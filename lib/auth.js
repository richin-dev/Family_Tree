// Shared by the Cloudflare Pages Functions, the user-creation script and the local dev server.
// Web-standard APIs only (crypto.subtle, TextEncoder), so it runs in Workers and Node 18+.
export const ITER = 100000;                 // Cloudflare Workers allows at most 100,000 PBKDF2 iterations
const enc = new TextEncoder();

export const toB64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
export const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const b64u = (buf) =>
  toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromB64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return fromB64(s);
};

export async function pbkdf2(password, salt, iterations = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { s: toB64(salt), i: ITER, h: toB64(await pbkdf2(password, salt, ITER)) };
}
const DUMMY = { s: toB64(new Uint8Array(16)), i: ITER, h: toB64(new Uint8Array(32)) };
// Always does the same amount of work, whether or not the user exists (no username guessing by timing).
export async function checkPassword(entry, password) {
  const e = entry || DUMMY;
  const got = await pbkdf2(password, fromB64(e.s), e.i || ITER);
  return !!entry && safeEqual(got, fromB64(e.h));
}

export function users(env) {
  try { const a = JSON.parse(env.AUTH_USERS || '[]'); return Array.isArray(a) ? a.filter(u => u && typeof u.u === 'string') : []; } catch { return []; }
}
export const findUser = (env, name) => { const n = String(name || '').trim().toLowerCase(); return users(env).find(u => u.u.toLowerCase() === n) || null; };
export const secretOk = (env) => typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32;

const hmacKey = (env, usage) => crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
export async function makeSession(env, username, ttlSeconds) {
  const payload = b64u(enc.encode(JSON.stringify({ u: username, e: Math.floor(Date.now() / 1000) + ttlSeconds, v: String(env.SESSION_EPOCH || '0') })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env, ['sign']), enc.encode(payload));
  return payload + '.' + b64u(sig);
}
// Returns the user entry if the cookie is genuine, unexpired, from the current epoch AND the user still exists.
export async function readSession(env, cookieHeader) {
  const m = /(?:^|;\s*)ft_session=([^;]+)/.exec(cookieHeader || '');
  if (!m || !secretOk(env)) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env, ['verify']), fromB64u(sig), enc.encode(payload));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(payload)));
    if (!p || p.e < Date.now() / 1000 || String(p.v) !== String(env.SESSION_EPOCH || '0')) return null;
    return findUser(env, p.u);          // removing a user from AUTH_USERS logs them out immediately
  } catch { return null; }
}
export const cookie = (value, maxAge, secure) => `ft_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
