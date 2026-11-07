const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
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

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason && (reason.stack || reason.message || reason));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error && (error.stack || error.message || error));
});

const { db, getPool } = require('./src/db/init');

// Initialize ImageKit SDK (credentials must come from environment variables)
let ik = null;
if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) {
  ik = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
  });
}

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

// Configure Multer based on environment
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

function requestWantsJson(req) {
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

function cleanupUploadedFiles(files) {
  (Array.isArray(files) ? files : []).forEach((file) => {
    if (file && file.path) {
      fs.unlink(file.path, () => {});
    }
  });
}

async function renderUploadPageWithError(req, res, status, message, formValues) {
  let categories = [];

  try {
    categories = await db.execute(
      'SELECT id, name, slug FROM categories ORDER BY sort_order ASC'
    );
  } catch (err) {
    console.error('Could not load upload categories:', err);
  }

  res.status(status).render('pages/upload', {
    pageTitle: 'ArtSpace | Upload',
    categories: categories || [],
    error: message,
    formValues: formValues || req.body || {}
  });
}

function handleArtworkUpload(req, res, next) {
  artworkUpload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = getUploadErrorMessage(error);
    cleanupUploadedFiles(req.files);

    if (requestWantsJson(req)) {
      res.status(400).json({ ok: false, error: message, field: 'images' });
      return;
    }

    renderUploadPageWithError(req, res, 400, message).catch(next);
  });
}

async function storeArtworkLocally(buffer, originalName) {
  const baseName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const imageName = `${baseName}.webp`;
  const thumbName = `${baseName}-thumb.webp`;

  await fs.promises.writeFile(path.join(PROCESSED_DIR, imageName), buffer);

  try {
    const thumbnail = await sharp(buffer)
      .resize({ width: 640, height: 640, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    await fs.promises.writeFile(path.join(PROCESSED_DIR, thumbName), thumbnail);
    return {
      image_url: `/uploads/processed/${imageName}`,
      thumbnail_url: `/uploads/processed/${thumbName}`,
      original_name: originalName
    };
  } catch (err) {
    console.error('Artwork thumbnail generation failed:', err);
    return {
      image_url: `/uploads/processed/${imageName}`,
      thumbnail_url: `/uploads/processed/${imageName}`,
      original_name: originalName
    };
  }
}

// Upload artwork images to ImageKit, with a local fallback for development
async function uploadArtworkToImageKit(files, userId) {
  if (!files || files.length === 0) return [];

  const processedImages = [];

  for (const file of files) {
    const originalName = file.originalname || 'artwork.jpg';

    try {
      let buffer = file.buffer;

      if (!buffer && file.path) {
        buffer = fs.readFileSync(file.path);
      }

      if (!buffer) {
        throw new Error('We could not read that image. Please try again.');
      }

      let optimized;

      try {
        optimized = await sharp(buffer)
          .rotate()
          .resize({ width: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch (sharpError) {
        throw new Error('That file does not look like a valid image. Please choose a JPG, PNG, or WEBP.');
      }

      if (ik) {
        try {
          const result = await ik.upload({
            file: optimized,
            fileName: `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`,
            folder: `/artspace/${userId}`
          });

          processedImages.push({
            image_url: result.url,
            thumbnail_url: result.thumbnailUrl || result.url,
            original_name: originalName
          });
          continue;
        } catch (uploadError) {
          console.error('ImageKit artwork upload failed:', uploadError);

          if (IS_VERCEL) {
            throw new Error('We could not save that image right now. Please try again.');
          }
        }
      } else if (IS_VERCEL) {
        throw new Error('Image storage is not configured. Please contact support.');
      }

      processedImages.push(await storeArtworkLocally(optimized, originalName));
    } finally {
      if (file.path) {
        fs.unlink(file.path, () => {});
      }
    }
  }

  return processedImages;
}

// Profile edit helpers
async function loadProfileEditUser(userId) {
  const rows = await db.execute(
    `SELECT id, name, username, email, bio, avatar, cover_image, website, instagram, twitter,
            COALESCE(NULLIF(name, ''), username) AS display_name
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function uploadProfileImage(file, userId, kind) {
  if (!ik) throw new Error('ImageKit is not configured. Set the IMAGEKIT_* environment variables.');

  let buffer = file.buffer;
  if (!buffer && file.path) {
    buffer = fs.readFileSync(file.path);
    fs.unlink(file.path, () => {});
  }
  if (!buffer) throw new Error('We could not read that image. Please try again.');

  const resizeOptions = kind === 'avatar'
    ? { width: 400, height: 400, fit: 'cover' }
    : { width: 1600, height: 500, fit: 'cover' };

  const optimized = await sharp(buffer)
    .resize(resizeOptions)
    .webp({ quality: 85 })
    .toBuffer();

  const result = await ik.upload({
    file: optimized,
    fileName: `${userId}-${kind}-${Date.now()}.webp`,
    folder: `/artspace/profiles/${userId}`
  });

  return result.url;
}

const profileUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cover_image', maxCount: 1 }
]);

function handleProfileUpload(req, res, next) {
  profileUpload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = getUploadErrorMessage(error);
    loadProfileEditUser(req.session.user.id)
      .then((user) => {
        res.status(400).render('pages/profile-edit', {
          pageTitle: 'ArtSpace | Edit Profile',
          user: user || { ...req.session.user, display_name: req.session.user.display_name || req.session.user.username },
          error: message
        });
      })
      .catch(next);
  });
}

// Persistent session store backed by MySQL (required on serverless platforms like Vercel)
class MySQLSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlSeconds = options.ttlSeconds || 14 * 24 * 60 * 60;
  }

  get(sid, callback) {
    db.execute('SELECT data FROM sessions WHERE sid = ? AND expires > NOW() LIMIT 1', [sid])
      .then((rows) => {
        if (!rows || !rows.length) return callback(null, null);
        try {
          callback(null, JSON.parse(rows[0].data));
        } catch (error) {
          console.error('Session parse failed:', error.message);
          callback(null, null);
        }
      })
      .catch((error) => {
        console.error('Session read failed:', error && (error.code || error.message));
        callback(null, null);
      });
  }

  set(sid, sessionData, callback) {
    db.execute(
      `INSERT INTO sessions (sid, data, expires)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE data = VALUES(data), expires = DATE_ADD(NOW(), INTERVAL ? SECOND)`,
      [sid, JSON.stringify(sessionData), this.ttlSeconds, this.ttlSeconds]
    ).then(() => callback(null)).catch((error) => {
      console.error('Session write failed:', error && (error.code || error.message));
      callback(null);
    });
  }

  touch(sid, sessionData, callback) {
    db.execute(
      'UPDATE sessions SET expires = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE sid = ?',
      [this.ttlSeconds, sid]
    ).then(() => callback(null)).catch((error) => {
      console.error('Session touch failed:', error && (error.code || error.message));
      callback(null);
    });
  }

  destroy(sid, callback) {
    db.execute('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => callback(null))
      .catch((error) => {
        console.error('Session destroy failed:', error && (error.code || error.message));
        callback(null);
      });
  }

  length(callback) {
    db.execute('SELECT COUNT(*) AS count FROM sessions WHERE expires > NOW()')
      .then((rows) => callback(null, Number(rows[0].count)))
      .catch(callback);
  }

  clear(callback) {
    db.execute('DELETE FROM sessions')
      .then(() => callback(null))
      .catch(callback);
  }
}

const IMAGEKIT_ENDPOINT = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');

function isTransformableImage(url) {
  return Boolean(IMAGEKIT_ENDPOINT && typeof url === 'string' && url.startsWith(IMAGEKIT_ENDPOINT));
}

function transformImageUrl(url, width, quality = 78) {
  if (!isTransformableImage(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}tr=w-${Math.round(width)},q-${quality},f-auto`;
}

function buildImageSrcset(url, widths, quality = 78) {
  if (!isTransformableImage(url)) return '';
  return widths
    .map((width) => `${transformImageUrl(url, width, quality)} ${width}w`)
    .join(', ');
}

function artworkCardSrc(artwork, width = 480) {
  if (!artwork) return '/images/default-artwork.svg';
  if (isTransformableImage(artwork.image_url)) return transformImageUrl(artwork.image_url, width);
  return artwork.thumbnail_url || artwork.image_url || '/images/default-artwork.svg';
}

function artworkCardSrcset(artwork, widths = [320, 480, 640, 800]) {
  if (!artwork) return '';
  return buildImageSrcset(artwork.image_url, widths);
}

const imageTools = {
  isTransformable: isTransformableImage,
  transformUrl: transformImageUrl,
  srcset: buildImageSrcset,
  cardSrc: artworkCardSrc,
  cardSrcset: artworkCardSrcset
};

const imagekitOrigin = (() => {
  try {
    return IMAGEKIT_ENDPOINT ? new URL(IMAGEKIT_ENDPOINT).origin : '';
  } catch (error) {
    return '';
  }
})();

const PIN_LIMIT = Math.max(1, Number.parseInt(process.env.PIN_LIMIT, 10) || 3);

const ASSET_VERSION = (() => {
  const assetFiles = [
    'public/css/styles.css',
    'public/css/cursor.css',
    'public/css/interactions.css',
    'public/css/background-falling.css',
    'public/css/mobile.css',
    'public/css/navbar-sketch.css',
    'public/css/spa-nav.css',
    'public/css/intro.css',
    'public/css/sketchbook.css',
    'public/css/pins.css',
    'public/css/journey.css',
    'public/css/image-editor.css',
    'public/js/intro.js',
    'public/js/app.js',
    'public/js/spa-nav.js',
    'public/js/navbar.js',
    'public/js/cursor.js',
    'public/js/interactions.js',
    'public/js/background-falling.js',
    'public/js/image-editor.js',
    'public/js/profile-edit.js',
    'public/vendor/page-flip.browser.js',
    'public/vendor/cropper.min.js',
    'public/vendor/cropper.min.css'
  ];
  const hash = crypto.createHash('sha1');
  for (const relative of assetFiles) {
    try {
      hash.update(fs.readFileSync(path.join(__dirname, relative)));
    } catch (error) {
      /* optional asset */
    }
  }
  return hash.digest('hex').slice(0, 10);
})();

async function getPinnedArtworkIds(userId) {
  if (!userId) return new Set();
  try {
    const rows = await db.execute('SELECT artwork_id FROM artwork_pins WHERE user_id = ?', [userId]);
    return new Set((rows || []).map((row) => Number(row.artwork_id)));
  } catch (error) {
    console.error('Could not load pinned artwork ids:', error);
    return new Set();
  }
}

async function countUserPins(userId) {
  if (!userId) return 0;
  const rows = await db.execute('SELECT COUNT(*) AS count FROM artwork_pins WHERE user_id = ?', [userId]);
  return Number((rows && rows[0] && rows[0].count) || 0);
}

async function getPinnedHomepageArtworks(viewerId) {
  const rows = await db.execute(
    `SELECT a.id, a.user_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
            u.username,
            COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
            u.avatar,
            c.name AS category_name, c.slug AS category_slug,
            a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
            p.created_at AS pinned_at, DATE_FORMAT(p.created_at, '%b %d, %Y') AS pinned_at_label,
            (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
            (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
            0 AS is_liked, 0 AS is_bookmarked, 'auto' AS visual_effect
       FROM artwork_pins p
       INNER JOIN artworks a ON a.id = p.artwork_id
       INNER JOIN users u ON u.id = a.user_id
       LEFT JOIN categories c ON c.id = a.category_id
      WHERE p.user_id = a.user_id
        AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 12`
  );

  const pinned = (rows || []).map((row) => ({ ...row }));
  if (!pinned.length) return pinned;

  if (viewerId) {
    const ids = pinned.map((row) => Number(row.id));
    const placeholders = ids.map(() => '?').join(',');
    try {
      const [likedRows, savedRows] = await Promise.all([
        db.execute(
          `SELECT artwork_id FROM likes WHERE user_id = ? AND artwork_id IN (${placeholders})`,
          [viewerId, ...ids]
        ),
        db.execute(
          `SELECT artwork_id FROM bookmarks WHERE user_id = ? AND artwork_id IN (${placeholders})`,
          [viewerId, ...ids]
        )
      ]);
      const likedSet = new Set((likedRows || []).map((row) => Number(row.artwork_id)));
      const savedSet = new Set((savedRows || []).map((row) => Number(row.artwork_id)));
      pinned.forEach((row) => {
        row.is_liked = likedSet.has(Number(row.id)) ? 1 : 0;
        row.is_bookmarked = savedSet.has(Number(row.id)) ? 1 : 0;
      });
    } catch (error) {
      console.error('Could not personalize pinned artworks:', error);
    }
  }

  return pinned;
}

const app = express();
app.disable('x-powered-by');

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function requireAuthJson(req, res, next) {
  if (req.session && req.session.user) return next();
  if (requestWantsJson(req)) {
    res.status(401).json({ ok: false, error: 'Please log in to pin artwork.' });
    return;
  }
  res.redirect('/login');
}

function respondPinSuccess(req, res, payload) {
  if (requestWantsJson(req)) {
    res.json({
      ok: true,
      pinned: Boolean(payload.pinned),
      count: payload.count,
      limit: PIN_LIMIT,
      artworkId: payload.artworkId
    });
    return;
  }
  res.redirect(getSafeActionRedirect(req, '/'));
}

function respondPinError(req, res, status, message) {
  if (requestWantsJson(req)) {
    res.status(status).json({ ok: false, error: message });
    return;
  }
  respondArtworkActionError(req, res, status, message);
}

function getSafeActionRedirect(req, fallback) {
  const referer = req.get('Referer');

  if (!referer) return fallback;

  try {
    const target = new URL(referer);
    if (target.host !== req.get('host')) return fallback;
    return `${target.pathname}${target.search}`;
  } catch (error) {
    return fallback;
  }
}

function respondArtworkActionError(req, res, status, message) {
  if (requestWantsJson(req)) {
    res.status(status).json({ ok: false, error: message });
    return;
  }

  res.status(status).render('pages/error', {
    message,
    pageTitle: 'ArtSpace | Page not found',
    isAuthenticated: Boolean(req.session && req.session.user),
    currentUser: (req.session && req.session.user) || null,
    unreadNotifications: 0
  });
}

app.use(compression());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (!IS_VERCEL) return;
    if (/\.(?:css|js|mjs|woff2?|ttf|svg|png|jpe?g|webp|avif|wav|mp3)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  etag: true,
  setHeaders: (res) => {
    if (!IS_VERCEL) return;
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  }
}));

const CSS_BUNDLE_FILES = [
  'styles.css',
  'cursor.css',
  'interactions.css',
  'background-falling.css',
  'mobile.css',
  'navbar-sketch.css',
  'spa-nav.css',
  'intro.css',
  'sketchbook.css',
  'pins.css',
  'journey.css'
];
let cssBundleCache = { key: '', css: '', gzip: null, br: null };

function buildCssBundle() {
  const cssDir = path.join(__dirname, 'public', 'css');
  const key = CSS_BUNDLE_FILES.map((file) => {
    try {
      const stat = fs.statSync(path.join(cssDir, file));
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    } catch (error) {
      return `${file}:0`;
    }
  }).join('|');

  if (cssBundleCache.key === key) return cssBundleCache;

  const css = CSS_BUNDLE_FILES.map((file) => {
    try {
      return fs.readFileSync(path.join(cssDir, file), 'utf8');
    } catch (error) {
      return '';
    }
  }).join('\n');

  let gzip = null;
  let br = null;
  try {
    gzip = zlib.gzipSync(Buffer.from(css), { level: 9 });
  } catch (error) {
    gzip = null;
  }
  try {
    br = zlib.brotliCompressSync(Buffer.from(css), {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(css)
      }
    });
  } catch (error) {
    br = null;
  }

  cssBundleCache = { key, css, gzip, br };
  return cssBundleCache;
}

app.get('/css/bundle.css', (req, res, next) => {
  try {
    const bundle = buildCssBundle();
    const accept = String(req.headers['accept-encoding'] || '');
    res.type('text/css');
    const versioned = Boolean(req.query.v);
    res.set('Cache-Control', IS_VERCEL ? (versioned ? 'public, max-age=31536000, immutable' : 'no-cache') : 'no-cache');
    res.set('Vary', 'Accept-Encoding');

    if (bundle.br && /\bbr\b/.test(accept)) {
      res.set('Content-Encoding', 'br');
      res.send(bundle.br);
      return;
    }
    if (bundle.gzip && /\bgzip\b/.test(accept)) {
      res.set('Content-Encoding', 'gzip');
      res.send(bundle.gzip);
      return;
    }
    res.send(bundle.css);
  } catch (error) {
    next(error);
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'artspace-dev-secret',
  store: new MySQLSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_VERCEL,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// Add IS_VERCEL and auth state to res.locals for template rendering
app.use((req, res, next) => {
  const currentUser = (req.session && req.session.user) || null;
  res.locals.isVercel = IS_VERCEL;
  res.locals.appName = 'ArtSpace';
  res.locals.currentUser = currentUser;
  res.locals.isAuthenticated = Boolean(currentUser);
  res.locals.unreadNotifications = 0;
  res.locals.pinLimit = PIN_LIMIT;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.imageTools = imageTools;
  res.locals.imagekitOrigin = imagekitOrigin;
  next();
});

// ----------------------------------------------------
// ROUTES (MUST BE PLACED BEFORE 404 CATCH-ALL)
// ----------------------------------------------------

// 1. Home Page Route
app.get('/', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;

    const [totalArtworkRows, bookArtworks, artistRows, categoryRows, pinnedArtworks, pinnedIds] = await Promise.all([
      db.execute(
        "SELECT COUNT(*) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1 AND status = 'active'"
      ),
      db.execute(
        `SELECT a.id, a.user_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar,
                c.name AS category_name, c.slug AS category_slug,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                a.visibility, a.is_published,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           INNER JOIN categories c ON c.id = a.category_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
          ORDER BY a.created_at DESC
          LIMIT 48`,
        [viewerId, viewerId]
      ),
      db.execute(
        `SELECT u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar, u.bio,
                COUNT(a.id) AS art_count
           FROM users u
           LEFT JOIN artworks a ON a.user_id = u.id AND a.visibility = 'public' AND a.is_published = 1
           GROUP BY u.id
           ORDER BY art_count DESC
           LIMIT 1`
      ),
      db.execute(
        `SELECT c.slug, c.name, COUNT(a.id) AS count
           FROM categories c
           LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1
           GROUP BY c.id
           ORDER BY c.sort_order`
      ),
      getPinnedHomepageArtworks(viewerId),
      getPinnedArtworkIds(viewerId)
    ]);

    const totalArtworks = Number((totalArtworkRows && totalArtworkRows[0] && totalArtworkRows[0].count) || 0);
    const pinnedIdSet = new Set((pinnedArtworks || []).map((artwork) => Number(artwork.id)));
    const latest = (bookArtworks || [])
      .filter((artwork) => !pinnedIdSet.has(Number(artwork.id)))
      .slice(0, 9);
    const viewerPinnedArtwork = (pinnedArtworks || [])
      .find((artwork) => pinnedIds.has(Number(artwork.id)))
      || (bookArtworks || []).find((artwork) => pinnedIds.has(Number(artwork.id)))
      || null;
    const heroArtwork = viewerPinnedArtwork
      || (pinnedArtworks && pinnedArtworks[0])
      || (bookArtworks && bookArtworks[0])
      || null;
    const heroArtworkIndex = heroArtwork
      ? Math.max(0, (bookArtworks || []).findIndex((artwork) => Number(artwork.id) === Number(heroArtwork.id)))
      : 0;
    const artistSpotlight = (artistRows && artistRows[0]) || null;
    const visibleCategories = (categoryRows || []).map((category) => ({
      slug: category.slug,
      name: category.name,
      count: Number(category.count) || 0
    }));

    const homeArtistCount = new Set((bookArtworks || []).map((artwork) => artwork.username)).size;

    const currentUser = (req.session && req.session.user) || null;
    const isAuthenticated = Boolean(currentUser);

    res.render('pages/home', {
      pageTitle: 'ArtSpace | Discover original artwork',
      isAuthenticated,
      currentUser,
      unreadNotifications: 0,
      totalArtworks,
      heroArtwork,
      heroArtworkImageUrl: heroArtwork ? (heroArtwork.image_url || heroArtwork.thumbnail_url) : null,
      heroArtworkIndex,
      bookArtworks: bookArtworks || [],
      latest,
      artistSpotlight,
      visibleCategories,
      homeArtistCount,
      liveCategoryCount: visibleCategories.filter((category) => Number(category.count) > 0).length,
      pinnedArtworks: pinnedArtworks || [],
      pinnedIds
    });
  } catch (err) {
    next(err);
  }
});

// 2. Explore Page Route
// 2. Explore Page Route
app.get('/explore', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const query = req.query.q || '';
    const filter = req.query.category || 'all';
    const sort = req.query.sort || 'latest';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 12;
    const offset = (page - 1) * pageSize;

    const whereConditions = ["a.visibility = 'public'", "a.is_published = 1", "a.status = 'active'"];
    const queryParams = [];

    if (filter !== 'all') {
      whereConditions.push('c.slug = ?');
      queryParams.push(filter);
    }

    if (query) {
      whereConditions.push('(a.title LIKE ? OR a.tags LIKE ? OR u.username LIKE ?)');
      queryParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const sortMap = {
      latest: 'a.created_at DESC',
      views: 'a.created_at DESC',
      popular: 'likes_count DESC, a.created_at DESC'
    };
    const orderBy = sortMap[sort] || 'a.created_at DESC';

    const [categoryRows, artworks, filteredCountRows, totalRows, artistRows, artistSpotlightRows] = await Promise.all([
      db.execute(
        `SELECT c.slug, c.name, COUNT(a.id) AS count
           FROM categories c
           LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1
           GROUP BY c.id
           ORDER BY c.sort_order`
      ),
      db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar,
                c.name AS category_name, c.slug AS category_slug,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           INNER JOIN categories c ON c.id = a.category_id
          ${whereClause}
          ORDER BY ${orderBy}
          LIMIT ${pageSize} OFFSET ${offset}`,
        [viewerId, viewerId, ...queryParams]
      ),
      db.execute(
        `SELECT COUNT(*) AS count
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           INNER JOIN categories c ON c.id = a.category_id
          ${whereClause}`,
        queryParams
      ),
      db.execute("SELECT COUNT(*) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1"),
      db.execute("SELECT COUNT(DISTINCT user_id) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1"),
      db.execute(
        `SELECT u.id, u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar, u.bio,
                COUNT(a.id) AS art_count,
                (SELECT COUNT(*)
                   FROM likes l
                   INNER JOIN artworks la ON la.id = l.artwork_id
                  WHERE la.user_id = u.id
                    AND la.visibility = 'public' AND la.is_published = 1 AND la.status = 'active') AS likes_count
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
          GROUP BY u.id
          ORDER BY art_count DESC
          LIMIT 6`
      )
    ]);

    const categories = (categoryRows || []).map((row) => ({
      slug: row.slug,
      name: row.name,
      count: Number(row.count) || 0
    }));
    const filteredTotal = Number((filteredCountRows && filteredCountRows[0] && filteredCountRows[0].count) || 0);
    const totalArtworks = Number((totalRows && totalRows[0] && totalRows[0].count) || 0);
    const artistCount = Number((artistRows && artistRows[0] && artistRows[0].count) || 0);
    const artists = artistSpotlightRows || [];

    const activeCategory = filter !== 'all'
      ? (categories.find((category) => category.slug === filter) || null)
      : null;

    const mediumCount = categories.length;
    const spotlightArtwork = (artworks && artworks.length > 0) ? artworks[0] : null;
    const loadedItems = artworks ? artworks.length : 0;
    const pinnedIds = await getPinnedArtworkIds(viewerId);

    const pagination = {
      page,
      pageSize,
      total: filteredTotal,
      start: filteredTotal === 0 ? 0 : offset + 1,
      end: Math.min(offset + loadedItems, filteredTotal),
      hasMore: offset + loadedItems < filteredTotal,
      nextPage: page + 1,
      remaining: Math.max(0, filteredTotal - (offset + loadedItems))
    };

    res.render('pages/explore', {
      pageTitle: 'ArtSpace | Explore',
      query,
      filter,
      categories,
      artworks: artworks || [],
      spotlightArtwork,
      artists,
      activeCategory,
      pagination,
      total: filteredTotal,
      totalArtworks,
      artistCount,
      mediumCount,
      sort,
      pinnedIds
    });
  } catch (err) {
    next(err);
  }
});

// 3. Upload Page Route
app.get('/upload', requireAuth, async (req, res, next) => {
  try {
    const categories = await db.execute(
      `SELECT id, name, slug FROM categories ORDER BY sort_order ASC`
    );

    res.render('pages/upload', {
      pageTitle: 'ArtSpace | Upload',
      categories: categories || [],
      error: null,
      formValues: {}
    });
  } catch (err) {
    next(err);
  }
});

app.post('/upload', requireAuth, handleArtworkUpload, async (req, res, next) => {
  const wantsJson = requestWantsJson(req);

  const respondError = async (status, message, field) => {
    cleanupUploadedFiles(req.files);

    if (wantsJson) {
      const payload = { ok: false, error: message };
      if (field) payload.field = field;
      res.status(status).json(payload);
      return;
    }

    await renderUploadPageWithError(req, res, status, message);
  };

  try {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 1200);
    const tags = String(req.body.tags || '').trim().slice(0, 180);
    const categoryValue = String(req.body.category || '').trim();
    const categoryId = /^\d+$/.test(categoryValue) ? Number.parseInt(categoryValue, 10) : NaN;
    const visibility = req.body.visibility === 'private' ? 'private' : 'public';
    const saveAsDraft = req.body.save_as_draft === 'on' || req.body.save_as_draft === '1';
    const file = Array.isArray(req.files) ? req.files[0] : null;

    cleanupUploadedFiles((req.files || []).slice(1));

    if (!title) {
      await respondError(400, 'Give your artwork a title before publishing.', 'title');
      return;
    }

    if (!Number.isFinite(categoryId)) {
      await respondError(400, 'Choose a category for your artwork.', 'category');
      return;
    }

    if (!file) {
      await respondError(400, 'Add an image of your artwork before publishing.', 'images');
      return;
    }

    const categoryRows = await db.execute(
      'SELECT id FROM categories WHERE id = ? LIMIT 1',
      [categoryId]
    );

    if (!categoryRows || categoryRows.length === 0) {
      await respondError(400, 'That category is not available. Choose another one.', 'category');
      return;
    }

    const processed = await uploadArtworkToImageKit([file], req.session.user.id);
    const artworkImage = processed[0];

    if (!artworkImage || !artworkImage.image_url) {
      await respondError(502, 'We could not save that image. Please try again.', 'images');
      return;
    }

    const isPublished = saveAsDraft ? 0 : 1;
    const createdOn = String(req.body.created_at || '').trim();
    let createdAt = null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(createdOn)) {
      const parsedDate = new Date(`${createdOn}T00:00:00Z`);
      if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === createdOn) {
        createdAt = `${createdOn} 12:00:00`;
      }
    }

    const result = await db.execute(
      `INSERT INTO artworks
         (user_id, category_id, title, description, tags, image_url, thumbnail_url,
          visibility, is_published, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', COALESCE(?, NOW()), NOW())`,
      [
        req.session.user.id,
        categoryId,
        title,
        description || null,
        tags || null,
        artworkImage.image_url,
        artworkImage.thumbnail_url || artworkImage.image_url,
        visibility,
        isPublished,
        createdAt
      ]
    );

    const artworkId = result.insertId;
    const artworkUrl = visibility === 'private' || saveAsDraft
      ? '/dashboard'
      : `/art/${artworkId}`;

    if (wantsJson) {
      res.status(201).json({
        ok: true,
        id: artworkId,
        isDraft: saveAsDraft,
        isPrivate: visibility === 'private',
        artworkImageUrl: artworkImage.image_url,
        artworkUrl,
        artworkEditUrl: '/dashboard'
      });
      return;
    }

    res.redirect(artworkUrl);
  } catch (err) {
    cleanupUploadedFiles(req.files);
    console.error('Artwork upload failed:', err);

    if (wantsJson) {
      const message = err.message && err.message.startsWith('We ')
        ? err.message
        : 'We could not publish this page. Please try again.';
      res.status(500).json({ ok: false, error: message });
      return;
    }

    next(err);
  }
});

// 4. Login Page Route
app.get('/login', (req, res) => {
  res.render('pages/login', {
    pageTitle: 'ArtSpace | Login',
    error: null,
    formValues: {}
  });
});

// 5. Register Page Route
app.get('/register', (req, res) => {
  res.render('pages/register', {
    pageTitle: 'ArtSpace | Register',
    error: null,
    formValues: {}
  });
});

// Register submission
app.post('/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.display_name || '').trim() || username;

    const renderError = (message) => res.status(400).render('pages/register', {
      pageTitle: 'ArtSpace | Register',
      error: message,
      formValues: { username, display_name: displayName, email }
    });

    if (!username || !email || password.length < 6) {
      return renderError('Please provide a username, email, and a password of at least 6 characters.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return renderError('Please enter a valid email address.');
    }

    const existing = await db.execute(
      'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    if (existing && existing.length) {
      return renderError('That username or email is already registered.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.execute(
      `INSERT INTO users (username, email, password, name, role, status)
       VALUES (?, ?, ?, ?, 'artist', 'active')`,
      [username, email, passwordHash, displayName]
    );

    req.session.user = {
      id: result && result.insertId,
      username,
      email,
      display_name: displayName,
      avatar: null,
      role: 'artist'
    };
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// Login submission
app.post('/login', async (req, res, next) => {
  try {
    const identifier = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    const rows = await db.execute(
      `SELECT id, name, username, email, password, role, status, avatar
         FROM users
        WHERE email = ? OR username = ?
        LIMIT 1`,
      [identifier, identifier]
    );
    const user = (rows && rows[0]) || null;

    let valid = false;
    if (user) {
      const stored = String(user.password || '');
      valid = stored.startsWith('$2')
        ? await bcrypt.compare(password, stored)
        : stored === password;
    }

    if (!user || !valid) {
      return res.status(401).render('pages/login', {
        pageTitle: 'ArtSpace | Login',
        error: 'That email or password does not match our records.'
      });
    }

    if (user.status && user.status !== 'active') {
      return res.status(403).render('pages/login', {
        pageTitle: 'ArtSpace | Login',
        error: 'This account is not active. Please contact support.'
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.name || user.username,
      avatar: user.avatar || null,
      role: user.role
    };
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// Logout
const logoutHandler = (req, res) => {
  if (!req.session) return res.redirect('/');
  req.session.destroy(() => res.redirect('/'));
};
app.get('/logout', logoutHandler);
app.post('/logout', logoutHandler);

// Forgot password submission (demo build)
app.post('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', {
    pageTitle: 'ArtSpace | Forgot password',
    message: 'Password reset flows are not active in this demo build.'
  });
});

// 6a. Profile Edit Routes (must be declared before /profile/:username)
app.get('/profile/edit', requireAuth, async (req, res, next) => {
  try {
    const user = await loadProfileEditUser(req.session.user.id);
    if (!user) {
      return req.session.destroy(() => res.redirect('/login'));
    }

    res.render('pages/profile-edit', {
      pageTitle: 'ArtSpace | Edit Profile',
      user,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

app.post('/profile/edit', requireAuth, handleProfileUpload, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const bio = String(req.body.bio || '').trim().slice(0, 600);
    let website = String(req.body.website || '').trim().slice(0, 255);
    const instagram = String(req.body.instagram || '').trim().slice(0, 100);
    const twitter = String(req.body.twitter || '').trim().slice(0, 100);

    if (website && !/^https?:\/\//i.test(website)) {
      website = `https://${website}`;
    }

    const avatarFile = req.files && req.files.avatar && req.files.avatar[0];
    const coverFile = req.files && req.files.cover_image && req.files.cover_image[0];

    let avatarUrl = null;
    let coverUrl = null;

    try {
      if (avatarFile) avatarUrl = await uploadProfileImage(avatarFile, userId, 'avatar');
      if (coverFile) coverUrl = await uploadProfileImage(coverFile, userId, 'cover');
    } catch (uploadError) {
      const user = await loadProfileEditUser(userId);
      return res.status(400).render('pages/profile-edit', {
        pageTitle: 'ArtSpace | Edit Profile',
        user: {
          ...(user || req.session.user),
          bio,
          website,
          instagram,
          twitter,
          display_name: (user && user.display_name) || req.session.user.display_name
        },
        error: uploadError.message || 'We could not process that image. Please try again.'
      });
    }

    await db.execute(
      `UPDATE users
          SET bio = ?,
              website = ?,
              instagram = ?,
              twitter = ?,
              avatar = COALESCE(?, avatar),
              cover_image = COALESCE(?, cover_image),
              updated_at = NOW()
        WHERE id = ?`,
      [bio || null, website || null, instagram || null, twitter || null, avatarUrl, coverUrl, userId]
    );

    if (avatarUrl) req.session.user.avatar = avatarUrl;
    res.redirect('/profile/' + encodeURIComponent(req.session.user.username));
  } catch (err) {
    next(err);
  }
});

// 6. Profile Page Route
app.get('/profile/:username', async (req, res, next) => {
  try {
    const targetUsername = req.params.username;
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const userRows = await db.execute(
      `SELECT u.id, u.username, u.email, u.role, (u.email_verified_at IS NOT NULL) AS is_verified,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              u.bio, u.cover_image, u.website, u.instagram, u.twitter
         FROM users u
        WHERE u.username = ?`,
      [targetUsername]
    );
    const profileUser = (userRows && userRows[0]) || null;

    if (!profileUser) {
      return res.status(404).render('pages/error', {
        message: 'User not found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: false,
        currentUser: null,
        unreadNotifications: 0
      });
    }

    const artRows = await db.execute(
      `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name,
              a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
              (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
              (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
              EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
              0 AS views, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.user_id = ? AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
        ORDER BY a.created_at DESC
        LIMIT 60`,
      [viewerId, viewerId, profileUser.id]
    );

    const likedRows = await db.execute(
      `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name,
              a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
              (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
              (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
              EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
              0 AS views, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         INNER JOIN likes liked_by ON liked_by.artwork_id = a.id AND liked_by.user_id = ?
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
        ORDER BY liked_by.created_at DESC
        LIMIT 60`,
      [viewerId, viewerId, profileUser.id]
    );

    const isOwner = Boolean(req.session && req.session.user && req.session.user.id === profileUser.id);
    let savedRows = [];
    let pinnedRows = [];

    if (isOwner) {
      savedRows = await db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar,
                c.name AS category_name,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           INNER JOIN bookmarks saved_by ON saved_by.artwork_id = a.id AND saved_by.user_id = ?
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
          ORDER BY saved_by.created_at DESC
          LIMIT 60`,
        [viewerId, viewerId, viewerId]
      );

      pinnedRows = await db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar,
                c.name AS category_name,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artwork_pins pin
           INNER JOIN artworks a ON a.id = pin.artwork_id
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE pin.user_id = ? AND a.user_id = ?
            AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
          ORDER BY pin.created_at DESC
          LIMIT 60`,
        [viewerId, viewerId, profileUser.id, profileUser.id]
      );
    }

    const countRows = await db.execute(
      "SELECT COUNT(*) AS count FROM artworks WHERE user_id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active'",
      [profileUser.id]
    );
    const totalArtworks = Number((countRows && countRows[0] && countRows[0].count) || 0);

    const likeCountRows = await db.execute(
      `SELECT COUNT(*) AS count
         FROM likes l
         INNER JOIN artworks a ON a.id = l.artwork_id
        WHERE a.user_id = ? AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'`,
      [profileUser.id]
    );
    const totalLikes = Number((likeCountRows && likeCountRows[0] && likeCountRows[0].count) || 0);

    const requestedTab = ['artworks', 'liked', 'saved', 'pinned'].includes(req.query.tab) ? req.query.tab : 'artworks';
    const activeTab = (requestedTab === 'saved' || requestedTab === 'pinned') && !isOwner ? 'artworks' : requestedTab;
    const pinnedIds = await getPinnedArtworkIds(viewerId);

    res.render('pages/profile', {
      pageTitle: `ArtSpace | ${profileUser.username}'s Profile`,
      profileUser,
      artworks: artRows || [],
      likedArtworks: likedRows || [],
      savedArtworks: savedRows || [],
      pinnedArtworks: pinnedRows || [],
      pinnedIds,
      stats: {
        totalArtworks,
        totalLikes,
        followers: 0,
        totalViews: 0
      },
      isFollowing: false,
      activeTab,
      memberSinceLabel: '',
      deletedNotice: req.query.deleted === '1'
    });
  } catch (err) {
    next(err);
  }
});

// 7. Artwork Detail Page Route
app.get('/art/:id', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      return res.status(404).render('pages/error', {
        message: 'The page you requested could not be found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: false,
        currentUser: null,
        unreadNotifications: 0
      });
    }

    const [rows, relatedRows] = await Promise.all([
      db.execute(
        `SELECT a.id, a.user_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                a.created_at, a.visibility,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar, u.bio,
                c.name AS category_name,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.id = ? AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
          LIMIT 1`,
        [viewerId, viewerId, artworkId]
      ),
      db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar,
                c.name AS category_name,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active' AND a.id <> ?
          ORDER BY a.created_at DESC
          LIMIT 4`,
        [viewerId, viewerId, artworkId]
      )
    ]);
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      return res.status(404).render('pages/error', {
        message: 'The artwork you requested could not be found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: false,
        currentUser: null,
        unreadNotifications: 0
      });
    }

    const pinnedIds = await getPinnedArtworkIds(viewerId);

    res.render('pages/artwork', {
      pageTitle: `ArtSpace | ${artwork.title}`,
      artwork,
      comments: [],
      related: relatedRows || [],
      artistStats: { isFollowing: false },
      pinnedIds
    });
  } catch (err) {
    next(err);
  }
});

function localUploadPath(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return null;

  const clean = decodeURIComponent(url.split('?')[0]);
  const relative = clean.slice('/uploads/'.length);
  const absolute = path.resolve(UPLOADS_DIR, relative);
  const root = path.resolve(UPLOADS_DIR) + path.sep;

  return absolute.startsWith(root) ? absolute : null;
}

async function deleteArtworkMedia(artwork) {
  const urls = [artwork.image_url, artwork.thumbnail_url].filter(Boolean);

  for (const url of urls) {
    const localPath = localUploadPath(url);
    if (!localPath) continue;
    try {
      await fs.promises.unlink(localPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Could not remove local artwork file:', err);
      }
    }
  }

  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  if (!ik || !endpoint) return;

  const remoteNames = new Set(
    urls
      .filter((url) => url.startsWith(endpoint))
      .map((url) => {
        try {
          return decodeURIComponent(new URL(url).pathname.split('/').pop());
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean)
  );

  if (remoteNames.size === 0) return;

  try {
    const files = await ik.listFiles({ path: `/artspace/${artwork.user_id}`, limit: 1000 });
    for (const file of files) {
      if (remoteNames.has(file.name)) {
        await ik.deleteFile(file.fileId);
      }
    }
  } catch (err) {
    console.error('Could not remove ImageKit artwork files:', err);
  }
}

// 7b. Artwork Like and Bookmark Actions
app.post('/art/:id/like', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const artworks = await db.execute(
      "SELECT id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const userId = req.session.user.id;
    const removed = await db.execute(
      'DELETE FROM likes WHERE user_id = ? AND artwork_id = ?',
      [userId, artworkId]
    );

    let liked = false;

    if (!removed || removed.affectedRows === 0) {
      await db.execute(
        'INSERT INTO likes (user_id, artwork_id) VALUES (?, ?)',
        [userId, artworkId]
      );
      liked = true;
    }

    const countRows = await db.execute(
      'SELECT COUNT(*) AS count FROM likes WHERE artwork_id = ?',
      [artworkId]
    );
    const likesCount = Number((countRows && countRows[0] && countRows[0].count) || 0);

    if (requestWantsJson(req)) {
      res.json({ ok: true, liked, likes_count: likesCount });
      return;
    }

    res.redirect(getSafeActionRedirect(req, `/art/${artworkId}`));
  } catch (err) {
    console.error('Artwork like toggle failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not update that like. Please try again.' });
      return;
    }
    next(err);
  }
});

app.post('/art/:id/bookmark', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const artworks = await db.execute(
      "SELECT id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const userId = req.session.user.id;
    const removed = await db.execute(
      'DELETE FROM bookmarks WHERE user_id = ? AND artwork_id = ?',
      [userId, artworkId]
    );

    let bookmarked = false;

    if (!removed || removed.affectedRows === 0) {
      await db.execute(
        'INSERT INTO bookmarks (user_id, artwork_id) VALUES (?, ?)',
        [userId, artworkId]
      );
      bookmarked = true;
    }

    if (requestWantsJson(req)) {
      res.json({ ok: true, bookmarked });
      return;
    }

    res.redirect(getSafeActionRedirect(req, `/art/${artworkId}`));
  } catch (err) {
    console.error('Artwork bookmark toggle failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not update that save. Please try again.' });
      return;
    }
    next(err);
  }
});

app.post('/art/:id/pin', requireAuthJson, async (req, res, next) => {
  const artworkId = parseInt(req.params.id, 10);
  const userId = Number(req.session.user.id);

  if (!Number.isFinite(artworkId)) {
    respondPinError(req, res, 404, 'The artwork you requested could not be found.');
    return;
  }

  let connection;

  try {
    const pinPool = await getPool();
    connection = await pinPool.getConnection();
    await connection.beginTransaction();

    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);

    const [artworkRows] = await connection.execute(
      'SELECT id, user_id, visibility, is_published, status FROM artworks WHERE id = ? LIMIT 1',
      [artworkId]
    );
    const artwork = artworkRows[0];

    if (!artwork) {
      await connection.rollback();
      respondPinError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) !== userId) {
      await connection.rollback();
      respondPinError(req, res, 403, 'You can only pin your own artwork.');
      return;
    }

    if (artwork.visibility !== 'public' || Number(artwork.is_published) !== 1 || artwork.status !== 'active') {
      await connection.rollback();
      respondPinError(req, res, 400, 'Only public, active artwork can be pinned.');
      return;
    }

    const [existing] = await connection.execute(
      'SELECT id FROM artwork_pins WHERE user_id = ? AND artwork_id = ? LIMIT 1',
      [userId, artworkId]
    );

    if (existing.length) {
      await connection.commit();
      const count = await countUserPins(userId);
      respondPinSuccess(req, res, { pinned: true, count, artworkId });
      return;
    }

    const [countRows] = await connection.execute(
      'SELECT COUNT(*) AS count FROM artwork_pins WHERE user_id = ?',
      [userId]
    );
    const count = Number((countRows[0] && countRows[0].count) || 0);

    if (count >= PIN_LIMIT) {
      await connection.rollback();
      respondPinError(req, res, 409, `You can pin up to ${PIN_LIMIT} artworks. Unpin one first.`);
      return;
    }

    await connection.execute(
      'INSERT INTO artwork_pins (user_id, artwork_id) VALUES (?, ?)',
      [userId, artworkId]
    );
    await connection.commit();
    respondPinSuccess(req, res, { pinned: true, count: count + 1, artworkId });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (rollbackError) { /* transaction already closed */ }
    }
    console.error('Artwork pin failed:', error);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not pin that artwork. Please try again.' });
      return;
    }
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.post('/art/:id/unpin', requireAuthJson, async (req, res, next) => {
  const artworkId = parseInt(req.params.id, 10);
  const userId = Number(req.session.user.id);

  if (!Number.isFinite(artworkId)) {
    respondPinError(req, res, 404, 'The artwork you requested could not be found.');
    return;
  }

  try {
    const rows = await db.execute('SELECT id, user_id FROM artworks WHERE id = ? LIMIT 1', [artworkId]);
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      respondPinError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) !== userId) {
      respondPinError(req, res, 403, 'You can only unpin your own artwork.');
      return;
    }

    await db.execute('DELETE FROM artwork_pins WHERE user_id = ? AND artwork_id = ?', [userId, artworkId]);
    const count = await countUserPins(userId);
    respondPinSuccess(req, res, { pinned: false, count, artworkId });
  } catch (error) {
    console.error('Artwork unpin failed:', error);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not unpin that artwork. Please try again.' });
      return;
    }
    next(error);
  }
});

app.post('/art/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const rows = await db.execute(
      'SELECT id, user_id, title, image_url, thumbnail_url FROM artworks WHERE id = ? LIMIT 1',
      [artworkId]
    );
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) !== Number(req.session.user.id)) {
      respondArtworkActionError(req, res, 403, 'You do not have permission to delete this artwork.');
      return;
    }

    await db.execute('DELETE FROM notifications WHERE artwork_id = ?', [artworkId]);
    const deleted = await db.execute('DELETE FROM artworks WHERE id = ? AND user_id = ?', [
      artworkId,
      req.session.user.id
    ]);

    if (!deleted || deleted.affectedRows === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    await deleteArtworkMedia(artwork);

    const redirectUrl = `/profile/${encodeURIComponent(req.session.user.username)}?tab=artworks&deleted=1`;

    if (requestWantsJson(req)) {
      res.json({ ok: true, deleted: true, id: artworkId, redirectUrl });
      return;
    }

    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Artwork delete failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not delete this artwork. Please try again.' });
      return;
    }
    next(err);
  }
});

// 8. Search Page Route
app.get('/search', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const query = (req.query.q || '').trim();
    let artworks = [];

    if (query) {
      artworks = await db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
                (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
                0 AS views, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
            AND (a.title LIKE ? OR a.tags LIKE ? OR u.username LIKE ?)
          ORDER BY a.created_at DESC
          LIMIT 24`,
        [viewerId, viewerId, `%${query}%`, `%${query}%`, `%${query}%`]
      );
    }

    const pinnedIds = await getPinnedArtworkIds(viewerId);

    res.render('pages/search', {
      pageTitle: query ? `ArtSpace | Search: ${query}` : 'ArtSpace | Search',
      query,
      artworks: artworks || [],
      pinnedIds
    });
  } catch (err) {
    next(err);
  }
});

// 9. Notifications Page Route
app.get('/notifications', requireAuth, (req, res) => {
  res.render('pages/notifications', {
    pageTitle: 'ArtSpace | Notifications',
    notifications: []
  });
});

// 10. Forgot Password Page Route
app.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', {
    pageTitle: 'ArtSpace | Forgot password',
    message: null
  });
});

// Auth-required pages redirect to login until authentication is implemented
app.get('/dashboard', requireAuth, (req, res) => {
  return res.redirect('/profile/' + encodeURIComponent(req.session.user.username));
});
app.get('/admin', (req, res) => res.redirect('/'));
app.get('/profile-edit', requireAuth, (req, res) => {
  return res.redirect('/profile/' + encodeURIComponent(req.session.user.username));
});
app.get('/art/:id/edit', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const rows = await db.execute(
      `SELECT id, user_id, category_id, title, description, tags, image_url, thumbnail_url,
              visibility, is_published, status
         FROM artworks
        WHERE id = ?
        LIMIT 1`,
      [artworkId]
    );
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) !== Number(req.session.user.id)) {
      respondArtworkActionError(req, res, 403, 'You do not have permission to edit this artwork.');
      return;
    }

    const categories = await db.execute(
      'SELECT id, name, slug FROM categories ORDER BY sort_order ASC'
    );
    artwork.visible_tags = String(artwork.tags || '')
      .split(/\s+/)
      .filter((tag) => tag && !/^effect:/i.test(tag))
      .join(' ');

    res.render('pages/artwork-edit', {
      pageTitle: 'ArtSpace | Edit artwork',
      artwork,
      categories: categories || [],
      error: null
    });
  } catch (err) {
    next(err);
  }
});

app.post('/art/:id/edit', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const rows = await db.execute(
      `SELECT id, user_id, category_id, title, description, tags, image_url, thumbnail_url,
              visibility, is_published, status
         FROM artworks
        WHERE id = ?
        LIMIT 1`,
      [artworkId]
    );
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) !== Number(req.session.user.id)) {
      respondArtworkActionError(req, res, 403, 'You do not have permission to edit this artwork.');
      return;
    }

    const title = String(req.body.title || '').trim().slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 1200);
    const categoryValue = String(req.body.category || '').trim();
    const categoryId = /^\d+$/.test(categoryValue) ? Number.parseInt(categoryValue, 10) : NaN;
    const visibleTags = String(req.body.tags || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const effectTags = String(artwork.tags || '')
      .split(/\s+/)
      .filter((tag) => tag && /^effect:/i.test(tag));
    const tags = [visibleTags, ...effectTags].filter(Boolean).join(' ').slice(0, 500);

    const renderError = async (message) => {
      if (requestWantsJson(req)) {
        res.status(400).json({ ok: false, error: message });
        return;
      }

      const categories = await db.execute(
        'SELECT id, name, slug FROM categories ORDER BY sort_order ASC'
      );
      res.status(400).render('pages/artwork-edit', {
        pageTitle: 'ArtSpace | Edit artwork',
        artwork: {
          ...artwork,
          title,
          description,
          category_id: Number.isFinite(categoryId) ? categoryId : artwork.category_id,
          visible_tags: visibleTags
        },
        categories: categories || [],
        error: message
      });
    };

    if (!title) {
      await renderError('Give your artwork a title before saving.');
      return;
    }

    if (!Number.isFinite(categoryId)) {
      await renderError('Choose a category for your artwork.');
      return;
    }

    const categoryRows = await db.execute(
      'SELECT id FROM categories WHERE id = ? LIMIT 1',
      [categoryId]
    );

    if (!categoryRows || categoryRows.length === 0) {
      await renderError('That category is not available. Choose another one.');
      return;
    }

    await db.execute(
      `UPDATE artworks
          SET title = ?, description = ?, category_id = ?, tags = ?, updated_at = NOW()
        WHERE id = ? AND user_id = ?`,
      [title, description || null, categoryId, tags || null, artworkId, req.session.user.id]
    );

    if (requestWantsJson(req)) {
      res.json({ ok: true, id: artworkId, artworkUrl: `/art/${artworkId}` });
      return;
    }

    res.redirect(`/art/${artworkId}`);
  } catch (err) {
    console.error('Artwork edit failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not save your changes. Please try again.' });
      return;
    }
    next(err);
  }
});

// ----------------------------------------------------
// 404 CATCH-ALL MIDDLEWARE (MUST BE AT THE VERY END)
// ----------------------------------------------------
app.use((req, res, next) => {
  res.status(404).render('pages/error', {
    message: 'The page you requested could not be found.',
    pageTitle: 'ArtSpace | Page not found',
    isAuthenticated: false,
    currentUser: null,
    unreadNotifications: 0
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err && (err.stack || err.message || err));

  if (res.headersSent) {
    next(err);
    return;
  }

  const isClientError = err instanceof URIError;
  const status = isClientError ? 400 : 500;
  const message = isClientError
    ? 'That request could not be understood. Please check the address and try again.'
    : 'Something went wrong on our side. Please refresh the page or try again in a moment.';

  if (requestWantsJson(req)) {
    res.status(status).json({ ok: false, error: message });
    return;
  }

  res.locals.assetVersion = res.locals.assetVersion || ASSET_VERSION;
  res.locals.imageTools = res.locals.imageTools || imageTools;
  res.locals.imagekitOrigin = res.locals.imagekitOrigin || imagekitOrigin;
  res.locals.pinLimit = res.locals.pinLimit || PIN_LIMIT;
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.isAuthenticated = Boolean(res.locals.currentUser);
  res.locals.unreadNotifications = 0;

  res.status(status).render('pages/error', {
    message,
    pageTitle: isClientError ? 'ArtSpace | Bad request' : 'ArtSpace | Something went wrong',
    isAuthenticated: res.locals.isAuthenticated,
    currentUser: res.locals.currentUser,
    unreadNotifications: 0
  }, (renderError, html) => {
    if (renderError) {
      console.error('Error page render failed:', renderError.message);
      res.type('text/plain').send(message);
      return;
    }
    res.send(html);
  });
});

// Start listener locally
if (!IS_VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
  });
}

// Export app for Vercel Serverless
module.exports = app;