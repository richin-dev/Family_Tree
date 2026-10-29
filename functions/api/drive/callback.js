import { driveCallbackUri, saveDriveRefreshToken } from '../../../lib/google-drive.js';

function cookieValue(header, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`).exec(header || '');
  return match ? match[1] : '';
}

function result(message, status, secure) {
  return new Response(message, {status, headers:{
    'Content-Type':'text/plain; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Set-Cookie':`ft_drive_state=; Path=/api/drive/callback; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  }});
}

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url), secure = url.protocol === 'https:';
  const state = url.searchParams.get('state') || '';
  const savedState = cookieValue(ctx.request.headers.get('Cookie'), 'ft_drive_state');
  if (!state || !savedState || state !== savedState) return result('Google Drive connection expired. Start the connection again as the family admin.', 400, secure);
  if (url.searchParams.has('error')) return result('Google Drive connection was cancelled. You can close this page.', 400, secure);
  const code = url.searchParams.get('code') || '';
  if (!code || !ctx.env.GOOGLE_CLIENT_ID || !ctx.env.GOOGLE_CLIENT_SECRET || !ctx.env.FAMILY_DB) {
    return result('Google Drive setup is incomplete. Check the OAuth settings and D1 migration.', 503, secure);
  }
  const body = new URLSearchParams({
    code,
    client_id:ctx.env.GOOGLE_CLIENT_ID,
    client_secret:ctx.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:driveCallbackUri(ctx.request),
    grant_type:'authorization_code'
  });
  let response;
  try { response = await fetch('https://oauth2.googleapis.com/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body}); }
  catch { return result('Could not contact Google. Please try again.', 502, secure); }
  if (!response.ok) return result('Google authorization could not be completed. Check the OAuth client and redirect URI.', 502, secure);
  let token;
  try { token = await response.json(); } catch { return result('Google returned an invalid authorization response.', 502, secure); }
  if (!token.refresh_token) return result('Google did not return a refresh token. Reconnect and approve offline access.', 502, secure);
  try { await saveDriveRefreshToken(ctx, token.refresh_token); }
  catch { return result('The Google account was authorized, but its connection could not be saved. Check the D1 migration.', 503, secure); }
  return result('Google Drive is connected. You can close this page.', 200, secure);
}
