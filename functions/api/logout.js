import { cookie, json } from '../../lib/auth.js';
async function handlePost({ request }) {
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, new URL(request.url).protocol === 'https:') });
}
export async function onRequest(ctx) {
  if (ctx.request.method === 'POST') return handlePost(ctx);
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
