#!/usr/bin/env node
// Builds the static site into dist/. Cloudflare Pages runs: node scripts/build.mjs   (output directory: dist)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkBranch } from './schema.mjs';

const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
const access = JSON.parse(fs.readFileSync('data/access.json', 'utf8'));
const errs = [], ids = new Set();
const tree = meta.files.map(f => {
  const r = JSON.parse(fs.readFileSync(path.join('data/branches', f), 'utf8'));
  checkBranch(r, f, errs, ids, id => fs.existsSync(`data/photos/${id}.jpg`));
  return { ...r, c: 'root' };
});
if (errs.length) { console.error('Data problems:\n' + errs.join('\n')); process.exit(1); }

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/photos', { recursive: true });
// What anonymous visitors get: the same tree without phone numbers, addresses and blood groups.
const strip = ({ tel, addr, bg, ...r }) => ({ ...r, kids: (r.kids || []).map(strip) });
const STATIC = process.env.STATIC_PAGES === '1';
if (STATIC) {
  // GitHub-only hosting: the published data.json NEVER contains contact details.
  // They go into contact.enc.json, encrypted with DATA_KEY (a GitHub Actions secret).
  const keyB64 = process.env.DATA_KEY || '';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) { console.error('DATA_KEY must be a base64 string of 32 bytes. Refusing to build.'); process.exit(1); }
  const contacts = {};
  const collect = r => { const c = {}; for (const f of ['tel', 'addr', 'bg']) if (r[f] !== undefined && r[f] !== '' && !(Array.isArray(r[f]) && !r[f].some(Boolean))) c[f] = r[f]; if (Object.keys(c).length) contacts[r.id] = c; (r.kids || []).forEach(collect); };
  tree.forEach(collect);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(contacts), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  fs.writeFileSync('dist/contact.enc.json', JSON.stringify({ v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') }));
  fs.writeFileSync('dist/data.json', JSON.stringify({ files: meta.files, tree: tree.map(strip) }));
  // Safety net: fail the build rather than publish a readable contact field.
  const leak = /"(tel|addr|bg)"\s*:/.test(fs.readFileSync('dist/data.json', 'utf8'));
  if (leak) { console.error('Contact fields found in public data.json. Refusing to build.'); process.exit(1); }
} else {
  fs.writeFileSync('dist/data.json', JSON.stringify({ files: meta.files, tree }));
  fs.writeFileSync('dist/data.public.json', JSON.stringify({ files: meta.files, tree: tree.map(strip) }));
}
const uploads = access.uploads === 'family' ? 'family' : 'admin';
fs.writeFileSync('dist/access.json', JSON.stringify({ repo: access.repo, admin: access.admin, uploads, users: access.users }));
const pagesBase = process.env.PAGES_BASE || '';
function copyHtml(src, fallback, dest) {
  // Older repository snapshots kept the HTML files at the project root. Prefer
  // the site/ source when present, but fall back to the root files so builds work.
  const source = fs.existsSync(src) ? src : fallback;
  if (!fs.existsSync(source)) throw new Error(`Missing HTML source: ${src} (fallback: ${fallback})`);
  let html = fs.readFileSync(source, 'utf8');
  if (pagesBase && !html.includes('<base ')) {
    html = html.replace('<head>', `<head><base href="${pagesBase}">`);
  }
  fs.writeFileSync(dest, html);
}
copyHtml('site/index.html', 'index.html', 'dist/index.html');
copyHtml('site/login.html', 'login.html', 'dist/login.html');
for (const f of ['pages-auth.js', 'auth-public.json']) {
  const s = fs.existsSync(`site/${f}`) ? `site/${f}` : f;   // site/ first, project root as fallback
  if (!fs.existsSync(s)) { console.error(`Missing ${f}`); process.exit(1); }
  fs.copyFileSync(s, `dist/${f}`);
}

// Run the login Function on every request, including static files and photos.
fs.writeFileSync('dist/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
for (const f of fs.readdirSync('data/photos')) if (f.endsWith('.jpg')) fs.copyFileSync(path.join('data/photos', f), path.join('dist/photos', f));
fs.writeFileSync('dist/_headers', '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n/data.json\n  Cache-Control: no-store\n/data.public.json\n  Cache-Control: no-store\n/access.json\n  Cache-Control: no-store\n');
console.log(`Built ${tree.length} branches, ${ids.size} people.`);
