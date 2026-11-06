require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const { dbConfig, db, initPool } = require('../src/db/init');

(async () => {
  await initPool();

  const conn = await mysql.createConnection(dbConfig);
  const [[info]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
  console.log('NEW_DB:', info.db);
  console.log('ENGINE:', `MySQL ${info.version}`);

  const [tables] = await conn.query('SHOW TABLES');
  console.log('NEW_DB_TABLES:', tables.map((row) => Object.values(row)[0]).join(', '));

  const [fks] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [info.db]
  );
  console.log('FOREIGN_KEYS_COUNT:', fks.length);
  for (const fk of fks) {
    console.log(`FK ${fk.TABLE_NAME}.${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
  }

  await conn.beginTransaction();
  try {
    const [u1] = await conn.execute("INSERT INTO users (name, username, email, password, role) VALUES ('Test One', 'fk_test_1', 'fk_test_1@example.com', 'x', 'artist')");
    const [u2] = await conn.execute("INSERT INTO users (name, username, email, password) VALUES ('Test Two', 'fk_test_2', 'fk_test_2@example.com', 'x')");
    const [cat] = await conn.execute("INSERT INTO categories (name, slug) VALUES ('FK Test', 'fk-test')");
    const [art] = await conn.execute("INSERT INTO artworks (user_id, category_id, title, image_url) VALUES (?, ?, ?, ?)", [u1.insertId, cat.insertId, 'FK Test Art', 'https://example.com/a.jpg']);

    await conn.execute('INSERT INTO likes (user_id, artwork_id) VALUES (?, ?)', [u2.insertId, art.insertId]);
    let duplicateLikeBlocked = false;
    try {
      await conn.execute('INSERT INTO likes (user_id, artwork_id) VALUES (?, ?)', [u2.insertId, art.insertId]);
    } catch (e) {
      duplicateLikeBlocked = e.code === 'ER_DUP_ENTRY';
    }
    await conn.execute('INSERT INTO bookmarks (user_id, artwork_id) VALUES (?, ?)', [u2.insertId, art.insertId]);
    await conn.execute('INSERT INTO comments (user_id, artwork_id, body) VALUES (?, ?, ?)', [u2.insertId, art.insertId, 'Nice']);
    await conn.execute('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [u2.insertId, u1.insertId]);

    let selfFollowBlocked = false;
    try {
      await conn.execute('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [u1.insertId, u1.insertId]);
    } catch (e) {
      selfFollowBlocked = e.code === 'ER_CHECK_CONSTRAINT_VIOLATED';
    }

    await conn.execute('INSERT INTO notifications (user_id, actor_id, type, artwork_id, message) VALUES (?, ?, ?, ?, ?)', [u1.insertId, u2.insertId, 'like', art.insertId, 'Test Two liked your artwork']);
    await conn.execute("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [u1.insertId, 'hash_test_123']);

    const [[counts]] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM likes WHERE artwork_id = ?) AS likes,
         (SELECT COUNT(*) FROM bookmarks WHERE artwork_id = ?) AS bookmarks,
         (SELECT COUNT(*) FROM comments WHERE artwork_id = ?) AS comments,
         (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS follows,
         (SELECT COUNT(*) FROM notifications WHERE user_id = ?) AS notifications,
         (SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?) AS reset_tokens`,
      [art.insertId, art.insertId, art.insertId, u2.insertId, u1.insertId, u1.insertId]
    );
    console.log('RELATION_TEST_COUNTS:', JSON.stringify(counts));
    console.log('DUPLICATE_LIKE_BLOCKED:', duplicateLikeBlocked);
    console.log('SELF_FOLLOW_BLOCKED:', selfFollowBlocked);
    await conn.rollback();
    console.log('TRANSACTION_ROLLED_BACK: true');
  } catch (e) {
    await conn.rollback();
    console.log('RELATION_TEST_ERROR:', e.code || '', e.message);
  }

  const legacy = await mysql.createConnection({ ...dbConfig, database: 'defaultdb' });
  const [legacyTables] = await legacy.query('SHOW TABLES');
  const [legacyUsers] = await legacy.query('SELECT COUNT(*) AS count FROM users');
  console.log('DEFAULTDB_TABLES_COUNT:', legacyTables.length);
  console.log('DEFAULTDB_USERS_COUNT:', legacyUsers[0].count);
  await legacy.end();

  await conn.end();
  await db.end();
})().catch((e) => {
  console.log('VERIFY_ERROR:', e.code || '', e.message);
  process.exit(1);
});
