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
    all: (...args) => {
      const p = args[0] || [];
      return execute(sql, typeof p === 'object' ? p : [p]);
    },
    get: (...args) => {
      const p = args[0] || [];
      return execute(sql, typeof p === 'object' ? p : [p]).then(([results]) => results.length > 0 ? results[0] : null);
    },
    run: (...args) => {
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

// Initialize pool
initPool();

module.exports = {
  db: {
    ...prepare('SELECT 1'),
    prepare,
    pragma,
    exec,
    end: async () => {
      if (pool) {
        await pool.end();
      }
    }
  }
};