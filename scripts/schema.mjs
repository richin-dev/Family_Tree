// Shared rules for what a branch file may contain. Used by CI (validate.mjs) and by the site build.
export const COLORS = ['blue','green','orange','purple','teal','pink','yellow'];
export const BLOOD = ['','A+','A−','B+','B−','AB+','AB−','O+','O−'];
const ID = /^[A-Za-z0-9_-]{1,24}$/, PHOTO = /^p[a-z0-9]{3,24}$/, CTRL = /[\u0000-\u001f\u007f]/;
const NODE_KEYS = new Set(['id','names','c','kids','bg','dd','ph','link','tel','addr']);

export function checkBranch(root, where, errs, ids, photoExists) {
  const e = (m) => errs.push(`${where}: ${m}`);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return e('must be a JSON object');
  const extra = Object.keys(root).filter(k => !['id','names','kids'].includes(k));
  if (extra.length) e(`unknown root field(s): ${extra.join(', ')}`);
  if (typeof root.id !== 'string' || !ID.test(root.id)) e('root id is missing or invalid');
  if (!Array.isArray(root.names) || root.names.length < 1 || root.names.length > 2 || root.names.some(s => typeof s !== 'string' || !s.length || s.length > 80 || CTRL.test(s))) e('root names must be 1-2 short strings');
  if (!Array.isArray(root.kids)) return e('root kids must be a list');
  let count = 0;
  const walk = (n, path, depth) => {
    if (++count > 600) { if (count === 601) e('too many people in one branch (limit 600)'); return; }
    if (!n || typeof n !== 'object' || Array.isArray(n)) return e(`${path} is not an object`);
    for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) e(`${path}: unknown field "${k}"`);
    if (typeof n.id !== 'string' || !ID.test(n.id)) e(`${path}: bad id`);
    else if (ids.has(n.id)) e(`${path}: duplicate id "${n.id}"`); else ids.add(n.id);
    if (!Array.isArray(n.names) || n.names.length < 1 || n.names.length > 6 || n.names.some(s => typeof s !== 'string' || !s.trim().length || s.length > 80 || CTRL.test(s))) e(`${path}: names must be 1-6 strings (max 80 chars)`);
    if (!COLORS.includes(n.c)) e(`${path}: unknown colour "${n.c}"`);
    if (!Array.isArray(n.kids)) e(`${path}: kids must be a list`);
    if (n.bg !== undefined && (!Array.isArray(n.bg) || n.bg.length > 6 || n.bg.some(x => !BLOOD.includes(x)))) e(`${path}: bad blood group`);
    if (n.dd !== undefined && (!Array.isArray(n.dd) || n.dd.length > 6 || n.dd.some(x => x !== null && (typeof x !== 'string' || x.length > 24)))) e(`${path}: bad passed-away entry`);
    if (n.ph !== undefined) {
      if (!Array.isArray(n.ph) || n.ph.length > 6 || n.ph.some(x => x !== null && (typeof x !== 'string' || !PHOTO.test(x)))) e(`${path}: bad photo list`);
      else n.ph.forEach(x => { if (x && photoExists && !photoExists(x)) e(`${path}: photo "${x}" is not in data/photos/`); });
    }
    if (n.link !== undefined && (typeof n.link !== 'string' || n.link.length > 120 || !/^https?:\/\//i.test(n.link))) e(`${path}: link must be an http(s) address`);
    if (n.tel !== undefined && (typeof n.tel !== 'string' || !/^[0-9+()\-\s.]{3,40}$/.test(n.tel))) e(`${path}: phone number has odd characters`);
    if (n.addr !== undefined && (typeof n.addr !== 'string' || n.addr.length > 200 || CTRL.test(n.addr.replace(/\n/g, ' ')))) e(`${path}: bad address`);
    if (Array.isArray(n.kids)) {
      if (depth > 9) return e(`${path}: nested too deep`);
      n.kids.forEach((k, i) => walk(k, `${path} › ${(k && Array.isArray(k.names) && k.names[0]) || i}`, depth + 1));
    }
  };
  root.kids.forEach((k, i) => walk(k, `${(root.names && root.names[0]) || 'root'} › ${(k && Array.isArray(k.names) && k.names[0]) || i}`, 1));
}

// ---- human-readable comparison ------------------------------------------------
const lab = n => (n.names || []).join(' & ');
function flat(root) { const m = new Map(); (function f(n, pn) { (n.kids || []).forEach(k => { m.set(k.id, { n: k, p: pn }); f(k, k); }); })(root, root); return m; }
export function describe(oldRoot, newRoot) {
  const A = flat(oldRoot || { kids: [] }), B = flat(newRoot), out = [];
  B.forEach(({ n, p }, id) => {
    const x = A.get(id);
    if (!x) { out.push(`➕ **${lab(n)}** (under ${lab(p) || 'the branch head'})`); return; }
    const y = x.n;
    if (lab(y) !== lab(n)) out.push(`✏️ **${lab(y)}** → **${lab(n)}**`);
    const c = [];
    [['c','generation colour'],['tel','phone'],['addr','address'],['link','link']].forEach(([k, l]) => { if ((y[k] || '') !== (n[k] || '')) c.push(l); });
    [['bg','blood group'],['dd','passed away'],['ph','photo']].forEach(([k, l]) => { if (JSON.stringify(y[k] || []) !== JSON.stringify(n[k] || [])) c.push(l); });
    if (c.length) out.push(`✏️ **${lab(n)}**: ${c.join(', ')} changed`);
  });
  A.forEach(({ n }, id) => { if (!B.has(id)) out.push(`➖ **${lab(n)}** removed`); });
  return out;
}
