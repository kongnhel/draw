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
const ImageKit = require('imagekit');

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

// Initialize ImageKit SDK
const ik = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'public_1THau+UteDSvtH49YQq/QUrOcGg=',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'private_1YwvomC1l8IhLU1mIQ1GUh2aQjU=',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/x1cuwrrgc'
});

// Determine environment and set upload directories
const IS_VERCEL = process.env.VERCEL === '1';
const UPLOADS_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'uploads');
const PROCESSED_DIR = IS_VERCEL ? '/tmp/processed' : path.join(UPLOADS_DIR, 'processed');
const AVATARS_DIR = IS_VERCEL ? '/tmp/avatars' : path.join(UPLOADS_DIR, 'avatars');
const COVERS_DIR = IS_VERCEL ? '/tmp/covers' : path.join(UPLOADS_DIR, 'covers');

// Create directories only in local development
if (!IS_VERCEL) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// Configure multer based on environment
let upload;
if (IS_VERCEL) {
  const memoryStorage = multer.memoryStorage();
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

// Upload artwork images to ImageKit
async function uploadArtworkToImageKit(files, userId) {
  if (!files || files.length === 0) return [];

  const processedImages = [];

  for (const file of files) {
    try {
      let buffer = file.buffer;
      let originalName = file.originalname || 'artwork.jpg';

      if (!buffer && file.path) {
        buffer = fs.readFileSync(file.path);
        originalName = file.filename || originalName;
      }

      const optimized = await sharp(buffer)
        .resize({ width: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

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
      processedImages.push({
        image_url: IS_VERCEL ? '/uploads/processed/fallback.jpg' : `/uploads/processed/${path.basename(file.path || originalName)}`,
        thumbnail_url: '/uploads/processed/fallback-thumb.webp',
        original_name: originalName
      });
    }
  }

  return processedImages;
}

const app = express();

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

// Add your app routes here (e.g., app.get('/', ...))

// 1. Export the app instance for Vercel Serverless Functions
module.exports = app;

// 2. Start the HTTP listener only during local development
if (!IS_VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
  });
}