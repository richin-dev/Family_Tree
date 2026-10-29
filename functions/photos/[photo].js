import { readSession } from '../../lib/auth.js';
import { driveRequest, findDrivePhoto } from '../../lib/google-drive.js';

const PHOTO_FILE = /^p[a-z0-9]{3,24}\.jpg$/;

async function isReferenced(ctx, id) {
  if (ctx.env.FAMILY_DB) {
    const row = await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();
    if (row) {
      try {
        let found = false;
        const walk = n => { if (!n || found) return; if (Array.isArray(n.ph) && n.ph.includes(id)) found = true; (n.kids || []).forEach(walk); };
        JSON.parse(row.payload).tree.forEach(walk);
        return found;
      } catch { return false; }
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

export async function onRequestGet(ctx) {
  if (!await readSession(ctx.env, ctx.request.headers.get('Cookie'))) return new Response('Sign in to view family photos.', {status:401, headers:{'Cache-Control':'no-store'}});
  const filename = String(ctx.params.photo || '');
  if (!PHOTO_FILE.test(filename)) return new Response('Not found.', {status:404});
  const id = filename.slice(0, -4);
  if (!await isReferenced(ctx, id)) return new Response('Not found.', {status:404});
  if (ctx.env.FAMILY_DB) {
    try {
      const stored = await findDrivePhoto(ctx, id);
      if (stored?.drive_file_id) {
        const response = await driveRequest(ctx, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(stored.drive_file_id)}?alt=media`);
        if (!response.ok) return new Response(response.status === 404 ? 'Not found.' : 'Photo storage is temporarily unavailable.', {status:response.status === 404 ? 404 : 503, headers:{'Cache-Control':'no-store'}});
        return new Response(response.body, {headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
    } catch {
      return new Response('Photo storage is temporarily unavailable.', {status:503, headers:{'Cache-Control':'no-store'}});
    }
  }
  const asset = await ctx.env.ASSETS.fetch(new Request(new URL(`/photos/${filename}`, ctx.request.url)));
  if (!asset.ok) return new Response('Not found.', {status:404});
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control','private, no-store');
  headers.set('X-Content-Type-Options','nosniff');
  return new Response(asset.body, {status:asset.status, headers});
}
