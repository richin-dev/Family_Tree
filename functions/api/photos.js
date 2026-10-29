import { json } from '../../lib/auth.js';
import { signedInAdmin, unauthorizedAdmin } from '../../lib/access.js';
import { deleteDrivePhoto, uploadDrivePhoto } from '../../lib/google-drive.js';

const PHOTO_ID = /^p[a-z0-9]{3,24}$/;
const MAX_BYTES = 600_000;
const MAX_EDGE = 300;

function jpegDimensions(image) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return null;
  const frameMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2;
  while (offset < image.length) {
    if (image[offset] !== 0xff) return null;
    while (offset < image.length && image[offset] === 0xff) offset++;
    if (offset >= image.length) return null;
    const marker = image[offset++];
    if (marker === 0xd9 || marker === 0xda) return null; // EOI/SOS before a frame header
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone markers
    if (offset + 2 > image.length) return null;
    const segmentLength = (image[offset] << 8) | image[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > image.length) return null;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {height:(image[offset + 3] << 8) | image[offset + 4], width:(image[offset + 5] << 8) | image[offset + 6]};
    }
    offset += segmentLength;
  }
  return null;
}

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
  if (!await signedInAdmin(ctx)) return unauthorizedAdmin();
  if (!ctx.env.FAMILY_DB) return json({error:'Family photo storage requires the D1 database binding.'},503);
  const contentType = String(ctx.request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'image/jpeg') return json({error:'Upload a JPEG image. PNG photos are accepted in the editor and converted before upload.'},415);
  const declared = Number(ctx.request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return json({error:'The resized photo must be 600 KB or smaller.'},413);
  const bytes = await readBounded(ctx.request.body);
  if (bytes === null) return json({error:'The resized photo must be 600 KB or smaller.'},413);
  if (!bytes.byteLength) return json({error:'The resized photo cannot be empty.'},400);
  const image = new Uint8Array(bytes);
  const dimensions = jpegDimensions(image);
  if (!dimensions || !dimensions.width || !dimensions.height) return json({error:'The uploaded file is not a valid JPEG image.'},415);
  if (dimensions.width > MAX_EDGE || dimensions.height > MAX_EDGE) return json({error:'The resized JPEG must be no larger than 300 × 300 pixels.'},413);
  const id = 'p' + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  try { await uploadDrivePhoto(ctx, id, bytes); }
  catch (error) { return json({error:error.message || 'Could not save the photo to Google Drive.'},503); }
  return json({id});
}

export async function onRequestDelete(ctx) {
  if (!await signedInAdmin(ctx)) return unauthorizedAdmin();
  if (!ctx.env.FAMILY_DB) return json({error:'Family photo storage requires the D1 database binding.'},503);
  const id = new URL(ctx.request.url).searchParams.get('id') || '';
  if (!PHOTO_ID.test(id)) return json({error:'Invalid photo id.'},400);
  if (await isReferenced(ctx, id)) return json({error:'This photo is still used by a family member. Save the tree change first.'},409);
  try { await deleteDrivePhoto(ctx, id); }
  catch (error) { return json({error:error.message || 'Could not remove the photo from Google Drive.'},503); }
  return json({deleted:true});
}
