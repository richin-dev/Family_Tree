import { readSession, secretOk, json } from './auth.js';

export async function signedInAdmin(ctx) {
  if (!secretOk(ctx.env)) return null;
  const user = await readSession(ctx.env, ctx.request.headers.get('Cookie'));
  if (!user) return null;
  const response = await ctx.env.ASSETS.fetch(new Request(new URL('/access.json', ctx.request.url)));
  let access = {};
  try { access = await response.json(); } catch {}
  const admin = String(ctx.env.FAMILY_ADMIN || access.admin || '').toLowerCase();
  return admin && String(user.github || '').toLowerCase() === admin ? user : null;
}

export function unauthorizedAdmin() {
  return json({error:'A signed-in family admin is required.'}, 403);
}
