const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

const { dbConfig, db } = require('./src/db/init');

// Initialize MySQL connection pool
const pool = mysql.createPool({
  host: process.env.AIVEN_MYSQL_HOST,
  port: process.env.AIVEN_MYSQL_PORT || 3306,
  database: process.env.AIVEN_MYSQL_DATABASE,
  user: process.env.AIVEN_MYSQL_USER,
  password: process.env.AIVEN_MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Determine environment and set upload directory
const IS_VERCEL = process.env.VERCEL === '1';
const UPLOADS_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'uploads');
const PROCESSED_DIR = IS_VERCEL ? '/tmp/processed' : path.join(uploadsDir, 'processed');
const AVATARS_DIR = IS_VERCEL ? '/tmp/avatars' : path.join(uploadsDir, 'avatars');
const COVERS_DIR = IS_VERCEL ? '/tmp/covers' : path.join(uploadsDir, 'covers');

// Create directories only in local development (Vercel uses /tmp)
if (!IS_VERCEL) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// Configure multer based on environment
// On Vercel: use memory storage since /tmp is ephemeral and serverless functions
// restart frequently, requiring immediate upload to ImageKit cloud storage
// On local: use disk storage with ./uploads directory
let upload;
if (IS_VERCEL) {
  // Memory storage for Vercel serverless - files are processed in-memory
  // and uploaded to ImageKit immediately
  const memoryStorage = multer.memoryStorage({
    destination: (req, file, cb) => {
      cb(null, '');
    }
  });
  upload = multer({
    storage: memoryStorage,
    limits: { fileSize: 8 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => {
      const permitted = ['image/jpeg', 'image/png', 'image/webp'];
      if (permitted.includes(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
    }
  });
} else {
  // Disk storage for local development
  const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      cb(null, uniqueName);
    }
  });
  upload = multer({
    storage: diskStorage,
    limits: { fileSize: 8 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => {
      const permitted = ['image/jpeg', 'image/png', 'image/webp'];
      if (permitted.includes(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
    }
  });
}

const artworkUpload = upload.array('images', 6);

function uploadRequestWantsJson(req) {
  return req.xhr
    || req.get('X-Requested-With') === 'XMLHttpRequest'
    || (req.get('Accept') || '').includes('application/json');
}

function getUploadErrorMessage(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return 'That image is larger than 8 MB. Please choose a smaller file.';
    if (error.code === 'LIMIT_FILE_COUNT') return 'Please upload no more than 6 artwork images at once.';
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return 'That file field is not recognized. Please choose your artwork image again.';
    return 'We could not receive that file. Please try a JPG, PNG, or WEBP image.';
  }
  return error.message || 'We could not receive that image. Please try again.';
}

function handleArtworkUpload(req, res, next) {
  artworkUpload(req, res, async (error) => {
    if (!error) {
      next();
      return;
    }

    const message = getUploadErrorMessage(error);
    if (uploadRequestWantsJson(req)) {
      res.status(400).json({ ok: false, error: message, field: 'images' });
      return;
    }

    res.status(400).render('pages/upload', {
      error: message,
      formValues: req.body || {},
      pageTitle: 'Upload artwork'
    });
  });
}

// ImageKit configuration and upload function
const imagekit = {
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'your-public-key-here',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'your-private-key-here',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://your-url-endpoint.iframe.imagekit.io'
};

// Initialize ImageKit SDK
const { imagekit } = require('@imagekit.io/node');
const ik = imagekit({
  publicKey: imagekit.publicKey,
  privateKey: imagekit.privateKey,
  urlEndpoint: imagekit.urlEndpoint
});

// Upload artwork images to ImageKit
async function uploadArtworkToImageKit(files, userId) {
  if (!files || files.length === 0) return [];

  const processedImages = [];

  for (const file of files) {
    try {
      let buffer = file.buffer;
      let originalName = file.originalname || 'artwork.jpg';

      // If using memory storage (Vercel), file is a Buffer
      // If using disk storage (local), read from path
      if (!buffer && file.path) {
        const fs = require('fs');
        buffer = fs.readFileSync(file.path);
        originalName = file.filename || originalName;
      }

      // Optimize image with sharp
      const optimized = sharp(buffer)
        .resize({ width: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      // Upload to ImageKit
      const result = await ik.upload({
        file: optimized,
        fileName: `${userId}-${Date.now()}-${path.extname(originalName)}`,
        folder: `/artspace/${userId}`
      });

      processedImages.push({
        image_url: result.url,
        thumbnail_url: result.thumbnailUrl || result.url,
        original_name: originalName
      });
    } catch (err) {
      console.error('ImageKit upload error:', err);
      // Fallback: use local path format
      processedImages.push({
        image_url: IS_VERCEL ? '/uploads/processed/fallback.jpg' : `/uploads/processed/${path.basename(file.path || originalName)}`,
        thumbnail_url: '/uploads/processed/fallback-thumb.webp',
        original_name: originalName
      });
    }
  }

  return processedImages;
}

// ImageKit configuration with provided credentials
const imagekit = {
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'public_1THau+UteDSvtH49YQq/QUrOcGg=',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'private_1YwvomC1l8IhLU1mIQ1GUh2aQjU=',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/x1cuwrrgc'
};

// Initialize ImageKit SDK
const { imagekit } = require('@imagekit.io/node');
const ik = imagekit({
  publicKey: imagekit.publicKey,
  privateKey: imagekit.privateKey,
  urlEndpoint: imagekit.urlEndpoint
});

// Upload artwork images to ImageKit
async function uploadArtworkToImageKit(files, userId) {
  if (!files || files.length === 0) return [];

  const processedImages = [];

  for (const file of files) {
    try {
      let buffer = file.buffer;
      let originalName = file.originalname || 'artwork.jpg';

      // If using memory storage (Vercel), file is a Buffer
      // If using disk storage (local), read from path
      if (!buffer && file.path) {
        const fs = require('fs');
        buffer = fs.readFileSync(file.path);
        originalName = file.filename || originalName;
      }

      // Optimize image with sharp
      const optimized = sharp(buffer)
        .resize({ width: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      // Upload to ImageKit
      const result = await ik.upload({
        file: optimized,
        fileName: `${userId}-${Date.now()}-${path.extname(originalName)}`,
        folder: `/artspace/${userId}`
      });

      processedImages.push({
        image_url: result.url,
        thumbnail_url: result.thumbnailUrl || result.url,
        original_name: originalName
      });
    } catch (err) {
      console.error('ImageKit upload error:', err);
      // Fallback: use local path format
      processedImages.push({
        image_url: IS_VERCEL ? '/uploads/processed/fallback.jpg' : `/uploads/processed/${path.basename(file.path || originalName)}`,
        thumbnail_url: '/uploads/processed/fallback-thumb.webp',
        original_name: originalName
      });
    }
  }

  return processedImages;
}

// Add IS_VERCEL to res.locals for template rendering
app.use((req, res, next) => {
  res.locals.isVercel = IS_VERCEL;
  res.locals.appName = 'ArtSpace';
  next();
});

app.use(compression());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ... rest of the server configuration continues below
// Routes, etc. remain the same as original server.js