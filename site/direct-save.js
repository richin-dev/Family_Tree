/* Admin "Save to site": commits straight to main (no pull request). Additive: wraps existing functions, safe to add to a customised page. */
(function () {
  if (window.__directSave) return; window.__directSave = 1;
  const stripK = ks => ks.map(({ tel, addr, bg, ...r }) => ({ ...r, kids: stripK(r.kids || []) }));
  const normB = r => JSON.stringify({ id: r.id, names: r.names, kids: NOCONTACT ? stripK(r.kids || []) : (r.kids || []) });
  const savedKey = b => 'saved:' + b;
  // "saved" = committed to GitHub but the published site may not have rebuilt yet; forget it once the site catches up.
  function cleanSaved() { try { DATA.forEach((r, b) => { const k = S(savedKey(b)); if (k && k === normB(r)) S(savedKey(b), null); }); } catch (x) {} }
  const _ld = loadDrafts; loadDrafts = function () { cleanSaved(); return _ld.apply(this, arguments); };
  const _sr = setRole; setRole = function () { _sr.apply(this, arguments); try { $('sub').textContent = role === 'admin' ? '💾 Save to site' : '📤 Submit changes'; } catch (x) {} };
  const _sub = $('sub').onclick; $('sub').onclick = function () { if (role === 'admin') { adminSave(); return; } return _sub && _sub.apply(this, arguments); };

  async function remoteBranch(b) {
    const f = await ghApi('/repos/' + REPO() + '/contents/data/branches/' + encodeURIComponent(META[b]) + '?ref=main');
    return { sha: f.sha, obj: JSON.parse(decodeURIComponent(escape(atob(f.content.replace(/\s/g, ''))))) };
  }
  async function saveDirect(bs) {
    const repo = REPO(), L = JSON.parse(LIVEJ), ph = newPhotos(bs), cur = {};
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
    modal('<h3>Save to the website</h3><div class="m">Saved straight to GitHub — no pull request. The live site updates in about a minute.</div>'
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
            const msg = String(x.message || 'error');
            m.querySelector('#gm').textContent = x.conflict
              ? '“' + x.conflict + '” was changed on GitHub since you opened this page (for example a pull request was merged). Reload the page, then repeat your edit so nothing is overwritten.'
              : 'Could not save (' + msg.slice(0, 140) + ')' + (/protected|rule|bypass/i.test(msg) ? ' — in the repository ruleset, set “Repository admin” to “Always allow” in the bypass list.' : (x.status === 403 || x.status === 404 ? ' — check the token has Contents: read & write on this repository.' : (x.status === 409 || x.status === 422 ? ' — GitHub says the file changed; reload and retry.' : '')));
          }
        };
      });
  }
})();
