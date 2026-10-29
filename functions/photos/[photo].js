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
  const filename = String(ctx.params.photo || '');
  if (!PHOTO_FILE.test(filename)) return new Response('Not found.', {status:404});
  const id = filename.slice(0, -4);
  if (!await isReferenced(ctx, id)) return new Response('Not found.', {status:404});
  if (ctx.env.FAMILY_PHOTOS) {
    const object = await ctx.env.FAMILY_PHOTOS.get(`photos/${filename}`);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Content-Type','image/jpeg');
      headers.set('Cache-Control','public, max-age=3600');
      return new Response(object.body, {headers});
    }
  }
  const asset = await ctx.env.ASSETS.fetch(new Request(new URL(`/photos/${filename}`, ctx.request.url)));
  return asset.ok ? asset : new Response('Not found.', {status:404});
}
