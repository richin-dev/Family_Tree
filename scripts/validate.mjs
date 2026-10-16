#!/usr/bin/env node
// Runs in CI on every pull request. It reads the PR's files as DATA ONLY (git show) — it never runs code from the PR.
// Trusted inputs (the access list) are read from the BASE commit, so a PR cannot change the rules that judge it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { checkBranch, describe } from './schema.mjs';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('base'), head = arg('head'), author = (arg('author') || '').toLowerCase(), outFile = arg('out') || 'summary.md';
if (!base || !head || !author) { console.error('usage: validate.mjs --base SHA --head REF --author LOGIN [--out file]'); process.exit(2); }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 100e6 });
const show = (ref, p) => { try { return execFileSync('git', ['show', `${ref}:${p}`], { maxBuffer: 100e6, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const sizeOf = (ref, p) => { try { return parseInt(git('cat-file', '-s', `${ref}:${p}`), 10); } catch { return -1; } };

const errs = [], notes = [];
const accessRaw = show(base, 'data/access.json'), metaRaw = show(base, 'data/meta.json');
if (!accessRaw || !metaRaw) { console.error('data/access.json or data/meta.json is missing on the base branch'); process.exit(2); }
const access = JSON.parse(accessRaw), baseMeta = JSON.parse(metaRaw);
const admin = String(access.admin || '').toLowerCase();
const isAdmin = author === admin;
const entry = Object.entries(access.users || {}).find(([u]) => u.toLowerCase() === author);
const allowedFiles = new Set(isAdmin ? [] : (entry ? entry[1] : []));

// ---- 1. which files changed -----------------------------------------------------
const tok = git('diff', '--name-status', '--no-renames', '-z', `${base}...${head}`).split('\0').filter(Boolean);
const changes = []; for (let i = 0; i + 1 < tok.length; i += 2) changes.push({ s: tok[i][0], p: tok[i + 1] });
if (!changes.length) notes.push('No file changes.');

const BRANCH = /^data\/branches\/([A-Za-z0-9._-]+\.json)$/, PHOTO = /^data\/photos\/(p[a-z0-9]{3,24})\.jpg$/;
const changedBranches = [], addedPhotos = [];
for (const { s, p } of changes) {
  const b = BRANCH.exec(p), ph = PHOTO.exec(p);
  if (isAdmin) { if (b && s !== 'D') changedBranches.push(b[1]); if (ph && s === 'A') addedPhotos.push(ph[1]); continue; }
  if (b) {
    if (s === 'D') errs.push(`\`${p}\`: only the admin may delete a branch file`);
    else if (s === 'A') errs.push(`\`${p}\`: only the admin may create a new branch file`);
    else if (!allowedFiles.has(b[1])) errs.push(`\`${p}\`: @${author} is not assigned to this family branch`);
    else changedBranches.push(b[1]);
  } else if (ph) {
    if (s !== 'A') errs.push(`\`${p}\`: photos can be added but not changed or deleted`);
    else {
      const buf = show(head, p), sz = sizeOf(head, p);
      if (!buf || buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) errs.push(`\`${p}\`: not a JPEG image`);
      else if (sz > 600000) errs.push(`\`${p}\`: photo is larger than 600 KB`);
      else addedPhotos.push(ph[1]);
    }
  } else errs.push(`\`${p}\`: only the admin may change this file`);
}
if (!isAdmin && !allowedFiles.size && changes.length) errs.push(`@${author} has no branches assigned in \`data/access.json\``);

// ---- 2. validate content of every branch file as it will exist after merge -------
const headMetaRaw = show(head, 'data/meta.json'), headMeta = headMetaRaw ? JSON.parse(headMetaRaw) : baseMeta;
const photoExists = (id) => addedPhotos.includes(id) || show(head, `data/photos/${id}.jpg`) !== null;
const ids = new Set(), summaries = [];
for (const f of headMeta.files) {
  const raw = show(head, `data/branches/${f}`);
  if (!raw) { errs.push(`\`data/branches/${f}\` is listed in meta.json but missing`); continue; }
  let obj; try { obj = JSON.parse(raw.toString('utf8')); } catch (e) { errs.push(`\`${f}\`: not valid JSON (${e.message})`); continue; }
  const local = [];
  checkBranch(obj, f, local, ids, photoExists);
  const touched = changedBranches.includes(f);
  if (touched) errs.push(...local); else if (local.length) notes.push(`(existing problem in unchanged file ${f}: ${local[0]})`);
  if (touched) {
    const oldRaw = show(base, `data/branches/${f}`);
    let oldObj = null; try { oldObj = oldRaw ? JSON.parse(oldRaw.toString('utf8')) : null; } catch {}
    if (!isAdmin && oldObj && (obj.id !== oldObj.id || JSON.stringify(obj.names) !== JSON.stringify(oldObj.names))) errs.push(`\`${f}\`: the branch title (grandparents' names) can only be changed by the admin`);
    summaries.push({ f, title: (obj.names || []).join(' / '), lines: describe(oldObj, obj) });
  }
}
// photos added must be used by an allowed branch file in this same PR (no free file hosting)
if (!isAdmin) for (const id of addedPhotos) {
  const used = changedBranches.some(f => { const r = show(head, `data/branches/${f}`); return r && r.toString('utf8').includes(`"${id}"`); });
  if (!used) errs.push(`\`data/photos/${id}.jpg\`: photo is not used by any branch file in this pull request`);
}

// ---- 3. report ----------------------------------------------------------------
const ok = errs.length === 0;
let md = `<!-- family-tree-validate -->\n### ${ok ? '✅ Checks passed' : '❌ Checks failed'} — @${author}${isAdmin ? ' (admin)' : ''}\n\n`;
if (errs.length) md += `**This pull request cannot be merged until these are fixed:**\n${errs.map(e => `- ${e}`).join('\n')}\n\n`;
if (summaries.length) { md += `**What changed**\n`; for (const s of summaries) md += `\n*${s.title}* (\`${s.f}\`)\n${s.lines.length ? s.lines.slice(0, 80).map(l => `- ${l}`).join('\n') : '- (no visible change)'}${s.lines.length > 80 ? `\n- …and ${s.lines.length - 80} more` : ''}\n`; }
if (addedPhotos.length) md += `\n📷 New photos: ${addedPhotos.length}\n`;
if (notes.length) md += `\n${notes.map(n => `> ${n}`).join('\n')}\n`;
if (ok) md += `\n_Only the admin can merge this. See **Files changed** for the exact edit._\n`;
fs.writeFileSync(outFile, md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
process.exit(ok ? 0 : 1);
