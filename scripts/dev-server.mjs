#!/usr/bin/env node
// Local preview that behaves like Cloudflare Pages + Functions (same code). Run:  node scripts/build.mjs && node scripts/dev-server.mjs
// Settings come from a .dev.vars file (see .dev.vars.example).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const env = {};
if (fs.existsSync('.dev.vars')) for (const l of fs.readFileSync('.dev.vars', 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, '$1'); }
const port = +(process.env.PORT || 8788), root = path.resolve('dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.js': 'text/javascript' };
const mw = (await import('../functions/_middleware.js')).onRequest;
const routes = { '/api/login': await import('../functions/api/login.js'), '/api/logout': await import('../functions/api/logout.js'), '/api/me': await import('../functions/api/me.js') };

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const url = new URL(req.url, `http://localhost:${port}`);
  const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const serveStatic = (pathname) => { const p = path.join(root, pathname === '/' ? 'index.html' : pathname); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return new Response('Not found', { status: 404 }); return new Response(fs.readFileSync(p), { headers: { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' } }); };
  const ctx = { request, env: { ...env, ASSETS: { fetch: async (r) => serveStatic(new URL(r.url).pathname) } }, data: {} };
  ctx.next = async () => {
    const r = routes[url.pathname];
    if (r) { const h = r['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()] || r.onRequest; return h(ctx); }
    return serveStatic(url.pathname);
  };
  const out = await mw(ctx);
  const headers = {}; out.headers.forEach((v, k) => { headers[k] = v; });
  const sc = out.headers.getSetCookie ? out.headers.getSetCookie() : []; if (sc.length) headers['set-cookie'] = sc;
  res.writeHead(out.status, headers); res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`Preview with login on http://localhost:${port}`));
