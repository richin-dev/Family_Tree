import { readSession, secretOk, json } from './auth.js';

export async function isAdminUser(ctx, user) {
  if (!user || !ctx.env.ASSETS) return false;
  let access = {};
  try {
    const response = await ctx.env.ASSETS.fetch(new Request(new URL('/access.json', ctx.request.url)));
    access = await response.json();
  } catch {}
  const admin = String(ctx.env.FAMILY_ADMIN || access.admin || '').toLowerCase();
  return !!admin && String(user.github || '').toLowerCase() === admin;
}

export async function signedInAdmin(ctx) {
  if (!secretOk(ctx.env)) return null;
  const user = await readSession(ctx.env, ctx.request.headers.get('Cookie'));
  return await isAdminUser(ctx, user) ? user : null;
}
export function unauthorizedAdmin() {
  return json({error:'A signed-in family admin is required.'}, 403);
}
