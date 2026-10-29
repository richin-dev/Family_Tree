import { signedInAdmin, unauthorizedAdmin } from '../../../lib/access.js';
import { driveCallbackUri } from '../../../lib/google-drive.js';

function base64url(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function onRequestGet(ctx) {
  if (!await signedInAdmin(ctx)) return unauthorizedAdmin();
  if (!ctx.env.GOOGLE_CLIENT_ID || !ctx.env.GOOGLE_CLIENT_SECRET || !ctx.env.FAMILY_DB) {
    return new Response('Google Drive setup is incomplete. Configure the Google OAuth client and D1 migration first.', {status:503});
  }
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const callback = driveCallbackUri(ctx.request);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id:ctx.env.GOOGLE_CLIENT_ID,
    redirect_uri:callback,
    response_type:'code',
    scope:'https://www.googleapis.com/auth/drive.file',
    access_type:'offline',
    prompt:'consent',
    include_granted_scopes:'true',
    state
  }).toString();
  const secure = new URL(ctx.request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {status:302, headers:{
    Location:url.toString(),
    'Set-Cookie':`ft_drive_state=${state}; Path=/api/drive/callback; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    'Cache-Control':'no-store'
  }});
}
