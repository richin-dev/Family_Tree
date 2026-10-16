export async function onRequestGet({ data }) {
  const u = data && data.user;
  return new Response(JSON.stringify(u ? { user: u.u, name: u.name || u.u, github: u.github || '' } : { user: null }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
