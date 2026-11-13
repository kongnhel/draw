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
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
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
const i18n = require('./src/i18n');

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
const ADSENSE_CLIENT = 'ca-pub-9143750053355750';
const ADSENSE_SCRIPT_URL = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
const ADS_CONSENT_COOKIE = 'artspace-ads-consent';
const normalizeAdSlot = (value) => {
  const slot = String(value || '').trim();
  return /^\d{6,}$/.test(slot) ? slot : '';
};
const ADSENSE_SLOTS = Object.freeze({
  home: normalizeAdSlot(process.env.ADSENSE_HOME_SLOT),
  explore: normalizeAdSlot(process.env.ADSENSE_EXPLORE_SLOT),
  artwork: normalizeAdSlot(process.env.ADSENSE_ARTWORK_SLOT),
  profile: normalizeAdSlot(process.env.ADSENSE_PROFILE_SLOT)
});
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

function handleArtworkEditUpload(req, res, next) {
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

    res.redirect(`/art/${encodeURIComponent(req.params.id)}/edit?error=${encodeURIComponent(message)}`);
  });
}

async function withTransaction(work) {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Could not roll back transaction:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function fetchArtworkImages(artworkId) {
  const rows = await db.execute(
    `SELECT id, artwork_id, image_url, thumbnail_url, sort_order
       FROM artwork_images
      WHERE artwork_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [artworkId]
  );

  return (rows || []).map((row) => ({
    id: Number(row.id),
    artwork_id: Number(row.artwork_id),
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url || row.image_url,
    sort_order: Number(row.sort_order || 0)
  }));
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
  return `${url}${separator}tr=w-${Math.round(width)}%2Cq-${quality}%2Cf-auto`;
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
    'public/css/book-slider.css',
    'public/css/book-slider-tailwind.css',
    'public/css/language.css',
    'public/css/studio-compact.css',
    'public/css/home-notebook.css',
    'public/css/notifications.css',
    'public/css/mobile-bottom-nav.css',
    'public/css/artwork-detail.css',
    'public/css/multi-image.css',
    'public/css/social.css',
    'public/css/community.css',
    'public/css/ads.css',
    'public/css/messages.css',
    'public/css/mobile-sketchbook.css',
    'public/css/mobile-polish.css',
    'public/js/ads.js',
    'public/js/book-slider.js',
    'public/js/i18n.js',
    'public/js/intro.js',
    'public/js/auth.js',
    'public/js/admin.js',
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

async function isFollowingUser(followerId, followingId) {
  const follower = Number(followerId);
  const following = Number(followingId);
  if (!follower || !following || follower === following) return false;

  const rows = await db.execute(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
    [follower, following]
  );
  return Boolean(rows && rows.length);
}

const COMMENT_PAGE_SIZE = 8;

const COMMENT_SELECT = `SELECT cm.id, cm.parent_id, cm.body, cm.created_at, cm.updated_at,
       u.id AS user_id, u.username,
       COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
       u.avatar,
       DATE_FORMAT(cm.created_at, '%b %d, %Y') AS created_at_label,
       (cm.updated_at > cm.created_at) AS is_edited,
       (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = cm.id) AS likes_count,
       EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = cm.id AND cl.user_id = ?) AS is_liked
  FROM comments cm
  INNER JOIN users u ON u.id = cm.user_id`;

function decorateCommentRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    id: Number(row.id),
    parent_id: row.parent_id ? Number(row.parent_id) : null,
    user_id: Number(row.user_id),
    likes_count: Number(row.likes_count || 0),
    is_liked: Boolean(Number(row.is_liked)),
    is_edited: Boolean(Number(row.is_edited)),
    replies: []
  }));
}

function buildCommentTree(topRows, replyRows) {
  const allRows = [...(topRows || []), ...(replyRows || [])];
  const nodes = decorateCommentRows(allRows);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = (topRows || [])
    .map((row) => byId.get(Number(row.id)))
    .filter(Boolean);

  (replyRows || []).forEach((row) => {
    const node = byId.get(Number(row.id));
    if (!node || !node.parent_id) return;
    const parent = byId.get(node.parent_id);
    if (parent) parent.replies.push(node);
  });

  return roots;
}

async function fetchArtworkComments(artworkId, viewerId, page = 1) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const offset = (safePage - 1) * COMMENT_PAGE_SIZE;

  const [topRows, replyRows, topCountRows, totalCountRows] = await Promise.all([
    db.execute(
      `${COMMENT_SELECT}
        WHERE cm.artwork_id = ? AND cm.parent_id IS NULL
        ORDER BY cm.created_at DESC, cm.id DESC
        LIMIT ${COMMENT_PAGE_SIZE} OFFSET ${offset}`,
      [viewerId, artworkId]
    ),
    db.execute(
      `${COMMENT_SELECT}
        WHERE cm.artwork_id = ? AND cm.parent_id IS NOT NULL
        ORDER BY cm.created_at ASC, cm.id ASC`,
      [viewerId, artworkId]
    ),
    db.execute(
      'SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ? AND parent_id IS NULL',
      [artworkId]
    ),
    db.execute('SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ?', [artworkId])
  ]);

  const topTotal = Number((topCountRows && topCountRows[0] && topCountRows[0].count) || 0);
  const total = Number((totalCountRows && totalCountRows[0] && totalCountRows[0].count) || 0);

  return {
    comments: buildCommentTree(topRows, replyRows),
    page: safePage,
    pageSize: COMMENT_PAGE_SIZE,
    topTotal,
    total,
    hasMore: safePage * COMMENT_PAGE_SIZE < topTotal
  };
}

async function fetchCommentForRender(commentId, viewerId) {
  const rows = await db.execute(
    `${COMMENT_SELECT} WHERE cm.id = ? LIMIT 1`,
    [viewerId, commentId]
  );
  const [comment] = decorateCommentRows(rows);
  return comment || null;
}

function renderViewPartial(app, view, locals) {
  return new Promise((resolve, reject) => {
    app.render(view, locals, (error, html) => {
      if (error) reject(error);
      else resolve(html);
    });
  });
}

function artworkViewerKey(req) {
  const viewerId = req.session && req.session.user && req.session.user.id;
  if (viewerId) return `u:${Number(viewerId)}`;
  const fingerprint = `${req.ip || ''}|${req.get('user-agent') || ''}`;
  return `g:${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

const REACTION_TYPES = ['like', 'love', 'care', 'haha', 'wow', 'sad'];
const REACTION_LABELS = {
  like: 'Like',
  love: 'Love',
  care: 'Care',
  haha: 'Haha',
  wow: 'Wow',
  sad: 'Sad'
};

function normalizeReaction(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return REACTION_TYPES.includes(candidate) ? candidate : 'like';
}

async function createNotification({ userId, actorId, type, artworkId = null, commentId = null, shareId = null, conversationId = null, message = null }) {
  const recipientId = Number(userId);
  const actor = Number(actorId);
  if (!recipientId || !actor || recipientId === actor) return;

  try {
    await db.execute(
      'INSERT INTO notifications (user_id, actor_id, type, artwork_id, comment_id, share_id, conversation_id, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [recipientId, actor, String(type), artworkId || null, commentId || null, shareId || null, conversationId || null, message || null]
    );
  } catch (error) {
    console.error('Could not create notification:', error);
  }
}

// One unread "message" notification per (recipient, actor, conversation): a new
// message bumps the existing row instead of stacking duplicates.
async function upsertMessageNotification({ userId, actorId, conversationId }) {
  const recipientId = Number(userId);
  const actor = Number(actorId);
  const conversation = Number(conversationId);
  if (!recipientId || !actor || !conversation || recipientId === actor) return;

  try {
    const existing = await db.execute(
      `SELECT id FROM notifications
        WHERE user_id = ? AND actor_id = ? AND type = 'message' AND conversation_id = ? AND is_read = 0
        LIMIT 1`,
      [recipientId, actor, conversation]
    );
    if (existing && existing.length) {
      await db.execute(
        'UPDATE notifications SET created_at = NOW() WHERE id = ?',
        [Number(existing[0].id)]
      );
      return;
    }

    await createNotification({
      userId: recipientId,
      actorId: actor,
      type: 'message',
      conversationId: conversation,
      message: 'sent you a private message'
    });
  } catch (error) {
    console.error('Could not upsert message notification:', error);
  }
}

async function removeNotification({ userId, actorId, type, artworkId = null }) {
  const recipientId = Number(userId);
  const actor = Number(actorId);
  if (!recipientId || !actor) return;

  const params = [recipientId, actor, String(type)];
  let sql = 'DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ?';

  if (artworkId) {
    sql += ' AND artwork_id = ?';
    params.push(Number(artworkId));
  } else {
    sql += ' AND artwork_id IS NULL';
  }

  try {
    await db.execute(sql, params);
  } catch (error) {
    console.error('Could not remove notification:', error);
  }
}

async function countUnreadNotifications(userId) {
  if (!userId) return 0;

  const rows = await db.execute(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return Number((rows && rows[0] && rows[0].count) || 0);
}

// ----------------------------------------------------
// Private messaging (user-to-user, Messenger style)
// ----------------------------------------------------

const MESSAGE_MAX_LENGTH = 2000;
const MESSAGE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MESSAGE_DELETE_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MESSAGE_TYPES = ['text', 'artwork', 'image'];
const ONLINE_WINDOW_SECONDS = 180;
const CONVERSATION_PAGE_SIZE = 30;
const MESSAGES_PAGE_SIZE = 30;

// In-memory typing + last-seen write throttle (single Node process; polling
// remains fully functional on serverless platforms, typing simply degrades).
const typingState = new Map();
const lastSeenWrites = new Map();

function setTypingFlag(conversationId, userId, isTyping) {
  const key = Number(conversationId);
  if (!key) return;
  const now = Date.now();
  let room = typingState.get(key);
  if (!room) {
    room = new Map();
    typingState.set(key, room);
  }
  if (isTyping) {
    room.set(Number(userId), now + 6000);
  } else {
    room.delete(Number(userId));
  }
  for (const [uid, expires] of room) {
    if (expires <= now) room.delete(uid);
  }
}

function getTypingUsers(conversationId, viewerId) {
  const room = typingState.get(Number(conversationId));
  if (!room) return [];
  const now = Date.now();
  const users = [];
  for (const [uid, expires] of room) {
    if (expires <= now) {
      room.delete(uid);
      continue;
    }
    if (Number(uid) === Number(viewerId)) continue;
    users.push(Number(uid));
  }
  return users;
}

async function touchUserLastSeen(userId) {
  const uid = Number(userId);
  if (!uid) return;
  const now = Date.now();
  const previous = lastSeenWrites.get(uid) || 0;
  if (now - previous < 45000) return;
  lastSeenWrites.set(uid, now);
  try {
    await db.execute('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [uid]);
  } catch (error) {
    console.error('Could not update last_seen_at:', error && (error.code || error.message));
  }
}

function sanitizeMessageContent(raw) {
  // Normalize whitespace, strip control characters and zero-width tricks.
  return String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, MESSAGE_MAX_LENGTH);
}

const MESSAGE_CONVERSATION_ACCESS_SQL = `EXISTS (
    SELECT 1 FROM conversation_participants cp
     WHERE cp.conversation_id = ? AND cp.user_id = ? AND cp.is_deleted = 0
  )`;

async function getConversationAccess(conversationId, userId) {
  const rows = await db.execute(
    `SELECT cp.id, cp.user_id, cp.last_read_at, cp.is_muted, cp.is_deleted, cp.deleted_at, c.created_at AS conversation_created_at, c.updated_at AS conversation_updated_at
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.conversation_id = ? AND cp.user_id = ?
      LIMIT 1`,
    [Number(conversationId), Number(userId)]
  );
  return rows && rows.length ? rows[0] : null;
}

async function getOtherParticipants(conversationId, userId) {
  const rows = await db.execute(
    `SELECT u.id, u.username, u.name, u.avatar, u.role, u.status, u.last_seen_at
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
      WHERE cp.conversation_id = ? AND cp.user_id <> ?
      ORDER BY cp.id ASC`,
    [Number(conversationId), Number(userId)]
  );
  return (rows || []).map((row) => ({
    id: Number(row.id),
    username: row.username,
    display_name: (row.name && String(row.name).trim()) || row.username,
    avatar: row.avatar || null,
    role: row.role || 'user',
    status: row.status || 'active',
    last_seen_at: row.last_seen_at
  }));
}

function isUserOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const timestamp = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= ONLINE_WINDOW_SECONDS * 1000;
}

async function getBlockStateBetween(userA, userB) {
  const rows = await db.execute(
    `SELECT blocker_id, blocked_id FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 2`,
    [Number(userA), Number(userB), Number(userB), Number(userA)]
  );
  let iBlocked = false;
  let blockedMe = false;
  (rows || []).forEach((row) => {
    if (Number(row.blocker_id) === Number(userA)) iBlocked = true;
    else blockedMe = true;
  });
  return { iBlocked, blockedMe };
}

async function findOrCreateConversation(userId, otherUserId) {
  const me = Number(userId);
  const other = Number(otherUserId);
  if (!me || !other || me === other) {
    return { error: 'Please choose another ArtSpace member to message.' };
  }

  const [target] = await db.execute(
    `SELECT id, username, status FROM users WHERE id = ? LIMIT 1`,
    [other]
  );
  if (!target) return { error: 'That ArtSpace member could not be found.' };
  if (target.status !== 'active') return { error: 'That account is not available for messaging.' };

  const existing = await db.execute(
    `SELECT c.id
       FROM conversations c
       JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
      WHERE (SELECT COUNT(*) FROM conversation_participants x WHERE x.conversation_id = c.id) = 2
      LIMIT 1`,
    [me, other]
  );
  if (existing && existing.length) {
    const conversationId = Number(existing[0].id);
    await db.execute(
      'UPDATE conversation_participants SET is_deleted = 0, deleted_at = NULL, updated_at = NOW() WHERE conversation_id = ? AND user_id = ? AND is_deleted = 1',
      [conversationId, me]
    );
    return { conversationId };
  }

  const blockState = await getBlockStateBetween(me, other);
  if (blockState.iBlocked) return { error: 'You blocked this member. Unblock them to send messages.', blocked: true };
  if (blockState.blockedMe) return { error: 'You cannot message this member right now.', blocked: true };

  const insertedId = await withTransaction(async (connection) => {
    const [conversationResult] = await connection.execute(
      'INSERT INTO conversations (id) VALUES (DEFAULT)'
    );
    const conversationId = Number(conversationResult.insertId);
    await connection.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
      [conversationId, me, conversationId, other]
    );
    return conversationId;
  });

  return { conversationId: insertedId };
}

const CONVERSATION_LIST_SELECT = `SELECT c.id, c.updated_at AS conversation_updated_at,
       cp.last_read_at, cp.is_muted,
       ou.id AS other_id, ou.username AS other_username, ou.avatar AS other_avatar, ou.last_seen_at AS other_last_seen_at,
       ou.status AS other_status,
       COALESCE(NULLIF(ou.name, ''), ou.username) AS other_display_name,
       lm.id AS last_message_id, lm.sender_id AS last_sender_id, lm.message_type AS last_message_type,
       lm.content AS last_content, lm.deleted_at AS last_deleted_at, lm.edited_at AS last_edited_at,
       lm.created_at AS last_message_at,
       lma.id AS last_attachment_id, lma.file_path AS last_attachment_path, lma.file_type AS last_attachment_type,
       la.id AS last_artwork_id, la.title AS last_artwork_title,
       lai.thumbnail_url AS last_artwork_thumbnail,
       lai.image_url AS last_artwork_image,
       lasu.username AS last_sender_username,
       COALESCE(NULLIF(lasu.name, ''), lasu.username) AS last_sender_name
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  JOIN conversation_participants other_cp ON other_cp.conversation_id = c.id AND other_cp.user_id <> cp.user_id
  JOIN users ou ON ou.id = other_cp.user_id
  LEFT JOIN messages lm ON lm.id = (
    SELECT m.id
      FROM messages m
     WHERE m.conversation_id = c.id
       AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)
       AND m.created_at > COALESCE(cp.deleted_at, '1971-01-01')
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1
  )
  LEFT JOIN message_attachments lma ON lma.message_id = lm.id AND lma.file_type = 'image'
  LEFT JOIN artworks la ON la.id = lm.artwork_id
  LEFT JOIN artwork_images lai ON lai.id = la.cover_image_id
  LEFT JOIN users lasu ON lasu.id = lm.sender_id
 WHERE cp.user_id = ? AND cp.is_deleted = 0`;

function mapConversationRow(row, viewerId) {
  const lastType = row.last_message_type || 'text';
  const senderIsViewer = Number(row.last_sender_id) === Number(viewerId);
  let preview = '';
  if (row.last_message_id) {
    if (lastType === 'artwork') {
      preview = row.last_artwork_title ? `Artwork · ${row.last_artwork_title}` : 'Artwork';
    } else if (lastType === 'image') {
      preview = row.last_content ? `Photo · ${row.last_content}` : 'Photo';
    } else {
      preview = String(row.last_content || '').replace(/\s+/g, ' ').slice(0, 90);
    }
  }
  return {
    id: Number(row.id),
    updated_at: row.conversation_updated_at,
    last_read_at: row.last_read_at,
    is_muted: Boolean(Number(row.is_muted)),
    other_user: {
      id: Number(row.other_id),
      username: row.other_username,
      display_name: row.other_display_name,
      avatar: row.other_avatar || null,
      online: isUserOnline(row.other_last_seen_at),
      last_seen_at: row.other_last_seen_at,
      status: row.other_status
    },
    last_message: row.last_message_id
      ? {
          id: Number(row.last_message_id),
          type: lastType,
          content: row.last_deleted_at ? null : preview,
          is_mine: senderIsViewer,
          sender_name: row.last_sender_name,
          created_at: row.last_message_at,
          artwork: lastType === 'artwork' && row.last_artwork_id
            ? { id: Number(row.last_artwork_id), title: row.last_artwork_title, thumbnail: row.last_artwork_thumbnail || row.last_artwork_image }
            : null,
          attachment: lastType === 'image' && row.last_attachment_path
            ? { path: row.last_attachment_path, type: row.last_attachment_type }
            : null
        }
      : null,
    unread_count: 0
  };
}

async function countUnreadMessagesByConversation(userId) {
  const rows = await db.execute(
    `SELECT m.conversation_id, COUNT(*) AS unread
       FROM messages m
       JOIN conversation_participants cp
         ON cp.conversation_id = m.conversation_id AND cp.user_id = ? AND cp.is_deleted = 0
      WHERE m.sender_id <> ?
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(cp.last_read_at, '1971-01-01')
        AND m.created_at > COALESCE(cp.deleted_at, '1971-01-01')
        AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)
      GROUP BY m.conversation_id`,
    [Number(userId), Number(userId), Number(userId)]
  );
  const map = new Map();
  (rows || []).forEach((row) => map.set(Number(row.conversation_id), Number(row.unread)));
  return map;
}

async function countUnreadMessagesTotal(userId) {
  const map = await countUnreadMessagesByConversation(userId);
  let total = 0;
  for (const count of map.values()) total += count;
  return total;
}

const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.content, m.reply_to_id,
       m.edited_at, m.deleted_at, m.created_at,
       su.username AS sender_username, su.avatar AS sender_avatar,
       COALESCE(NULLIF(su.name, ''), su.username) AS sender_name,
       a.id AS artwork_id, a.title AS artwork_title, a.user_id AS artwork_artist_id, a.visibility AS artwork_visibility, a.status AS artwork_status,
       au.username AS artwork_artist_username,
       COALESCE(NULLIF(au.name, ''), au.username) AS artwork_artist_name,
       COALESCE(ai.thumbnail_url, ai.image_url, a.thumbnail_url, a.image_url) AS artwork_thumbnail,
       ma.id AS attachment_id, ma.file_path AS attachment_path, ma.file_type AS attachment_type,
       rm.id AS reply_id, rm.content AS reply_content, rm.message_type AS reply_type, rm.created_at AS reply_created_at, rm.deleted_at AS reply_deleted_at,
       ru.username AS reply_username,
       COALESCE(NULLIF(ru.name, ''), ru.username) AS reply_name
  FROM messages m
  JOIN users su ON su.id = m.sender_id
  LEFT JOIN artworks a ON a.id = m.artwork_id
  LEFT JOIN users au ON au.id = a.user_id
  LEFT JOIN artwork_images ai ON ai.id = a.cover_image_id
  LEFT JOIN message_attachments ma ON ma.message_id = m.id AND ma.file_type = 'image'
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = rm.sender_id`;

function mapMessageRow(row, viewerId) {
  const hiddenForMe = Boolean(Number(row.hidden_for_me));
  const removedForEveryone = Boolean(row.deleted_at);
  const isArtworkType = row.message_type === 'artwork';
  const artworkVisible = Boolean(row.artwork_id) && row.artwork_visibility !== 'private' && row.artwork_status === 'active';
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_id: Number(row.sender_id),
    is_mine: viewerId !== undefined && Number(row.sender_id) === Number(viewerId),
    sender_name: row.sender_name,
    sender_username: row.sender_username,
    sender_avatar: row.sender_avatar || null,
    type: row.message_type,
    content: removedForEveryone ? null : (row.content || ''),
    is_removed: removedForEveryone || hiddenForMe,
    removed_for_everyone: removedForEveryone,
    edited_at: row.edited_at || null,
    created_at: row.created_at,
    reply_to: row.reply_id && !row.reply_deleted_at
      ? {
          id: Number(row.reply_id),
          content: row.reply_type === 'text' ? String(row.reply_content || '').slice(0, 140) : null,
          type: row.reply_type,
          sender_name: row.reply_name,
          created_at: row.reply_created_at
        }
      : null,
    artwork: isArtworkType && artworkVisible
      ? {
          id: Number(row.artwork_id),
          title: row.artwork_title,
          artist_username: row.artwork_artist_username,
          artist_name: row.artwork_artist_name,
          thumbnail: row.artwork_thumbnail || null
        }
      : null,
    attachment: row.message_type === 'image' && row.attachment_path
      ? { path: row.attachment_path, type: row.attachment_type }
      : null
  };
}

const MESSAGE_REACTIONS_ALLOWED = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👎'];

async function mapMessageRowsWithReactions(rows, viewerId) {
  const mapped = (rows || []).map((row) => mapMessageRow(row, viewerId));
  const ids = mapped.map((message) => message.id);
  if (!ids.length) return mapped;

  const placeholders = ids.map(() => '?').join(',');
  const reactionRows = await db.execute(
    `SELECT message_id, user_id, reaction FROM message_reactions WHERE message_id IN (${placeholders})`,
    ids
  );

  const byMessage = new Map();
  for (const row of reactionRows || []) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
    byMessage.get(row.message_id).push(row);
  }
  for (const message of mapped) {
    message.reactions = summarizeReactions(byMessage.get(message.id) || [], viewerId);
  }
  return mapped;
}

function summarizeReactions(reactionRows, viewerId) {
  const grouped = new Map();
  for (const row of reactionRows || []) {
    if (!grouped.has(row.reaction)) {
      grouped.set(row.reaction, { reaction: row.reaction, count: 0, mine: false });
    }
    const entry = grouped.get(row.reaction);
    entry.count += 1;
    if (Number(row.user_id) === Number(viewerId)) entry.mine = true;
  }
  return [...grouped.values()];
}


function escapeHtmlText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

const MENTION_REGEX = /(^|[^\w@/])@([A-Za-z0-9_]{2,30})/g;

function extractMentionUsernames(text) {
  const found = new Set();
  const source = String(text || '');
  let match = MENTION_REGEX.exec(source);
  while (match) {
    found.add(match[2].toLowerCase());
    match = MENTION_REGEX.exec(source);
  }
  MENTION_REGEX.lastIndex = 0;
  return [...found];
}

function mentionify(value) {
  return escapeHtmlText(value).replace(
    /(^|[^\w@/])@([A-Za-z0-9_]{2,30})/g,
    (full, prefix, username) => `${prefix}<a class="ad-mention" href="/profile/${encodeURIComponent(username)}" data-i18n-skip>@${username}</a>`
  );
}

async function syncMentions({ actorId, text, mentionableType, mentionableId, artworkId = null, shareId = null, notificationMessage = null }) {
  const author = Number(actorId);
  const type = String(mentionableType || '');
  const target = Number(mentionableId);
  if (!author || !type || !target) return [];

  const usernames = extractMentionUsernames(text);
  if (!usernames.length) return [];

  const placeholders = usernames.map(() => '?').join(',');
  let rows = [];
  try {
    rows = await db.execute(
      `SELECT id, username FROM users WHERE LOWER(username) IN (${placeholders}) AND status = 'active'`,
      usernames
    );
  } catch (error) {
    console.error('Could not resolve mentioned users:', error);
    return [];
  }

  const notified = [];
  for (const row of rows || []) {
    try {
      const inserted = await db.execute(
        `INSERT IGNORE INTO mentions (mentioned_by, mentioned_user_id, mentionable_type, mentionable_id)
         VALUES (?, ?, ?, ?)`,
        [author, row.id, type, target]
      );
      if (!inserted || inserted.affectedRows === 0) continue;

      await createNotification({
        userId: row.id,
        actorId: author,
        type: 'mention',
        artworkId,
        commentId: type === 'comment' || type === 'share_comment' ? target : null,
        shareId,
        message: notificationMessage || String(text || '').slice(0, 240)
      });
      notified.push(Number(row.id));
    } catch (error) {
      console.error('Could not store mention:', error);
    }
  }

  return notified;
}

async function removeMentionsFor(mentionableType, mentionableId) {
  try {
    await db.execute(
      'DELETE FROM mentions WHERE mentionable_type = ? AND mentionable_id = ?',
      [String(mentionableType), Number(mentionableId)]
    );
  } catch (error) {
    console.error('Could not clear mentions:', error);
  }
}

async function fetchReactionSummary(artworkId) {
  const rows = await db.execute(
    'SELECT reaction_type, COUNT(*) AS count FROM likes WHERE artwork_id = ? GROUP BY reaction_type',
    [artworkId]
  );
  const counts = {};
  let total = 0;
  for (const type of REACTION_TYPES) counts[type] = 0;
  for (const row of rows || []) {
    const type = normalizeReaction(row.reaction_type);
    const count = Number(row.count || 0);
    counts[type] += count;
    total += count;
  }
  return { counts, total };
}

const COMMUNITY_PAGE_SIZE = 8;
const SHARE_COMMENT_PAGE_SIZE = 10;

const COMMUNITY_SHARE_SELECT = `SELECT s.id AS share_id, s.message AS share_message, s.created_at AS share_created_at,
       s.user_id AS sharer_id,
       su.username AS sharer_username,
       COALESCE(NULLIF(su.name, ''), su.username) AS sharer_name,
       su.avatar AS sharer_avatar,
       a.id, a.user_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
       u.username,
       COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
       u.avatar,
       c.name AS category_name,
       a.created_at, DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_at_label,
       (SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id) AS shared_likes_count,
       (SELECT COUNT(*) FROM share_comments sc WHERE sc.share_id = s.id) AS shared_comments_count,
       (SELECT COUNT(*) FROM artwork_shares ash WHERE ash.artwork_id = a.id AND ash.platform = 'internal') AS artwork_shares_count,
       EXISTS(SELECT 1 FROM share_likes sl WHERE sl.share_id = s.id AND sl.user_id = ?) AS viewer_shared_liked,
       (SELECT sl.reaction_type FROM share_likes sl WHERE sl.share_id = s.id AND sl.user_id = ? LIMIT 1) AS viewer_shared_reaction,
       (SELECT COUNT(*) FROM artwork_images ai WHERE ai.artwork_id = a.id) AS artwork_images_count
  FROM artwork_shares s
  INNER JOIN artworks a ON a.id = s.artwork_id
  INNER JOIN users u ON u.id = a.user_id
  INNER JOIN users su ON su.id = s.user_id
  LEFT JOIN categories c ON c.id = a.category_id`;

const COMMUNITY_SHARE_FILTERS = "s.platform = 'internal' AND s.user_id IS NOT NULL AND su.status = 'active' AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'";

function decorateCommunityShare(row) {
  return {
    share_id: Number(row.share_id),
    message: row.share_message || '',
    created_at: row.share_created_at,
    sharer: {
      id: Number(row.sharer_id),
      username: row.sharer_username,
      display_name: row.sharer_name || row.sharer_username,
      avatar: row.sharer_avatar
    },
    artwork: {
      id: Number(row.id),
      user_id: Number(row.user_id),
      title: row.title,
      description: row.description,
      image_url: row.image_url,
      thumbnail_url: row.thumbnail_url,
      tags: row.tags,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
      category_name: row.category_name,
      created_at: row.created_at,
      created_at_label: row.created_at_label,
      images_count: Number(row.artwork_images_count || 0),
      shares_count: Number(row.artwork_shares_count || 0)
    },
    likes_count: Number(row.shared_likes_count || 0),
    comments_count: Number(row.shared_comments_count || 0),
    is_liked: Boolean(Number(row.viewer_shared_liked)),
    viewer_reaction: row.viewer_shared_reaction ? normalizeReaction(row.viewer_shared_reaction) : null
  };
}

async function fetchCommunityShare(shareId, viewerId) {
  const rows = await db.execute(
    `${COMMUNITY_SHARE_SELECT}
      WHERE s.id = ? AND ${COMMUNITY_SHARE_FILTERS}
      LIMIT 1`,
    [viewerId, viewerId, shareId]
  );
  const row = rows && rows[0];
  return row ? decorateCommunityShare(row) : null;
}

async function fetchShareReactionSummary(shareId) {
  const rows = await db.execute(
    'SELECT reaction_type, COUNT(*) AS count FROM share_likes WHERE share_id = ? GROUP BY reaction_type',
    [shareId]
  );
  const counts = {};
  let total = 0;
  for (const type of REACTION_TYPES) counts[type] = 0;
  for (const row of rows || []) {
    const type = normalizeReaction(row.reaction_type);
    const count = Number(row.count || 0);
    counts[type] += count;
    total += count;
  }
  return { counts, total };
}

const SHARE_COMMENT_SELECT = `SELECT sc.id, sc.parent_id, sc.body, sc.created_at, sc.updated_at,
       u.id AS user_id, u.username,
       COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
       u.avatar,
       DATE_FORMAT(sc.created_at, '%b %d, %Y') AS created_at_label,
       (sc.updated_at > sc.created_at) AS is_edited
  FROM share_comments sc
  INNER JOIN users u ON u.id = sc.user_id`;

async function fetchShareComments(shareId, page = 1) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const offset = (safePage - 1) * SHARE_COMMENT_PAGE_SIZE;

  const [topRows, replyRows, topCountRows, totalRows] = await Promise.all([
    db.execute(
      `${SHARE_COMMENT_SELECT}
        WHERE sc.share_id = ? AND sc.parent_id IS NULL
        ORDER BY sc.created_at DESC, sc.id DESC
        LIMIT ${SHARE_COMMENT_PAGE_SIZE} OFFSET ${offset}`,
      [shareId]
    ),
    db.execute(
      `${SHARE_COMMENT_SELECT}
        WHERE sc.share_id = ? AND sc.parent_id IS NOT NULL
        ORDER BY sc.created_at ASC, sc.id ASC`,
      [shareId]
    ),
    db.execute(
      'SELECT COUNT(*) AS count FROM share_comments WHERE share_id = ? AND parent_id IS NULL',
      [shareId]
    ),
    db.execute(
      'SELECT COUNT(*) AS count FROM share_comments WHERE share_id = ?',
      [shareId]
    )
  ]);

  const topTotal = Number((topCountRows && topCountRows[0] && topCountRows[0].count) || 0);
  const total = Number((totalRows && totalRows[0] && totalRows[0].count) || 0);

  return {
    comments: buildCommentTree(topRows || [], replyRows || []),
    page: safePage,
    pageSize: SHARE_COMMENT_PAGE_SIZE,
    topTotal,
    total,
    hasMore: safePage * SHARE_COMMENT_PAGE_SIZE < topTotal
  };
}

async function fetchShareCommentForRender(commentId) {
  const rows = await db.execute(
    `${SHARE_COMMENT_SELECT} WHERE sc.id = ? LIMIT 1`,
    [commentId]
  );
  return rows && rows[0] ? decorateCommentRows([rows[0]])[0] : null;
}

async function deleteNotificationsForShare(shareId) {
  try {
    await db.execute('DELETE FROM notifications WHERE share_id = ?', [Number(shareId)]);
  } catch (error) {
    console.error('Could not clear share notifications:', error);
  }
}

function notificationLink(row) {
  const type = String(row.type || '');
  if (row.share_id) {
    const anchor = row.comment_id && ['share_comment', 'share_reply', 'share_mention', 'mention'].includes(type)
      ? `#share-comment-${row.comment_id}`
      : '';
    return `/community/${row.share_id}${anchor}`;
  }
  if (row.artwork_id) {
    if (row.comment_id && ['comment', 'reply', 'comment_like', 'mention'].includes(type)) {
      return `/art/${row.artwork_id}#comment-${row.comment_id}`;
    }
    if (type === 'comment' || type === 'comment_like') {
      return `/art/${row.artwork_id}#ad-comments`;
    }
    return `/art/${row.artwork_id}`;
  }
  if (row.actor_username) return `/profile/${encodeURIComponent(row.actor_username)}`;
  return '/explore';
}

function notificationLink(row) {
  const type = String(row.type || '');
  if (type === 'message') {
    return row.conversation_id ? `/messages?c=${Number(row.conversation_id)}` : '/messages';
  }
  if (row.share_id) {
    const anchor = row.comment_id && ['share_comment', 'share_reply', 'share_mention', 'mention'].includes(type)
      ? `#share-comment-${row.comment_id}`
      : '';
    return `/community/${row.share_id}${anchor}`;
  }
  if (row.artwork_id) {
    if (row.comment_id && ['comment', 'reply', 'comment_like', 'mention'].includes(type)) {
      return `/art/${row.artwork_id}#comment-${row.comment_id}`;
    }
    if (type === 'comment' || type === 'comment_like') {
      return `/art/${row.artwork_id}#ad-comments`;
    }
    return `/art/${row.artwork_id}`;
  }
  if (row.actor_username) return `/profile/${encodeURIComponent(row.actor_username)}`;
  return '/explore';
}

function mapNotificationRow(row) {
  return {
    id: Number(row.id),
    type: String(row.type || 'update'),
    message: row.message || '',
    is_read: Boolean(Number(row.is_read)),
    artwork_id: row.artwork_id ? Number(row.artwork_id) : null,
    comment_id: row.comment_id ? Number(row.comment_id) : null,
    share_id: row.share_id ? Number(row.share_id) : null,
    conversation_id: row.conversation_id ? Number(row.conversation_id) : null,
    artwork_title: row.artwork_title || null,
    actor_username: row.actor_username || null,
    actor_name: row.actor_name || 'Someone',
    actor_avatar: row.actor_avatar || null,
    created_at: row.created_at,
    created_at_label: row.created_at_label || '',
    link: notificationLink(row)
  };
}

const NOTIFICATION_SELECT = `SELECT n.id, n.type, n.message, n.is_read, n.created_at, n.artwork_id, n.comment_id, n.share_id, n.conversation_id,
       DATE_FORMAT(n.created_at, '%b %d, %Y') AS created_at_label,
       u.username AS actor_username,
       COALESCE(NULLIF(u.name, ''), u.username) AS actor_name,
       u.avatar AS actor_avatar,
       a.title AS artwork_title
  FROM notifications n
  LEFT JOIN users u ON u.id = n.actor_id
  LEFT JOIN artworks a ON a.id = n.artwork_id`;

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

function requireAuthAction(req, res, next) {
  if (req.session && req.session.user) return next();
  if (requestWantsJson(req)) {
    res.status(401).json({ ok: false, error: 'Please log in to continue.' });
    return;
  }
  res.redirect('/login');
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ ok: false, error: 'Please log in to continue.' });
}

// Guest-only guard: sends already-authenticated users away from /login and /register.
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    if (requestWantsJson(req)) {
      res.status(200).json({ ok: true, redirect: '/' });
      return;
    }
    return res.redirect('/');
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('pages/error', {
      message: 'You do not have permission to open the admin studio.',
      pageTitle: 'ArtSpace | Not available',
      isAuthenticated: true,
      currentUser: req.session.user,
      unreadNotifications: 0
    });
  }
  return next();
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
  'journey.css',
  'wall.css',
  'admin.css',
  'book-slider-tailwind.css',
  'book-slider.css',
  'language.css',
  'studio-compact.css',
  'home-notebook.css',
  'notifications.css',
  'mobile-bottom-nav.css',
  'artwork-detail.css',
  'multi-image.css',
  'social.css',
  'community.css',
  'messages.css',
  'ads.css',
  'mobile-sketchbook.css',
  'mobile-polish.css'
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
      // Files saved with a BOM or in UTF-16 (stray NUL bytes when read as UTF-8)
      // would otherwise corrupt the first selector of the following stylesheet.
      return fs.readFileSync(path.join(cssDir, file), 'utf8')
        .replace(/^\uFEFF+/, '')
        .replace(/\u0000/g, '')
        .replace(/\uFFFD/g, '');
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
app.use(cookieParser());

// Express 5 leaves req.body undefined when a request has no parsed body.
// Normalize it so route handlers can safely read fields from any POST.
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
});

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
app.use(async (req, res, next) => {
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
  res.locals.mentionify = mentionify;
  res.locals.reactionTypes = REACTION_TYPES;
  res.locals.adsenseClient = ADSENSE_CLIENT;
  res.locals.adsenseScriptUrl = ADSENSE_SCRIPT_URL;
  res.locals.adsenseSlots = ADSENSE_SLOTS;
  res.locals.adsAllowed = false;
  const consentValue = req.cookies ? req.cookies[ADS_CONSENT_COOKIE] : '';
  res.locals.adsConsent = consentValue === 'granted' || consentValue === 'denied' ? consentValue : '';

  if (currentUser) {
    try {
      const rows = await db.execute(
        'SELECT id, name, username, email, role, status, avatar, locale FROM users WHERE id = ? LIMIT 1',
        [currentUser.id]
      );
      const freshUser = rows && rows[0];
      if (freshUser) {
        req.session.user = {
          id: freshUser.id,
          username: freshUser.username,
          email: freshUser.email,
          display_name: freshUser.name || freshUser.username,
          avatar: freshUser.avatar || null,
          role: freshUser.role,
          locale: i18n.SUPPORTED.includes(freshUser.locale)
            ? freshUser.locale
            : (currentUser.locale || i18n.DEFAULT_LOCALE)
        };
        res.locals.currentUser = req.session.user;
      }
    } catch (error) {
      console.error('Could not refresh session user:', error);
    }

    try {
      res.locals.unreadNotifications = await countUnreadNotifications(res.locals.currentUser.id);
    } catch (error) {
      console.error('Could not load notification count:', error);
    }

    touchUserLastSeen(res.locals.currentUser.id);

    try {
      res.locals.unreadMessages = await countUnreadMessagesTotal(res.locals.currentUser.id);
    } catch (error) {
      res.locals.unreadMessages = 0;
      console.error('Could not load unread message count:', error);
    }
  } else {
    res.locals.unreadMessages = 0;
  }

  next();
});

// Same-origin guard for state-changing requests (CSRF defense in depth,
// alongside the SameSite=Lax session cookie).
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('Origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch (error) {
    /* fall through to rejection */
  }
  if (requestWantsJson(req)) {
    res.status(403).json({ ok: false, error: 'This request could not be verified. Please refresh and try again.' });
    return;
  }
  respondArtworkActionError(req, res, 403, 'This request could not be verified. Please refresh and try again.');
});

// Locale, shared translator helpers and the Khmer phrase dictionary for JS UI.
app.use((req, res, next) => {
  const locale = i18n.getRequestLocale(req);
  req.locale = locale;
  res.locals.locale = locale;
  res.locals.currentPath = req.originalUrl || '/';
  res.locals.t = (phrase, vars) => i18n.t(locale, phrase, vars);
  res.locals.i18nClient = locale === 'km' ? i18n.clientDictionary() : null;
  next();
});

// Translate the final server-rendered HTML. This covers every EJS page,
// including admin, dashboard, errors, modals and the existing sketchbook UI.
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function sendTranslated(body) {
    try {
      const type = String(res.get('Content-Type') || '');
      const isHtml = type.includes('text/html') || (typeof body === 'string' && body.includes('<!DOCTYPE html'));
      if (req.locale === 'km' && isHtml && typeof body === 'string') {
        body = i18n.translateHtml(body, req.locale);
      }
    } catch (error) {
      console.error('Locale render translation failed:', error && (error.message || error));
    }
    return originalSend.call(this, body);
  };
  next();
});

// Language switch: set the cookie, remember the preference for signed-in users,
// and return to the exact route the visitor was reading.
app.get('/language/:locale', async (req, res) => {
  const locale = String(req.params.locale || '');
  if (!i18n.SUPPORTED.includes(locale)) {
    res.redirect('/');
    return;
  }

  i18n.setLocaleCookie(res, locale);

  if (req.session && req.session.user) {
    req.session.user.locale = locale;
    try {
      await db.execute('UPDATE users SET locale = ? WHERE id = ?', [locale, req.session.user.id]);
    } catch (error) {
      console.error('Could not save user locale:', error && (error.message || error));
    }
  }

  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') && !req.query.next.startsWith('//')
    ? req.query.next
    : '/';
  res.redirect(next);
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
           LEFT JOIN artworks a ON a.user_id = u.id AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
           GROUP BY u.id
           ORDER BY art_count DESC
           LIMIT 1`
      ),
      db.execute(
        `SELECT c.slug, c.name, COUNT(a.id) AS count
           FROM categories c
           LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
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
    const journeyArtworks = [...(bookArtworks || [])]
      .sort((a, b) => {
        const likesDiff = (Number(b.likes_count) || 0) - (Number(a.likes_count) || 0);
        if (likesDiff !== 0) return likesDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 5);
    const artistSpotlightArtworks = artistSpotlight
      ? (bookArtworks || [])
        .filter((artwork) => artwork.username === artistSpotlight.username)
        .slice(0, 3)
      : [];
    const visibleCategories = (categoryRows || []).map((category) => ({
      slug: category.slug,
      name: category.name,
      count: Number(category.count) || 0
    }));

    const homeArtistCount = new Set((bookArtworks || []).map((artwork) => artwork.username)).size;

    const currentUser = (req.session && req.session.user) || null;
    const isAuthenticated = Boolean(currentUser);
    res.locals.adsAllowed = true;

    res.render('pages/home', {
      pageTitle: 'ArtSpace | Discover original artwork',
      isAuthenticated,
      currentUser,
      totalArtworks,
      heroArtwork,
      heroArtworkImageUrl: heroArtwork ? (heroArtwork.image_url || heroArtwork.thumbnail_url) : null,
      heroArtworkIndex,
      bookArtworks: bookArtworks || [],
      latest,
      journeyArtworks,
      artistSpotlight,
      artistSpotlightArtworks,
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
           LEFT JOIN artworks a ON a.category_id = c.id AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
           GROUP BY c.id
           ORDER BY c.sort_order`
      ),
      db.execute(
        `SELECT a.id, a.user_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
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
      db.execute("SELECT COUNT(*) AS count FROM artworks WHERE visibility = 'public' AND is_published = 1 AND status = 'active'"),
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

    const mediumCount = categories.filter((category) => category.count > 0).length;
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
    res.locals.adsAllowed = true;

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
    const files = Array.isArray(req.files) ? req.files : [];

    if (!title) {
      await respondError(400, 'Give your artwork a title before publishing.', 'title');
      return;
    }

    if (!Number.isFinite(categoryId)) {
      await respondError(400, 'Choose a category for your artwork.', 'category');
      return;
    }

    if (files.length === 0) {
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

    const processed = await uploadArtworkToImageKit(files, req.session.user.id);

    if (!processed.length || processed.some((image) => !image || !image.image_url)) {
      await respondError(502, 'We could not save that image. Please try again.', 'images');
      return;
    }

    const coverIndexRaw = Number.parseInt(String(req.body.cover_index || ''), 10);
    let coverIndex = Number.isFinite(coverIndexRaw) ? coverIndexRaw : 0;
    if (coverIndex < 0 || coverIndex >= processed.length) coverIndex = 0;

    const isPublished = saveAsDraft ? 0 : 1;
    const createdOn = String(req.body.created_at || '').trim();
    let createdAt = null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(createdOn)) {
      const parsedDate = new Date(`${createdOn}T00:00:00Z`);
      if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === createdOn) {
        createdAt = `${createdOn} 12:00:00`;
      }
    }

    const coverImage = processed[coverIndex];

    const { artworkId } = await withTransaction(async (connection) => {
      const [insertResult] = await connection.execute(
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
          coverImage.image_url,
          coverImage.thumbnail_url || coverImage.image_url,
          visibility,
          isPublished,
          createdAt
        ]
      );

      const newArtworkId = insertResult.insertId;
      const imageValues = processed.map((image, index) => [
        newArtworkId,
        image.image_url,
        image.thumbnail_url || image.image_url,
        index
      ]);
      await connection.query(
        'INSERT INTO artwork_images (artwork_id, image_url, thumbnail_url, sort_order) VALUES ?',
        [imageValues]
      );

      const [coverRows] = await connection.execute(
        'SELECT id FROM artwork_images WHERE artwork_id = ? AND sort_order = ? LIMIT 1',
        [newArtworkId, coverIndex]
      );
      const coverImageId = (coverRows && coverRows[0] && coverRows[0].id) || null;
      if (coverImageId) {
        await connection.execute(
          'UPDATE artworks SET cover_image_id = ? WHERE id = ?',
          [coverImageId, newArtworkId]
        );
      }

      return { artworkId: newArtworkId };
    });

    const artworkUrl = visibility === 'private' || saveAsDraft
      ? '/dashboard'
      : `/art/${artworkId}`;

    if (description) {
      await syncMentions({
        actorId: req.session.user.id,
        text: description,
        mentionableType: 'artwork',
        mentionableId: artworkId,
        artworkId,
        notificationMessage: description.slice(0, 240)
      });
    }

    if (wantsJson) {
      res.status(201).json({
        ok: true,
        id: artworkId,
        isDraft: saveAsDraft,
        isPrivate: visibility === 'private',
        artworkImageUrl: coverImage.image_url,
        imagesCount: processed.length,
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
app.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('pages/login', {
    pageTitle: 'ArtSpace | Login',
    error: null,
    formValues: {}
  });
});

// 5. Register Page Route
app.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('pages/register', {
    pageTitle: 'ArtSpace | Register',
    error: null,
    formValues: {}
  });
});

// Register submission
app.post('/register', redirectIfAuthenticated, async (req, res, next) => {
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
      `INSERT INTO users (username, email, password, name, locale, role, status)
       VALUES (?, ?, ?, ?, ?, 'artist', 'active')`,
      [username, email, passwordHash, displayName, req.locale || i18n.DEFAULT_LOCALE]
    );

    req.session.user = {
      id: result && result.insertId,
      username,
      email,
      display_name: displayName,
      avatar: null,
      role: 'artist',
      locale: req.locale || i18n.DEFAULT_LOCALE
    };
    i18n.setLocaleCookie(res, req.session.user.locale);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// Login submission
app.post('/login', redirectIfAuthenticated, async (req, res, next) => {
  try {
    const identifier = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    const rows = await db.execute(
      `SELECT id, name, username, email, password, role, status, avatar, locale
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
      role: user.role,
      locale: i18n.SUPPORTED.includes(user.locale) ? user.locale : i18n.DEFAULT_LOCALE
    };
    i18n.setLocaleCookie(res, req.session.user.locale);
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
      `SELECT u.id, u.username, u.email, u.role, u.status, (u.email_verified_at IS NOT NULL) AS is_verified,
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

    const [sharedRows, sharedCountRows] = await Promise.all([
      db.execute(
        `${COMMUNITY_SHARE_SELECT}
          WHERE s.user_id = ? AND ${COMMUNITY_SHARE_FILTERS}
          ORDER BY s.created_at DESC
          LIMIT 30`,
        [viewerId, viewerId, profileUser.id]
      ),
      db.execute(
        `SELECT COUNT(*) AS count
           FROM artwork_shares s
           INNER JOIN artworks a ON a.id = s.artwork_id
           INNER JOIN users su ON su.id = s.user_id
          WHERE s.user_id = ? AND ${COMMUNITY_SHARE_FILTERS}`,
        [profileUser.id]
      )
    ]);
    const profileShares = (sharedRows || []).map(decorateCommunityShare);
    const profileSharesTotal = Number((sharedCountRows && sharedCountRows[0] && sharedCountRows[0].count) || 0);

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

    const pinCountRows = await db.execute(
      `SELECT COUNT(*) AS count
         FROM artwork_pins p
         INNER JOIN artworks a ON a.id = p.artwork_id
        WHERE p.user_id = ? AND a.user_id = ?
          AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'`,
      [profileUser.id, profileUser.id]
    );
    const totalPins = Number((pinCountRows && pinCountRows[0] && pinCountRows[0].count) || 0);

    const [followerCountRows, following] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?', [profileUser.id]),
      isFollowingUser(viewerId, profileUser.id)
    ]);
    const followersCount = Number((followerCountRows && followerCountRows[0] && followerCountRows[0].count) || 0);

    const requestedTab = ['artworks', 'shared', 'liked', 'saved', 'pinned'].includes(req.query.tab) ? req.query.tab : 'artworks';
    const activeTab = (requestedTab === 'saved' || requestedTab === 'pinned') && !isOwner ? 'artworks' : requestedTab;
    const pinnedIds = await getPinnedArtworkIds(viewerId);
    res.locals.adsAllowed = activeTab === 'artworks' || activeTab === 'liked';

    res.render('pages/profile', {
      pageTitle: `ArtSpace | ${profileUser.username}'s Profile`,
      profileUser,
      artworks: artRows || [],
      likedArtworks: likedRows || [],
      savedArtworks: savedRows || [],
      pinnedArtworks: pinnedRows || [],
      profileShares,
      profileSharesTotal,
      pinnedIds,
      stats: {
        totalArtworks,
        totalLikes,
        totalPins,
        followers: followersCount,
        totalViews: 0
      },
      isFollowing: following,
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

    const rows = await db.execute(
      `SELECT a.id, a.user_id, a.category_id, a.title, a.description, a.image_url, a.thumbnail_url, a.tags,
              a.created_at, a.visibility, a.cover_image_id,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
              u.avatar, u.bio,
              c.name AS category_name,
              (SELECT COUNT(*) FROM likes l WHERE l.artwork_id = a.id) AS likes_count,
              (SELECT COUNT(*) FROM comments cm WHERE cm.artwork_id = a.id) AS comments_count,
              (SELECT COUNT(*) FROM artwork_shares s WHERE s.artwork_id = a.id) AS shares_count,
              EXISTS(SELECT 1 FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ?) AS is_liked,
              EXISTS(SELECT 1 FROM bookmarks b WHERE b.artwork_id = a.id AND b.user_id = ?) AS is_bookmarked,
              (SELECT l.reaction_type FROM likes l WHERE l.artwork_id = a.id AND l.user_id = ? LIMIT 1) AS viewer_reaction,
              'auto' AS visual_effect
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.id = ? AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
        LIMIT 1`,
      [viewerId, viewerId, viewerId, artworkId]
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

    const viewerKey = artworkViewerKey(req);
    const viewTask = db.execute(
      `INSERT INTO artwork_views (artwork_id, viewer_key, user_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_viewed_at = NOW(), user_id = VALUES(user_id)`,
      [artworkId, viewerKey, viewerId || null]
    ).catch((error) => {
      console.error('Could not record artwork view:', error && (error.code || error.message));
    });

    const [relatedRows, commentData, pinnedIds, following, followerCountRows, viewsCount, galleryRows, reactionSummary] = await Promise.all([
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
                'auto' AS visual_effect
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active' AND a.id <> ?
          ORDER BY CASE WHEN a.category_id = ? THEN 0 ELSE 1 END, a.created_at DESC
          LIMIT 8`,
        [viewerId, viewerId, artworkId, artwork.category_id || 0]
      ),
      fetchArtworkComments(artworkId, viewerId, 1),
      getPinnedArtworkIds(viewerId),
      isFollowingUser(viewerId, artwork.user_id),
      db.execute('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?', [artwork.user_id]),
      (async () => {
        await viewTask;
        try {
          const viewRows = await db.execute(
            'SELECT COUNT(*) AS count FROM artwork_views WHERE artwork_id = ?',
            [artworkId]
          );
          return Number((viewRows && viewRows[0] && viewRows[0].count) || 0);
        } catch (error) {
          return 0;
        }
      })(),
      fetchArtworkImages(artworkId).catch(() => []),
      fetchReactionSummary(artworkId).catch(() => ({ counts: {}, total: 0 }))
    ]);

    let artworkImages = galleryRows && galleryRows.length
      ? galleryRows
      : (artwork.image_url ? [{
          id: 0,
          image_url: artwork.image_url,
          thumbnail_url: artwork.thumbnail_url || artwork.image_url,
          sort_order: 0
        }] : []);
    artwork.images = artworkImages;
    artwork.cover_image_id = artwork.cover_image_id !== null && artwork.cover_image_id !== undefined
      ? Number(artwork.cover_image_id)
      : (artworkImages[0] ? artworkImages[0].id : null);

    artwork.views_count = viewsCount;
    artwork.shares_count = Number(artwork.shares_count || 0);
    artwork.comments_count = commentData.total;
    const followersCount = Number((followerCountRows && followerCountRows[0] && followerCountRows[0].count) || 0);

    res.locals.adsAllowed = true;

    res.render('pages/artwork', {
      pageTitle: `ArtSpace | ${artwork.title}`,
      artwork,
      comments: commentData.comments,
      commentsPage: commentData.page,
      commentsPageSize: commentData.pageSize,
      commentsTotal: commentData.total,
      commentsTopTotal: commentData.topTotal,
      commentsHasMore: commentData.hasMore,
      commentsNextPage: commentData.page + 1,
      related: relatedRows || [],
      artistStats: { isFollowing: following, followersCount },
      pinnedIds,
      reactionSummary,
      reportStatus: typeof req.query.report === 'string' ? req.query.report : null
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

async function ensureArtworkGalleryRows(artwork) {
  let images = await fetchArtworkImages(artwork.id);

  if (!images.length && artwork.image_url) {
    await withTransaction(async (connection) => {
      await connection.execute(
        `INSERT INTO artwork_images (artwork_id, image_url, thumbnail_url, sort_order)
         SELECT ?, ?, ?, 0
          WHERE NOT EXISTS (SELECT 1 FROM artwork_images WHERE artwork_id = ?)`,
        [artwork.id, artwork.image_url, artwork.thumbnail_url || artwork.image_url, artwork.id]
      );
      const [coverRows] = await connection.execute(
        'SELECT id FROM artwork_images WHERE artwork_id = ? AND sort_order = 0 LIMIT 1',
        [artwork.id]
      );
      if (coverRows && coverRows[0]) {
        await connection.execute(
          'UPDATE artworks SET cover_image_id = ? WHERE id = ?',
          [coverRows[0].id, artwork.id]
        );
      }
    });
    images = await fetchArtworkImages(artwork.id);
  }

  return images;
}

async function removeArtworkMediaUrls(urls, userId) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];

  for (const url of uniqueUrls) {
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
    uniqueUrls
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
    const files = await ik.listFiles({ path: `/artspace/${userId}`, limit: 1000 });
    for (const file of files) {
      if (remoteNames.has(file.name)) {
        await ik.deleteFile(file.fileId);
      }
    }
  } catch (err) {
    console.error('Could not remove ImageKit artwork files:', err);
  }
}

async function deleteArtworkMedia(artwork, galleryImages) {
  const rows = Array.isArray(galleryImages) ? galleryImages : [];
  const urls = [
    artwork.image_url,
    artwork.thumbnail_url,
    ...rows.flatMap((row) => [row.image_url, row.thumbnail_url])
  ];

  await removeArtworkMediaUrls(urls, artwork.user_id);
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
      "SELECT id, user_id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const userId = Number(req.session.user.id);
    const artworkOwnerId = Number(artworks[0].user_id);
    const reaction = normalizeReaction((req.body && req.body.reaction) || req.query.reaction);

    const existing = await db.execute(
      'SELECT id, reaction_type FROM likes WHERE user_id = ? AND artwork_id = ? LIMIT 1',
      [userId, artworkId]
    );

    let reacted = false;
    let activeReaction = null;

    if (existing && existing.length) {
      if (normalizeReaction(existing[0].reaction_type) === reaction) {
        await db.execute('DELETE FROM likes WHERE id = ?', [existing[0].id]);
      } else {
        await db.execute('UPDATE likes SET reaction_type = ? WHERE id = ?', [reaction, existing[0].id]);
        reacted = true;
        activeReaction = reaction;
      }
    } else {
      await db.execute(
        'INSERT INTO likes (user_id, artwork_id, reaction_type) VALUES (?, ?, ?)',
        [userId, artworkId, reaction]
      );
      reacted = true;
      activeReaction = reaction;
    }

    await removeNotification({
      userId: artworkOwnerId,
      actorId: userId,
      type: 'like',
      artworkId
    });

    if (reacted) {
      await createNotification({
        userId: artworkOwnerId,
        actorId: userId,
        type: 'like',
        artworkId,
        message: reaction
      });
    }

    const summary = await fetchReactionSummary(artworkId);

    if (requestWantsJson(req)) {
      res.json({
        ok: true,
        liked: reacted,
        reacted,
        reaction: activeReaction,
        likes_count: summary.total,
        reactions: summary.counts
      });
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

app.get('/art/:id/reactions', async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const artworks = await db.execute(
      "SELECT id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const [summary, users] = await Promise.all([
      fetchReactionSummary(artworkId),
      db.execute(
        `SELECT u.username,
                COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                u.avatar, l.reaction_type, l.created_at
           FROM likes l
           INNER JOIN users u ON u.id = l.user_id
          WHERE l.artwork_id = ?
          ORDER BY l.created_at DESC
          LIMIT 60`,
        [artworkId]
      )
    ]);

    res.json({
      ok: true,
      total: summary.total,
      reactions: summary.counts,
      users: (users || []).map((row) => ({
        username: row.username,
        display_name: row.display_name,
        avatar: row.avatar,
        reaction: normalizeReaction(row.reaction_type),
        created_at: row.created_at
      }))
    });
  } catch (err) {
    console.error('Could not load artwork reactions:', err);
    res.status(500).json({ ok: false, error: 'We could not load those reactions. Please try again.' });
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

app.post('/art/:id/comment', requireAuthAction, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > 2000) {
      const message = !body
        ? 'Please write a comment before posting.'
        : 'Comments must be 2,000 characters or fewer.';

      if (requestWantsJson(req)) {
        res.status(400).json({ ok: false, error: message });
        return;
      }

      respondArtworkActionError(req, res, 400, message);
      return;
    }

    const artworks = await db.execute(
      "SELECT id, user_id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const userId = Number(req.session.user.id);
    let parentId = null;
    let parentComment = null;

    if (req.body.parent_id !== undefined && req.body.parent_id !== null && String(req.body.parent_id).trim() !== '') {
      parentId = Number.parseInt(req.body.parent_id, 10);
      if (!Number.isFinite(parentId) || parentId <= 0) {
        res.status(400).json({ ok: false, error: 'That comment thread could not be found.' });
        return;
      }

      const parentRows = await db.execute(
        'SELECT id, user_id FROM comments WHERE id = ? AND artwork_id = ? LIMIT 1',
        [parentId, artworkId]
      );
      parentComment = (parentRows && parentRows[0]) || null;
      if (!parentComment) {
        res.status(404).json({ ok: false, error: 'That comment thread could not be found.' });
        return;
      }
    }

    const [recentRows, duplicateRows] = await Promise.all([
      db.execute(
        'SELECT id FROM comments WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 3 SECOND) LIMIT 1',
        [userId]
      ),
      db.execute(
        `SELECT id FROM comments
          WHERE user_id = ? AND artwork_id = ? AND body = ?
            AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)
          LIMIT 1`,
        [userId, artworkId, body]
      )
    ]);

    if (recentRows && recentRows.length) {
      res.status(429).json({ ok: false, error: 'Give the ink a moment to dry. Please wait a few seconds before posting again.' });
      return;
    }

    if (duplicateRows && duplicateRows.length) {
      res.status(409).json({ ok: false, error: 'You just posted that same note. Try adding something new.' });
      return;
    }

    const result = await db.execute(
      'INSERT INTO comments (user_id, artwork_id, parent_id, body) VALUES (?, ?, ?, ?)',
      [userId, artworkId, parentId, body]
    );

    const artworkOwnerId = Number(artworks[0].user_id);

    if (parentComment) {
      await createNotification({
        userId: Number(parentComment.user_id),
        actorId: userId,
        type: 'reply',
        artworkId,
        commentId: parentId,
        message: body.slice(0, 240)
      });

      if (artworkOwnerId !== Number(parentComment.user_id)) {
        await createNotification({
          userId: artworkOwnerId,
          actorId: userId,
          type: 'comment',
          artworkId,
          message: body.slice(0, 240)
        });
      }
    } else {
      await createNotification({
        userId: artworkOwnerId,
        actorId: userId,
        type: 'comment',
        artworkId,
        commentId: result.insertId,
        message: body.slice(0, 240)
      });
    }

    await syncMentions({
      actorId: userId,
      text: body,
      mentionableType: 'comment',
      mentionableId: result.insertId,
      artworkId,
      notificationMessage: body.slice(0, 240)
    });

    const [comment, countRows] = await Promise.all([
      fetchCommentForRender(result.insertId, userId),
      db.execute('SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ?', [artworkId])
    ]);

    const commentsCount = Number((countRows && countRows[0] && countRows[0].count) || 0);
    const topCountRows = await db.execute(
      'SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ? AND parent_id IS NULL',
      [artworkId]
    );
    const commentsTopCount = Number((topCountRows && topCountRows[0] && topCountRows[0].count) || 0);

    if (requestWantsJson(req)) {
      const commentHtml = comment
        ? await renderViewPartial(req.app, 'partials/artwork-comment', {
          comment,
          artwork: artworks[0],
          currentUser: req.session.user,
          isAuthenticated: true,
          depth: 0,
          mentionify
        })
        : '';

      res.status(201).json({
        ok: true,
        comment,
        comment_html: commentHtml,
        parent_id: parentId,
        comments_count: commentsCount,
        comments_top_count: commentsTopCount
      });
      return;
    }

    res.redirect(`/art/${artworkId}#ad-comments`);
  } catch (err) {
    console.error('Artwork comment failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not post that comment. Please try again.' });
      return;
    }
    next(err);
  }
});

app.get('/art/:id/comments', async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const artworks = await db.execute(
      "SELECT id, user_id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const data = await fetchArtworkComments(artworkId, viewerId, req.query.page);
    const currentUser = (req.session && req.session.user) || null;
    const htmlParts = await Promise.all(data.comments.map((comment) => renderViewPartial(
      req.app,
      'partials/artwork-comment',
      {
        comment,
        artwork: artworks[0],
        currentUser,
        isAuthenticated: Boolean(currentUser),
        depth: 0,
        mentionify
      }
    )));

    res.json({
      ok: true,
      html: htmlParts.join(''),
      page: data.page,
      has_more: data.hasMore,
      next_page: data.page + 1,
      comments_count: data.total,
      comments_top_count: data.topTotal
    });
  } catch (err) {
    console.error('Artwork comments load failed:', err);
    res.status(500).json({ ok: false, error: 'We could not load more comments. Please try again.' });
  }
});

app.post('/comments/:id/like', requireAuthAction, async (req, res, next) => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(commentId)) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const rows = await db.execute(
      `SELECT cm.id, cm.user_id, cm.artwork_id, a.user_id AS artwork_owner_id
         FROM comments cm
         INNER JOIN artworks a ON a.id = cm.artwork_id
        WHERE cm.id = ? AND a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'
        LIMIT 1`,
      [commentId]
    );
    const comment = (rows && rows[0]) || null;

    if (!comment) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const userId = Number(req.session.user.id);
    const removed = await db.execute(
      'DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?',
      [userId, commentId]
    );

    let liked = false;
    if (!removed || removed.affectedRows === 0) {
      await db.execute(
        'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)',
        [userId, commentId]
      );
      liked = true;
    }

    await removeNotification({
      userId: Number(comment.user_id),
      actorId: userId,
      type: 'comment_like',
      artworkId: Number(comment.artwork_id)
    });

    if (liked) {
      await createNotification({
        userId: Number(comment.user_id),
        actorId: userId,
        type: 'comment_like',
        artworkId: Number(comment.artwork_id)
      });
    }

    const countRows = await db.execute(
      'SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?',
      [commentId]
    );
    const likesCount = Number((countRows && countRows[0] && countRows[0].count) || 0);

    if (requestWantsJson(req)) {
      res.json({ ok: true, liked, likes_count: likesCount, comment_id: commentId });
      return;
    }

    res.redirect(`/art/${comment.artwork_id}#ad-comments`);
  } catch (err) {
    console.error('Comment like toggle failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not update that comment like. Please try again.' });
      return;
    }
    next(err);
  }
});

app.post('/comments/:id/edit', requireAuthAction, async (req, res, next) => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(commentId)) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > 2000) {
      res.status(400).json({
        ok: false,
        error: !body ? 'Please write a comment before saving.' : 'Comments must be 2,000 characters or fewer.'
      });
      return;
    }

    const rows = await db.execute(
      'SELECT id, user_id, artwork_id FROM comments WHERE id = ? LIMIT 1',
      [commentId]
    );
    const comment = (rows && rows[0]) || null;

    if (!comment) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    if (Number(comment.user_id) !== Number(req.session.user.id)) {
      res.status(403).json({ ok: false, error: 'You can only edit your own comments.' });
      return;
    }

    await db.execute(
      'UPDATE comments SET body = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [body, commentId, req.session.user.id]
    );

    const mentionNames = extractMentionUsernames(body);
    if (mentionNames.length) {
      await db.execute(
        `DELETE m FROM mentions m
          INNER JOIN users u ON u.id = m.mentioned_user_id
         WHERE m.mentionable_type = 'comment' AND m.mentionable_id = ?
           AND LOWER(u.username) NOT IN (${mentionNames.map(() => '?').join(',')})`,
        [commentId, ...mentionNames]
      ).catch(() => {});
    } else {
      await removeMentionsFor('comment', commentId);
    }

    await syncMentions({
      actorId: req.session.user.id,
      text: body,
      mentionableType: 'comment',
      mentionableId: commentId,
      artworkId: Number(comment.artwork_id),
      notificationMessage: body.slice(0, 240)
    });

    res.json({ ok: true, body, edited: true, comment_id: commentId, body_html: mentionify(body) });
  } catch (err) {
    console.error('Comment edit failed:', err);
    res.status(500).json({ ok: false, error: 'We could not save that edit. Please try again.' });
  }
});

app.post('/comments/:id/delete', requireAuthAction, async (req, res, next) => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(commentId)) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const rows = await db.execute(
      `SELECT cm.id, cm.user_id, cm.artwork_id, a.user_id AS artwork_owner_id
         FROM comments cm
         INNER JOIN artworks a ON a.id = cm.artwork_id
        WHERE cm.id = ?
        LIMIT 1`,
      [commentId]
    );
    const comment = (rows && rows[0]) || null;

    if (!comment) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const userId = Number(req.session.user.id);
    const isCommentOwner = Number(comment.user_id) === userId;
    const isArtworkOwner = Number(comment.artwork_owner_id) === userId;
    const isAdmin = req.session.user.role === 'admin';

    if (!isCommentOwner && !isArtworkOwner && !isAdmin) {
      res.status(403).json({ ok: false, error: 'You do not have permission to delete this comment.' });
      return;
    }

    const deletedIds = [commentId];
    let frontier = [commentId];

    for (let depth = 0; depth < 10 && frontier.length; depth += 1) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = await db.execute(
        `SELECT id FROM comments WHERE parent_id IN (${placeholders})`,
        frontier
      );
      frontier = (children || []).map((row) => Number(row.id));
      deletedIds.push(...frontier);
    }

    const placeholders = deletedIds.map(() => '?').join(',');
    await db.execute(`DELETE FROM comments WHERE id IN (${placeholders})`, deletedIds);
    await db.execute(
      `DELETE FROM mentions WHERE mentionable_type = 'comment' AND mentionable_id IN (${placeholders})`,
      deletedIds
    ).catch(() => {});
    await db.execute(
      `UPDATE notifications SET comment_id = NULL WHERE comment_id IN (${placeholders})`,
      deletedIds
    ).catch(() => {});

    const [countRows, topCountRows] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ?', [comment.artwork_id]),
      db.execute(
        'SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ? AND parent_id IS NULL',
        [comment.artwork_id]
      )
    ]);

    if (requestWantsJson(req)) {
      res.json({
        ok: true,
        deleted_ids: deletedIds,
        comments_count: Number((countRows && countRows[0] && countRows[0].count) || 0),
        comments_top_count: Number((topCountRows && topCountRows[0] && topCountRows[0].count) || 0)
      });
      return;
    }

    res.redirect(`/art/${comment.artwork_id}#ad-comments`);
  } catch (err) {
    console.error('Comment delete failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not delete that comment. Please try again.' });
      return;
    }
    next(err);
  }
});

app.post('/art/:id/share', async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const artworks = await db.execute(
      "SELECT id, user_id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );

    if (!artworks || artworks.length === 0) {
      res.status(404).json({ ok: false, error: 'The artwork you requested could not be found.' });
      return;
    }

    const requested = String((req.body && req.body.platform) || '').toLowerCase();
    const allowedPlatforms = new Set(['internal', 'copy', 'telegram', 'facebook', 'messenger', 'whatsapp', 'x', 'linkedin', 'email', 'native', 'other']);
    const platform = allowedPlatforms.has(requested) ? requested : 'other';
    const userId = (req.session && req.session.user && req.session.user.id) || null;

    if (platform === 'internal' && !userId) {
      res.status(401).json({ ok: false, error: 'Please log in to share inside ArtSpace.' });
      return;
    }

    const message = platform === 'internal'
      ? String((req.body && req.body.message) || '').replace(/\r\n/g, '\n').trim().slice(0, 500)
      : null;

    const result = await db.execute(
      'INSERT INTO artwork_shares (artwork_id, user_id, platform, message) VALUES (?, ?, ?, ?)',
      [artworkId, userId, platform, message || null]
    );

    if (platform === 'internal' && userId) {
      await createNotification({
        userId: Number(artworks[0].user_id),
        actorId: userId,
        type: 'share',
        artworkId,
        shareId: result.insertId,
        message: message ? message.slice(0, 240) : null
      });

      if (message) {
        await syncMentions({
          actorId: userId,
          text: message,
          mentionableType: 'share',
          mentionableId: result.insertId,
          artworkId,
          shareId: result.insertId,
          notificationMessage: message.slice(0, 240)
        });
      }
    }

    const countRows = await db.execute(
      'SELECT COUNT(*) AS count FROM artwork_shares WHERE artwork_id = ?',
      [artworkId]
    );
    const sharesCount = Number((countRows && countRows[0] && countRows[0].count) || 0);

    if (requestWantsJson(req)) {
      res.json({
        ok: true,
        shares_count: sharesCount,
        platform,
        share_id: result.insertId,
        internal: platform === 'internal'
      });
      return;
    }

    res.redirect(getSafeActionRedirect(req, `/art/${artworkId}`));
  } catch (err) {
    console.error('Artwork share tracking failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not record that share. Please try again.' });
      return;
    }
    next(err);
  }
});

app.post('/follow/:id', requireAuth, async (req, res, next) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetUserId)) {
      respondArtworkActionError(req, res, 404, 'The artist you requested could not be found.');
      return;
    }

    const userId = Number(req.session.user.id);
    if (targetUserId === userId) {
      res.redirect(getSafeActionRedirect(req, `/profile/${encodeURIComponent(req.session.user.username)}`));
      return;
    }

    const users = await db.execute(
      "SELECT username FROM users WHERE id = ? AND status = 'active' LIMIT 1",
      [targetUserId]
    );

    if (!users || users.length === 0) {
      respondArtworkActionError(req, res, 404, 'The artist you requested could not be found.');
      return;
    }

    const removed = await db.execute(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
      [userId, targetUserId]
    );

    let following = false;

    if (!removed || removed.affectedRows === 0) {
      await db.execute(
        'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
        [userId, targetUserId]
      );
      following = true;
    }

    await removeNotification({
      userId: targetUserId,
      actorId: userId,
      type: 'follow'
    });

    if (following) {
      await createNotification({
        userId: targetUserId,
        actorId: userId,
        type: 'follow'
      });
    }

    const followerCountRows = await db.execute(
      'SELECT COUNT(*) AS count FROM follows WHERE following_id = ?',
      [targetUserId]
    );
    const followersCount = Number((followerCountRows && followerCountRows[0] && followerCountRows[0].count) || 0);

    if (requestWantsJson(req)) {
      res.json({ ok: true, following, followers_count: followersCount });
      return;
    }

    res.redirect(getSafeActionRedirect(req, `/profile/${encodeURIComponent(users[0].username)}`));
  } catch (err) {
    console.error('Artist follow toggle failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not update that follow. Please try again.' });
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

    const galleryImages = await fetchArtworkImages(artworkId).catch(() => []);

    await db.execute('DELETE FROM notifications WHERE artwork_id = ?', [artworkId]);
    const deleted = await db.execute('DELETE FROM artworks WHERE id = ? AND user_id = ?', [
      artworkId,
      req.session.user.id
    ]);

    if (!deleted || deleted.affectedRows === 0) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    await deleteArtworkMedia(artwork, galleryImages);

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

app.post('/art/:id/report', requireAuth, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const rows = await db.execute(
      "SELECT id, user_id FROM artworks WHERE id = ? AND visibility = 'public' AND is_published = 1 AND status = 'active' LIMIT 1",
      [artworkId]
    );
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    if (Number(artwork.user_id) === Number(req.session.user.id)) {
      if (requestWantsJson(req)) {
        res.status(400).json({ ok: false, error: 'You cannot report your own artwork.' });
        return;
      }
      res.redirect(`/art/${artworkId}?report=self`);
      return;
    }

    const existing = await db.execute(
      "SELECT id FROM reports WHERE artwork_id = ? AND reporter_id = ? AND status = 'open' LIMIT 1",
      [artworkId, req.session.user.id]
    );

    if (existing && existing.length) {
      if (requestWantsJson(req)) {
        res.status(409).json({ ok: false, error: 'You already have an open report for this artwork.' });
        return;
      }
      res.redirect(`/art/${artworkId}?report=exists`);
      return;
    }

    const reason = String(req.body.reason || '').trim().slice(0, 500) || 'Reported from the artwork page.';
    await db.execute(
      "INSERT INTO reports (artwork_id, reporter_id, reason, status) VALUES (?, ?, ?, 'open')",
      [artworkId, req.session.user.id, reason]
    );

    if (requestWantsJson(req)) {
      res.json({ ok: true, reported: true });
      return;
    }
    res.redirect(`/art/${artworkId}?report=sent`);
  } catch (err) {
    console.error('Artwork report failed:', err);
    if (requestWantsJson(req)) {
      res.status(500).json({ ok: false, error: 'We could not send that report. Please try again.' });
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

app.post('/ads-consent', (req, res) => {
  const choice = req.body && req.body.choice;
  const fallback = '/';

  if (choice === 'reset') {
    res.clearCookie(ADS_CONSENT_COOKIE, { path: '/' });
    res.redirect(getSafeActionRedirect(req, fallback));
    return;
  }

  if (choice !== 'granted' && choice !== 'denied') {
    res.redirect(getSafeActionRedirect(req, fallback));
    return;
  }

  res.cookie(ADS_CONSENT_COOKIE, choice, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_VERCEL,
    path: '/',
    maxAge: 180 * 24 * 60 * 60 * 1000
  });
  res.redirect(getSafeActionRedirect(req, fallback));
});

app.get('/privacy', (req, res) => {
  res.render('pages/privacy', {
    pageTitle: 'ArtSpace | Privacy and ads'
  });
});

// 9. Notifications Page Route
// 9b. Community — shared artwork posts and interactions
app.get('/community', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const sort = req.query.sort === 'popular' ? 'popular' : 'latest';
    const scope = req.query.scope === 'following' && viewerId ? 'following' : 'all';
    const query = String(req.query.q || '').trim().slice(0, 80);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * COMMUNITY_PAGE_SIZE;

    const conditions = [COMMUNITY_SHARE_FILTERS];
    const params = [viewerId, viewerId];

    if (scope === 'following') {
      conditions.push('s.user_id IN (SELECT f.following_id FROM follows f WHERE f.follower_id = ?)');
      params.push(viewerId);
    }

    if (query) {
      conditions.push('(s.message LIKE ? OR a.title LIKE ? OR su.username LIKE ?)');
      const like = `%${query}%`;
      params.push(like, like, like);
    }

    const whereClause = conditions.join(' AND ');
    const orderBy = sort === 'popular'
      ? 'shared_likes_count DESC, shared_comments_count DESC, s.created_at DESC'
      : 's.created_at DESC';

    const [rows, countRows] = await Promise.all([
      db.execute(
        `${COMMUNITY_SHARE_SELECT}
          WHERE ${whereClause}
          ORDER BY ${orderBy}
          LIMIT ${COMMUNITY_PAGE_SIZE} OFFSET ${offset}`,
        params
      ),
      db.execute(
        `SELECT COUNT(*) AS count
           FROM artwork_shares s
           INNER JOIN artworks a ON a.id = s.artwork_id
           INNER JOIN users su ON su.id = s.user_id
          WHERE ${whereClause}`,
        params.slice(2)
      )
    ]);

    const posts = (rows || []).map(decorateCommunityShare);
    const total = Number((countRows && countRows[0] && countRows[0].count) || 0);
    const loaded = posts.length;

    const pagination = {
      page,
      pageSize: COMMUNITY_PAGE_SIZE,
      total,
      start: total === 0 ? 0 : offset + 1,
      end: Math.min(offset + loaded, total),
      hasMore: offset + loaded < total,
      nextPage: page + 1
    };

    res.locals.adsAllowed = false;

    res.render('pages/community', {
      pageTitle: 'ArtSpace | Community',
      posts,
      pagination,
      sort,
      scope,
      query
    });
  } catch (err) {
    next(err);
  }
});

app.get('/community/:id', async (req, res, next) => {
  try {
    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      return res.status(404).render('pages/error', {
        message: 'That shared post could not be found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: false,
        currentUser: null,
        unreadNotifications: 0
      });
    }

    const share = await fetchCommunityShare(shareId, viewerId);
    if (!share) {
      return res.status(404).render('pages/error', {
        message: 'That shared post could not be found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: false,
        currentUser: null,
        unreadNotifications: 0
      });
    }

    const [commentData, reactionSummary] = await Promise.all([
      fetchShareComments(shareId, 1),
      fetchShareReactionSummary(shareId)
    ]);

    const isShareOwner = Boolean(viewerId && viewerId === share.sharer.id);

    res.locals.adsAllowed = false;

    res.render('pages/community-post', {
      pageTitle: `ArtSpace | ${share.artwork.title} shared by ${share.sharer.display_name}`,
      share,
      reactionSummary,
      comments: commentData.comments,
      commentsPage: commentData.page,
      commentsPageSize: commentData.pageSize,
      commentsTotal: commentData.total,
      commentsTopTotal: commentData.topTotal,
      commentsHasMore: commentData.hasMore,
      commentsNextPage: commentData.page + 1,
      isShareOwner
    });
  } catch (err) {
    next(err);
  }
});

app.post('/community/:id/like', requireAuthAction, async (req, res, next) => {
  try {
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const rows = await db.execute(
      `SELECT s.id, s.user_id, s.artwork_id
         FROM artwork_shares s
         INNER JOIN artworks a ON a.id = s.artwork_id
         INNER JOIN users su ON su.id = s.user_id
        WHERE s.id = ? AND ${COMMUNITY_SHARE_FILTERS}
        LIMIT 1`,
      [shareId]
    );
    const share = rows && rows[0];
    if (!share) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const userId = Number(req.session.user.id);
    const reaction = normalizeReaction((req.body && req.body.reaction) || req.query.reaction);

    const existing = await db.execute(
      'SELECT id, reaction_type FROM share_likes WHERE share_id = ? AND user_id = ? LIMIT 1',
      [shareId, userId]
    );

    let reacted = false;
    let activeReaction = null;

    if (existing && existing.length) {
      if (normalizeReaction(existing[0].reaction_type) === reaction) {
        await db.execute('DELETE FROM share_likes WHERE id = ?', [existing[0].id]);
      } else {
        await db.execute('UPDATE share_likes SET reaction_type = ? WHERE id = ?', [reaction, existing[0].id]);
        reacted = true;
        activeReaction = reaction;
      }
    } else {
      await db.execute(
        'INSERT INTO share_likes (share_id, user_id, reaction_type) VALUES (?, ?, ?)',
        [shareId, userId, reaction]
      );
      reacted = true;
      activeReaction = reaction;
    }

    await db.execute(
      "DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'share_like' AND share_id = ?",
      [Number(share.user_id), userId, shareId]
    ).catch(() => {});

    if (reacted) {
      await createNotification({
        userId: Number(share.user_id),
        actorId: userId,
        type: 'share_like',
        artworkId: Number(share.artwork_id),
        shareId,
        message: reaction
      });
    }

    const summary = await fetchShareReactionSummary(shareId);
    res.json({
      ok: true,
      liked: reacted,
      reacted,
      reaction: activeReaction,
      likes_count: summary.total,
      reactions: summary.counts
    });
  } catch (err) {
    console.error('Shared post like failed:', err);
    res.status(500).json({ ok: false, error: 'We could not update that reaction. Please try again.' });
  }
});

app.post('/community/:id/comment', requireAuthAction, async (req, res, next) => {
  try {
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > 2000) {
      res.status(400).json({
        ok: false,
        error: !body
          ? 'Please write a comment before posting.'
          : 'Comments must be 2,000 characters or fewer.'
      });
      return;
    }

    const rows = await db.execute(
      `SELECT s.id, s.user_id, s.artwork_id
         FROM artwork_shares s
         INNER JOIN artworks a ON a.id = s.artwork_id
         INNER JOIN users su ON su.id = s.user_id
        WHERE s.id = ? AND ${COMMUNITY_SHARE_FILTERS}
        LIMIT 1`,
      [shareId]
    );
    const share = rows && rows[0];
    if (!share) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const userId = Number(req.session.user.id);
    let parentId = null;
    let parentComment = null;

    const rawParent = req.body && req.body.parent_id !== undefined && req.body.parent_id !== null
      ? String(req.body.parent_id).trim()
      : '';

    if (rawParent) {
      parentId = Number.parseInt(rawParent, 10);
      if (!Number.isFinite(parentId) || parentId <= 0) {
        res.status(400).json({ ok: false, error: 'That comment thread could not be found.' });
        return;
      }
      const parentRows = await db.execute(
        'SELECT id, user_id FROM share_comments WHERE id = ? AND share_id = ? LIMIT 1',
        [parentId, shareId]
      );
      parentComment = (parentRows && parentRows[0]) || null;
      if (!parentComment) {
        res.status(404).json({ ok: false, error: 'That comment thread could not be found.' });
        return;
      }
    }

    const [recentRows, duplicateRows] = await Promise.all([
      db.execute(
        'SELECT id FROM share_comments WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 3 SECOND) LIMIT 1',
        [userId]
      ),
      db.execute(
        `SELECT id FROM share_comments
          WHERE user_id = ? AND share_id = ? AND body = ?
            AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)
          LIMIT 1`,
        [userId, shareId, body]
      )
    ]);

    if (recentRows && recentRows.length) {
      res.status(429).json({ ok: false, error: 'Give the ink a moment to dry. Please wait a few seconds before posting again.' });
      return;
    }

    if (duplicateRows && duplicateRows.length) {
      res.status(409).json({ ok: false, error: 'You just posted that same note. Try adding something new.' });
      return;
    }

    const result = await db.execute(
      'INSERT INTO share_comments (share_id, user_id, parent_id, body) VALUES (?, ?, ?, ?)',
      [shareId, userId, parentId, body]
    );

    if (parentComment) {
      await createNotification({
        userId: Number(parentComment.user_id),
        actorId: userId,
        type: 'share_reply',
        artworkId: Number(share.artwork_id),
        shareId,
        commentId: parentId,
        message: body.slice(0, 240)
      });
    } else {
      await createNotification({
        userId: Number(share.user_id),
        actorId: userId,
        type: 'share_comment',
        artworkId: Number(share.artwork_id),
        shareId,
        commentId: result.insertId,
        message: body.slice(0, 240)
      });
    }

    await syncMentions({
      actorId: userId,
      text: body,
      mentionableType: 'share_comment',
      mentionableId: result.insertId,
      artworkId: Number(share.artwork_id),
      shareId,
      notificationMessage: body.slice(0, 240)
    });

    const [comment, countRows] = await Promise.all([
      fetchShareCommentForRender(result.insertId),
      db.execute('SELECT COUNT(*) AS count FROM share_comments WHERE share_id = ?', [shareId])
    ]);

    const commentsCount = Number((countRows && countRows[0] && countRows[0].count) || 0);

    const communityShare = await fetchCommunityShare(shareId, userId);

    const commentHtml = comment
      ? await renderViewPartial(req.app, 'partials/share-comment', {
        comment,
        share: communityShare || share,
        viewerId: userId,
        currentUser: req.session.user,
        isAuthenticated: true,
        depth: 0,
        mentionify
      })
      : '';

    res.status(201).json({
      ok: true,
      comment,
      comment_html: commentHtml,
      parent_id: parentId,
      comments_count: commentsCount
    });
  } catch (err) {
    console.error('Shared post comment failed:', err);
    res.status(500).json({ ok: false, error: 'We could not post that comment. Please try again.' });
  }
});

app.get('/community/:id/comments', async (req, res, next) => {
  try {
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const rows = await db.execute(
      `SELECT s.id FROM artwork_shares s
        INNER JOIN artworks a ON a.id = s.artwork_id
        INNER JOIN users su ON su.id = s.user_id
        WHERE s.id = ? AND ${COMMUNITY_SHARE_FILTERS} LIMIT 1`,
      [shareId]
    );
    if (!rows || !rows.length) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const viewerId = (req.session && req.session.user && req.session.user.id) || 0;
    const share = await fetchCommunityShare(shareId, viewerId);
    const data = await fetchShareComments(shareId, req.query.page);

    const htmlParts = await Promise.all(data.comments.map((comment) => renderViewPartial(
      req.app,
      'partials/share-comment',
      {
        comment,
        share,
        viewerId,
        currentUser: (req.session && req.session.user) || null,
        isAuthenticated: Boolean(viewerId),
        depth: 0,
        mentionify
      }
    )));

    res.json({
      ok: true,
      html: htmlParts.join(''),
      page: data.page,
      has_more: data.hasMore,
      next_page: data.page + 1,
      comments_count: data.total,
      comments_top_count: data.topTotal
    });
  } catch (err) {
    console.error('Could not load shared post comments:', err);
    res.status(500).json({ ok: false, error: 'We could not load more comments. Please try again.' });
  }
});

app.post('/community/comments/:id/edit', requireAuthAction, async (req, res, next) => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(commentId)) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > 2000) {
      res.status(400).json({
        ok: false,
        error: !body ? 'Please write a comment before saving.' : 'Comments must be 2,000 characters or fewer.'
      });
      return;
    }

    const rows = await db.execute(
      `SELECT sc.id, sc.user_id, sc.share_id, s.artwork_id
         FROM share_comments sc
         INNER JOIN artwork_shares s ON s.id = sc.share_id
        WHERE sc.id = ?
        LIMIT 1`,
      [commentId]
    );
    const comment = rows && rows[0];
    if (!comment) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    if (Number(comment.user_id) !== Number(req.session.user.id)) {
      res.status(403).json({ ok: false, error: 'You can only edit your own comments.' });
      return;
    }

    await db.execute(
      'UPDATE share_comments SET body = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [body, commentId, req.session.user.id]
    );

    const mentionNames = extractMentionUsernames(body);
    if (mentionNames.length) {
      await db.execute(
        `DELETE m FROM mentions m
          INNER JOIN users u ON u.id = m.mentioned_user_id
         WHERE m.mentionable_type = 'share_comment' AND m.mentionable_id = ?
           AND LOWER(u.username) NOT IN (${mentionNames.map(() => '?').join(',')})`,
        [commentId, ...mentionNames]
      ).catch(() => {});
    } else {
      await removeMentionsFor('share_comment', commentId);
    }

    await syncMentions({
      actorId: req.session.user.id,
      text: body,
      mentionableType: 'share_comment',
      mentionableId: commentId,
      artworkId: Number(comment.artwork_id),
      shareId: Number(comment.share_id),
      notificationMessage: body.slice(0, 240)
    });

    res.json({ ok: true, body, edited: true, comment_id: commentId, body_html: mentionify(body) });
  } catch (err) {
    console.error('Shared comment edit failed:', err);
    res.status(500).json({ ok: false, error: 'We could not save that edit. Please try again.' });
  }
});

app.post('/community/comments/:id/delete', requireAuthAction, async (req, res, next) => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(commentId)) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const rows = await db.execute(
      `SELECT sc.id, sc.user_id, sc.share_id, s.user_id AS sharer_id, s.artwork_id
         FROM share_comments sc
         INNER JOIN artwork_shares s ON s.id = sc.share_id
        WHERE sc.id = ?
        LIMIT 1`,
      [commentId]
    );
    const comment = rows && rows[0];
    if (!comment) {
      res.status(404).json({ ok: false, error: 'That comment could not be found.' });
      return;
    }

    const userId = Number(req.session.user.id);
    const canDelete = Number(comment.user_id) === userId
      || Number(comment.sharer_id) === userId
      || req.session.user.role === 'admin';

    if (!canDelete) {
      res.status(403).json({ ok: false, error: 'You do not have permission to delete this comment.' });
      return;
    }

    const deletedIds = [commentId];
    let frontier = [commentId];

    for (let depth = 0; depth < 10 && frontier.length; depth += 1) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = await db.execute(
        `SELECT id FROM share_comments WHERE parent_id IN (${placeholders})`,
        frontier
      );
      frontier = (children || []).map((row) => Number(row.id)).filter((id) => !deletedIds.includes(id));
      deletedIds.push(...frontier);
    }

    const placeholders = deletedIds.map(() => '?').join(',');
    await db.execute(`DELETE FROM share_comments WHERE id IN (${placeholders})`, deletedIds);
    await db.execute(
      `DELETE FROM mentions WHERE mentionable_type = 'share_comment' AND mentionable_id IN (${placeholders})`,
      deletedIds
    ).catch(() => {});

    const countRows = await db.execute(
      'SELECT COUNT(*) AS count FROM share_comments WHERE share_id = ?',
      [comment.share_id]
    );

    res.json({
      ok: true,
      deleted_ids: deletedIds,
      comments_count: Number((countRows && countRows[0] && countRows[0].count) || 0)
    });
  } catch (err) {
    console.error('Shared comment delete failed:', err);
    res.status(500).json({ ok: false, error: 'We could not delete that comment. Please try again.' });
  }
});

app.post('/community/:id/edit', requireAuthAction, async (req, res, next) => {
  try {
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const rows = await db.execute(
      'SELECT id, user_id, artwork_id FROM artwork_shares WHERE id = ? AND platform = ? LIMIT 1',
      [shareId, 'internal']
    );
    const share = rows && rows[0];
    if (!share) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    if (Number(share.user_id) !== Number(req.session.user.id)) {
      res.status(403).json({ ok: false, error: 'You can only edit your own shares.' });
      return;
    }

    const message = String((req.body && req.body.message) || '').replace(/\r\n/g, '\n').trim().slice(0, 500);

    await db.execute(
      'UPDATE artwork_shares SET message = ? WHERE id = ?',
      [message || null, shareId]
    );

    await removeMentionsFor('share', shareId);
    if (message) {
      await syncMentions({
        actorId: req.session.user.id,
        text: message,
        mentionableType: 'share',
        mentionableId: shareId,
        artworkId: Number(share.artwork_id),
        shareId,
        notificationMessage: message.slice(0, 240)
      });
    }

    res.json({ ok: true, message, message_html: message ? mentionify(message) : '' });
  } catch (err) {
    console.error('Shared post edit failed:', err);
    res.status(500).json({ ok: false, error: 'We could not save that message. Please try again.' });
  }
});

app.post('/community/:id/delete', requireAuthAction, async (req, res, next) => {
  try {
    const shareId = parseInt(req.params.id, 10);
    if (!Number.isFinite(shareId)) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    const rows = await db.execute(
      "SELECT id, user_id, artwork_id FROM artwork_shares WHERE id = ? AND platform = 'internal' LIMIT 1",
      [shareId]
    );
    const share = rows && rows[0];
    if (!share) {
      res.status(404).json({ ok: false, error: 'That shared post could not be found.' });
      return;
    }

    if (Number(share.user_id) !== Number(req.session.user.id)) {
      res.status(403).json({ ok: false, error: 'You can only delete your own shares.' });
      return;
    }

    await db.execute('DELETE FROM artwork_shares WHERE id = ?', [shareId]);
    await removeMentionsFor('share', shareId);
    await deleteNotificationsForShare(shareId);

    res.json({ ok: true, deleted: true, share_id: shareId, artwork_id: Number(share.artwork_id) });
  } catch (err) {
    console.error('Shared post delete failed:', err);
    res.status(500).json({ ok: false, error: 'We could not delete that share. Please try again.' });
  }
});

app.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const rows = await db.execute(
      `${NOTIFICATION_SELECT}
        WHERE n.user_id = ?
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 100`,
      [userId]
    );

    const notifications = (rows || []).map(mapNotificationRow);
    const unreadCount = notifications.filter((item) => !item.is_read).length;

    await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    res.locals.unreadNotifications = 0;

    res.render('pages/notifications', {
      pageTitle: 'ArtSpace | Notifications',
      notifications,
      unreadCount
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/notifications', requireAuthApi, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const [rows, unread] = await Promise.all([
      db.execute(
        `${NOTIFICATION_SELECT}
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT 8`,
        [userId]
      ),
      countUnreadNotifications(userId)
    ]);

    res.json({ ok: true, unread, items: (rows || []).map(mapNotificationRow) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/read-all', requireAuthApi, async (req, res, next) => {
  try {
    await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.session.user.id]
    );
    res.locals.unreadNotifications = 0;
    res.json({ ok: true, unread: 0 });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/:id/read', requireAuthApi, async (req, res, next) => {
  try {
    const notificationId = parseInt(req.params.id, 10);
    if (!Number.isFinite(notificationId)) {
      res.status(404).json({ ok: false, error: 'That notification could not be found.' });
      return;
    }

    await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [notificationId, req.session.user.id]
    );
    const unread = await countUnreadNotifications(req.session.user.id);
    res.json({ ok: true, unread });
  } catch (err) {
    next(err);
  }
});

app.get('/api/mentions/search', requireAuthApi, async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().replace(/^@/, '').slice(0, 40);
    if (!query) {
      res.json({ ok: true, users: [] });
      return;
    }

    const like = `%${query}%`;
    const rows = await db.execute(
      `SELECT username,
              COALESCE(NULLIF(name, ''), username) AS display_name,
              avatar
         FROM users
        WHERE status = 'active'
          AND (username LIKE ? OR name LIKE ?)
        ORDER BY CASE WHEN username LIKE ? THEN 0 ELSE 1 END, username ASC
        LIMIT 8`,
      [like, like, `${query}%`]
    );

    res.json({
      ok: true,
      users: (rows || []).map((row) => ({
        username: row.username,
        display_name: row.display_name,
        avatar: row.avatar
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// 9b. Private messaging (Messenger-style user-to-user chat)
// ----------------------------------------------------

// Minimal artwork info for the "share in message" flow in the messenger.
app.get('/api/artworks/:id/brief', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const artworkId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId) || artworkId <= 0) {
      res.status(404).json({ ok: false, error: 'That artwork cannot be shared in messages.' });
      return;
    }
    const rows = await db.execute(
      `SELECT a.id, a.title, a.user_id, a.visibility, a.is_published, a.status,
              COALESCE(ai.thumbnail_url, ai.image_url, a.thumbnail_url, a.image_url) AS thumbnail,
              u.username,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name
         FROM artworks a
         INNER JOIN users u ON u.id = a.user_id
         LEFT JOIN artwork_images ai ON ai.id = a.cover_image_id
        WHERE a.id = ?
        LIMIT 1`,
      [artworkId]
    );
    const artwork = rows && rows[0];
    const shareable = Boolean(artwork)
      && ((artwork.visibility === 'public' && Number(artwork.is_published) === 1 && artwork.status === 'active')
        || Number(artwork.user_id) === viewerId);
    if (!shareable) {
      res.status(404).json({ ok: false, error: 'That artwork cannot be shared in messages.' });
      return;
    }
    res.json({
      ok: true,
      artwork: {
        id: Number(artwork.id),
        title: artwork.title,
        thumbnail: artwork.thumbnail || null,
        artist_username: artwork.username,
        artist_display_name: artwork.display_name
      }
    });
  } catch (err) {
    next(err);
  }
});

const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `u${(req.session && req.session.user && req.session.user.id) || ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'You are sending messages too quickly. Take a short break and try again.' })
});

const conversationCreateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `u${(req.session && req.session.user && req.session.user.id) || ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'You are opening conversations too quickly. Please try again shortly.' })
});

const messageAttachmentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `u${(req.session && req.session.user && req.session.user.id) || ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'You are attaching too many images right now. Please try again shortly.' })
});

app.get('/messages', requireAuth, (req, res) => {
  const conversationParam = Number.parseInt(String(req.query.c || ''), 10);
  const shareParam = Number.parseInt(String(req.query.share || ''), 10);
  const toParam = String(req.query.to || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);

  res.render('pages/messages', {
    pageTitle: 'ArtSpace | Messages',
    initialConversationId: Number.isFinite(conversationParam) && conversationParam > 0 ? conversationParam : 0,
    shareArtworkId: Number.isFinite(shareParam) && shareParam > 0 ? shareParam : 0,
    initialTo: toParam
  });
});

app.get('/api/messages/conversations', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const search = sanitizeMessageContent(String(req.query.q || '')).slice(0, 60);
    const like = `%${search.replace(/([\\%_])/g, '\\$1')}%`;

    let params = [viewerId, viewerId];
    let whereExtra = '';
    if (search) {
      params = [viewerId, viewerId, like, like, like];
      whereExtra = `
        AND (ou.username LIKE ? OR COALESCE(NULLIF(ou.name, ''), '') LIKE ? OR lm.content LIKE ?)`;
    }

    const rows = await db.execute(
      `${CONVERSATION_LIST_SELECT}${whereExtra}
        ORDER BY COALESCE(lm.created_at, c.updated_at) DESC, c.id DESC
        LIMIT 60`,
      params
    );

    const unreadMap = await countUnreadMessagesByConversation(viewerId);
    const conversations = (rows || []).map((row) => ({
      ...mapConversationRow(row, viewerId),
      unread_count: unreadMap.get(Number(row.id)) || 0
    }));

    res.json({ ok: true, conversations });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations', requireAuthApi, conversationCreateLimiter, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    let otherUserId = Number.parseInt(req.body.user_id, 10);
    if (!Number.isFinite(otherUserId)) {
      const username = String(req.body.username || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
      if (username) {
        const rows = await db.execute('SELECT id FROM users WHERE username = ? AND status = \'active\' LIMIT 1', [username]);
        otherUserId = rows && rows.length ? Number(rows[0].id) : 0;
      }
    }

    if (!Number.isFinite(otherUserId) || otherUserId <= 0) {
      res.status(400).json({ ok: false, error: 'Choose an ArtSpace member to start a conversation.' });
      return;
    }

    const result = await findOrCreateConversation(viewerId, otherUserId);
    if (result.error) {
      res.status(result.blocked ? 403 : 400).json({ ok: false, error: result.error, blocked: Boolean(result.blocked) });
      return;
    }

    const unreadMap = await countUnreadMessagesByConversation(viewerId);
    const rows = await db.execute(`${CONVERSATION_LIST_SELECT} AND c.id = ? LIMIT 1`, [viewerId, viewerId, result.conversationId]);
    if (!rows || !rows.length) {
      res.status(500).json({ ok: false, error: 'We could not open that conversation. Please try again.' });
      return;
    }

    res.json({
      ok: true,
      conversation: {
        ...mapConversationRow(rows[0], viewerId),
        unread_count: unreadMap.get(result.conversationId) || 0
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/conversations/:id', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    if (Number(access.is_deleted)) {
      await db.execute(
        'UPDATE conversation_participants SET is_deleted = 0, deleted_at = NULL WHERE conversation_id = ? AND user_id = ?',
        [conversationId, viewerId]
      );
    }

    const [others, blockState] = await Promise.all([
      getOtherParticipants(conversationId, viewerId),
      Promise.all([getOtherParticipants(conversationId, viewerId)]).then(async ([participants]) => (
        participants.length === 1 ? getBlockStateBetween(viewerId, participants[0].id) : { iBlocked: false, blockedMe: false }
      ))
    ]);

    const participantRows = await db.execute(
      `SELECT cp.user_id, cp.last_read_at, u.username, COALESCE(NULLIF(u.name, ''), u.username) AS display_name, u.avatar
         FROM conversation_participants cp
         JOIN users u ON u.id = cp.user_id
        WHERE cp.conversation_id = ?
        ORDER BY cp.id ASC`,
      [conversationId]
    );

    const messageRows = await db.execute(
      `SELECT * FROM (
         ${MESSAGE_SELECT}
          WHERE m.conversation_id = ?
            AND NOT EXISTS (SELECT 1 FROM message_deletions md2 WHERE md2.message_id = m.id AND md2.user_id = ?)
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT ${MESSAGES_PAGE_SIZE}
       ) recent
       ORDER BY recent.created_at ASC, recent.id ASC`,
      [conversationId, viewerId]
    );

    const totalRows = await db.execute(
      `SELECT COUNT(*) AS count FROM messages m
        WHERE m.conversation_id = ?
          AND m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM message_deletions md3 WHERE md3.message_id = m.id AND md3.user_id = ?)`,
      [conversationId, viewerId]
    );
    const total = Number((totalRows && totalRows[0] && totalRows[0].count) || 0);

    // Opening a conversation marks it read (and clears its message notifications).
    await db.execute(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, viewerId]
    );
    await db.execute(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'message' AND conversation_id = ? AND is_read = 0",
      [viewerId, conversationId]
    );
    const unreadNotifications = await countUnreadNotifications(viewerId);
    const unreadMessages = await countUnreadMessagesTotal(viewerId);

    const typingIds = getTypingUsers(conversationId, viewerId);
    const typing = others
      .filter((participant) => typingIds.includes(participant.id))
      .map((participant) => ({ id: participant.id, username: participant.username, display_name: participant.display_name }));

    res.json({
      ok: true,
      conversation: {
        id: conversationId,
        is_muted: Boolean(Number(access.is_muted)),
        other_users: others,
        other_user: others[0] || null,
        participants: (participantRows || []).map((row) => ({
          id: Number(row.user_id),
          username: row.username,
          display_name: row.display_name,
          avatar: row.avatar || null,
          last_read_at: row.last_read_at
        })),
        blocked: blockState,
        messages: await mapMessageRowsWithReactions(messageRows, viewerId),
        has_more: total > messageRows.length,
        total,
        typing
      },
      unread_notifications: unreadNotifications,
      unread_messages: unreadMessages
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/conversations/:id/messages', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const afterId = Number.parseInt(req.query.after_id, 10);
    const beforeId = Number.parseInt(req.query.before_id, 10);
    let rows;
    let hasMore = false;

    if (Number.isFinite(afterId) && afterId >= 0) {
      if (afterId === 0) {
        rows = await db.execute(
          `SELECT * FROM (
             ${MESSAGE_SELECT}
              WHERE m.conversation_id = ?
                AND NOT EXISTS (SELECT 1 FROM message_deletions md2 WHERE md2.message_id = m.id AND md2.user_id = ?)
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT ${MESSAGES_PAGE_SIZE}
           ) recent
           ORDER BY recent.created_at ASC, recent.id ASC`,
          [conversationId, viewerId]
        );
      } else {
        rows = await db.execute(
          `${MESSAGE_SELECT}
            WHERE m.conversation_id = ?
              AND m.id > ?
              AND NOT EXISTS (SELECT 1 FROM message_deletions md2 WHERE md2.message_id = m.id AND md2.user_id = ?)
            ORDER BY m.created_at ASC, m.id ASC`,
          [conversationId, afterId, viewerId]
        );
      }
    } else if (Number.isFinite(beforeId) && beforeId > 0) {
      rows = await db.execute(
        `SELECT * FROM (
           ${MESSAGE_SELECT}
            WHERE m.conversation_id = ?
              AND m.id < ?
              AND NOT EXISTS (SELECT 1 FROM message_deletions md2 WHERE md2.message_id = m.id AND md2.user_id = ?)
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT ${MESSAGES_PAGE_SIZE}
         ) older
         ORDER BY older.created_at ASC, older.id ASC`,
        [conversationId, beforeId, viewerId]
      );
      const olderTotal = await db.execute(
        `SELECT COUNT(*) AS count FROM messages m
          WHERE m.conversation_id = ?
            AND m.id < ?
            AND m.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM message_deletions md3 WHERE md3.message_id = m.id AND md3.user_id = ?)`,
        [conversationId, beforeId, viewerId]
      );
      hasMore = Number((olderTotal && olderTotal[0] && olderTotal[0].count) || 0) > 0;
    } else {
      res.status(400).json({ ok: false, error: 'Provide after_id or before_id.' });
      return;
    }

    const others = await getOtherParticipants(conversationId, viewerId);
    const typingIds = getTypingUsers(conversationId, viewerId);
    const typing = others
      .filter((participant) => typingIds.includes(participant.id))
      .map((participant) => ({ id: participant.id, username: participant.username, display_name: participant.display_name }));

    const participantRows = await db.execute(
      `SELECT cp.user_id, cp.last_read_at FROM conversation_participants cp WHERE cp.conversation_id = ?`,
      [conversationId]
    );

    let unread = 0;
    if (afterId > 0) {
      const unreadMap = await countUnreadMessagesByConversation(viewerId);
      unread = unreadMap.get(conversationId) || 0;
    }

    res.json({
      ok: true,
      messages: await mapMessageRowsWithReactions(rows, viewerId),
      typing,
      has_more: hasMore || (afterId > 0 ? false : undefined),
      participants_last_read: (participantRows || []).map((row) => ({
        user_id: Number(row.user_id),
        last_read_at: row.last_read_at
      })),
      unread
    });
  } catch (err) {
    next(err);
  }
});

async function persistMessage({ connection, conversationId, senderId, messageType, content, artworkId, replyToId, attachments }) {
  const [insertResult] = await connection.execute(
    `INSERT INTO messages (conversation_id, sender_id, message_type, content, artwork_id, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [conversationId, senderId, messageType, content, artworkId || null, replyToId || null]
  );

  const messageId = Number(insertResult.insertId);
  for (const attachment of attachments || []) {
    await connection.execute(
      'INSERT INTO message_attachments (message_id, file_path, file_type) VALUES (?, ?, ?)',
      [messageId, attachment.path, attachment.type || 'image']
    );
  }

  // A new message restores the conversation for everyone who removed it from
  // their inbox, and refreshes the conversation sort timestamp.
  await connection.execute(
    'UPDATE conversation_participants SET is_deleted = 0, deleted_at = NULL, updated_at = NOW() WHERE conversation_id = ?',
    [conversationId]
  );
  await connection.execute('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);

  return messageId;
}

async function notifyMessageParticipants({ conversationId, senderId, others }) {
  for (const participant of others) {
    if (participant.is_muted) continue;
    await upsertMessageNotification({ userId: participant.id, actorId: senderId, conversationId });
  }
}

app.post('/api/messages/conversations/:id/messages', requireAuthApi, messageSendLimiter, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const messageType = MESSAGE_TYPES.includes(String(req.body.message_type)) ? String(req.body.message_type) : 'text';
    const content = sanitizeMessageContent(req.body.content);
    const replyToId = Number.parseInt(req.body.reply_to_id, 10);
    let artworkId = Number.parseInt(req.body.artwork_id, 10);

    if (messageType === 'text' && !content) {
      res.status(400).json({ ok: false, error: 'Write a message before sending.' });
      return;
    }
    if (messageType === 'artwork') {
      if (!Number.isFinite(artworkId) || artworkId <= 0) {
        res.status(400).json({ ok: false, error: 'Choose an artwork to send.' });
        return;
      }
    } else {
      artworkId = 0;
    }

    const others = await getOtherParticipants(conversationId, viewerId);
    if (others.length === 1) {
      const blockState = await getBlockStateBetween(viewerId, others[0].id);
      if (blockState.iBlocked || blockState.blockedMe) {
        res.status(403).json({
          ok: false,
          error: blockState.iBlocked
            ? 'You blocked this member. Unblock them to send messages.'
            : 'You cannot send messages to this member.',
          blocked: true
        });
        return;
      }
    }

    let replyValidated = 0;
    if (Number.isFinite(replyToId) && replyToId > 0) {
      const replyRows = await db.execute(
        'SELECT id, deleted_at FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1',
        [replyToId, conversationId]
      );
      if (!replyRows || !replyRows.length || replyRows[0].deleted_at) {
        res.status(400).json({ ok: false, error: 'That message can no longer be replied to.' });
        return;
      }
      replyValidated = replyToId;
    }

    if (messageType === 'artwork') {
      const artworkRows = await db.execute(
        `SELECT id, user_id, visibility, is_published, status FROM artworks WHERE id = ? LIMIT 1`,
        [artworkId]
      );
      const artwork = artworkRows && artworkRows[0];
      const shareable = artwork
        && (artwork.visibility === 'public' && Number(artwork.is_published) === 1 && artwork.status === 'active'
          || Number(artwork.user_id) === viewerId);
      if (!shareable) {
        res.status(400).json({ ok: false, error: 'That artwork cannot be shared in messages.' });
        return;
      }
    }

    const insertPayload = {
      conversationId,
      senderId: viewerId,
      messageType,
      content: messageType === 'text' ? content : (content || null),
      artworkId: messageType === 'artwork' ? artworkId : null,
      replyToId: replyValidated || null,
      attachments: []
    };

    let messageId;
    try {
      messageId = await withTransaction(async (connection) => persistMessage({ connection, ...insertPayload }));
    } catch (error) {
      console.error('Message send failed:', error);
      res.status(500).json({ ok: false, error: 'We could not send that message. Please try again.' });
      return;
    }

    const participantState = await db.execute(
      'SELECT cp.user_id, cp.is_muted FROM conversation_participants cp WHERE cp.conversation_id = ? AND cp.user_id <> ?',
      [conversationId, viewerId]
    );
    await notifyMessageParticipants({
      conversationId,
      senderId: viewerId,
      others: (participantState || []).map((row) => ({ id: Number(row.user_id), is_muted: Boolean(Number(row.is_muted)) }))
    });

    const messageRows = await db.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [messageId]);
    const unreadMap = await countUnreadMessagesByConversation(viewerId);

    res.status(201).json({
      ok: true,
      message: messageRows && messageRows.length ? mapMessageRow(messageRows[0], viewerId) : null,
      unread: unreadMap.get(conversationId) || 0
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/attachments', requireAuthApi, messageAttachmentLimiter, (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      res.status(400).json({ ok: false, error: getUploadErrorMessage(error) });
      return;
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      cleanupUploadedFiles(req.file ? [req.file] : []);
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Choose an image to send.' });
      return;
    }

    const others = await getOtherParticipants(conversationId, viewerId);
    if (others.length === 1) {
      const blockState = await getBlockStateBetween(viewerId, others[0].id);
      if (blockState.iBlocked || blockState.blockedMe) {
        cleanupUploadedFiles([req.file]);
        res.status(403).json({ ok: false, error: 'You cannot send messages to this member.', blocked: true });
        return;
      }
    }

    const processed = await uploadArtworkToImageKit([req.file], viewerId);
    const image = processed && processed[0];
    if (!image || !image.image_url) {
      res.status(500).json({ ok: false, error: 'We could not save that image. Please try again.' });
      return;
    }

    const content = sanitizeMessageContent(req.body.content).slice(0, 300);
    let messageId;
    try {
      messageId = await withTransaction(async (connection) => persistMessage({
        connection,
        conversationId,
        senderId: viewerId,
        messageType: 'image',
        content: content || null,
        artworkId: null,
        replyToId: null,
        attachments: [{ path: image.image_url, type: 'image' }]
      }));
    } catch (error) {
      console.error('Image message failed:', error);
      res.status(500).json({ ok: false, error: 'We could not send that image. Please try again.' });
      return;
    }

    const participantState = await db.execute(
      'SELECT cp.user_id, cp.is_muted FROM conversation_participants cp WHERE cp.conversation_id = ? AND cp.user_id <> ?',
      [conversationId, viewerId]
    );
    await notifyMessageParticipants({
      conversationId,
      senderId: viewerId,
      others: (participantState || []).map((row) => ({ id: Number(row.user_id), is_muted: Boolean(Number(row.is_muted)) }))
    });

    const messageRows = await db.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [messageId]);
    res.status(201).json({
      ok: true,
      message: messageRows && messageRows.length ? mapMessageRow(messageRows[0], viewerId) : null
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/read', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    await db.execute(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, viewerId]
    );
    await db.execute(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'message' AND conversation_id = ? AND is_read = 0",
      [viewerId, conversationId]
    );

    const [unreadMessages, unreadNotifications] = await Promise.all([
      countUnreadMessagesTotal(viewerId),
      countUnreadNotifications(viewerId)
    ]);
    res.json({ ok: true, unread: unreadMessages, unread_notifications: unreadNotifications });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/typing', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    setTypingFlag(conversationId, viewerId, req.body.typing !== false && req.body.typing !== 'false');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/mute', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    await db.execute(
      'UPDATE conversation_participants SET is_muted = IF(is_muted = 1, 0, 1) WHERE conversation_id = ? AND user_id = ?',
      [conversationId, viewerId]
    );
    const refreshed = await getConversationAccess(conversationId, viewerId);
    res.json({ ok: true, is_muted: Boolean(Number(refreshed.is_muted)) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/delete', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    // Removes the conversation from this user's inbox only. The other
    // participant keeps their copy and full history.
    await db.execute(
      'UPDATE conversation_participants SET is_deleted = 1, deleted_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, viewerId]
    );
    const unreadMessages = await countUnreadMessagesTotal(viewerId);
    res.json({ ok: true, deleted_for: 'self', unread_messages: unreadMessages });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/block', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const others = await getOtherParticipants(conversationId, viewerId);
    if (others.length !== 1) {
      res.status(400).json({ ok: false, error: 'Blocking is only available in one-to-one conversations.' });
      return;
    }

    await db.execute(
      'INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
      [viewerId, others[0].id]
    );
    res.json({ ok: true, blocked: true, blocked_user: others[0].username });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/unblock', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const others = await getOtherParticipants(conversationId, viewerId);
    if (others.length !== 1) {
      res.status(400).json({ ok: false, error: 'Blocking is only available in one-to-one conversations.' });
      return;
    }

    await db.execute(
      'DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?',
      [viewerId, others[0].id]
    );
    res.json({ ok: true, blocked: false, blocked_user: others[0].username });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/conversations/:id/report', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const reason = sanitizeMessageContent(req.body.reason).slice(0, 500);
    let messageId = Number.parseInt(req.body.message_id, 10);
    if (Number.isFinite(messageId) && messageId > 0) {
      const rows = await db.execute(
        'SELECT id FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1',
        [messageId, conversationId]
      );
      if (!rows || !rows.length) messageId = 0;
    } else {
      messageId = 0;
    }

    if (!messageId) {
      const latest = await db.execute(
        `SELECT id FROM messages
          WHERE conversation_id = ? AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = messages.id AND md.user_id = ?)
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [conversationId, viewerId]
      );
      messageId = latest && latest.length ? Number(latest[0].id) : 0;
    }

    if (!messageId) {
      res.status(400).json({ ok: false, error: 'There is no message to report in this conversation.' });
      return;
    }

    await db.execute(
      'INSERT INTO message_reports (message_id, reporter_id, reason) VALUES (?, ?, ?)',
      [messageId, viewerId, reason || null]
    );
    res.json({ ok: true, reported: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/:id/delete', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const messageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }
    const scope = req.body.scope === 'everyone' ? 'everyone' : 'self';

    const messageRows = await db.execute(
      `SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.created_at, m.deleted_at
         FROM messages m
        WHERE m.id = ? LIMIT 1`,
      [messageId]
    );
    const message = messageRows && messageRows[0];
    if (!message) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }

    const access = await getConversationAccess(message.conversation_id, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    if (scope === 'everyone') {
      const isSender = Number(message.sender_id) === viewerId;
      const withinWindow = message.created_at
        ? (Date.now() - new Date(message.created_at).getTime()) <= MESSAGE_DELETE_EVERYONE_WINDOW_MS
        : false;
      if (!isSender) {
        res.status(403).json({ ok: false, error: 'Only the sender can delete a message for everyone.' });
        return;
      }
      if (!withinWindow) {
        res.status(400).json({ ok: false, error: 'Messages can only be deleted for everyone within 24 hours.' });
        return;
      }
      await db.execute('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [messageId]);
    } else {
      await db.execute(
        'INSERT IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)',
        [messageId, viewerId]
      );
    }

    const unreadMessages = await countUnreadMessagesTotal(viewerId);
    res.json({ ok: true, scope, unread_messages: unreadMessages });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages/:id/edit', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const messageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }
    const content = sanitizeMessageContent(req.body.content);

    const messageRows = await db.execute(
      'SELECT id, conversation_id, sender_id, message_type, deleted_at, created_at FROM messages WHERE id = ? LIMIT 1',
      [messageId]
    );
    const message = messageRows && messageRows[0];
    if (!message) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }

    const access = await getConversationAccess(message.conversation_id, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const isSender = Number(message.sender_id) === viewerId;
    const withinWindow = message.created_at
      ? (Date.now() - new Date(message.created_at).getTime()) <= MESSAGE_EDIT_WINDOW_MS
      : false;

    if (!isSender || message.message_type !== 'text' || message.deleted_at || !withinWindow) {
      res.status(400).json({ ok: false, error: 'That message can no longer be edited.' });
      return;
    }
    if (!content) {
      res.status(400).json({ ok: false, error: 'Write a message before saving.' });
      return;
    }

    await db.execute('UPDATE messages SET content = ?, edited_at = NOW() WHERE id = ?', [content, messageId]);
    const refreshed = await db.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [messageId]);
    res.json({ ok: true, message: refreshed && refreshed.length ? mapMessageRow(refreshed[0], viewerId) : null });
  } catch (err) {
    next(err);
  }
});

const MESSAGE_REACTION_SELECT_LIMIT = 200;

app.post('/api/messages/:id/react', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const messageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }

    const messageRows = await db.execute(
      'SELECT id, conversation_id, sender_id, deleted_at FROM messages WHERE id = ? LIMIT 1',
      [messageId]
    );
    const message = messageRows && messageRows[0];
    if (!message || message.deleted_at) {
      res.status(404).json({ ok: false, error: 'That message could not be found.' });
      return;
    }

    const access = await getConversationAccess(message.conversation_id, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const others = await getOtherParticipants(message.conversation_id, viewerId);
    if (others.length === 1) {
      const blockState = await getBlockStateBetween(viewerId, others[0].id);
      if (blockState.iBlocked || blockState.blockedMe) {
        res.status(403).json({ ok: false, error: 'You cannot react in this conversation.' });
        return;
      }
    }

    const requested = String(req.body.reaction || '').trim();
    if (requested && !MESSAGE_REACTIONS_ALLOWED.includes(requested)) {
      res.status(400).json({ ok: false, error: 'That reaction is not available.' });
      return;
    }

    if (!requested) {
      await db.execute('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [messageId, viewerId]);
    } else {
      await db.execute(
        `INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), created_at = NOW()`,
        [messageId, viewerId, requested]
      );
    }

    const reactionRows = await db.execute(
      'SELECT message_id, user_id, reaction FROM message_reactions WHERE message_id = ?',
      [messageId]
    );
    res.json({ ok: true, message_id: messageId, reactions: summarizeReactions(reactionRows, viewerId) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/conversations/:id/reactions', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }
    const access = await getConversationAccess(conversationId, viewerId);
    if (!access) {
      res.status(404).json({ ok: false, error: 'That conversation could not be found.' });
      return;
    }

    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, MESSAGE_REACTION_SELECT_LIMIT);
    if (!ids.length) {
      res.json({ ok: true, reactions: {} });
      return;
    }

    const placeholders = ids.map(() => '?').join(',');
    const reactionRows = await db.execute(
      `SELECT mr.message_id, mr.user_id, mr.reaction
         FROM message_reactions mr
         JOIN messages m ON m.id = mr.message_id
        WHERE m.conversation_id = ? AND mr.message_id IN (${placeholders})`,
      [conversationId, ...ids]
    );

    const byMessage = new Map();
    for (const row of reactionRows || []) {
      if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
      byMessage.get(row.message_id).push(row);
    }
    const reactions = {};
    for (const [key, rows] of byMessage) {
      reactions[String(key)] = summarizeReactions(rows, viewerId);
    }
    res.json({ ok: true, reactions });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/users', requireAuthApi, async (req, res, next) => {
  try {
    const viewerId = Number(req.session.user.id);
    const search = sanitizeMessageContent(String(req.query.q || '')).slice(0, 60);
    if (!search) {
      res.json({ ok: true, users: [] });
      return;
    }

    const like = `%${search.replace(/([\\%_])/g, '\\$1')}%`;
    const rows = await db.execute(
      `SELECT u.id, u.username, u.avatar, u.last_seen_at,
              COALESCE(NULLIF(u.name, ''), u.username) AS display_name
         FROM users u
        WHERE u.status = 'active'
          AND u.id <> ?
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = u.id)
          AND (u.username LIKE ? OR u.name LIKE ?)
        ORDER BY CASE WHEN u.username LIKE ? THEN 0 ELSE 1 END, u.username ASC
        LIMIT 12`,
      [viewerId, viewerId, like, like, `${search}%`]
    );

    res.json({
      ok: true,
      users: (rows || []).map((row) => ({
        id: Number(row.id),
        username: row.username,
        display_name: row.display_name,
        avatar: row.avatar || null,
        online: isUserOnline(row.last_seen_at)
      }))
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/unread-count', requireAuthApi, async (req, res, next) => {
  try {
    const unread = await countUnreadMessagesTotal(Number(req.session.user.id));
    res.json({ ok: true, unread });
  } catch (err) {
    next(err);
  }
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
app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const [userCountRows, artworkCountRows, reportCountRows, pinCountRows, hiddenCountRows, users, artworks, reports] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM users'),
      db.execute("SELECT COUNT(*) AS count FROM artworks WHERE status = 'active'"),
      db.execute("SELECT COUNT(*) AS count FROM reports WHERE status = 'open'"),
      db.execute(
        `SELECT COUNT(*) AS count
           FROM artwork_pins p
           INNER JOIN artworks a ON a.id = p.artwork_id
          WHERE a.visibility = 'public' AND a.is_published = 1 AND a.status = 'active'`
      ),
      db.execute("SELECT COUNT(*) AS count FROM artworks WHERE status <> 'active'"),
      db.execute(
        `SELECT u.id, u.name, u.username, u.email, u.role, u.status, u.avatar, u.created_at,
                DATE_FORMAT(u.created_at, '%b %d, %Y') AS joined_label,
                COUNT(a.id) AS artwork_count
           FROM users u
           LEFT JOIN artworks a ON a.user_id = u.id AND a.status = 'active'
          GROUP BY u.id
          ORDER BY u.created_at DESC
          LIMIT 100`
      ),
      db.execute(
        `SELECT a.id, a.title, a.thumbnail_url, a.image_url, a.status, a.visibility, a.created_at,
                DATE_FORMAT(a.created_at, '%b %d, %Y') AS created_label,
                u.username, COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
                c.name AS category_name,
                (SELECT COUNT(*) FROM reports r WHERE r.artwork_id = a.id AND r.status = 'open') AS open_reports
           FROM artworks a
           INNER JOIN users u ON u.id = a.user_id
           LEFT JOIN categories c ON c.id = a.category_id
          ORDER BY a.created_at DESC
          LIMIT 100`
      ),
      db.execute(
        `SELECT r.id, r.reason, r.status, r.created_at,
                DATE_FORMAT(r.created_at, '%b %d, %Y') AS created_label,
                a.id AS artwork_id, a.title AS artwork_title, a.thumbnail_url, a.image_url,
                artist.username AS artist_username,
                COALESCE(NULLIF(artist.name, ''), artist.username) AS artist_name,
                reporter.username AS reporter_username,
                COALESCE(NULLIF(reporter.name, ''), reporter.username) AS reporter_name
           FROM reports r
           INNER JOIN artworks a ON a.id = r.artwork_id
           INNER JOIN users artist ON artist.id = a.user_id
           INNER JOIN users reporter ON reporter.id = r.reporter_id
          WHERE r.status = 'open'
          ORDER BY r.created_at DESC
          LIMIT 100`
      )
    ]);

    const count = (rows) => Number((rows && rows[0] && rows[0].count) || 0);

    res.render('pages/admin', {
      pageTitle: 'ArtSpace | Admin studio',
      adminUser: req.session.user,
      stats: {
        users: count(userCountRows),
        artworks: count(artworkCountRows),
        openReports: count(reportCountRows),
        pins: count(pinCountRows),
        hidden: count(hiddenCountRows)
      },
      users: users || [],
      artworks: artworks || [],
      reports: reports || [],
      activeTab: ['overview', 'artworks', 'users', 'reports'].includes(req.query.tab) ? req.query.tab : 'overview',
      notice: typeof req.query.notice === 'string' ? req.query.notice : null
    });
  } catch (err) {
    next(err);
  }
});

app.post('/admin/artworks/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    const nextStatus = req.body.status === 'hidden' ? 'hidden' : 'active';
    if (!Number.isFinite(artworkId)) {
      res.status(404).render('pages/error', {
        message: 'The artwork you requested could not be found.',
        pageTitle: 'ArtSpace | Page not found',
        isAuthenticated: true,
        currentUser: req.session.user,
        unreadNotifications: 0
      });
      return;
    }

    const result = await db.execute('UPDATE artworks SET status = ?, updated_at = NOW() WHERE id = ?', [nextStatus, artworkId]);
    if (!result || result.affectedRows === 0) {
      res.redirect('/admin?tab=artworks&notice=missing#artworks');
      return;
    }

    if (nextStatus === 'hidden') {
      await db.execute(
        "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = NOW() WHERE artwork_id = ? AND status = 'open'",
        [req.session.user.id, artworkId]
      );
    }

    res.redirect(`/admin?tab=artworks&notice=${nextStatus === 'hidden' ? 'artwork-hidden' : 'artwork-restored'}#artworks`);
  } catch (err) {
    next(err);
  }
});

app.post('/admin/artworks/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      res.redirect('/admin?tab=artworks&notice=missing#artworks');
      return;
    }

    const rows = await db.execute(
      'SELECT id, user_id, title, image_url, thumbnail_url FROM artworks WHERE id = ? LIMIT 1',
      [artworkId]
    );
    const artwork = (rows && rows[0]) || null;

    if (!artwork) {
      res.redirect('/admin?tab=artworks&notice=missing#artworks');
      return;
    }

    const galleryImages = await fetchArtworkImages(artworkId).catch(() => []);

    await db.execute('DELETE FROM notifications WHERE artwork_id = ?', [artworkId]);
    await db.execute('DELETE FROM artworks WHERE id = ?', [artworkId]);
    await deleteArtworkMedia(artwork, galleryImages);

    res.redirect('/admin?tab=artworks&notice=artwork-deleted#artworks');
  } catch (err) {
    next(err);
  }
});

app.post('/admin/users/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const nextStatus = req.body.status === 'suspended' ? 'suspended' : 'active';
    if (!Number.isFinite(userId) || userId === Number(req.session.user.id)) {
      res.redirect('/admin?tab=users&notice=user-protected#users');
      return;
    }

    const rows = await db.execute('SELECT id, role FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = (rows && rows[0]) || null;

    if (!user) {
      res.redirect('/admin?tab=users&notice=missing#users');
      return;
    }

    if (user.role === 'admin') {
      res.redirect('/admin?tab=users&notice=user-protected#users');
      return;
    }

    await db.execute('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [nextStatus, userId]);
    res.redirect(`/admin?tab=users&notice=${nextStatus === 'suspended' ? 'user-suspended' : 'user-active'}#users`);
  } catch (err) {
    next(err);
  }
});

app.post('/admin/reports/:id/:action', requireAdmin, async (req, res, next) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    const action = req.params.action === 'dismiss' ? 'dismissed' : 'resolved';
    if (!Number.isFinite(reportId)) {
      res.redirect('/admin?tab=reports&notice=missing#reports');
      return;
    }

    const result = await db.execute(
      "UPDATE reports SET status = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'open'",
      [action, req.session.user.id, reportId]
    );

    res.redirect(`/admin?tab=reports&notice=${result && result.affectedRows ? `report-${action}` : 'missing'}#reports`);
  } catch (err) {
    next(err);
  }
});
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

    const [categories, artworkImages] = await Promise.all([
      db.execute('SELECT id, name, slug FROM categories ORDER BY sort_order ASC'),
      ensureArtworkGalleryRows(artwork).catch(() => [])
    ]);
    artwork.visible_tags = String(artwork.tags || '')
      .split(/\s+/)
      .filter((tag) => tag && !/^effect:/i.test(tag))
      .join(' ');
    artwork.images = artworkImages.length
      ? artworkImages
      : (artwork.image_url ? [{
          id: 0,
          image_url: artwork.image_url,
          thumbnail_url: artwork.thumbnail_url || artwork.image_url,
          sort_order: 0
        }] : []);

    res.render('pages/artwork-edit', {
      pageTitle: 'ArtSpace | Edit artwork',
      artwork,
      categories: categories || [],
      error: typeof req.query.error === 'string' && req.query.error ? req.query.error : null
    });
  } catch (err) {
    next(err);
  }
});

app.post('/art/:id/edit', requireAuth, handleArtworkEditUpload, async (req, res, next) => {
  try {
    const artworkId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artworkId)) {
      respondArtworkActionError(req, res, 404, 'The artwork you requested could not be found.');
      return;
    }

    const rows = await db.execute(
      `SELECT id, user_id, category_id, title, description, tags, image_url, thumbnail_url, cover_image_id,
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
    const newFiles = Array.isArray(req.files) ? req.files : [];

    const cleanupNewFiles = () => {
      cleanupUploadedFiles(newFiles);
    };

    const renderError = async (message) => {
      cleanupNewFiles();
      if (requestWantsJson(req)) {
        res.status(400).json({ ok: false, error: message });
        return;
      }

      const [categories, currentImages] = await Promise.all([
        db.execute('SELECT id, name, slug FROM categories ORDER BY sort_order ASC'),
        fetchArtworkImages(artworkId).catch(() => [])
      ]);
      res.status(400).render('pages/artwork-edit', {
        pageTitle: 'ArtSpace | Edit artwork',
        artwork: {
          ...artwork,
          title,
          description,
          category_id: Number.isFinite(categoryId) ? categoryId : artwork.category_id,
          visible_tags: visibleTags,
          images: currentImages
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

    const existingImages = await ensureArtworkGalleryRows(artwork);
    const existingById = new Map(existingImages.map((image) => [image.id, image]));

    // Parse the desired final order: array of existing ids or "new:<fileIndex>" tokens.
    let orderTokens = null;
    const orderRaw = String(req.body.image_order || '').trim();
    if (orderRaw) {
      try {
        const parsed = JSON.parse(orderRaw);
        if (Array.isArray(parsed)) {
          orderTokens = parsed.map((token) => String(token).trim()).filter(Boolean);
        }
      } catch (parseError) {
        orderTokens = null;
      }
      if (!orderTokens) {
        await renderError('We could not read the new page order. Please refresh and try again.');
        return;
      }
    }

    // Legacy fallback (non-JS submissions): keep current order, append new files.
    const planned = orderTokens
      ? orderTokens
          .map((token) => {
            if (/^\d+$/.test(token)) {
              const id = Number.parseInt(token, 10);
              return existingById.has(id) ? { kind: 'existing', id } : null;
            }
            const newMatch = token.match(/^new:(\d+)$/);
            if (newMatch) {
              const fileIndex = Number.parseInt(newMatch[1], 10);
              return fileIndex >= 0 && fileIndex < newFiles.length
                ? { kind: 'new', fileIndex }
                : null;
            }
            return null;
          })
          .filter(Boolean)
      : [
          ...existingImages.map((image) => ({ kind: 'existing', id: image.id })),
          ...newFiles.map((file, index) => ({ kind: 'new', fileIndex: index }))
        ];

    const keepIds = new Set(planned.filter((item) => item.kind === 'existing').map((item) => item.id));
    const removedRows = existingImages.filter((image) => !keepIds.has(image.id));

    if (planned.length === 0) {
      await renderError('An artwork needs at least one image. Keep a page or add new ones.');
      return;
    }

    // Resolve the requested cover: an existing id or "new:<fileIndex>".
    const coverRaw = String(req.body.cover_image_id || '').trim();
    let coverToken = null;
    if (/^\d+$/.test(coverRaw) && existingById.has(Number.parseInt(coverRaw, 10)) && keepIds.has(Number.parseInt(coverRaw, 10))) {
      coverToken = { kind: 'existing', id: Number.parseInt(coverRaw, 10) };
    } else {
      const coverNewMatch = coverRaw.match(/^new:(\d+)$/);
      if (coverNewMatch) {
        const fileIndex = Number.parseInt(coverNewMatch[1], 10);
        if (fileIndex >= 0 && fileIndex < newFiles.length) {
          coverToken = { kind: 'new', fileIndex };
        }
      }
    }

    if (!coverToken && orderTokens) {
      coverToken = planned[0];
    }

    let processedNew = null;

    try {
      processedNew = newFiles.length
        ? await uploadArtworkToImageKit(newFiles, req.session.user.id)
        : [];

      if (processedNew.some((image) => !image || !image.image_url)) {
        throw Object.assign(new Error('We could not save the new images. Please try again.'), { handled: true });
      }

      const outcome = await withTransaction(async (connection) => {
        const finalImages = [];
        let position = 0;
        let coverRow = null;
        const insertedNew = [];

        if (removedRows.length) {
          await connection.execute(
            `DELETE FROM artwork_images WHERE artwork_id = ? AND id IN (${removedRows.map(() => '?').join(',')})`,
            [artworkId, ...removedRows.map((row) => row.id)]
          );
        }

        for (const item of planned) {
          if (item.kind === 'existing') {
            const row = existingById.get(item.id);
            await connection.execute(
              'UPDATE artwork_images SET sort_order = ? WHERE id = ? AND artwork_id = ?',
              [position, item.id, artworkId]
            );
            finalImages.push({ id: item.id, image_url: row.image_url, thumbnail_url: row.thumbnail_url || row.image_url });
          } else {
            const image = processedNew[item.fileIndex];
            const [insertResult] = await connection.execute(
              'INSERT INTO artwork_images (artwork_id, image_url, thumbnail_url, sort_order) VALUES (?, ?, ?, ?)',
              [artworkId, image.image_url, image.thumbnail_url || image.image_url, position]
            );
            const inserted = {
              id: Number(insertResult.insertId),
              image_url: image.image_url,
              thumbnail_url: image.thumbnail_url || image.image_url
            };
            insertedNew.push(inserted);
            finalImages.push(inserted);
          }

          if (coverToken
            && ((item.kind === 'existing' && coverToken.kind === 'existing' && coverToken.id === item.id)
              || (item.kind === 'new' && coverToken.kind === 'new' && coverToken.fileIndex === item.fileIndex))) {
            coverRow = finalImages[finalImages.length - 1];
          }

          position += 1;
        }

        if (!coverRow) {
          const previousCover = existingImages.find((image) => image.id === Number(artwork.cover_image_id));
          if (previousCover && keepIds.has(previousCover.id)) {
            coverRow = finalImages.find((image) => image.id === previousCover.id) || null;
          }
          if (!coverRow) {
            coverRow = finalImages[0];
          }
        }

        await connection.execute(
          `UPDATE artworks
              SET title = ?, description = ?, category_id = ?, tags = ?,
                  image_url = ?, thumbnail_url = ?, cover_image_id = ?, updated_at = NOW()
            WHERE id = ? AND user_id = ?`,
          [
            title,
            description || null,
            categoryId,
            tags || null,
            coverRow.image_url,
            coverRow.thumbnail_url || coverRow.image_url,
            coverRow.id,
            artworkId,
            req.session.user.id
          ]
        );

        return { finalImages, coverRow, insertedNew };
      });

      cleanupNewFiles();

      if (description) {
        await removeMentionsFor('artwork', artworkId);
        await syncMentions({
          actorId: req.session.user.id,
          text: description,
          mentionableType: 'artwork',
          mentionableId: artworkId,
          artworkId,
          notificationMessage: description.slice(0, 240)
        });
      }

      // Remove media for deleted gallery rows only after a successful commit.
      if (removedRows.length) {
        await removeArtworkMediaUrls(
          removedRows.flatMap((row) => [row.image_url, row.thumbnail_url]),
          req.session.user.id
        );
      }

      if (requestWantsJson(req)) {
        res.json({
          ok: true,
          id: artworkId,
          artworkUrl: `/art/${artworkId}`,
          imagesCount: outcome.finalImages.length,
          coverImageId: outcome.coverRow.id
        });
        return;
      }

      res.redirect(`/art/${artworkId}`);
    } catch (processingError) {
      // Roll back orphaned uploads: if the transaction failed, remove newly stored media.
      if (processedNew && processedNew.length) {
        await removeArtworkMediaUrls(
          processedNew.flatMap((image) => [image.image_url, image.thumbnail_url]),
          req.session.user.id
        ).catch(() => {});
      }

      if (processingError && processingError.handled) {
        await renderError(processingError.message);
        return;
      }

      throw processingError;
    }
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