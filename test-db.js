const m = require('./src/db/init');
console.log('db:', typeof m.db);
console.log('prepare:', typeof m.db?.prepare);
console.log('all:', typeof m.db?.all);
const r = m.db.prepare('SELECT 1 AS test').all();
console.log('result:', r);