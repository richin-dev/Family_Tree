import { readSession, json, secretOk } from '../../lib/auth.js';

const PHOTO_ID = /^p[a-z0-9]{3,24}$/;
const MAX_BYTES = 600_000;

async function readBounded(stream) {
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function signedInAdmin(ctx) {
  if (!secretOk(ctx.env)) return null;
  const user = await readSession(ctx.env, ctx.request.headers.get('Cookie'));
  if (!user) return null;
  const response = await ctx.env.ASSETS.fetch(new Request(new URL('/access.json', ctx.request.url)));
  let access = {};
  try { access = await response.json(); } catch {}
  const admin = String(ctx.env.FAMILY_ADMIN || access.admin || '').toLowerCase();
  return admin && String(user.github || '').toLowerCase() === admin ? user : null;
}

async function isReferenced(ctx, id) {
  if (ctx.env.FAMILY_DB) {
    const row = await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();
    if (row) {
      try {
        let found = false;
        const walk = n => { if (!n || found) return; if (Array.isArray(n.ph) && n.ph.includes(id)) found = true; (n.kids || []).forEach(walk); };
        JSON.parse(row.payload).tree.forEach(walk);
        return found;
      } catch { return true; }
    }
  }
  const response = await ctx.env.ASSETS.fetch(new Request(new URL('/data.public.json', ctx.request.url)));
  if (!response.ok) return false;
  try {
    let found = false;
    const walk = n => { if (!n || found) return; if (Array.isArray(n.ph) && n.ph.includes(id)) found = true; (n.kids || []).forEach(walk); };
    (await response.json()).tree.forEach(walk);
    return found;
  } catch { return false; }
}

export async function onRequestPost(ctx) {
  if (!await signedInAdmin(ctx)) return json({error:'A signed-in family admin is required to upload photos.'},403);
  if (!ctx.env.FAMILY_PHOTOS) return json({error:'Photo storage is not configured. Create and bind the FAMILY_PHOTOS R2 bucket.'},503);
  const contentType = String(ctx.request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'image/jpeg') return json({error:'Upload a JPEG image. PNG and WebP photos are accepted in the editor and converted before upload.'},415);
  const declared = Number(ctx.request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return json({error:'The resized photo must be 600 KB or smaller.'},413);
  const bytes = await readBounded(ctx.request.body);
  if (bytes === null) return json({error:'The resized photo must be 600 KB or smaller.'},413);
  if (!bytes.byteLength) return json({error:'The resized photo cannot be empty.'},400);
  const image = new Uint8Array(bytes);
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) return json({error:'The uploaded file is not a valid JPEG image.'},415);
  const id = 'p' + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  await ctx.env.FAMILY_PHOTOS.put(`photos/${id}.jpg`, bytes, {httpMetadata:{contentType:'image/jpeg',cacheControl:'public, max-age=3600'}});
  return json({id});
}

export async function onRequestDelete(ctx) {
  if (!await signedInAdmin(ctx)) return json({error:'A signed-in family admin is required to remove photos.'},403);
  if (!ctx.env.FAMILY_PHOTOS) return json({error:'Photo storage is not configured.'},503);
  const id = new URL(ctx.request.url).searchParams.get('id') || '';
  if (!PHOTO_ID.test(id)) return json({error:'Invalid photo id.'},400);
  if (await isReferenced(ctx, id)) return json({error:'This photo is still used by a family member. Save the tree change first.'},409);
  await ctx.env.FAMILY_PHOTOS.delete(`photos/${id}.jpg`);
  return json({deleted:true});
}
