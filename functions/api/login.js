// POST {username, password}. There is deliberately NO sign-up route: accounts exist only if the admin put them in AUTH_USERS.
import { findUser, checkPassword, makeSession, cookie, json, secretOk } from '../../lib/auth.js';
import { isAdminUser } from '../../lib/access.js';

const TTL = 7 * 24 * 3600, MAX_FAILS = 5, WINDOW = 900;

async function handlePost({ request, env }) {
  if (!secretOk(env)) return json({ error: 'Server not configured.' }, 500);
  let body; try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const username = String(body.username || '').trim().toLowerCase().slice(0, 64), password = String(body.password || '').slice(0, 200);
  if (!username || !password) return json({ error: 'Enter your username and password.' }, 400);

  // Optional lock-out (needs a KV namespace bound as LOGIN_KV): 5 wrong tries per username+IP in 15 minutes.
  const ip = request.headers.get('CF-Connecting-IP') || 'local', key = `fail:${username}:${ip}`;
  const kv = env.LOGIN_KV;
  if (kv) { const n = parseInt(await kv.get(key) || '0', 10); if (n >= MAX_FAILS) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429); }

  const user = findUser(env, username);
  const ok = await checkPassword(user, password);
  if (!ok) {
    if (kv) { const n = parseInt(await kv.get(key) || '0', 10); await kv.put(key, String(n + 1), { expirationTtl: WINDOW }); }
    return json({ error: 'Wrong username or password.' }, 401);
  }
  if (kv) await kv.delete(key);
  const token = await makeSession(env, user.u, TTL);
  let connectDrive = false;
  if (await isAdminUser({ request, env }, user) && env.FAMILY_DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    try {
      const connected = await env.FAMILY_DB.prepare('SELECT id FROM google_drive_settings WHERE id=1').first();
      connectDrive = !connected;
    } catch { /* Keep sign-in available if the Drive migration is not ready. */ }
  }
  return json({ ok: true, connectDrive }, 200, { 'Set-Cookie': cookie(token, TTL, new URL(request.url).protocol === 'https:') });
}
export async function onRequest(ctx) {
  if (ctx.request.method === 'POST') return handlePost(ctx);
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
