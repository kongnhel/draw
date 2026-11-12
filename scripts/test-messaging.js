require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const { dbConfig, db, initPool } = require('../src/db/init');

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures += 1;
};

(async () => {
  await initPool();

  const conn = await mysql.createConnection(dbConfig);
  const [[info]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
  console.log('MESSAGING_TEST_DB:', info.db, '| MySQL', info.version);

  await conn.beginTransaction();
  try {
    /* ---------- fixtures ---------- */
    const suffix = Date.now();
    const [uA] = await conn.execute(
      "INSERT INTO users (name, username, email, password, role) VALUES ('Msg Test A', ?, ?, 'x', 'artist')",
      [`msg_test_a_${suffix}`, `msg_test_a_${suffix}@example.com`]
    );
    const [uB] = await conn.execute(
      "INSERT INTO users (name, username, email, password, role) VALUES ('Msg Test B', ?, ?, 'x', 'artist')",
      [`msg_test_b_${suffix}`, `msg_test_b_${suffix}@example.com`]
    );
    const [uC] = await conn.execute(
      "INSERT INTO users (name, username, email, password, role) VALUES ('Msg Test C', ?, ?, 'x', 'artist')",
      [`msg_test_c_${suffix}`, `msg_test_c_${suffix}@example.com`]
    );
    const A = uA.insertId;
    const B = uB.insertId;
    const C = uC.insertId;

    const [cat] = await conn.execute("INSERT INTO categories (name, slug) VALUES (?, ?)", [`Msg Test Cat ${suffix}`, `msg-test-${suffix}`]);
    const [art] = await conn.execute(
      "INSERT INTO artworks (user_id, category_id, title, image_url, visibility, is_published, status) VALUES (?, ?, ?, ?, 'public', 1, 'active')",
      [A, cat.insertId, 'Msg Test Artwork', 'https://example.com/msg-test.jpg']
    );
    const artworkId = art.insertId;

    const [convResult] = await conn.execute('INSERT INTO conversations (id) VALUES (DEFAULT)');
    const conversationId = convResult.insertId;
    await conn.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
      [conversationId, A, conversationId, B]
    );

    /* ---------- messages ---------- */
    const insertMessage = async (sender, type, content, extra = {}, minutesAgo = 0) => {
      const [row] = await conn.execute(
        `INSERT INTO messages (conversation_id, sender_id, message_type, content, artwork_id, reply_to_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
        [conversationId, sender, type, content, extra.artworkId || null, extra.replyToId || null, minutesAgo]
      );
      if (extra.attachment) {
        await conn.execute(
          'INSERT INTO message_attachments (message_id, file_path, file_type) VALUES (?, ?, ?)',
          [row.insertId, extra.attachment, 'image']
        );
      }
      return row.insertId;
    };

    const m1 = await insertMessage(A, 'text', 'Hello there', {}, 5);
    const m2 = await insertMessage(B, 'text', 'Hi back', {}, 4);
    const m3 = await insertMessage(A, 'artwork', 'Check this out', { artworkId }, 3);
    const m4 = await insertMessage(A, 'image', 'Photo caption', { attachment: 'https://example.com/msg-test-photo.jpg' }, 2);
    const m5 = await insertMessage(B, 'text', 'Replying to you', { replyToId: m1 }, 1);
    check('messages inserted (5, artwork/image/reply types)', [m1, m2, m3, m4, m5].every(Number.isFinite) && m5 > m4);

    /* ---------- 1:1 conversation lookup (findOrCreateConversation shape) ---------- */
    const [pairRows] = await conn.execute(
      `SELECT c.id
         FROM conversations c
         JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
         JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
        WHERE (SELECT COUNT(*) FROM conversation_participants x WHERE x.conversation_id = c.id) = 2
        LIMIT 1`,
      [A, B]
    );
    check('pair lookup finds the conversation for A+B', pairRows.length === 1 && Number(pairRows[0].id) === conversationId);
    const [strangerRows] = await conn.execute(
      `SELECT c.id
         FROM conversations c
         JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
         JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
        WHERE (SELECT COUNT(*) FROM conversation_participants x WHERE x.conversation_id = c.id) = 2
        LIMIT 1`,
      [A, C]
    );
    check('pair lookup empty for A+C (non-participant isolation)', strangerRows.length === 0);

    /* ---------- duplicate participant guard ---------- */
    let duplicateParticipantBlocked = false;
    try {
      await conn.execute('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [conversationId, A]);
    } catch (e) {
      duplicateParticipantBlocked = e.code === 'ER_DUP_ENTRY';
    }
    check('duplicate participant blocked (uq_participants_conversation_user)', duplicateParticipantBlocked);

    /* ---------- MESSAGE_SELECT style fetch (post-fix placeholders) ---------- */
    const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.content, m.reply_to_id,
       m.edited_at, m.deleted_at, m.created_at,
       su.username AS sender_username, su.avatar AS sender_avatar,
       COALESCE(NULLIF(su.name, ''), su.username) AS sender_name,
       a.id AS artwork_id, a.title AS artwork_title,
       ma.id AS attachment_id, ma.file_path AS attachment_path, ma.file_type AS attachment_type,
       rm.id AS reply_id, rm.content AS reply_content, rm.message_type AS reply_type, rm.deleted_at AS reply_deleted_at,
       ru.username AS reply_username,
       COALESCE(NULLIF(ru.name, ''), ru.username) AS reply_name
  FROM messages m
  JOIN users su ON su.id = m.sender_id
  LEFT JOIN artworks a ON a.id = m.artwork_id
  LEFT JOIN message_attachments ma ON ma.message_id = m.id AND ma.file_type = 'image'
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = rm.sender_id`;
    const [replyRow] = await conn.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [m5]);
    check('reply join resolves original text', replyRow.length === 1 && replyRow[0].reply_content === 'Hello there' && replyRow[0].reply_id === m1);
    const [artworkRow] = await conn.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [m3]);
    check('artwork join resolves title', artworkRow.length === 1 && artworkRow[0].artwork_title === 'Msg Test Artwork');
    const [imageRow] = await conn.execute(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [m4]);
    check('attachment join resolves image path', imageRow.length === 1 && imageRow[0].attachment_path === 'https://example.com/msg-test-photo.jpg');

    /* ---------- unread counts (countUnreadMessagesByConversation shape) ---------- */
    const unreadQuery = `SELECT m.conversation_id, COUNT(*) AS unread
       FROM messages m
       JOIN conversation_participants cp
         ON cp.conversation_id = m.conversation_id AND cp.user_id = ? AND cp.is_deleted = 0
      WHERE m.sender_id <> ?
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(cp.last_read_at, '1971-01-01')
        AND m.created_at > COALESCE(cp.deleted_at, '1971-01-01')
        AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)
      GROUP BY m.conversation_id`;
    const unreadFor = async (userId) => {
      const rows = await conn.execute(unreadQuery, [userId, userId, userId]);
      const map = new Map();
      (rows[0] || []).forEach((row) => map.set(Number(row.conversation_id), Number(row.unread)));
      return map.get(conversationId) || 0;
    };
    check('unread for B = 3 (m1, m3, m4 from A)', (await unreadFor(B)) === 3);
    check('unread for A = 2 (m2, m5 from B)', (await unreadFor(A)) === 2);
    check('unread for C (outsider) = 0', (await unreadFor(C)) === 0);

    /* ---------- read receipts ---------- */
    await conn.execute(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, B]
    );
    check('unread for B = 0 after marking read', (await unreadFor(B)) === 0);

    /* ---------- per-user deletion ---------- */
    await conn.execute('INSERT INTO message_deletions (message_id, user_id) VALUES (?, ?)', [m1, B]);
    check('per-user deletion (m1 hidden for B) keeps A unread untouched', (await unreadFor(A)) === 2);
    let duplicateDeletionBlocked = false;
    try {
      await conn.execute('INSERT INTO message_deletions (message_id, user_id) VALUES (?, ?)', [m1, B]);
    } catch (e) {
      duplicateDeletionBlocked = e.code === 'ER_DUP_ENTRY';
    }
    check('duplicate per-user deletion blocked (uq_message_deletions_message_user)', duplicateDeletionBlocked);

    /* ---------- delete for everyone (tombstone) ---------- */
    await conn.execute('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [m5]);
    check('tombstoned message (m5) excluded from unread', (await unreadFor(A)) === 1);

    /* ---------- conversation list preview (CONVERSATION_LIST_SELECT shape) ---------- */
    const listQuery = `SELECT c.id,
        cp.last_read_at, cp.is_muted, cp.is_deleted,
        ou.id AS other_id, ou.username AS other_username,
        lm.id AS last_message_id, lm.sender_id AS last_sender_id, lm.message_type AS last_message_type,
        lm.content AS last_content, lm.deleted_at AS last_deleted_at, lm.created_at AS last_message_at,
        lma.id AS last_attachment_id, lma.file_path AS last_attachment_path,
        la.id AS last_artwork_id, la.title AS last_artwork_title,
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
   LEFT JOIN users lasu ON lasu.id = lm.sender_id
  WHERE cp.user_id = ? AND cp.is_deleted = 0`;
    const [listA] = await conn.execute(listQuery, [A, A]);
    check('list for A: 1 row, other = B', listA.length === 1 && Number(listA[0].other_id) === B);
    check('list for A: last visible message = m4 (image, m5 tombstoned, m1 not deleted for A)', Number(listA[0].last_message_id) === m4 && listA[0].last_attachment_path === 'https://example.com/msg-test-photo.jpg');

    await conn.execute('INSERT INTO message_deletions (message_id, user_id) VALUES (?, ?)', [m4, B]);
    const [listB] = await conn.execute(listQuery, [B, B]);
    check('list for B: last visible = m3 artwork (m1+m4 hidden for B, m5 tombstoned)', Number(listB[0].last_message_id) === m3 && listB[0].last_artwork_title === 'Msg Test Artwork');

    /* ---------- per-user conversation delete + restore on new message ---------- */
    await conn.execute(
      'UPDATE conversation_participants SET is_deleted = 1, deleted_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, A]
    );
    const [listAfterDelete] = await conn.execute(listQuery, [A, A]);
    check('conversation hidden from inbox after per-user delete', listAfterDelete.length === 0);
    check('unread for A = 0 while conversation deleted', (await unreadFor(A)) === 0);
    await conn.execute(
      'UPDATE conversation_participants SET is_deleted = 0, deleted_at = NULL, updated_at = NOW() WHERE conversation_id = ?',
      [conversationId]
    );
    const [listAfterRestore] = await conn.execute(listQuery, [A, A]);
    check('incoming message restores conversation (persistMessage reset)', listAfterRestore.length === 1);

    /* ---------- mute toggle ---------- */
    await conn.execute(
      'UPDATE conversation_participants SET is_muted = IF(is_muted = 1, 0, 1) WHERE conversation_id = ? AND user_id = ?',
      [conversationId, A]
    );
    const [[mutedRow]] = await conn.execute(
      'SELECT is_muted FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, A]
    );
    check('mute toggle flips is_muted', Number(mutedRow.is_muted) === 1);

    /* ---------- blocks ---------- */
    let selfBlockBlocked = false;
    try {
      await conn.execute('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', [A, A]);
    } catch (e) {
      selfBlockBlocked = e.code === 'ER_CHECK_CONSTRAINT_VIOLATED';
    }
    check('self-block blocked (chk_blocks_not_self)', selfBlockBlocked);

    await conn.execute('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', [B, A]);
    const blockStateQuery = `SELECT blocker_id, blocked_id FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 2`;
    const [blockRows] = await conn.execute(blockStateQuery, [A, B, B, A]);
    let iBlocked = false;
    let blockedMe = false;
    blockRows.forEach((row) => {
      if (Number(row.blocker_id) === A) iBlocked = true;
      else blockedMe = true;
    });
    check('block state: A sees blockedMe=true, iBlocked=false', !iBlocked && blockedMe);

    /* ---------- message notification dedupe shape ---------- */
    await conn.execute(
      "INSERT INTO notifications (user_id, actor_id, type, conversation_id, message) VALUES (?, ?, 'message', ?, 'sent you a private message')",
      [B, A, conversationId]
    );
    const [[existingNotif]] = await conn.execute(
      `SELECT id FROM notifications
        WHERE user_id = ? AND actor_id = ? AND type = 'message' AND conversation_id = ? AND is_read = 0
        LIMIT 1`,
      [B, A, conversationId]
    );
    check('message notification created with conversation link', Boolean(existingNotif && existingNotif.id));
    await conn.execute('UPDATE notifications SET created_at = NOW() WHERE id = ?', [existingNotif.id]);
    const [[notifCount]] = await conn.execute(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND type = 'message' AND conversation_id = ?",
      [B, conversationId]
    );
    check('upsert keeps a single unread notification (bump not stack)', Number(notifCount.count) === 1);

    /* ---------- reports ---------- */
    await conn.execute('INSERT INTO message_reports (message_id, reporter_id, reason) VALUES (?, ?, ?)', [m2, B, 'test reason']);
    const [[reportCount]] = await conn.execute('SELECT COUNT(*) AS count FROM message_reports WHERE message_id = ?', [m2]);
    check('message report persisted', Number(reportCount.count) === 1);

    /* ---------- artwork shareable rule ---------- */
    const shareableQuery = `SELECT id, user_id, visibility, is_published, status FROM artworks WHERE id = ? LIMIT 1`;
    const [[artworkState]] = await conn.execute(shareableQuery, [artworkId]);
    const shareable = artworkState
      && (artworkState.visibility === 'public' && Number(artworkState.is_published) === 1 && artworkState.status === 'active');
    check('public published artwork is shareable', Boolean(shareable));
    await conn.execute("UPDATE artworks SET visibility = 'private' WHERE id = ?", [artworkId]);
    const [[privateState]] = await conn.execute(shareableQuery, [artworkId]);
    const privateShareable = Number(privateState.user_id) === A;
    check('private artwork only shareable by owner', privateShareable === true);

    await conn.rollback();
    console.log('TRANSACTION_ROLLED_BACK: true');
  } catch (e) {
    await conn.rollback();
    console.log('MESSAGING_TEST_ERROR:', e.code || '', e.message);
    failures += 1;
  }

  const [[leftover]] = await conn.execute("SELECT COUNT(*) AS count FROM users WHERE username LIKE 'msg_test_%'");
  check('test data rolled back (no leftover users)', Number(leftover.count) === 0);

  await conn.end();
  await db.end();

  console.log(failures === 0 ? 'MESSAGING_TESTS: ALL PASSED' : `MESSAGING_TESTS: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.log('VERIFY_ERROR:', e.code || '', e.message);
  process.exit(1);
});
