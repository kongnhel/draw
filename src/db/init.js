require('dotenv').config({ quiet: true });
const fs = require('fs');
const mysql = require('mysql2/promise');

function buildSslConfig() {
  const mode = String(process.env.AIVEN_MYSQL_SSL || '').toLowerCase();
  if (mode !== 'required') return undefined;

  const caPath = process.env.AIVEN_MYSQL_SSL_CA_PATH;
  if (caPath && fs.existsSync(caPath)) {
    return { ca: fs.readFileSync(caPath), rejectUnauthorized: true };
  }
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
  connectionLimit: 10,
  queueLimit: 0,
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

  `CREATE TABLE IF NOT EXISTS comments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    artwork_id INT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_comments_artwork (artwork_id, created_at),
    KEY idx_comments_user (user_id),
    CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_artwork FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE CASCADE
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

async function ensureUserProfileColumns() {
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const existing = new Set(columns.map((row) => row.COLUMN_NAME));
  const additions = [
    ['cover_image', 'VARCHAR(500) DEFAULT NULL'],
    ['website', 'VARCHAR(255) DEFAULT NULL'],
    ['instagram', 'VARCHAR(100) DEFAULT NULL'],
    ['twitter', 'VARCHAR(100) DEFAULT NULL']
  ];

  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await pool.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function initPool() {
  if (!initPromise) {
    initPromise = (async () => {
      if (dbConfig.database === 'defaultdb') {
        throw new Error('Refusing to use "defaultdb". Set AIVEN_MYSQL_DATABASE=draw_web_db in your environment (including Vercel).');
      }
      pool = mysql.createPool(dbConfig);
      for (const statement of schemaStatements) {
        await pool.query(statement);
      }
      await ensureUserProfileColumns();
      return pool;
    })();
  }
  return initPromise;
}

// Execute SQL and return results (mimics better-sqlite3 .all() behavior)
async function execute(sql, params = []) {
  const p = await initPool();
  const [results] = await p.execute(sql, params);
  return results;
}

// Prepare a statement (mimics better-sqlite3 .prepare())
function prepare(sql) {
  return {
    all: async (...args) => {
      const p = args[0] || [];
      return execute(sql, typeof p === 'object' ? p : [p]);
    },
    get: async (...args) => {
      const p = args[0] || [];
      const [results] = await execute(sql, typeof p === 'object' ? p : [p]);
      return results.length > 0 ? results[0] : null;
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

module.exports = { dbConfig, db, initPool, schemaStatements };
