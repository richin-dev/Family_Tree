import { readSession, json, secretOk } from '../../lib/auth.js';

async function sessionUser(request, env) {
  if (!secretOk(env)) return null;
  return readSession(env, request.headers.get('Cookie'));
}
async function published(ctx) {
  const r = await ctx.env.ASSETS.fetch(new Request(new URL('/data.json', ctx.request.url)));
  return r.ok ? r.json() : null;
}
function photoState(tree) {
  const people = new Map(), ids = new Set();
  const walk = n => {
    if (!n || typeof n !== 'object') throw new Error('Invalid person data.');
    if (n.ph !== undefined) {
      if (!Array.isArray(n.ph) || n.ph.length > 6 || n.ph.some(x => x !== null && (typeof x !== 'string' || !/^p[a-z0-9]{3,24}$/.test(x)))) throw new Error('Invalid photo list.');
      people.set(n.id, JSON.stringify(n.ph));
      n.ph.forEach(id => { if (id) ids.add(id); });
    }
    if (Array.isArray(n.kids)) n.kids.forEach(walk);
  };
  if (!Array.isArray(tree)) throw new Error('Invalid family tree.');
  tree.forEach(walk);
  return { people, ids };
}
async function handleGet(ctx) {
  const user = await sessionUser(ctx.request, ctx.env);
  if (!user) { if(ctx.env.FAMILY_DB){const row=await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();if(row){try{const d=JSON.parse(row.payload),strip=n=>{const {tel,addr,bg,...rest}=n;return {...rest,kids:(n.kids||[]).map(strip)}};return json({...d,tree:d.tree.map(strip)});}catch{}}} const r=await ctx.env.ASSETS.fetch(new Request(new URL('/data.public.json',ctx.request.url))); return r.ok?new Response(r.body,r):json({error:'Public tree unavailable.'},500); }
  if (!ctx.env.FAMILY_DB) return json({error:'Database is not configured. Follow SETUP-DIRECT-SAVE.md.'},503);
  let row = await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();
  if (!row) {
    const initial = await published(ctx);
    if (!initial) return json({error:'Initial family data could not be loaded.'},500);
    await ctx.env.FAMILY_DB.prepare('INSERT OR IGNORE INTO family_tree(id,payload,updated_by) VALUES(1,?,?)').bind(JSON.stringify(initial),user.u).run();
    row = await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();
  }
  try { return json(JSON.parse(row.payload)); } catch { return json({error:'Saved family data is invalid.'},500); }
}
async function handlePut(ctx) {
  const user = await sessionUser(ctx.request, ctx.env);
  if (!user) return json({error:'Sign in required.'},401);
  if (!ctx.env.FAMILY_DB) return json({error:'Database is not configured. Follow SETUP-DIRECT-SAVE.md.'},503);
  let body; try { body=await ctx.request.json(); } catch { return json({error:'Invalid JSON.'},400); }
  if (!Array.isArray(body.tree) || !Array.isArray(body.files) || body.tree.length !== body.files.length || body.tree.length > 30) return json({error:'Invalid family tree payload.'},400);
  const accessRes=await ctx.env.ASSETS.fetch(new Request(new URL('/access.json',ctx.request.url)));
  let access={}; try{access=await accessRes.json()}catch{}
  const gh=String(user.github||'').toLowerCase(), admin=String(ctx.env.FAMILY_ADMIN||access.admin||'').toLowerCase();
  const allowed=gh && gh===admin ? body.files : (access.users && access.users[gh] || []);
  if(!gh || (gh!==admin && !Array.isArray(allowed))) return json({error:'This account is not authorized to save.'},403);
  const original=await ctx.env.FAMILY_DB.prepare('SELECT payload FROM family_tree WHERE id=1').first();
  let current;
  try { current=original ? JSON.parse(original.payload) : await published(ctx); } catch { return json({error:'Current database data is invalid.'},500); }
  if (!current || !Array.isArray(current.tree)) return json({error:'Current family data is invalid.'},500);
  let beforePhotos, afterPhotos;
  try { beforePhotos=photoState(current.tree); afterPhotos=photoState(body.tree); }
  catch (e) { return json({error:e.message||'Invalid photo data.'},400); }
  const photoChanged=[...new Set([...beforePhotos.people.keys(),...afterPhotos.people.keys()])].some(id=>beforePhotos.people.get(id)!==afterPhotos.people.get(id));
  if (photoChanged && gh!==admin) return json({error:'Only the family admin can add, change, or remove photos.'},403);
  if (photoChanged && !ctx.env.FAMILY_PHOTOS) return json({error:'Photo storage is not configured. Create and bind the FAMILY_PHOTOS R2 bucket.'},503);
  if (photoChanged) {
    for (const id of afterPhotos.ids) if (!beforePhotos.ids.has(id) && !await ctx.env.FAMILY_PHOTOS.head(`photos/${id}.jpg`)) return json({error:'A selected photo is not available in family photo storage.'},400);
  }
  const allowedSet=new Set(gh===admin?body.files:allowed);
  if(body.files.some((f,i)=>f!==current.files[i]) || body.files.length!==current.files.length) return json({error:'Branch list cannot be changed here.'},400);
  let nextTree; try { nextTree=current.tree.map((old,i)=>{
    const incoming=body.tree[i]; if(!incoming || incoming.id!==old.id) throw new Error('Branch identity mismatch.');
    const changed=JSON.stringify(incoming)!==JSON.stringify(old);
    if(changed && !allowedSet.has(current.files[i])) throw new Error('You cannot edit one or more family branches.');
    return changed?incoming:old;
  }); } catch(e) { return json({error:e.message||'Invalid branch data.'},403); }
  const next={files:current.files,tree:nextTree};
  await ctx.env.FAMILY_DB.prepare('INSERT INTO family_tree(id,payload,updated_by) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP,updated_by=excluded.updated_by').bind(JSON.stringify(next),user.u).run();
  if (photoChanged) for (const id of beforePhotos.ids) if (!afterPhotos.ids.has(id)) {
    try { await ctx.env.FAMILY_PHOTOS.delete(`photos/${id}.jpg`); }
    catch { console.error('Could not remove an unreferenced family photo from R2.'); }
  }
  return json(next);
}
export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return handleGet(ctx);
  if (ctx.request.method === 'PUT') return handlePut(ctx);
  return json({error:'Method not allowed.'},405,{Allow:'GET, PUT'});
}
