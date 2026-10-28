#!/usr/bin/env node
// Admin tool. Creates login accounts. There is no sign-up on the website — this is the only way to make one.
//   node scripts/make-user.mjs add alice [--github alice-gh] [--name "Alice K"] [--password '...']
//   node scripts/make-user.mjs passwd alice        (new password for an existing user)
//   node scripts/make-user.mjs remove alice
//   node scripts/make-user.mjs list
//   node scripts/make-user.mjs print               (the AUTH_USERS value to paste into Cloudflare)
// Only salted hashes are stored (in .auth/users.json, which is git-ignored). Passwords are shown once.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashPassword } from '../lib/auth.js';

const FILE = '.auth/users.json';
const [cmd, who, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : undefined; };
const load = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
const save = (a) => { fs.mkdirSync('.auth', { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 }); };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const gen = (n = 16) => Array.from({ length: n }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
const norm = (u) => String(u || '').trim().toLowerCase();
const bad = (m) => { console.error('✗ ' + m); process.exit(1); };
const show = (u, pw) => console.log(`\n  Username : ${u}\n  Password : ${pw}\n\n  (shown once — give it to the person, then run:  node scripts/make-user.mjs print\n   and paste the output into Cloudflare → AUTH_USERS)\n`);

const users = load();
if (cmd === 'add' || cmd === 'passwd') {
  const u = norm(who); if (!/^[a-z0-9._-]{3,32}$/.test(u)) bad('username: 3-32 characters, letters/digits . _ - only');
  const exists = users.findIndex(x => x.u === u);
  if (cmd === 'add' && exists >= 0) bad('that user already exists (use passwd to change the password)');
  if (cmd === 'passwd' && exists < 0) bad('no such user');
  const pw = opt('password') || gen(16);
  if (pw.length < 12) bad('password must be at least 12 characters');
  const prev = exists >= 0 ? users[exists] : {};
  const entry = { u, ...(await hashPassword(pw)), ...(opt('name') || prev.name ? { name: opt('name') || prev.name } : {}), ...(opt('github') || prev.github ? { github: opt('github') || prev.github } : {}) };
  if (exists >= 0) users[exists] = entry; else users.push(entry);
  save(users); show(u, pw);
} else if (cmd === 'remove') {
  const u = norm(who), n = users.filter(x => x.u !== u); if (n.length === users.length) bad('no such user');
  save(n); console.log(`Removed ${u}. Run "print" and update AUTH_USERS — they are logged out as soon as it is saved.`);
} else if (cmd === 'list') {
  users.forEach(x => console.log(`${x.u}${x.github ? '  (github: ' + x.github + ')' : ''}`)); if (!users.length) console.log('(no users yet)');
} else if (cmd === 'print') {
  process.stdout.write(JSON.stringify(users) + '\n');
} else bad('usage: make-user.mjs add|passwd|remove|list|print <username> [--github x] [--name "..."] [--password ...]');
