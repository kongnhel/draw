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
          callback(error);
        }
      })
      .catch(callback);
  }

  set(sid, sessionData, callback) {
    db.execute(
      `INSERT INTO sessions (sid, data, expires)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE data = VALUES(data), expires = DATE_ADD(NOW(), INTERVAL ? SECOND)`,
      [sid, JSON.stringify(sessionData), this.ttlSeconds, this.ttlSeconds]
    ).then(() => callback(null)).catch(callback);
  }

  touch(sid, sessionData, callback) {
    db.execute(
      'UPDATE sessions SET expires = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE sid = ?',
      [this.ttlSeconds, sid]
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback) {
    db.execute('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => callback(null))
      .catch(callback);
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

const app = express();

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

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
  next();
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ----------------------------------------------------
// ROUTES (MUST BE PLACED BEFORE 404 CATCH-ALL)
// ----------------------------------------------------

// 1. Home Page Route
app.get('/', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const totalArtworkRows = await db.execute(
      "SELECT COUNT(*) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1 AND status = 'active'"
    );
    const totalArtworks = Number((totalArtworkRows && totalArtworkRows[0] && totalArtworkRows[0].count) || 0);

    const bookArtworks = await db.execute(
      `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name, c.slug AS category_slug,
              a.created_at, a.visibility, a.is_published,
              (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
              (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
              EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         INNER JOIN categories c ON c.id = a.category_id
        WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
        ORDER BY a.created_at DESC`,
      [viewerId, viewerId]
    );

    const latest = (bookArtworks || []).slice(0, 9);
    const heroArtwork = (bookArtworks && bookArtworks[0]) || null;
    const heroArtworkIndex = heroArtwork ? bookArtworks.indexOf(heroArtwork) : 0;

    const artistRows = await db.execute(
      `SELECT u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar, u.bio,
              COUNT(a.id) AS art_count
         FROM users u
         LEFT JOIN artworks a ON a.user_id = u.id AND a.visibility = 'public' AND a.is_published = 1
         GROUP BY u.id
         ORDER BY art_count DESC
         LIMIT 1`
    );
    const artistSpotlight = (artistRows && artistRows[0]) || null;

    const categoryRows = await db.execute(
      `SELECT c.slug, c.name, COUNT(a.id) AS count
         FROM categories c
         LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1
         GROUP BY c.id
         ORDER BY c.sort_order`
    );
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
      liveCategoryCount: visibleCategories.filter((category) => Number(category.count) > 0).length
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

    const categoryRows = await db.execute(
      `SELECT c.slug, c.name, COUNT(a.id) AS count
         FROM categories c
         LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1
         GROUP BY c.id
         ORDER BY c.sort_order`
    );
    const categories = (categoryRows || []).map((row) => ({
      slug: row.slug,
      name: row.name,
      count: Number(row.count) || 0
    }));

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

    const artworks = await db.execute(
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
    );

    const filteredCountRows = await db.execute(
      `SELECT COUNT(*) AS count
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         INNER JOIN categories c ON c.id = a.category_id
        ${whereClause}`,
      queryParams
    );
    const filteredTotal = Number((filteredCountRows && filteredCountRows[0] && filteredCountRows[0].count) || 0);

    const totalRows = await db.execute("SELECT COUNT(*) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1");
    const totalArtworks = Number((totalRows && totalRows[0] && totalRows[0].count) || 0);

    const artistRows = await db.execute("SELECT COUNT(DISTINCT user_id) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1");
    const artistCount = Number((artistRows && artistRows[0] && artistRows[0].count) || 0);

    const artistSpotlightRows = await db.execute(
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
    );
    const artists = artistSpotlightRows || [];

    const activeCategory = filter !== 'all'
      ? (categories.find((category) => category.slug === filter) || null)
      : null;

    const mediumCount = categories.length;
    const spotlightArtwork = (artworks && artworks.length > 0) ? artworks[0] : null;
    const loadedItems = artworks ? artworks.length : 0;

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
      sort
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
        : 'We could not pin this page. Please try again.';
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
        LIMIT 12`,
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
        LIMIT 12`,
      [viewerId, viewerId, profileUser.id]
    );

    const isOwner = Boolean(req.session && req.session.user && req.session.user.id === profileUser.id);
    let savedRows = [];

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
          LIMIT 12`,
        [viewerId, viewerId, viewerId]
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

    const activeTab = ['artworks', 'liked', 'saved'].includes(req.query.tab) ? req.query.tab : 'artworks';

    res.render('pages/profile', {
      pageTitle: `ArtSpace | ${profileUser.username}'s Profile`,
      profileUser,
      artworks: artRows || [],
      likedArtworks: likedRows || [],
      savedArtworks: savedRows || [],
      stats: {
        totalArtworks,
        totalLikes,
        followers: 0,
        totalViews: 0
      },
      isFollowing: false,
      activeTab,
      memberSinceLabel: ''
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

    const rows = await db.execute(
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
    );
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

    const relatedRows = await db.execute(
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
    );

    res.render('pages/artwork', {
      pageTitle: `ArtSpace | ${artwork.title}`,
      artwork,
      comments: [],
      related: relatedRows || [],
      artistStats: { isFollowing: false }
    });
  } catch (err) {
    next(err);
  }
});

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

    res.render('pages/search', {
      pageTitle: query ? `ArtSpace | Search: ${query}` : 'ArtSpace | Search',
      query,
      artworks: artworks || []
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
app.get('/art/:id/edit', (req, res) => res.redirect('/art/' + encodeURIComponent(req.params.id)));

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

// Start listener locally
if (!IS_VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
  });
}

// Export app for Vercel Serverless
module.exports = app;