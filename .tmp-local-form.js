const BASE = 'http://localhost:3100';
const cookies = new Map();
function capture(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function hit(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookies.size) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(BASE + pathname, { redirect: 'manual', ...options, headers });
  capture(res);
  return res;
}
(async () => {
  const unique = Date.now().toString(36);
  const username = `tmp_like_${unique}`.slice(0, 32);
  const reg = await hit('/register', {
    method: 'POST',
    body: new URLSearchParams({ username, email: `${username}@example.com`, password: 'Password123!', display_name: 'Like QA' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  console.log('register:', reg.status, 'username:', username);
  await new Promise((r) => setTimeout(r, 400));

  const jsonLike = await hit('/art/106/like', {
    method: 'POST',
    body: JSON.stringify({ reaction: 'love' }),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
  });
  console.log('json like:', jsonLike.status, (await jsonLike.text()).slice(0, 160));

  const formLike = await hit('/art/106/like', {
    method: 'POST',
    body: new URLSearchParams({}),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  const formText = await formLike.text();
  console.log('form like:', formLike.status, 'errorPage:', formText.includes('មានបញ្ហាកើតឡើង'), 'location:', formLike.headers.get('location'));
  console.log('user for cleanup:', username);
})();
