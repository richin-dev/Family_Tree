#!/usr/bin/env node
// Adds admin "Save to site" to an existing site/index.html WITHOUT replacing the file (keeps your other changes).
// Run from the repo root:  node scripts/apply-direct-save.mjs
import fs from 'node:fs';
const page = 'site/index.html', block = fs.readFileSync('site/direct-save.js', 'utf8');
let html = fs.readFileSync(page, 'utf8');
const marker = /<script id="direct-save">[\s\S]*?<\/script>/;
if (marker.test(html)) {                                   // already installed: upgrade the block to the current version
  const next = html.replace(marker, () => '<script id="direct-save">\n' + block + '\n</script>');
  if (next === html) { console.log('Already up to date.'); process.exit(0); }
  fs.writeFileSync(page, next); console.log('Updated — admin save feature upgraded in site/index.html.'); process.exit(0);
}
if (!html.includes('</body>')) { console.error('site/index.html has no </body> — not changed.'); process.exit(1); }
const need = ['ghApi', 'newPhotos', 'manualHtml', 'branchJson', 'unsentB'];
const missing = need.filter(n => !html.includes(n));
if (missing.length) { console.error('This page is missing: ' + missing.join(', ') + ' — it is not based on the pull-request version. Not changed.'); process.exit(1); }
html = html.replace('</body>', '<script id="direct-save">\n' + block + '\n</script></body>');
fs.writeFileSync(page, html);
console.log('Done — admin "Save to site" added to site/index.html.');
