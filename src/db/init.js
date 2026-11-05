const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.AIVEN_MYSQL_HOST,
  port: process.env.AIVEN_MYSQL_PORT || 3306,
  database: process.env.AIVEN_MYSQL_DATABASE,
  user: process.env.AIVEN_MYSQL_USER,
  password: process.env.AIVEN_MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;
let baseSql;

async function initPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
    // Ensure required tables exist
    await pool.execute(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) UNIQUE,
      email VARCHAR(191) UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      bio TEXT,
      avatar TEXT,
      cover_image TEXT,
      website TEXT,
      instagram TEXT,
      twitter TEXT,
      role TEXT,
      is_verified INTEGER,
      created_at TEXT
    )`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT,
      slug VARCHAR(191) UNIQUE,
      sort_order INTEGER
    )`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS artworks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INTEGER,
      category_id INTEGER,
      title TEXT,
      description TEXT,
      tags TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      visibility TEXT,
      is_published INTEGER,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`);
  }
  return pool;
}

// Execute SQL and return results (mimics better-sqlite3 .all() behavior)
async function execute(sql, params = []) {
  baseSql = sql;
  const p = pool || await initPool();
  const [results] = await p.execute(sql, params);
  return results;
}

// Prepare a statement (mimics better-sqlite3 .prepare())
function prepare(sql) {
  baseSql = sql;
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

module.exports = { dbConfig, db };