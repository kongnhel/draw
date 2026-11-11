require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

function buildSslConfig() {
  const mode = String(process.env.AIVEN_MYSQL_SSL || '').toLowerCase();
  if (mode !== 'required') return undefined;
  return { rejectUnauthorized: false };
}

const dbConfig = {
  host: process.env.AIVEN_MYSQL_HOST,
  port: Number(process.env.AIVEN_MYSQL_PORT || 3306),
  database: process.env.AIVEN_MYSQL_DATABASE,
  user: process.env.AIVEN_MYSQL_USER,
  password: process.env.AIVEN_MYSQL_PASSWORD,
  charset: 'utf8mb4',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 60000,
  connectTimeout: 15000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl: buildSslConfig(),
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(191) NOT NULL,
    password VARCHAR(255) NOT NULL,
    avatar VARCHAR(500) DEFAULT NULL,
    cover_image VARCHAR(500) DEFAULT NULL,
    bio TEXT,
    website VARCHAR(255) DEFAULT NULL,
    instagram VARCHAR(100) DEFAULT NULL,
    twitter VARCHAR(100) DEFAULT NULL,
    locale VARCHAR(5) NOT NULL DEFAULT 'km',
    role ENUM('user', 'artist', 'admin') NOT NULL DEFAULT 'user',
    status ENUM('active', 'pending', 'suspended') NOT NULL DEFAULT 'active',
    email_verified_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role (role),
    KEY idx_users_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS categories (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_name (name),
    UNIQUE KEY uq_categories_slug (slug),
    KEY idx_categories_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artworks (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    category_id INT UNSIGNED DEFAULT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    tags VARCHAR(500) DEFAULT NULL,
    image_url VARCHAR(1000) NOT NULL,
    thumbnail_url VARCHAR(1000) DEFAULT NULL,
    visibility ENUM('public', 'private', 'unlisted') NOT NULL DEFAULT 'public',
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    status ENUM('active', 'hidden', 'removed') NOT NULL DEFAULT 'active',
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_artworks_user (user_id),
    KEY idx_artworks_category (category_id),
    KEY idx_artworks_feed (visibility, is_published, status, is_featured, created_at),
    CONSTRAINT fk_artworks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_artworks_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS likes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    artwork_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_likes_user_artwork (user_id, artwork_id),
    KEY idx_likes_artwork (artwork_id),
    CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_likes_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    artwork_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bookmarks_user_artwork (user_id, artwork_id),
    KEY idx_bookmarks_artwork (artwork_id),
    CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_bookmarks_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artwork_pins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    artwork_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_artwork_pins_user_artwork (user_id, artwork_id),
    KEY idx_artwork_pins_user_created (user_id, created_at),
    KEY idx_artwork_pins_created (created_at),
    KEY idx_artwork_pins_artwork (artwork_id),
    CONSTRAINT fk_artwork_pins_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_artwork_pins_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS comments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    artwork_id INT UNSIGNED NOT NULL,
    parent_id INT UNSIGNED DEFAULT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_comments_artwork (artwork_id, created_at),
    KEY idx_comments_user (user_id),
    KEY idx_comments_parent (parent_id),
    CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS comment_likes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    comment_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_comment_likes_user_comment (user_id, comment_id),
    KEY idx_comment_likes_comment (comment_id),
    CONSTRAINT fk_comment_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artwork_shares (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    artwork_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED DEFAULT NULL,
    platform VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_artwork_shares_artwork (artwork_id, created_at),
    KEY idx_artwork_shares_user (user_id),
    CONSTRAINT fk_artwork_shares_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE,
    CONSTRAINT fk_artwork_shares_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artwork_views (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    artwork_id INT UNSIGNED NOT NULL,
    viewer_key VARCHAR(80) NOT NULL,
    user_id INT UNSIGNED DEFAULT NULL,
    first_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_artwork_views_artwork_viewer (artwork_id, viewer_key),
    KEY idx_artwork_views_artwork (artwork_id),
    KEY idx_artwork_views_user (user_id),
    CONSTRAINT fk_artwork_views_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE,
    CONSTRAINT fk_artwork_views_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artwork_images (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    artwork_id INT UNSIGNED NOT NULL,
    image_url VARCHAR(1000) NOT NULL,
    thumbnail_url VARCHAR(1000) DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_artwork_images_artwork (artwork_id, sort_order),
    CONSTRAINT fk_artwork_images_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS follows (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    follower_id INT UNSIGNED NOT NULL,
    following_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_follows_pair (follower_id, following_id),
    KEY idx_follows_following (following_id),
    CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_follows_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_follows_not_self CHECK (follower_id <> following_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    actor_id INT UNSIGNED DEFAULT NULL,
    type VARCHAR(50) NOT NULL,
    artwork_id INT UNSIGNED DEFAULT NULL,
    message VARCHAR(500) DEFAULT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_notifications_user (user_id, is_read, created_at),
    KEY idx_notifications_actor (actor_id),
    KEY idx_notifications_artwork (artwork_id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_notifications_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS share_likes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    share_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    reaction_type VARCHAR(16) NOT NULL DEFAULT 'like',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_share_likes_share_user (share_id, user_id),
    KEY idx_share_likes_share (share_id),
    KEY idx_share_likes_user (user_id),
    CONSTRAINT fk_share_likes_share FOREIGN KEY (share_id) REFERENCES artwork_shares (id) ON DELETE CASCADE,
    CONSTRAINT fk_share_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS share_comments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    share_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    parent_id INT UNSIGNED DEFAULT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_share_comments_share (share_id, created_at),
    KEY idx_share_comments_user (user_id),
    KEY idx_share_comments_parent (parent_id),
    CONSTRAINT fk_share_comments_share FOREIGN KEY (share_id) REFERENCES artwork_shares (id) ON DELETE CASCADE,
    CONSTRAINT fk_share_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_share_comments_parent FOREIGN KEY (parent_id) REFERENCES share_comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS mentions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    mentioned_by INT UNSIGNED NOT NULL,
    mentioned_user_id INT UNSIGNED NOT NULL,
    mentionable_type VARCHAR(16) NOT NULL,
    mentionable_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mentions_target (mentioned_by, mentioned_user_id, mentionable_type, mentionable_id),
    KEY idx_mentions_user (mentioned_user_id, created_at),
    KEY idx_mentions_mentionable (mentionable_type, mentionable_id),
    CONSTRAINT fk_mentions_author FOREIGN KEY (mentioned_by) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_mentions_user FOREIGN KEY (mentioned_user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS reports (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    artwork_id INT UNSIGNED NOT NULL,
    reporter_id INT UNSIGNED NOT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
    resolved_by INT UNSIGNED DEFAULT NULL,
    resolved_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reports_status_created (status, created_at),
    KEY idx_reports_artwork (artwork_id),
    KEY idx_reports_reporter (reporter_id),
    CONSTRAINT fk_reports_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE,
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reports_resolver FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_password_reset_token (token_hash),
    KEY idx_password_reset_user (user_id),
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(128) NOT NULL,
    data MEDIUMTEXT NOT NULL,
    expires DATETIME NOT NULL,
    PRIMARY KEY (sid),
    KEY idx_sessions_expires (expires)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

let pool;
let initPromise = null;

const IS_SERVERLESS = process.env.VERCEL === '1';
const SKIP_SCHEMA_INIT = process.env.DB_SKIP_SCHEMA_INIT === '1';
const READ_QUERY = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i;
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_WAIT_TIMEOUT'
]);

function attachPoolErrorHandlers(targetPool) {
  const basePool = targetPool && targetPool.pool ? targetPool.pool : targetPool;
  if (!basePool || typeof basePool.on !== 'function') return;

  basePool.on('connection', (connection) => {
    connection.on('error', (error) => {
      console.error('MySQL connection error:', error && (error.code || error.message));
    });
  });

  basePool.on('error', (error) => {
    console.error('MySQL pool error:', error && (error.code || error.message));
  });
}

async function ensureUserProfileColumns(targetPool = pool) {
  const [columns] = await targetPool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const existing = new Set(columns.map((row) => row.COLUMN_NAME));
  const additions = [
    ['cover_image', 'VARCHAR(500) DEFAULT NULL'],
    ['website', 'VARCHAR(255) DEFAULT NULL'],
    ['instagram', 'VARCHAR(100) DEFAULT NULL'],
    ['twitter', 'VARCHAR(100) DEFAULT NULL'],
    ['locale', "VARCHAR(5) NOT NULL DEFAULT 'km'"]
  ];

  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await targetPool.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function ensureCommentColumns(targetPool) {
  const [columns] = await targetPool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments'`
  );
  const existing = new Set(columns.map((row) => row.COLUMN_NAME));

  if (!existing.has('parent_id')) {
    await targetPool.query('ALTER TABLE comments ADD COLUMN parent_id INT UNSIGNED DEFAULT NULL AFTER artwork_id');
  }

  const [indexes] = await targetPool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments'`
  );
  const indexNames = new Set(indexes.map((row) => row.INDEX_NAME));
  if (!indexNames.has('idx_comments_parent')) {
    await targetPool.query('ALTER TABLE comments ADD INDEX idx_comments_parent (parent_id)');
  }

  const [constraints] = await targetPool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`
  );
  const constraintNames = new Set(constraints.map((row) => row.CONSTRAINT_NAME));
  if (!constraintNames.has('fk_comments_parent')) {
    await targetPool.query(
      'ALTER TABLE comments ADD CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments (id) ON DELETE CASCADE'
    );
  }
}

async function ensureArtworkImageColumns(targetPool) {
  const [artworkColumns] = await targetPool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'artworks'`
  );
  const artworkColumnNames = new Set(artworkColumns.map((row) => row.COLUMN_NAME));

  if (!artworkColumnNames.has('cover_image_id')) {
    await targetPool.query('ALTER TABLE artworks ADD COLUMN cover_image_id INT UNSIGNED DEFAULT NULL');
  }

  // Backfill legacy artworks: copy the single cover into artwork_images,
  // then point cover_image_id at the first gallery row.
  await targetPool.query(
    `INSERT INTO artwork_images (artwork_id, image_url, thumbnail_url, sort_order)
     SELECT a.id, a.image_url, a.thumbnail_url, 0
       FROM artworks a
      WHERE a.image_url IS NOT NULL AND a.image_url <> ''
        AND a.cover_image_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM artwork_images ai WHERE ai.artwork_id = a.id)`
  );

  await targetPool.query(
    `UPDATE artworks a
        LEFT JOIN artwork_images ai ON ai.id = a.cover_image_id
        SET a.cover_image_id = NULL
      WHERE a.cover_image_id IS NOT NULL AND ai.id IS NULL`
  );

  await targetPool.query(
    `UPDATE artworks a
        LEFT JOIN artwork_images first_image
               ON first_image.artwork_id = a.id
              AND first_image.sort_order = 0
        SET a.cover_image_id = first_image.id
      WHERE a.image_url IS NOT NULL AND a.image_url <> ''
        AND a.cover_image_id IS NULL`
  );
}

async function ensureSocialColumns(targetPool) {
  const addColumn = async (table, column, definition) => {
    const [columns] = await targetPool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    const names = new Set(columns.map((row) => row.COLUMN_NAME));
    if (!names.has(column)) {
      await targetPool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  await addColumn('likes', 'reaction_type', "VARCHAR(16) NOT NULL DEFAULT 'like'");
  await addColumn('artwork_shares', 'message', 'VARCHAR(500) DEFAULT NULL');
  await addColumn('notifications', 'comment_id', 'INT UNSIGNED DEFAULT NULL');
  await addColumn('notifications', 'share_id', 'INT UNSIGNED DEFAULT NULL');

  const ensureIndex = async (table, indexName, definition) => {
    const [indexes] = await targetPool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    const names = new Set(indexes.map((row) => row.INDEX_NAME));
    if (!names.has(indexName)) {
      await targetPool.query(`ALTER TABLE ${table} ADD INDEX ${indexName} ${definition}`);
    }
  };

  await ensureIndex('notifications', 'idx_notifications_comment', '(comment_id)');
  await ensureIndex('notifications', 'idx_notifications_share', '(share_id)');
  await ensureIndex('artwork_shares', 'idx_artwork_shares_feed', '(platform, created_at)');

  // Backfill legacy rows written before reactions existed.
  await targetPool.query("UPDATE likes SET reaction_type = 'like' WHERE reaction_type IS NULL OR reaction_type = ''");
}

async function initializeSchema(targetPool) {
  for (const statement of schemaStatements) {
    await targetPool.query(statement);
  }
  await ensureUserProfileColumns(targetPool);
  await ensureCommentColumns(targetPool);
  await ensureArtworkImageColumns(targetPool);
  await ensureSocialColumns(targetPool);
}

async function initPool() {
  if (!initPromise) {
    initPromise = (async () => {
      if (dbConfig.database === 'defaultdb') {
        throw new Error('Refusing to use "defaultdb". Set AIVEN_MYSQL_DATABASE=draw_web_db in your environment (including Vercel).');
      }

      pool = mysql.createPool(dbConfig);
      attachPoolErrorHandlers(pool);

      if (!SKIP_SCHEMA_INIT) {
        const schemaTask = initializeSchema(pool).catch((error) => {
          console.error('MySQL schema initialization failed:', error && (error.code || error.message));
        });
        if (!IS_SERVERLESS) await schemaTask;
      }

      return pool;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

const isRetryableDatabaseError = (error) => Boolean(error && RETRYABLE_CODES.has(error.code));

async function runQuery(targetPool, sql, params) {
  const [results] = await targetPool.execute(sql, params);
  return results;
}

async function execute(sql, params = []) {
  const targetPool = await initPool();
  try {
    return await runQuery(targetPool, sql, params);
  } catch (error) {
    if (READ_QUERY.test(sql) && isRetryableDatabaseError(error)) {
      return runQuery(targetPool, sql, params);
    }
    throw error;
  }
}

function prepare(sql) {
  return {
    all: async (...args) => {
      const p = args[0] || [];
      return execute(sql, typeof p === 'object' ? p : [p]);
    },
    get: async (...args) => {
      const p = args[0] || [];
      const rows = await execute(sql, typeof p === 'object' ? p : [p]);
      return rows.length > 0 ? rows[0] : null;
    },
    run: async (...args) => {
      const p = args.length > 1 ? args[1] : args[0] || [];
      return execute(sql, typeof p === 'object' ? p : [p]);
    }
  };
}

function pragma(...args) {
  return [];
}

function exec(sql) {
  return execute(sql);
}

// Initialize pool on module load
initPool().then(() => {
  console.log('MySQL pool initialized');
}).catch((err) => {
  console.error('Failed to initialize MySQL pool:', err.message);
});

// Export with both async and direct query methods
const db = {
  ...prepare('SELECT 1'),
  prepare,
  pragma,
  exec,
  execute,
  end: async () => {
    if (pool) {
      await pool.end();
    }
  }
};

module.exports = { dbConfig, db, initPool, getPool: initPool, schemaStatements };
