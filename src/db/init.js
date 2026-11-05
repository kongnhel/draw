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

async function initPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

// Execute SQL and return results (mimics better-sqlite3 .all() behavior)
async function execute(sql, params = []) {
  const p = pool || await initPool();
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

// Add sync methods that wait for promises (for compatibility with existing server.js)
prepare.prototype.allSync = async function(...args) {
  const p = args[0] || [];
  const results = await execute(sql, typeof p === 'object' ? p : [p]);
  return results;
};

prepare.prototype.getSync = async function(...args) {
  const p = args[0] || [];
  const [results] = await execute(sql, typeof p === 'object' ? p : [p]);
  return results.length > 0 ? results[0] : null;
};

prepare.prototype.runSync = async function(...args) {
  const p = args.length > 1 ? args[1] : args[0] || [];
  return await execute(sql, typeof p === 'object' ? p : [p]);
};

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

// Export with both async and sync methods
const db = {
  ...prepare('SELECT 1'),
  prepare,
  pragma,
  exec,
  end: async () => {
    if (pool) {
      await pool.end();
    }
  }
};

// Add sync wrappers to db object
db.allSync = async () => {
  const [results] = await execute('SELECT 1');
  return results;
};
db.getSync = async () => {
  const [results] = await execute('SELECT 1');
  return results.length > 0 ? results[0] : null;
};
db.runSync = async () => {
  return await execute('SELECT 1');
};

module.exports = { db };