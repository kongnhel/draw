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
      pageTitle: 'Upload artwork',
      categories: []
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

const app = express();

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(session({
  secret: process.env.SESSION_SECRET || 'artspace-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_VERCEL
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
    const totalArtworkRows = await db.execute('SELECT COUNT(*) AS count FROM artworks');
    const totalArtworks = Number((totalArtworkRows && totalArtworkRows[0] && totalArtworkRows[0].count) || 0);

    const bookArtworks = await db.execute(
      `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name, c.slug AS category_slug,
              a.created_at, a.visibility, a.is_published
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         INNER JOIN categories c ON c.id = a.category_id
        WHERE a.visibility = 'public' AND a.is_published = 1
        ORDER BY a.created_at DESC`
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

    const whereConditions = ["a.visibility = 'public'", "a.is_published = 1"];
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
      popular: 'a.created_at DESC'
    };
    const orderBy = sortMap[sort] || 'a.created_at DESC';

    const artworks = await db.execute(
      `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              c.name AS category_name, c.slug AS category_slug,
              a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
              0 AS is_liked, 0 AS is_bookmarked, 0 AS likes_count, 0 AS comments_count, 0 AS views, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         INNER JOIN categories c ON c.id = a.category_id
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}`,
      queryParams
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
              u.avatar, u.bio, 0 AS likes_count,
              COUNT(a.id) AS art_count
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
        WHERE a.visibility = 'public' AND a.is_published = 1
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
              NULL AS category_name,
              a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
              0 AS likes_count, 0 AS comments_count, 0 AS views,
              0 AS is_liked, 0 AS is_bookmarked, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ? AND a.visibility = 'public' AND a.is_published = 1
        ORDER BY a.created_at DESC
        LIMIT 12`,
      [profileUser.id]
    );

    const countRows = await db.execute(
      "SELECT COUNT(*) AS count FROM artworks WHERE user_id = ? AND visibility = 'public' AND is_published = 1",
      [profileUser.id]
    );
    const totalArtworks = Number((countRows && countRows[0] && countRows[0].count) || 0);

    const activeTab = ['artworks', 'liked', 'saved'].includes(req.query.tab) ? req.query.tab : 'artworks';

    res.render('pages/profile', {
      pageTitle: `ArtSpace | ${profileUser.username}'s Profile`,
      profileUser,
      artworks: artRows || [],
      likedArtworks: [],
      savedArtworks: [],
      stats: {
        totalArtworks,
        totalLikes: 0,
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
              NULL AS category_name,
              0 AS likes_count, 0 AS comments_count, 0 AS views,
              0 AS is_liked, 0 AS is_bookmarked, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
        WHERE a.id = ? AND a.visibility = 'public' AND a.is_published = 1
        LIMIT 1`,
      [artworkId]
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
              NULL AS category_name,
              a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
              0 AS likes_count, 0 AS comments_count, 0 AS views,
              0 AS is_liked, 0 AS is_bookmarked, 'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
        WHERE a.visibility = 'public' AND a.is_published = 1 AND a.id <> ?
        ORDER BY a.created_at DESC
        LIMIT 4`,
      [artworkId]
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

// 8. Search Page Route
app.get('/search', async (req, res, next) => {
  try {
    const query = (req.query.q || '').trim();
    let artworks = [];

    if (query) {
      artworks = await db.execute(
        `SELECT a.id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
                u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar,
              NULL AS category_name,
                a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
                0 AS likes_count, 0 AS comments_count, 0 AS views,
                0 AS is_liked, 0 AS is_bookmarked, 'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
          WHERE a.visibility = 'public' AND a.is_published = 1
            AND (a.title LIKE ? OR a.tags LIKE ? OR u.username LIKE ?)
          ORDER BY a.created_at DESC
          LIMIT 24`,
        [`%${query}%`, `%${query}%`, `%${query}%`]
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