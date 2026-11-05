const fs = require('fs');
const path = require('path');
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

function execute(sql, params = []) {
  return pool.execute(sql, params).then(([results]) => results);
}

function prepare(sql) {
  return {
    all: (...args) => execute(sql, args.length > 0 ? args[0] : []),
    get: (...args) => {
      const results = execute(sql, args.length > 0 ? args[0] : []);
      return results.length > 0 ? results[0] : null;
    },
    run: (...args) => {
      const [paramsArr] = args.length > 1 ? [args[1]] : [args[0]];
      return execute(sql, paramsArr);
    }
  };
}

module.exports = {
  execute,
  prepare,
  end: async () => {
    if (pool) {
      await pool.end();
    }
  }
};