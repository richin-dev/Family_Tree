import { cookie, json } from '../../lib/auth.js';
export async function onRequestPost({ request }) {
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, new URL(request.url).protocol === 'https:') });
}
export const onRequest = () => json({ error: 'Use POST.' }, 405);
