#!/usr/bin/env node
// Builds the static site into dist/. Cloudflare Pages runs: node scripts/build.mjs   (output directory: dist)
import fs from 'node:fs';
import path from 'node:path';
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
fs.writeFileSync('dist/data.json', JSON.stringify({ files: meta.files, tree }));
// What anonymous visitors get: the same tree without phone numbers, addresses and blood groups.
const strip = ({ tel, addr, bg, ...r }) => ({ ...r, kids: (r.kids || []).map(strip) });
fs.writeFileSync('dist/data.public.json', JSON.stringify({ files: meta.files, tree: tree.map(strip) }));
const uploads = access.uploads === 'family' ? 'family' : 'admin';
fs.writeFileSync('dist/access.json', JSON.stringify({ repo: access.repo, admin: access.admin, uploads, users: access.users }));
const pagesBase = process.env.PAGES_BASE || '';
function copyHtml(src, dest) {
  let html = fs.readFileSync(src, 'utf8');
  if (pagesBase && !html.includes('<base ')) {
    html = html.replace('<head>', `<head><base href="${pagesBase}">`);
  }
  fs.writeFileSync(dest, html);
}
copyHtml('site/index.html', 'dist/index.html');
copyHtml('site/login.html', 'dist/login.html');
fs.copyFileSync('site/pages-auth.js', 'dist/pages-auth.js');
fs.copyFileSync('site/auth-public.json', 'dist/auth-public.json');

// Run the login Function on every request, including static files and photos.
fs.writeFileSync('dist/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
for (const f of fs.readdirSync('data/photos')) if (f.endsWith('.jpg')) fs.copyFileSync(path.join('data/photos', f), path.join('dist/photos', f));
fs.writeFileSync('dist/_headers', '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n/data.json\n  Cache-Control: no-store\n/data.public.json\n  Cache-Control: no-store\n/access.json\n  Cache-Control: no-store\n');
console.log(`Built ${tree.length} branches, ${ids.size} people.`);
