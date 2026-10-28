// Public to read, login to edit.
//  - Anyone with the link can load the page, the tree and the photos (the public copy hides phone, address and blood group).
//  - Signed-in family members get the full data and can edit. Everything else (e.g. the access list) needs a session.
import { readSession, secretOk, json } from '../lib/auth.js';

const PUBLIC_GET = [/^\/$/, /^\/index\.html$/, /^\/login\.html$/, /^\/data\.json$/, /^\/data\.public\.json$/, /^\/photos\/p[a-z0-9]{3,24}\.jpg$/, /^\/favicon\.ico$/, /^\/api\/me$/];
const OPEN_ANY = new Set(['/api/login', '/api/logout']);

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!secretOk(env)) return new Response('Server not configured: set a SESSION_SECRET of at least 32 characters.', { status: 500 });
  if (path === '/login') return Response.redirect(url.origin + '/login.html', 302);

  const user = await readSession(env, request.headers.get('Cookie'));
  ctx.data = { user };
  const isPublic = (method === 'GET' || method === 'HEAD') && PUBLIC_GET.some(r => r.test(path));
  if (!user && !isPublic && !OPEN_ANY.has(path)) return json({ error: 'Sign in required.' }, 401);

  let res;
  if (path === '/data.json' && !user && env.PUBLIC_SHOW_CONTACT !== '1' && env.ASSETS) {
    res = await env.ASSETS.fetch(new Request(url.origin + '/data.public.json'));   // same tree, without phone / address / blood group
  } else res = await ctx.next();

  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('X-Robots-Tag', 'noindex');
  if (path === '/data.json' || path === '/access.json' || path.startsWith('/api/') || user) { out.headers.set('Cache-Control', 'private, no-store'); out.headers.set('Vary', 'Cookie'); }
  return out;
}
