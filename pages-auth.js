// Static sign-in for GitHub Pages, which cannot run /api/login.
// The password is checked in the browser against the hash in auth-public.json.
const FT_LOCAL_KEY = 'ft_local_user';
const ftEnc = new TextEncoder();

function ftFromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function ftSafeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
async function ftPbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', ftEnc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function ftLocalLogin(username, password) {
  const res = await fetch('auth-public.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('auth ' + res.status);
  const data = await res.json();
  const name = String(username || '').trim().toLowerCase();
  const user = (data.users || []).find(u => u && String(u.u).toLowerCase() === name);
  if (!user || !user.s || !user.h) return null;
  const got = await ftPbkdf2(password, ftFromB64(user.s), user.i || 100000);
  if (!ftSafeEqual(got, ftFromB64(user.h))) return null;
  const session = { user: user.u, name: user.name || user.u, github: user.github || '' };
  sessionStorage.setItem(FT_LOCAL_KEY, JSON.stringify(session));
  return session;
}

function ftLocalSession() {
  try { const j = JSON.parse(sessionStorage.getItem(FT_LOCAL_KEY) || 'null'); return j && j.user ? j : null; } catch (e) { return null; }
}

function ftClearLocalSession() { sessionStorage.removeItem(FT_LOCAL_KEY); }
