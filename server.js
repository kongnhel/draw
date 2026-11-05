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

const { dbConfig } = require('./src/db/init');

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

// Wrap pool methods with promise support
global.db = pool;
db = {
  execute: (...args) => pool.execute(...args),
  query: (...args) => pool.query(...args).then(([results]) => results),
  getConnection: () => pool.getConnection()
};

async function initDb() {
  const connection = await pool.getConnection();
  console.log('Connected to Aiven MySQL');
  connection.release();
}

initDb().then(() => {
  // Seed database after connection
  const { ensureSeeded } = require('./src/db/seed');
  return ensureSeeded();
}).then(() => {
  console.log('Database seeded successfully');
}).catch((err) => {
  console.error('Error initializing database:', err);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const uploadsDir = path.join(__dirname, 'uploads');
const processedDir = path.join(uploadsDir, 'processed');
const avatarsDir = path.join(uploadsDir, 'avatars');
const coversDir = path.join(uploadsDir, 'covers');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(processedDir, { recursive: true });
fs.mkdirSync(avatarsDir, { recursive: true });
fs.mkdirSync(coversDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    }
  }
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get('/vendor/page-flip.browser.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'page-flip', 'dist', 'js', 'page-flip.browser.js'));
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'artspace-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.'
}));

const categoryRows = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
const artworkEffectOptions = new Set(['portrait', 'sketch', 'digital', 'nature', 'khmer']);

function getArtworkEffect(tags) {
  const effectTag = (tags || '').split(/\s+/).find((tag) => /^effect:/i.test(tag));
  const effect = effectTag?.slice(effectTag.indexOf(':') + 1).toLowerCase();
  return artworkEffectOptions.has(effect) ? effect : 'auto';
}

function getVisibleArtworkTags(tags) {
  return (tags || '').split(/\s+/).filter((tag) => tag && !/^effect:/i.test(tag)).join(' ');
}

function mergeArtworkEffect(tags, requestedEffect) {
  const cleanTags = (tags || '').trim().split(/\s+/).filter((tag) => tag && !/^effect:/i.test(tag));
  const effect = String(requestedEffect || 'auto').toLowerCase();
  if (artworkEffectOptions.has(effect)) cleanTags.push(`effect:${effect}`);
  return cleanTags.join(' ');
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/');
  }
  next();
}

function getCurrentUser(req) {
  return req.session.user || null;
}

function redirectBack(req, res) {
  const referer = req.get('Referer');
  return res.redirect(referer || '/');
}

const DEFAULT_AVATAR = '/uploads/avatars/default-avatar.svg';
const DEFAULT_COVER = '/uploads/covers/default-cover.svg';

function resolveUploadAsset(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/uploads/')) return value;
  const filePath = path.join(uploadsDir, value.replace(/^\/uploads\//, ''));
  return fs.existsSync(filePath) ? value : fallback;
}

function formatUser(user) {
  return {
    ...user,
    display_name: user.display_name || user.username,
    avatar: resolveUploadAsset(user.avatar, DEFAULT_AVATAR)
  };
}

function calculateArtStats(userId) {
  const totalArtworks = db.prepare('SELECT COUNT(*) AS count FROM artworks WHERE user_id = ? AND is_published = 1').get(userId).count;
  const totalLikes = db.prepare(`
    SELECT COUNT(*) AS count
    FROM likes l
    JOIN artworks a ON a.id = l.artwork_id
    WHERE a.user_id = ?
  `).get(userId).count;
  const followers = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?').get(userId).count;
  const following = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?').get(userId).count;
  const totalViews = db.prepare('SELECT COALESCE(SUM(views), 0) AS count FROM artworks WHERE user_id = ? AND is_published = 1').get(userId).count;

  return { totalArtworks, totalLikes, followers, following, totalViews };
}

function getArtworkCardData(artwork) {
  return {
    ...artwork,
    likes_count: Number(artwork.likes_count || 0),
    comments_count: Number(artwork.comments_count || 0),
    is_liked: !!artwork.is_liked,
    is_bookmarked: !!artwork.is_bookmarked,
    visual_effect: getArtworkEffect(artwork.tags),
    created_at_label: formatDate(artwork.created_at)
  };
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Date(toTimestamp(value)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function toTimestamp(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  return new Date(normalized).getTime() || 0;
}

function formatTimeAgo(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return 'Just now';
  const elapsed = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return 'Just now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < day * 7) return `${Math.floor(elapsed / day)}d ago`;
  return formatDate(value);
}

function buildArtworkQuery(userId) {
  return `
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.is_published = 1 AND a.visibility = 'public'
  `;
}

function getFeaturedArtworks() {
  return db.prepare(`${buildArtworkQuery('?')} ORDER BY a.created_at DESC LIMIT 6`).all(0, 0);
}

app.use((req, res, next) => {
  const currentUser = getCurrentUser(req);
  res.locals.currentUser = currentUser ? formatUser(currentUser) : null;
  res.locals.isAuthenticated = Boolean(currentUser);
  res.locals.categories = categoryRows;
  res.locals.appName = 'ArtSpace';
  res.locals.pageTitle = 'ArtSpace';
  res.locals.unreadNotifications = currentUser
    ? db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND is_read = 0').get(currentUser.id).count
    : 0;
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
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
  artworkUpload(req, res, (error) => {
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

const profileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === 'avatar' ? avatarsDir : coversDir);
    },
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${Date.now()}${extension}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitted = ['image/jpeg', 'image/png', 'image/webp'];
    if (permitted.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'ArtSpace' });
});

app.get('/', (req, res) => {
  const userId = req.session.user?.id || 0;
  const bookArtworks = db.prepare(`
    SELECT a.id, a.title, a.description, a.tags, a.created_at, a.image_url, a.thumbnail_url,
      c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.is_published = 1 AND a.visibility = 'public'
    ORDER BY a.created_at DESC, a.id DESC
  `).all(userId, userId).map(getArtworkCardData);

  const isAvailableArtworkImage = (imageUrl) => {
    if (!imageUrl) return false;
    if (!imageUrl.startsWith('/uploads/')) return true;

    const imagePath = path.resolve(__dirname, `.${imageUrl}`);
    return imagePath.startsWith(`${uploadsDir}${path.sep}`) && fs.existsSync(imagePath);
  };

  const heroArtwork = bookArtworks.find((artwork) =>
    isAvailableArtworkImage(artwork.thumbnail_url) || isAvailableArtworkImage(artwork.image_url)
  ) || null;
  const heroArtworkImageUrl = heroArtwork
    ? [heroArtwork.thumbnail_url, heroArtwork.image_url].find(isAvailableArtworkImage)
    : null;
  const heroArtworkIndex = heroArtwork ? bookArtworks.indexOf(heroArtwork) + 1 : 0;

  const latest = db.prepare(`${buildArtworkQuery('?')} ORDER BY a.created_at DESC, a.id DESC LIMIT 12`).all(req.session.user?.id || 0, req.session.user?.id || 0)
    .map(getArtworkCardData);

  const artistSpotlight = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM artworks a WHERE a.user_id = u.id AND a.is_published = 1) AS art_count
    FROM users u
    WHERE u.role = 'artist'
      AND EXISTS (SELECT 1 FROM artworks a WHERE a.user_id = u.id AND a.is_published = 1)
    ORDER BY art_count DESC, u.id ASC
    LIMIT 1
  `).get();

  const categoryCounts = db.prepare(`
    SELECT c.id, COUNT(a.id) AS count
    FROM categories c
    LEFT JOIN artworks a ON a.category_id = c.id AND a.is_published = 1 AND a.visibility = 'public'
    GROUP BY c.id
    ORDER BY c.sort_order ASC
  `).all();
  const countById = new Map(categoryCounts.map((row) => [row.id, Number(row.count || 0)]));
  const visibleCategories = categoryRows.map((category) => ({
    ...category,
    count: countById.get(category.id) || 0
  }));

  res.render('pages/home', {
    bookArtworks,
    heroArtwork,
    heroArtworkImageUrl,
    heroArtworkIndex,
    latest,
    artistSpotlight,
    visibleCategories,
    totalArtworks: bookArtworks.length,
    pageTitle: 'ArtSpace | Discover original artwork'
  });
});

app.get('/explore', (req, res) => {
  const userId = req.session.user?.id || 0;
  const requestedCategory = String(req.query.category || 'all').toLowerCase();
  const filter = requestedCategory === 'all' || categoryRows.some((category) => category.slug === requestedCategory)
    ? requestedCategory
    : 'all';
  const query = String(req.query.q || '').trim().slice(0, 120);
  const requestedSort = String(req.query.sort || 'latest').toLowerCase();
  const sortAliases = {
    latest: 'latest',
    newest: 'latest',
    views: 'views',
    viewed: 'views',
    'most-viewed': 'views',
    popular: 'popular',
    liked: 'popular',
    'most-liked': 'popular',
    trending: 'popular'
  };
  const sort = sortAliases[requestedSort] || 'latest';
  const pageSize = 9;
  const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const orderMap = {
    latest: 'a.created_at DESC, a.id DESC',
    views: 'a.views DESC, a.created_at DESC, a.id DESC',
    popular: 'likes_count DESC, a.created_at DESC, a.id DESC'
  };

  const predicates = [
    'a.is_published = 1',
    "a.visibility = 'public'"
  ];
  const filterParams = [];

  if (filter !== 'all') {
    predicates.push('c.slug = ?');
    filterParams.push(filter);
  }

  if (query) {
    predicates.push(`(
      a.title LIKE ? OR a.description LIKE ? OR a.tags LIKE ?
      OR u.display_name LIKE ? OR u.username LIKE ? OR c.name LIKE ?
    )`);
    const likeQuery = `%${query}%`;
    filterParams.push(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);
  }

  const whereClause = predicates.join(' AND ');
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE ${whereClause}
  `).get(...filterParams).count);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const artworkSelect = `
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
  `;

  const artworks = db.prepare(`
    ${artworkSelect}
    WHERE ${whereClause}
    ORDER BY ${orderMap[sort]}
    LIMIT ? OFFSET ?
  `).all(userId, userId, ...filterParams, pageSize, offset).map(getArtworkCardData);

  const spotlightArtwork = db.prepare(`
    ${artworkSelect}
    WHERE a.is_published = 1 AND a.visibility = 'public'
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
  `).get(userId, userId);
  const publicStats = db.prepare(`
    SELECT COUNT(*) AS artworks, COUNT(DISTINCT a.user_id) AS artists
    FROM artworks a
    WHERE a.is_published = 1 AND a.visibility = 'public'
  `).get();
  const categoryCountRows = db.prepare(`
    SELECT c.slug, COUNT(*) AS count
    FROM artworks a
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.is_published = 1 AND a.visibility = 'public'
    GROUP BY c.slug
  `).all();
  const categoryCounts = new Map(categoryCountRows.map((row) => [row.slug, Number(row.count)]));
  const categoryFilters = categoryRows.map((category) => ({
    ...category,
    count: categoryCounts.get(category.slug) || 0
  }));
  const activeCategory = categoryFilters.find((category) => category.slug === filter) || null;
  const mediumCount = categoryFilters.filter((category) => category.count > 0).length;
  const artists = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio,
      (SELECT COUNT(*) FROM artworks a
        WHERE a.user_id = u.id AND a.is_published = 1 AND a.visibility = 'public') AS art_count,
      COALESCE((SELECT COUNT(*) FROM likes l
        INNER JOIN artworks a ON a.id = l.artwork_id
        WHERE a.user_id = u.id AND a.is_published = 1 AND a.visibility = 'public'), 0) AS likes_count
    FROM users u
    WHERE EXISTS (
      SELECT 1 FROM artworks a
      WHERE a.user_id = u.id AND a.is_published = 1 AND a.visibility = 'public'
    )
    ORDER BY art_count DESC, likes_count DESC, u.id ASC
    LIMIT 5
  `).all();
  const pagination = {
    page,
    pageSize,
    pageCount: totalPages,
    total,
    shown: artworks.length,
    start: total ? offset + 1 : 0,
    end: offset + artworks.length,
    hasMore: page < totalPages,
    nextPage: page + 1,
    remaining: Math.max(0, total - (offset + artworks.length))
  };
  const viewData = {
    artworks,
    artists,
    activeCategory,
    categoryFilters,
    filter,
    sort,
    query,
    pagination,
    totalArtworks: Number(publicStats.artworks || 0),
    artistCount: Number(publicStats.artists || 0),
    mediumCount,
    spotlightArtwork: spotlightArtwork ? getArtworkCardData(spotlightArtwork) : null,
    pageTitle: 'Explore | ArtSpace'
  };

  if (req.query.partial === '1') {
    return res.render('partials/explore-results', viewData);
  }

  return res.render('pages/explore', viewData);
});

app.get('/search', (req, res) => {
  const query = (req.query.q || '').trim();
  const userId = req.session.user?.id || 0;
  const artworks = query
    ? db.prepare(`
        SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
          COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
          COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
          CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
          CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
        FROM artworks a
        INNER JOIN users u ON u.id = a.user_id
        INNER JOIN categories c ON c.id = a.category_id
        WHERE a.is_published = 1 AND a.visibility = 'public' AND (
          a.title LIKE ? OR a.description LIKE ? OR a.tags LIKE ?
          OR u.display_name LIKE ? OR u.username LIKE ? OR c.name LIKE ?
        )
        ORDER BY a.created_at DESC
      `).all(userId, userId, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`).map(getArtworkCardData)
    : [];

  res.render('pages/search', { artworks, query, pageTitle: `Search: ${query || 'artwork'}` });
});

app.get('/art/:id', (req, res) => {
  const artworkId = Number(req.params.id);
  const currentUserId = req.session.user?.id || 0;

  if (Number.isInteger(artworkId)) {
    db.prepare('UPDATE artworks SET views = COALESCE(views, 0) + 1 WHERE id = ? AND is_published = 1').run(artworkId);
  }

  const artwork = db.prepare(`
    SELECT a.*, c.name AS category_name, c.slug AS category_slug, u.id AS artist_id, u.username, u.display_name, u.bio, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.id = ? AND a.is_published = 1
  `).get(currentUserId, currentUserId, artworkId);

  if (!artwork) {
    return res.status(404).render('pages/error', { message: 'Artwork not found.' });
  }

  const comments = db.prepare(`
    SELECT cm.*, u.username, u.display_name, u.avatar
    FROM comments cm
    INNER JOIN users u ON u.id = cm.user_id
    WHERE cm.artwork_id = ?
    ORDER BY cm.created_at ASC
  `).all(artworkId);

  const related = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.is_published = 1 AND a.category_id = ? AND a.id != ?
    ORDER BY a.created_at DESC
    LIMIT 4
  `).all(artwork.category_id, artworkId).map(getArtworkCardData);

  const isFollowing = req.session.user && db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.session.user.id, artwork.artist_id);
  const artistStats = {
    ...calculateArtStats(artwork.artist_id),
    isFollowing: !!isFollowing
  };

  res.render('pages/artwork', {
    artwork,
    comments,
    related,
    artistStats,
    pageTitle: `${artwork.title} | ArtSpace`
  });
});

app.post('/art/:id/like', requireAuth, (req, res) => {
  const artworkId = Number(req.params.id);
  const userId = req.session.user.id;
  const existing = db.prepare('SELECT id FROM likes WHERE artwork_id = ? AND user_id = ?').get(artworkId, userId);

  let liked = false;

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO likes (artwork_id, user_id) VALUES (?, ?)').run(artworkId, userId);
    liked = true;
  }

  const likesCount = Number(db.prepare('SELECT COUNT(*) AS count FROM likes WHERE artwork_id = ?').get(artworkId).count);

  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
    return res.json({ liked, likes_count: likesCount });
  }

  return redirectBack(req, res);
});

app.post('/art/:id/bookmark', requireAuth, (req, res) => {
  const artworkId = Number(req.params.id);
  const userId = req.session.user.id;
  const existing = db.prepare('SELECT id FROM bookmarks WHERE artwork_id = ? AND user_id = ?').get(artworkId, userId);

  let bookmarked = false;

  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO bookmarks (artwork_id, user_id) VALUES (?, ?)').run(artworkId, userId);
    bookmarked = true;
  }

  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
    return res.json({ bookmarked });
  }

  return redirectBack(req, res);
});

app.post('/art/:id/comment', requireAuth, (req, res) => {
  const body = (req.body.body || '').trim();
  const artworkId = Number(req.params.id);

  if (!body) {
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(400).json({ ok: false, message: 'Comment cannot be empty.' });
    }
    return redirectBack(req, res);
  }

  const artwork = db.prepare('SELECT user_id FROM artworks WHERE id = ?').get(artworkId);
  const user = req.session.user;
  const insertResult = db.prepare('INSERT INTO comments (artwork_id, user_id, body) VALUES (?, ?, ?)');
  insertResult.run(artworkId, user.id, body);

  const commentsCount = Number(db.prepare('SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ?').get(artworkId).count);
  const comment = {
    id: insertResult.lastInsertRowid,
    artwork_id: artworkId,
    user_id: user.id,
    body,
    username: user.username,
    display_name: user.display_name || user.username,
    avatar: user.avatar || '/uploads/avatars/default-avatar.png',
    created_at: new Date().toISOString()
  };

  if (artwork && artwork.user_id !== user.id) {
    db.prepare('INSERT INTO notifications (recipient_id, actor_id, type, message, link) VALUES (?, ?, ?, ?, ?)')
      .run(artwork.user_id, user.id, 'comment', `${user.display_name || user.username} commented on your artwork.`, `/art/${artworkId}`);
  }

  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
    return res.json({ ok: true, comment, comments_count: commentsCount });
  }

  return redirectBack(req, res);
});

app.post('/follow/:userId', requireAuth, (req, res) => {
  const followerId = req.session.user.id;
  const followingId = Number(req.params.userId);

  if (followerId === followingId) {
    return redirectBack(req, res);
  }

  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(followerId, followingId);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(followerId, followingId);
    db.prepare('INSERT INTO notifications (recipient_id, actor_id, type, message, link) VALUES (?, ?, ?, ?, ?)')
      .run(followingId, followerId, 'follow', `${req.session.user.display_name || req.session.user.username} started following you.`, `/profile/${req.session.user.username}`);
  }

  return redirectBack(req, res);
});

app.post('/art/:id/report', requireAuth, (req, res) => {
  const artworkId = Number(req.params.id);
  const reason = (req.body.reason || 'Inappropriate content').trim();

  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, 'artwork', artworkId, reason);

  return redirectBack(req, res);
});

app.get('/upload', requireAuth, (req, res) => {
  res.render('pages/upload', { pageTitle: 'Upload artwork' });
});

app.post('/upload', requireAuth, handleArtworkUpload, async (req, res) => {
  const wantsJson = uploadRequestWantsJson(req);

  const respondWithError = (message, field, status = 400) => {
    if (wantsJson) {
      return res.status(status).json({ ok: false, error: message, field });
    }
    return res.status(status).render('pages/upload', {
      error: message,
      formValues: req.body || {},
      pageTitle: 'Upload artwork'
    });
  };

  const discardUploadedFiles = () => {
    for (const file of req.files || []) {
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not discard upload:', error);
      }
    }
  };

  try {
    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const categoryId = Number(req.body.category);
    const tags = mergeArtworkEffect(req.body.tags, req.body.visual_effect);
    const visibility = req.body.visibility === 'private' ? 'private' : 'public';
    const saveAsDraft = req.body.save_as_draft === 'on';
    const createdAt = req.body.created_at || new Date().toISOString();

    if (!req.files || req.files.length === 0) {
      return respondWithError('Add an image of your artwork before publishing.', 'images');
    }

    if (!title) {
      discardUploadedFiles();
      return respondWithError('Give your artwork a title before publishing.', 'title');
    }

    if (!categoryId) {
      discardUploadedFiles();
      return respondWithError('Choose a category for your artwork.', 'category');
    }

    const userId = req.session.user.id;
    const files = [];

    for (const file of req.files) {
      const originalName = file.filename;
      const baseName = path.basename(originalName, path.extname(originalName));
      const originalPath = path.join(uploadsDir, originalName);
      const imagePath = path.join(processedDir, `${baseName}.webp`);
      const thumbPath = path.join(processedDir, `${baseName}-thumb.webp`);

      await sharp(originalPath)
        .resize({ width: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(imagePath);

      await sharp(originalPath)
        .resize({ width: 480, height: 480, fit: 'cover' })
        .webp({ quality: 72 })
        .toFile(thumbPath);

      fs.unlinkSync(originalPath);
      files.push({
        image_url: `/uploads/processed/${path.basename(imagePath)}`,
        thumbnail_url: `/uploads/processed/${path.basename(thumbPath)}`
      });
    }

    const createdIds = [];
    const insertArtwork = db.prepare(`
      INSERT INTO artworks (user_id, category_id, title, description, tags, image_url, thumbnail_url, visibility, is_published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      const created = insertArtwork.run(userId, categoryId, title, description, tags, file.image_url, file.thumbnail_url, visibility, saveAsDraft ? 0 : 1, createdAt, new Date().toISOString());
      createdIds.push(Number(created.lastInsertRowid));
    }

    if (wantsJson) {
      const artworkId = createdIds[0];
      return res.status(201).json({
        ok: true,
        artworkId,
        artworkUrl: `/art/${artworkId}`,
        artworkEditUrl: `/art/${artworkId}/edit`,
        artworkImageUrl: files[0].image_url,
        artworkThumbnailUrl: files[0].thumbnail_url,
        isDraft: saveAsDraft,
        count: files.length
      });
    }

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    discardUploadedFiles();
    if (wantsJson) {
      return res.status(500).json({
        ok: false,
        error: 'That image could not be processed. Please try a different JPG, PNG, or WEBP file.'
      });
    }
    res.status(500).render('pages/upload', {
      error: 'Upload failed. Please check your image files and try again.',
      pageTitle: 'Upload artwork'
    });
  }
});

app.get('/profile/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  user.avatar = resolveUploadAsset(user.avatar, DEFAULT_AVATAR);
  user.cover_image = resolveUploadAsset(user.cover_image, DEFAULT_COVER);
  res.render('pages/profile-edit', { user, pageTitle: 'Edit profile' });
});

app.post('/profile/edit', requireAuth, profileUpload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cover_image', maxCount: 1 }
]), (req, res) => {
  const bio = (req.body.bio || '').trim();
  const website = (req.body.website || '').trim();
  const instagram = (req.body.instagram || '').trim();
  const twitter = (req.body.twitter || '').trim();

  const updates = [];
  const values = [];

  if (req.files && req.files.avatar && req.files.avatar[0]) {
    const avatarPath = `/uploads/avatars/${req.files.avatar[0].filename}`;
    updates.push('avatar = ?');
    values.push(avatarPath);
  }

  if (req.files && req.files.cover_image && req.files.cover_image[0]) {
    const coverPath = `/uploads/covers/${req.files.cover_image[0].filename}`;
    updates.push('cover_image = ?');
    values.push(coverPath);
  }

  updates.push('bio = ?');
  values.push(bio);
  updates.push('website = ?');
  values.push(website);
  updates.push('instagram = ?');
  values.push(instagram);
  updates.push('twitter = ?');
  values.push(twitter);
  values.push(req.session.user.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const freshUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  req.session.user.avatar = freshUser.avatar;
  req.session.user.display_name = freshUser.display_name || freshUser.username;
  res.redirect(`/profile/${req.session.user.username}`);
});

app.get('/profile/:username', (req, res) => {
  const profileUser = db.prepare(`
    SELECT u.*, 
      (SELECT COUNT(*) FROM artworks a WHERE a.user_id = u.id AND a.is_published = 1) AS art_count,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = u.id) AS following_count
    FROM users u
    WHERE u.username = ?
  `).get(req.params.username);

  if (!profileUser) {
    return res.status(404).render('pages/error', { message: 'Profile not found.' });
  }

  profileUser.avatar = resolveUploadAsset(profileUser.avatar, DEFAULT_AVATAR);
  profileUser.cover_image = resolveUploadAsset(profileUser.cover_image, DEFAULT_COVER);

  const tab = (req.query.tab || 'artworks').toLowerCase();
  const activeTab = ['artworks', 'liked', 'saved'].includes(tab) ? tab : 'artworks';

  const currentUserId = req.session.user?.id || 0;

  const artworks = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.user_id = ? AND a.is_published = 1
    ORDER BY a.created_at DESC
  `).all(currentUserId, currentUserId, profileUser.id).map(getArtworkCardData);

  const likedArtworks = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l2 WHERE l2.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      1 AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) THEN 1 ELSE 0 END AS is_bookmarked
    FROM likes l
    INNER JOIN artworks a ON a.id = l.artwork_id
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE l.user_id = ? AND a.is_published = 1
    ORDER BY l.created_at DESC
    LIMIT 6
  `).all(currentUserId, profileUser.id).map(getArtworkCardData);

  const savedArtworks = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l2 WHERE l2.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      CASE WHEN EXISTS (SELECT 1 FROM likes l2 WHERE l2.artwork_id = a.id AND l2.user_id = ?) THEN 1 ELSE 0 END AS is_liked,
      1 AS is_bookmarked
    FROM bookmarks b
    INNER JOIN artworks a ON a.id = b.artwork_id
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    WHERE b.user_id = ? AND a.is_published = 1
    ORDER BY b.created_at DESC
    LIMIT 12
  `).all(currentUserId, profileUser.id).map(getArtworkCardData);

  const isFollowing = req.session.user && db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.session.user.id, profileUser.id);
  const stats = calculateArtStats(profileUser.id);

  res.render('pages/profile', {
    profileUser: formatUser(profileUser),
    artworks,
    likedArtworks,
    savedArtworks,
    activeTab,
    isFollowing: !!isFollowing,
    stats,
    memberSinceLabel: formatDate(profileUser.created_at),
    pageTitle: `${profileUser.display_name} | ArtSpace`
  });
});

app.get('/art/:id/edit', requireAuth, (req, res) => {
  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.session.user.id);
  if (!artwork) {
    return res.status(404).render('pages/error', { message: 'Artwork not found or you do not own it.' });
  }

  artwork.visual_effect = getArtworkEffect(artwork.tags);
  artwork.visible_tags = getVisibleArtworkTags(artwork.tags);
  res.render('pages/artwork-edit', { artwork, pageTitle: 'Edit artwork', categories: categoryRows });
});

app.post('/art/:id/edit', requireAuth, (req, res) => {
  const artworkId = Number(req.params.id);
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const tags = mergeArtworkEffect(req.body.tags, req.body.visual_effect);
  const categoryId = Number(req.body.category);

  if (!title || !categoryId) {
    return res.status(400).render('pages/artwork-edit', {
      artwork: { id: artworkId, title, description, tags, visible_tags: getVisibleArtworkTags(tags), category_id: categoryId, visual_effect: getArtworkEffect(tags) },
      error: 'Title and category are required.',
      pageTitle: 'Edit artwork',
      categories: categoryRows
    });
  }

  db.prepare('UPDATE artworks SET title = ?, description = ?, tags = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(title, description, tags, categoryId, new Date().toISOString(), artworkId, req.session.user.id);

  res.redirect(`/art/${artworkId}`);
});

app.post('/art/:id/delete', requireAuth, (req, res) => {
  const artworkId = Number(req.params.id);
  db.transaction(() => {
    db.prepare('DELETE FROM collection_items WHERE artwork_id = ?').run(artworkId);
    db.prepare('DELETE FROM artworks WHERE id = ? AND user_id = ?').run(artworkId, req.session.user.id);
  })();
  res.redirect('/dashboard');
});

app.get('/dashboard', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const uploaded = db.prepare(`
    SELECT a.*, c.name AS category_name,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      COALESCE(a.views, 0) AS views
    FROM artworks a
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.user_id = ? AND a.is_published = 1
    ORDER BY a.created_at DESC, a.id DESC
  `).all(userId).map(getArtworkCardData);

  const drafts = db.prepare(`
    SELECT a.*, c.name AS category_name,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id), 0) AS comments_count,
      COALESCE(a.views, 0) AS views
    FROM artworks a
    INNER JOIN categories c ON c.id = a.category_id
    WHERE a.user_id = ? AND a.is_published = 0
    ORDER BY a.created_at DESC, a.id DESC
  `).all(userId).map(getArtworkCardData);

  const bookmarks = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count
    FROM bookmarks b
    INNER JOIN artworks a ON a.id = b.artwork_id
    INNER JOIN categories c ON c.id = a.category_id
    INNER JOIN users u ON u.id = a.user_id
    WHERE b.user_id = ? AND a.is_published = 1
    ORDER BY b.created_at DESC, b.id DESC
  `).all(userId).map(getArtworkCardData);

  const likedArtworks = db.prepare(`
    SELECT a.*, c.name AS category_name, u.username, u.display_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id), 0) AS likes_count
    FROM likes l
    INNER JOIN artworks a ON a.id = l.artwork_id
    INNER JOIN categories c ON c.id = a.category_id
    INNER JOIN users u ON u.id = a.user_id
    WHERE l.user_id = ? AND a.is_published = 1
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT 8
  `).all(userId).map(getArtworkCardData);

  const collections = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS items_count,
      (SELECT a.thumbnail_url FROM collection_items ci INNER JOIN artworks a ON a.id = ci.artwork_id WHERE ci.collection_id = c.id ORDER BY ci.created_at DESC, ci.id DESC LIMIT 1) AS cover_thumbnail,
      (SELECT a.image_url FROM collection_items ci INNER JOIN artworks a ON a.id = ci.artwork_id WHERE ci.collection_id = c.id ORDER BY ci.created_at DESC, ci.id DESC LIMIT 1) AS cover_image
    FROM collections c
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC, c.id DESC
  `).all(userId).map((collection) => ({
    ...collection,
    created_at_label: formatDate(collection.created_at)
  }));

  const followers = db.prepare(`
    SELECT u.*, f.created_at
    FROM follows f
    INNER JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);

  const following = db.prepare(`
    SELECT u.*, f.created_at
    FROM follows f
    INNER JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);

  const recentLikes = db.prepare(`
    SELECT l.created_at, u.username AS actor_username, u.display_name AS actor_name, u.avatar AS actor_avatar,
      a.id AS artwork_id, a.title AS artwork_title
    FROM likes l
    INNER JOIN artworks a ON a.id = l.artwork_id
    INNER JOIN users u ON u.id = l.user_id
    WHERE a.user_id = ? AND l.user_id != ?
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT 5
  `).all(userId, userId).map((item) => ({
    type: 'like',
    message: `${item.actor_name || item.actor_username} favorited “${item.artwork_title}”.`,
    link: `/art/${item.artwork_id}`,
    actor_name: item.actor_name || item.actor_username,
    actor_avatar: item.actor_avatar,
    created_at: item.created_at
  }));

  const recentComments = db.prepare(`
    SELECT cm.created_at, cm.body, u.username AS actor_username, u.display_name AS actor_name, u.avatar AS actor_avatar,
      a.id AS artwork_id, a.title AS artwork_title
    FROM comments cm
    INNER JOIN artworks a ON a.id = cm.artwork_id
    INNER JOIN users u ON u.id = cm.user_id
    WHERE a.user_id = ? AND cm.user_id != ?
    ORDER BY cm.created_at DESC, cm.id DESC
    LIMIT 5
  `).all(userId, userId).map((item) => ({
    type: 'comment',
    message: `${item.actor_name || item.actor_username} left a note on “${item.artwork_title}”.`,
    detail: item.body,
    link: `/art/${item.artwork_id}`,
    actor_name: item.actor_name || item.actor_username,
    actor_avatar: item.actor_avatar,
    created_at: item.created_at
  }));

  const recentFollows = db.prepare(`
    SELECT f.created_at, u.username AS actor_username, u.display_name AS actor_name, u.avatar AS actor_avatar
    FROM follows f
    INNER JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT 5
  `).all(userId).map((item) => ({
    type: 'follow',
    message: `${item.actor_name || item.actor_username} joined your studio circle.`,
    link: `/profile/${item.actor_username}`,
    actor_name: item.actor_name || item.actor_username,
    actor_avatar: item.actor_avatar,
    created_at: item.created_at
  }));

  const recentActivity = [...recentLikes, ...recentComments, ...recentFollows]
    .sort((first, second) => toTimestamp(second.created_at) - toTimestamp(first.created_at))
    .slice(0, 6)
    .map((item) => ({ ...item, time_label: formatTimeAgo(item.created_at) }));

  const baseStats = calculateArtStats(userId);
  const totalViews = Number(db.prepare(`
    SELECT COALESCE(SUM(views), 0) AS count
    FROM artworks
    WHERE user_id = ? AND is_published = 1
  `).get(userId).count);
  const favoritesReceived = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM likes l
    INNER JOIN artworks a ON a.id = l.artwork_id
    WHERE a.user_id = ? AND a.is_published = 1
  `).get(userId).count);
  const commentsReceived = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM comments cm
    INNER JOIN artworks a ON a.id = cm.artwork_id
    WHERE a.user_id = ? AND a.is_published = 1
  `).get(userId).count);
  const bookmarksReceived = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM bookmarks b
    INNER JOIN artworks a ON a.id = b.artwork_id
    WHERE a.user_id = ? AND a.is_published = 1
  `).get(userId).count);
  const mostViewed = uploaded.reduce((top, artwork) => (artwork.views > (top ? top.views : -1) ? artwork : top), null);
  const mostLiked = uploaded.reduce((top, artwork) => (artwork.likes_count > (top ? top.likes_count : -1) ? artwork : top), null);

  res.render('pages/dashboard', {
    uploaded,
    drafts,
    bookmarks,
    likedArtworks,
    collections,
    followers,
    following,
    recentActivity,
    stats: {
      ...baseStats,
      totalViews,
      favoritesReceived,
      collectionsCount: collections.length,
      totalComments: commentsReceived,
      bookmarksReceived
    },
    mostViewed,
    mostLiked,
    todayLabel: new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }),
    pageTitle: 'Dashboard | ArtSpace'
  });
});

app.post('/collections/create', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const description = String(req.body.description || '').trim().slice(0, 300);
  const rawArtworkIds = Array.isArray(req.body.artwork_ids) ? req.body.artwork_ids : [req.body.artwork_ids];
  const artworkIds = [...new Set(rawArtworkIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

  if (!name) {
    return res.redirect('/dashboard#collections');
  }

  const createCollection = db.transaction(() => {
    const created = db.prepare('INSERT INTO collections (user_id, name, description) VALUES (?, ?, ?)')
      .run(req.session.user.id, name, description);
    const insertItem = db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, artwork_id) VALUES (?, ?)');
    const ownedArtwork = db.prepare('SELECT id FROM artworks WHERE id = ? AND user_id = ? AND is_published = 1');

    for (const artworkId of artworkIds) {
      if (ownedArtwork.get(artworkId, req.session.user.id)) {
        insertItem.run(created.lastInsertRowid, artworkId);
      }
    }
  });

  createCollection();
  return res.redirect('/dashboard#collections');
});

app.post('/collections/:id/delete', requireAuth, (req, res) => {
  const collection = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.user.id);

  if (collection) {
    db.transaction(() => {
      db.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(collection.id);
      db.prepare('DELETE FROM collections WHERE id = ?').run(collection.id);
    })();
  }

  return res.redirect('/dashboard#collections');
});

app.get('/admin', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 10').all();
  const artworks = db.prepare(`
    SELECT a.*, u.username, c.name AS category_name
    FROM artworks a
    INNER JOIN users u ON u.id = a.user_id
    INNER JOIN categories c ON c.id = a.category_id
    ORDER BY a.created_at DESC
    LIMIT 10
  `).all();
  const reports = db.prepare(`
    SELECT r.*, u.username AS reporter_username, a.title AS artwork_title
    FROM reports r
    LEFT JOIN users u ON u.id = r.reporter_id
    LEFT JOIN artworks a ON a.id = r.target_id AND r.target_type = 'artwork'
    ORDER BY r.created_at DESC
    LIMIT 20
  `).all();

  res.render('pages/admin', {
    users,
    artworks,
    reports,
    pageTitle: 'Admin Dashboard'
  });
});

app.post('/admin/report/:id/clear', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin');
});

app.post('/admin/art/:id/hide', requireAdmin, (req, res) => {
  db.prepare('UPDATE artworks SET is_published = 0 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('pages/login', { pageTitle: 'Login' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('pages/login', {
      error: 'Invalid login credentials.',
      pageTitle: 'Login'
    });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    email: user.email,
    avatar: user.avatar
  };

  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('pages/register', { pageTitle: 'Create account' });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const displayName = (req.body.display_name || username || 'Artist').trim();

  if (!username || !email || !password || password.length < 6) {
    return res.status(400).render('pages/register', {
      error: 'Please provide a valid username, email, and a password with at least 6 characters.',
      pageTitle: 'Create account'
    });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existingUser) {
    return res.status(400).render('pages/register', {
      error: 'A user with this username or email already exists.',
      pageTitle: 'Create account'
    });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const created = db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, bio, avatar, cover_image, role, is_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'artist', 1)
  `).run(username, email, passwordHash, displayName, 'Freshly joined the ArtSpace community.', '/uploads/avatars/default-avatar.svg', '/uploads/covers/default-cover.svg');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(created.lastInsertRowid);
  req.session.user = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    email: user.email,
    avatar: user.avatar
  };

  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', { pageTitle: 'Forgot password' });
});

app.post('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', {
    message: 'Password reset is not enabled in the demo build, but your account remains protected with secure session-based auth.',
    pageTitle: 'Forgot password'
  });
});

app.get('/notifications', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE recipient_id = ?
    ORDER BY created_at DESC
  `).all(req.session.user.id);

  db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_id = ?').run(req.session.user.id);

  res.render('pages/notifications', {
    notifications,
    pageTitle: 'Notifications'
  });
});

app.use((req, res) => {
  res.status(404).render('pages/error', { message: 'The page you requested could not be found.' });
});

app.listen(PORT, HOST, () => {
  const portSuffix = Number(PORT) === 80 ? '' : `:${PORT}`;
  const localUrl = `http://localhost${portSuffix}`;
  console.log(`ArtSpace is running at ${localUrl}`);

  if (HOST === '0.0.0.0') {
    const lanAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((network) => network && (network.family === 'IPv4' || network.family === 4) && !network.internal)
      .map((network) => network.address);

    [...new Set(lanAddresses)].forEach((address) => {
      console.log(`LAN: http://${address}${portSuffix}`);
    });
  }
});
