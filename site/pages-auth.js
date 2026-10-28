// Static sign-in for GitHub Pages (no server).
// Each user's password unwraps a data key (auth-public.json). That key decrypts
// contact.enc.json (phone, address, blood group). Guests never get readable contact data.
const FT_LOCAL_KEY = 'ft_local_user';
const FT_DATA_KEY = 'ft_local_key';
const ftEnc = new TextEncoder();

function ftFromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function ftToB64(u8) { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }

async function ftWrapKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', ftEnc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function ftLocalLogin(username, password) {
  const res = await fetch('auth-public.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('auth ' + res.status);
  const data = await res.json();
  const name = String(username || '').trim().toLowerCase();
  const user = (data.users || []).find(u => u && String(u.u).toLowerCase() === name);
  if (!user || !user.s || !user.iv || !user.k) return null;
  let raw;
  try {
    const wk = await ftWrapKey(password, ftFromB64(user.s), user.i || 600000);
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ftFromB64(user.iv) }, wk, ftFromB64(user.k)));
  } catch (e) { return null; }   // wrong password: the AES-GCM tag check fails
  const session = { user: user.u, name: user.name || user.u, github: user.github || '' };
  sessionStorage.setItem(FT_LOCAL_KEY, JSON.stringify(session));
  sessionStorage.setItem(FT_DATA_KEY, ftToB64(raw));
  return session;
}

function ftLocalSession() {
  try { const j = JSON.parse(sessionStorage.getItem(FT_LOCAL_KEY) || 'null'); return j && j.user ? j : null; } catch (e) { return null; }
}

function ftClearLocalSession() {
  sessionStorage.removeItem(FT_LOCAL_KEY);
  sessionStorage.removeItem(FT_DATA_KEY);
  sessionStorage.removeItem('ft_local_token');
}

// Decrypts contact.enc.json and merges tel/addr/bg into the tree (by person id). Returns true on success.
async function ftUnlockContacts(d) {
  const k = sessionStorage.getItem(FT_DATA_KEY);
  if (!k) return false;
  try {
    const res = await fetch('contact.enc.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const e = await res.json();
    const key = await crypto.subtle.importKey('raw', ftFromB64(k), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ftFromB64(e.iv) }, key, ftFromB64(e.ct));
    const map = JSON.parse(new TextDecoder().decode(plain));
    const walk = r => { const c = map[r.id]; if (c) Object.assign(r, c); (r.kids || []).forEach(walk); };
    d.tree.forEach(walk);
    return true;
  } catch (x) { return false; }
}
