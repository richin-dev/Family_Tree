# Family Tree — pull-request edition

Every change to the family tree is a **pull request**. Only the admin can merge it. The tree you see on the website is built from what is merged — nothing else.

```
relative edits on the site ──► pull request (branch + diff) ──► automatic checks (CI)
                                                          └──► admin reviews ──► Merge ──► site rebuilds
```

## Who can do what
| Person | Edit | Merge / approve |
|---|---|---|
| **Admin** (your GitHub account) | everything | ✅ only you |
| **Family editors** listed in `data/access.json` | only their assigned grandparent branch(es) and photos | ❌ |
| Everyone else | nothing | ❌ |

**This is enforced by GitHub, not by the web page**, in three layers:
1. **Ruleset** (`.github/rulesets/main-protection.json`): nobody can push to `main`; a pull request needs your review (code owner) and the `validate` check to pass.
2. **`validate` check** (`scripts/validate.mjs`, run by `.github/workflows/validate.yml`): rejects a pull request if its author touches a branch they are not assigned to, edits `data/access.json`, the workflows or scripts, changes a grandparents' title, adds a photo that isn't a small JPEG used by their branch, or breaks the data format (duplicate ids, unknown fields, `javascript:` links …). It reads the pull request **as data only** and takes the rules from `main`, so a pull request cannot change the rules that judge it.
3. **CODEOWNERS** (`.github/CODEOWNERS`): you are the required reviewer for every file.

## One-time setup
1. **Create a private GitHub repository** and upload this folder (or `git init`, `git push`). Your GitHub account should have 2-step verification on.
2. **Edit three things** and commit them to `main`:
   - `data/access.json` → `"repo": "YOURNAME/REPONAME"`, `"admin": "yourgithubusername"`, and the `users` list (see below).
   - `.github/CODEOWNERS` → your GitHub username.
3. **Settings → Actions → General**: set *Workflow permissions* to **Read repository contents**; leave "Allow GitHub Actions to create and approve pull requests" **off**; under *Fork pull request workflows* require approval.
4. **Settings → Rules → Rulesets → New ruleset → Import a ruleset** → choose `.github/rulesets/main-protection.json`. (If the `validate` status check isn't offered yet, open any pull request first so it runs once, then re-import/edit.)
5. **Publish the site with Cloudflare Pages (login is built in).**
   - Cloudflare → *Workers & Pages → Create → Pages → Connect to Git* → this repo. Build command `node scripts/build.mjs`, output directory `dist`. (The `functions/` folder is picked up automatically.)
   - *Settings → Environment variables* (add to **Production and Preview**, as **Encrypted**):
     - `SESSION_SECRET` — a long random string (32+ characters; e.g. run `openssl rand -base64 48`).
     - `AUTH_USERS` — the list of accounts: run `node scripts/make-user.mjs print` and paste the output (see *Creating logins*).
   - *Optional but recommended* — lock-out after 5 wrong passwords: create a **KV namespace** and bind it to the project as `LOGIN_KV` (Settings → Functions → KV namespace bindings). Also add a Cloudflare *Rate limiting rule* for `/api/login` if you like.
6. **Invite your editors** as collaborators on the GitHub repo (*Settings → Collaborators → Add people*, role **Write**). They can open pull requests but the ruleset stops them merging.

## Who sees what
| | Anyone with the link | Signed-in family member |
|---|---|---|
| View the tree, photos, passed-away marks | ✅ | ✅ |
| Phone, address, blood group | 🔒 hidden | ✅ |
| Edit / propose changes | ❌ (the Edit button takes them to the sign-in page) | ✅ only their assigned branches |
| Merge/approve | ❌ | ❌ (only you, on GitHub) |

The hiding is done on the server: visitors are sent `data.public.json` (built without phone, address and blood group), so those details are never sent to them. If you want **everything** public, add the Cloudflare environment variable `PUBLIC_SHOW_CONTACT` = `1`. Photos are public either way. The site asks search engines not to index it, but anyone who has the link can open it and share it.

## Creating logins (no sign-up on the site)
Logging in is only for editing. **There is no register, "create account" or password-reset option** — accounts exist only because you created them:
```bash
node scripts/make-user.mjs add alice --name "Alice K" --github alice-gh   # prints a strong password ONCE
node scripts/make-user.mjs list
node scripts/make-user.mjs passwd alice        # new password
node scripts/make-user.mjs remove alice
node scripts/make-user.mjs print               # → paste into Cloudflare env var AUTH_USERS, then redeploy/save
```
- Give each person their username and password privately. Only **salted password hashes** are kept (in `.auth/users.json` on your computer — git-ignored — and in the Cloudflare variable). Nobody, including you, can read a password back.
- `--github` links the login to the person's GitHub username so the site knows which branches they may edit without asking them.
- **Remove someone**: `remove`, `print`, update `AUTH_USERS` — their session stops working at once. To sign everybody out, add/raise an env var `SESSION_EPOCH` (e.g. `2`).
- The password check, the session cookie (HttpOnly, SameSite=Strict, 7 days) and the rules for what a visitor may fetch run on Cloudflare's server in `functions/` — not in the browser. Visitors can read only the page, the public data and photos; the access list and everything else need a session.
- Try it on your computer first: copy `.dev.vars.example` to `.dev.vars`, fill it in, then `node scripts/build.mjs && node scripts/dev-server.mjs` → http://localhost:8788 .

## Adding / changing an editor
Edit `data/access.json` (as admin, via a pull request or directly) — filenames are in `data/branches/`:
```json
{ "repo": "you/family-tree", "admin": "you",
  "users": { "cousin-github-name": ["05-rappai-rosa.json"],
             "aunt-github-name":   ["01-lonappan-maryam.json", "02-ouseph-eliya.json"] } }
```
Remove a name to remove their access. They also need a GitHub account (free) and to be invited as a collaborator.

## How a relative edits
Open the site → **✏️ Edit** → enter their GitHub username (optionally a token) → edit their branch → **📤 Submit changes**.
- **With a token** (fine-grained, this repository only, *Contents* + *Pull requests* read & write): the site creates the pull request for them.
- **Without a token**: the site shows the updated file; they copy it into GitHub's editor and choose *Create a new branch and start a pull request*.

## How you approve
GitHub emails you. Open the pull request: a bot comment lists, in plain words, who was added/renamed/removed/changed (phone, address, blood group, photo …) and whether the checks passed; **Files changed** shows the exact diff. **Merge** = approved (site updates in ~1–2 min). **Close** = rejected — write why in a comment. The person gets a comment (`@name`) and GitHub's own email either way. **History** = the repository's commit list; any change can be reverted with one click.

## Please be aware
- **Tested here:** the login (36 checks: visitors get only the public copy, wrong/unknown user, forged or expired cookies, removed users, lock-out) and in a real browser (login, sign-out, mobile); the `validate` script (24 scenarios in a real temporary git repo, plus a check that files made by the site pass them: allowed edits pass; wrong branch, edits to rules/workflows, bad data, bad photos, missing assignments all fail) and the site (editing, the pull-request calls against a *simulated* GitHub API, mobile layout).
- **Not tested here — please try once:** the GitHub workflows and ruleset on real GitHub, and the Cloudflare settings (Pages Functions, environment variables, KV). Do a dry run: as one editor open a pull request that edits their branch (should pass), then one that edits another branch (should fail and be unmergeable).
- The username typed into the site only tells the page which branches to show. The real identity is the **GitHub account that opens the pull request**; that is what the checks use.
- **Reading is public by design:** anyone with the link sees the whole tree (names, relationships, photos, passed-away marks). Signed-in family members also see phone/address/blood group; repo collaborators can read every file. If branches must be hidden from each other, you need separate sites/repos.
- Website login is your own username/password system (above). GitHub accounts are only needed to *propose changes*. Passwords are not recoverable; if someone forgets theirs, run `passwd` and send the new one.
- Limits of this login: it is as strong as the passwords you hand out (the generated 16-character ones are strong) and has no "forgot password" email or two-step verification. Cloudflare Access (Google/email code) can be added in front as an extra layer if you want one.
- Anyone who has already opened the tree can of course keep what they saw; removing them only stops future access.
- Photos: JPEG only, ≤ 600 KB, added through a pull request (the site resizes them to ~320 px).
- One slot in the Anthony / Maryam branch had no name in the original artwork; it is shown as "(name needed)".
