const enc = new TextEncoder();
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

function b64url(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), c => c.charCodeAt(0));
}

async function tokenKey(env, usage) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('Session security is not configured.');
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`family-tree:google-drive-refresh-token:v1:${env.SESSION_SECRET}`));
  return crypto.subtle.importKey('raw', material, {name:'AES-GCM'}, false, usage);
}

export async function encryptDriveRefreshToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv}, await tokenKey(env, ['encrypt']), enc.encode(token));
  return {ciphertext:b64url(new Uint8Array(ciphertext)), iv:b64url(iv)};
}

async function decryptDriveRefreshToken(env, row) {
  try {
    const clear = await crypto.subtle.decrypt({name:'AES-GCM', iv:fromB64url(row.token_iv)}, await tokenKey(env, ['decrypt']), fromB64url(row.refresh_token));
    return new TextDecoder().decode(clear);
  } catch { throw new Error('Google Drive connection is unavailable. Reconnect the admin Google account.'); }
}

export function driveCallbackUri(request) {
  return new URL('/api/drive/callback', request.url).toString();
}

export async function saveDriveRefreshToken(ctx, token) {
  const encrypted = await encryptDriveRefreshToken(ctx.env, token);
  await ctx.env.FAMILY_DB.prepare(`INSERT INTO google_drive_settings(id,refresh_token,token_iv,folder_id)
    VALUES(1,?,?,NULL)
    ON CONFLICT(id) DO UPDATE SET refresh_token=excluded.refresh_token,token_iv=excluded.token_iv,connected_at=CURRENT_TIMESTAMP`)
    .bind(encrypted.ciphertext, encrypted.iv).run();
}

async function accessToken(ctx) {
  const {env} = ctx;
  if (!env.FAMILY_DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Google Drive setup is incomplete.');
  let row;
  try { row = await env.FAMILY_DB.prepare('SELECT refresh_token,token_iv FROM google_drive_settings WHERE id=1').first(); }
  catch { throw new Error('Google Drive database setup is incomplete. Apply the latest D1 migration.'); }
  if (!row) throw new Error('Connect the admin Google Drive account before uploading photos.');
  const refreshToken = await decryptDriveRefreshToken(env, row);
  const body = new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET, refresh_token:refreshToken, grant_type:'refresh_token'});
  const response = await fetch('https://oauth2.googleapis.com/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body});
  if (!response.ok) throw new Error('Google Drive authorization expired. Reconnect the admin Google account.');
  const token = await response.json();
  if (!token.access_token) throw new Error('Google Drive did not return an access token.');
  return token.access_token;
}

export async function driveRequest(ctx, url, init = {}) {
  const access = await accessToken(ctx);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${access}`);
  return fetch(url, {...init, headers});
}

export async function driveFolderId(ctx) {
  const db = ctx.env.FAMILY_DB;
  const row = await db.prepare('SELECT folder_id FROM google_drive_settings WHERE id=1').first();
  if (row?.folder_id) return row.folder_id;
  const response = await driveRequest(ctx, `${API}/files?fields=id`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Family Tree Photos', mimeType:'application/vnd.google-apps.folder'})
  });
  if (!response.ok) throw new Error('Could not create the private Family Tree Photos folder in Google Drive.');
  const folder = await response.json();
  if (!folder.id) throw new Error('Google Drive did not return the photo folder ID.');
  await db.prepare('UPDATE google_drive_settings SET folder_id=? WHERE id=1').bind(folder.id).run();
  return folder.id;
}

export async function findDrivePhoto(ctx, photoId) {
  return ctx.env.FAMILY_DB.prepare('SELECT drive_file_id FROM family_photos WHERE photo_id=?').bind(photoId).first();
}

export async function deleteDrivePhoto(ctx, photoId) {
  const row = await findDrivePhoto(ctx, photoId);
  if (!row) return;
  const response = await driveRequest(ctx, `${API}/files/${encodeURIComponent(row.drive_file_id)}`, {method:'DELETE'});
  if (!response.ok && response.status !== 404) throw new Error('Could not remove the photo from Google Drive.');
  await ctx.env.FAMILY_DB.prepare('DELETE FROM family_photos WHERE photo_id=?').bind(photoId).run();
}

export async function uploadDrivePhoto(ctx, photoId, bytes) {
  const folderId = await driveFolderId(ctx);
  const boundary = `family_tree_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({name:`${photoId}.jpg`, mimeType:'image/jpeg', parents:[folderId]});
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`
  ], {type:`multipart/related; boundary=${boundary}`});
  const response = await driveRequest(ctx, `${UPLOAD_API}/files?uploadType=multipart&fields=id`, {method:'POST', body});
  if (!response.ok) throw new Error('Google Drive could not save this photo. Check the Drive connection and storage quota.');
  const file = await response.json();
  if (!file.id) throw new Error('Google Drive did not return the saved photo ID.');
  try {
    await ctx.env.FAMILY_DB.prepare('INSERT INTO family_photos(photo_id,drive_file_id) VALUES(?,?)').bind(photoId,file.id).run();
  } catch {
    await driveRequest(ctx, `${API}/files/${encodeURIComponent(file.id)}`, {method:'DELETE'}).catch(()=>{});
    throw new Error('The photo was uploaded, but its family-tree reference could not be saved.');
  }
  return file.id;
}
