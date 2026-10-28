#!/usr/bin/env node
// Admin tool for the GitHub-only site. There is no sign-up on the website: accounts exist only because you run this.
//   node scripts/make-user.mjs add alice [--name "Alice K"] [--github alice-gh] [--password '...']
//   node scripts/make-user.mjs passwd alice
//   node scripts/make-user.mjs remove alice     (then run "rotate" so they lose access to data they already unlocked)
//   node scripts/make-user.mjs rotate           (new data key + NEW passwords for everyone who remains)
//   node scripts/make-user.mjs list
//   node scripts/make-user.mjs key              (prints the DATA_KEY value for the GitHub Actions secret)
// Passwords are never stored. Each user's entry in site/auth-public.json holds the data key encrypted under their password.
// The data key itself lives in .auth/datakey on your computer (git-ignored) and in the GitHub secret DATA_KEY.
import fs from 'node:fs';
import crypto from 'node:crypto';

const KEYFILE = '.auth/datakey';
const AUTHFILE = fs.existsSync('site') ? 'site/auth-public.json' : 'auth-public.json';
const ITER = 600000;
const [cmd, who, ...rest] = process.argv.slice(2);
const opt = k => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : undefined; };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const gen = (n = 16) => Array.from({ length: n }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
const norm = u => String(u || '').trim().toLowerCase();
const bad = m => { console.error('✗ ' + m); process.exit(1); };

let all = fs.existsSync(AUTHFILE) ? (JSON.parse(fs.readFileSync(AUTHFILE, 'utf8')).users || []) : [];
const legacy = all.filter(x => !x.k);
if (legacy.length) console.warn(`! Ignoring ${legacy.length} old-style login(s) (${legacy.map(x => x.u).join(', ')}): they cannot unlock contact data. Add them again with "add".`);
let users = all.filter(x => x.k);
const saveUsers = () => fs.writeFileSync(AUTHFILE, JSON.stringify({ v: 2, users }, null, 2) + '\n');

function loadKey(create) {
  if (fs.existsSync(KEYFILE)) return Buffer.from(fs.readFileSync(KEYFILE, 'utf8').trim(), 'base64');
  if (!create) bad('No data key found at .auth/datakey. Run this on the computer where you created the first user.');
  if (users.length) bad('Users exist but .auth/datakey is missing. Without it new logins cannot be created. Run "rotate" only if you still have the key; otherwise start over by deleting site/auth-public.json.');
  const k = crypto.randomBytes(32);
  fs.mkdirSync('.auth', { recursive: true });
  fs.writeFileSync(KEYFILE, k.toString('base64') + '\n', { mode: 0o600 });
  console.log('Created a new data key in .auth/datakey. Run "key" and save it as the GitHub secret DATA_KEY.');
  return k;
}
function wrap(dataKey, password) {
  const s = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const wk = crypto.pbkdf2Sync(password, s, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', wk, iv);
  const ct = Buffer.concat([c.update(dataKey), c.final(), c.getAuthTag()]);
  return { s: s.toString('base64'), i: ITER, iv: iv.toString('base64'), k: ct.toString('base64') };
}
const show = (u, pw) => console.log(`\n  Username : ${u}\n  Password : ${pw}\n`);

if (cmd === 'add' || cmd === 'passwd') {
  const u = norm(who); if (!/^[a-z0-9._-]{3,32}$/.test(u)) bad('username: 3-32 characters, letters/digits . _ - only');
  const at = users.findIndex(x => x.u === u);
  if (cmd === 'add' && at >= 0) bad('that user already exists (use passwd to change the password)');
  if (cmd === 'passwd' && at < 0) bad('no such user');
  const pw = opt('password') || gen(16);
  if (pw.length < 12) bad('password must be at least 12 characters');
  const prev = at >= 0 ? users[at] : {};
  const name = opt('name') || prev.name, github = opt('github') || prev.github;
  const entry = { u, ...(name ? { name } : {}), ...(github ? { github } : {}), ...wrap(loadKey(true), pw) };
  if (at >= 0) users[at] = entry; else users.push(entry);
  saveUsers(); show(u, pw);
  console.log(`Saved to ${AUTHFILE}. Commit that file to publish the change.`);
} else if (cmd === 'remove') {
  const u = norm(who), n = users.filter(x => x.u !== u); if (n.length === users.length) bad('no such user');
  users = n; saveUsers();
  console.log(`Removed ${u}. They can no longer sign in, but they still know the data key's contents. To lock them out of future updates, run "rotate".`);
} else if (cmd === 'rotate') {
  loadKey(false);
  const k = crypto.randomBytes(32);
  const out = users.map(x => { const pw = gen(16); return [x, pw, wrap(k, pw)]; });
  users = out.map(([x, , w]) => ({ u: x.u, ...(x.name ? { name: x.name } : {}), ...(x.github ? { github: x.github } : {}), ...w }));
  fs.writeFileSync(KEYFILE, k.toString('base64') + '\n', { mode: 0o600 });
  saveUsers();
  out.forEach(([x, pw]) => show(x.u, pw));
  console.log(`New data key saved. Next: 1) run "key" and update the GitHub secret DATA_KEY, 2) commit ${AUTHFILE}, 3) give everyone their new password.`);
} else if (cmd === 'list') {
  users.forEach(x => console.log(`${x.u}${x.github ? '  (github: ' + x.github + ')' : ''}`)); if (!users.length) console.log('(no users yet)');
} else if (cmd === 'key') {
  process.stdout.write(loadKey(false).toString('base64') + '\n');
} else bad('usage: make-user.mjs add|passwd|remove|rotate|list|key <username> [--github x] [--name "..."] [--password ...]');
