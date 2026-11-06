require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const DB_NAME = process.env.AIVEN_MYSQL_NEW_DATABASE || 'draw_web_db';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.AIVEN_MYSQL_HOST,
    port: Number(process.env.AIVEN_MYSQL_PORT || 3306),
    database: process.env.AIVEN_MYSQL_DATABASE,
    user: process.env.AIVEN_MYSQL_USER,
    password: process.env.AIVEN_MYSQL_PASSWORD
  });

  const [grants] = await conn.query('SHOW GRANTS');
  console.log('CURRENT_DATABASE:', process.env.AIVEN_MYSQL_DATABASE);
  console.log('GRANTS:', JSON.stringify(grants));

  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('CREATE_DATABASE_OK:', DB_NAME);
  } catch (e) {
    console.log('CREATE_DATABASE_ERROR:', e.code || '', e.message);
  }

  try {
    const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [DB_NAME]);
    console.log('VERIFY_DATABASE:', JSON.stringify(dbs));
  } catch (e) {
    console.log('VERIFY_ERROR:', e.code || '', e.message);
  }

  await conn.end();
})().catch((e) => {
  console.log('CONNECT_ERROR:', e.code || '', e.message);
  process.exit(1);
});
