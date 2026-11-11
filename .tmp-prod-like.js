const BASE = 'https://draw-khaki-iota.vercel.app';
const cookies = new Map();
let failures = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) failures += 1;
}

function captureCookies(res) {
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
  captureCookies(res);
  return res;
}

async function bodyOf(res) {
  const text = await res.text();
  return text;
}

(async () => {
  // 1. Public pages
  for (const page of ['/explore', '/art/106', '/art/108']) {
    const res = await hit(page);
    check(`GET ${page}`, res.status === 200, `status=${res.status}`);
  }

  // 2. Register temp user
  const unique = Date.now().toString(36);
  const username = `tmp_like_${unique}`.slice(0, 32);
  const reg = await hit('/register', {
    method: 'POST',
    body: new URLSearchParams({
      username,
      email: `${username}@example.com`,
      password: 'Password123!',
      display_name: 'Like QA'
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  check('register', reg.status === 302, `status=${reg.status}`);
  await new Promise((resolve) => setTimeout(resolve, 600));

  // 3. JSON reaction (as the explore/feed JS does)
  const jsonLike = await hit('/art/106/like', {
    method: 'POST',
    body: JSON.stringify({ reaction: 'love' }),
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json'
    }
  });
  const jsonText = await bodyOf(jsonLike);
  console.log('JSON like ->', jsonLike.status, jsonText.slice(0, 300));
  check('JSON like succeeds', jsonLike.status === 200, `status=${jsonLike.status}`);

  // 4. Plain form POST (as share-card / old cards do)
  const formLike = await hit('/art/106/like', {
    method: 'POST',
    body: new URLSearchParams({}),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  const formText = await bodyOf(formLike);
  const looksLikeErrorPage = formText.includes('មានបញ្ហាកើតឡើង') || formText.includes('Something went wrong');
  console.log('FORM like ->', formLike.status, 'location:', formLike.headers.get('location') || '(none)', 'errorPage:', looksLikeErrorPage);
  check('FORM like does not error', formLike.status !== 500 && !looksLikeErrorPage, `status=${formLike.status}`);

  console.log('\ntemp user:', username);
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error('Production test failed:', error);
  process.exit(1);
});
