/* Admin "Save to site": commits straight to main (no pull request). Additive: wraps existing functions, safe to add to a customised page. */
(function () {
  if (window.__directSave) return; window.__directSave = 1;
  const stripK = ks => ks.map(({ tel, addr, bg, ...r }) => ({ ...r, kids: stripK(r.kids || []) }));
  const normB = r => JSON.stringify({ id: r.id, names: r.names, kids: NOCONTACT ? stripK(r.kids || []) : (r.kids || []) });
  const savedKey = b => 'saved:' + b;
  // Repo name: from data/access.json, or guessed from the web address (https://OWNER.github.io/REPO/).
  const repoName = () => { let r = ''; try { r = REPO(); } catch (x) {} if (r) return r; const m = /^([^.]+)\.github\.io$/.exec(location.hostname), seg = location.pathname.split('/')[1]; return m && seg ? m[1] + '/' + seg : ''; };
  // Admin = the signed-in token holder has ADMIN rights on the repository (GitHub decides; no need to edit access.json).
  window.__repoAdmin = false; let adminChecked = '';
  async function verifyAdmin() {
    const key = (GH.user || '') + '|' + (GH.token || '') + '|' + repoName();
    if (key === adminChecked) return; adminChecked = key;
    let isAdm = false;
    if (GH.token && repoName()) { try { const r = await ghApi('/repos/' + repoName()); isAdm = !!(r && r.permissions && r.permissions.admin); } catch (x) {} }
    if (isAdm !== window.__repoAdmin) { window.__repoAdmin = isAdm; try { resolveRole(); loadDrafts(); render(); setRole(); } catch (x) {} }
  }
  const _rr = resolveRole; resolveRole = function () { _rr.apply(this, arguments); if (window.__repoAdmin) { role = 'admin'; BR = META.map((x, i) => i); } };
  // "saved" = committed to GitHub but the published site may not have rebuilt yet; forget it once the site catches up.
  function cleanSaved() { try { DATA.forEach((r, b) => { const k = S(savedKey(b)); if (k && k === normB(r)) S(savedKey(b), null); }); } catch (x) {} }
  const _ld = loadDrafts; loadDrafts = function () { cleanSaved(); verifyAdmin(); return _ld.apply(this, arguments); };
  const _sr = setRole; setRole = function () { _sr.apply(this, arguments); try { $('sub').textContent = role === 'admin' ? '💾 Save changes' : '📤 Submit changes'; } catch (x) {} };
  const _sub = $('sub').onclick; $('sub').onclick = function () { if (role === 'admin') { adminSaveNow(); return; } return _sub && _sub.apply(this, arguments); };
  function toast(t) {
    let e = document.getElementById('ds-toast');
    if (!e) { e = document.createElement('div'); e.id = 'ds-toast'; e.setAttribute('role', 'status'); e.style.cssText = 'position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:12;max-width:92vw;padding:11px 16px;border-radius:12px;border:1px solid #b8893f;background:#1f1a14;color:#f0d9a0;font:600 14px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);text-align:center'; document.body.appendChild(e); }
    e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => { e.style.display = 'none'; }, 7000);
  }
  // One tap: saves straight to the site (no confirmation step).
  async function adminSaveNow() {
    if (!GH.token) { adminSave(); return; }                 // no token yet: explain how to connect one
    const bs = unsentB(); if (!bs.length) return;
    const btn = $('sub'); btn.disabled = true; btn.textContent = '⏳ Saving…';
    try {
      await saveDirect(bs); bs.forEach(b => { SENT[b] = hash(JSON.stringify(DATA[b])); });
      toast('✅ Saved — the live site updates in about a minute'); st('Saved to GitHub — live in about a minute');
    } catch (x) {
      const msg = String(x.message || 'error');
      modal('<h3>Could not save</h3><div class="warn">' + E(saveErr(x, msg)) + '</div><button id="rt">Try again</button>', m => { m.querySelector('#rt').onclick = () => { $('modal').style.display = 'none'; adminSaveNow(); }; });
    } finally { btn.disabled = false; setRole(); }
  }
  function saveErr(x, msg) {
    return x.conflict
      ? '“' + x.conflict + '” was changed on GitHub since you opened this page (for example a pull request was merged). Reload the page, then repeat your edit so nothing is overwritten.'
      : 'Could not save (' + msg.slice(0, 140) + ')' + (/protected|rule|bypass/i.test(msg) ? ' — in the repository ruleset, set “Repository admin” to “Always allow” in the bypass list.' : (x.status === 401 || x.status === 403 || x.status === 404 ? ' — check the token is still valid and has Contents: read & write on this repository.' : (x.status === 409 || x.status === 422 ? ' — GitHub says the file changed; reload and retry.' : '')));
  }

  async function remoteBranch(b) {
    const f = await ghApi('/repos/' + repoName() + '/contents/data/branches/' + encodeURIComponent(META[b]) + '?ref=main');
    return { sha: f.sha, obj: JSON.parse(decodeURIComponent(escape(atob(f.content.replace(/\s/g, ''))))) };
  }
  async function saveDirect(bs) {
    const repo = repoName(), L = JSON.parse(LIVEJ), ph = newPhotos(bs), cur = {};
    for (const b of bs) {            // never overwrite something that changed on GitHub since this page loaded
      const r = await remoteBranch(b); cur[b] = r; const rem = normB(r.obj);
      if (rem !== normB(L[b]) && rem !== S(savedKey(b))) { const e = new Error('conflict'); e.conflict = DATA[b].names.join(' / '); throw e; }
    }
    const put = (path, content, msg, sha) => ghApi('/repos/' + repo + '/contents/' + path, { method: 'PUT', body: JSON.stringify({ message: msg, content, branch: 'main', sha }) });
    for (const id of Object.keys(ph)) {
      let sha; try { sha = (await ghApi('/repos/' + repo + '/contents/data/photos/' + id + '.jpg?ref=main')).sha; } catch (x) { if (x.status !== 404) throw x; }
      await put('data/photos/' + id + '.jpg', ph[id].split(',')[1], 'Add photo ' + id, sha);
    }
    for (const b of bs) { await put('data/branches/' + META[b], b64(branchJson(b)), 'Admin edit: ' + DATA[b].names.join(' / '), cur[b].sha); S(savedKey(b), normB(DATA[b])); }
  }
  function adminSave() {
    const L = JSON.parse(LIVEJ), bs = unsentB(), ph = newPhotos(bs);
    modal('<h3>Save changes</h3><div class="m">Saved straight to GitHub — no pull request. The live site updates in about a minute.</div>'
      + bs.map(b => '<div class="m"><b>' + E(DATA[b].names.join(' / ')) + '</b></div>' + dlist(diff(L[b], DATA[b]))).join('')
      + (GH.token ? '<button id="go">💾 Save now</button>' : '<div class="warn">To save directly, connect GitHub with a token that has <b>Contents: read &amp; write</b> (tap 🔗 at the top). Or save by hand:</div>' + manualHtml(bs, ph))
      + '<div id="gm" class="warn"></div>', m => {
        m.querySelectorAll('.cp').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(branchJson(+b.dataset.b)); b.textContent = 'Copied ✔'; } catch (x) { b.textContent = 'Copy failed'; } });
        const go = m.querySelector('#go');
        if (go) go.onclick = async () => {
          go.disabled = true; go.textContent = 'Saving…';
          try {
            await saveDirect(bs); bs.forEach(b => { SENT[b] = hash(JSON.stringify(DATA[b])); }); setRole();
            m.innerHTML = '<h3>✅ Saved</h3><div class="m">Your changes are in GitHub. The live site updates in about a minute — reload then.</div>'; st('Saved to GitHub — live in about a minute');
          } catch (x) {
            go.disabled = false; go.textContent = '💾 Save now';
            m.querySelector('#gm').textContent = saveErr(x, String(x.message || 'error'));
          }
        };
      });
  }
})();
