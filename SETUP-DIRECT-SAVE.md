# Family Tree — direct shared saving (Cloudflare D1)

This version saves family edits to a Cloudflare D1 database. GitHub is only used to deploy code; normal family edits do not create commits or require a push. Do **not** publish this version on GitHub Pages: GitHub Pages cannot run the authenticated API. Use Cloudflare Pages with Functions.

## One-time Cloudflare setup

1. In Cloudflare, open **Workers & Pages → D1 SQL Database → Create database**. Name it `family-tree-db`.
2. Copy the database ID and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.toml`.
3. In this project folder, install Wrangler if needed: `npm install --save-dev wrangler`.
4. Authenticate: `npx wrangler login`.
5. Apply the schema: `npx wrangler d1 migrations apply family-tree-db --remote`.
6. In Cloudflare Pages → your project → **Settings → Functions → D1 database bindings**, add binding `FAMILY_DB` and select `family-tree-db` for Production (and Preview if used).
7. In Cloudflare R2, create a bucket named `family-tree-photos`. In the Pages project, add an **R2 bucket binding** named `FAMILY_PHOTOS` pointing to that bucket for Production and Preview. If you choose a different bucket name, update `bucket_name` in `wrangler.toml` to match. Keep bucket-level public access disabled; the site serves only photos referenced by the tree.
8. Keep the existing encrypted `SESSION_SECRET` and `AUTH_USERS` variables. The login users must have their `github` field set to their family-tree username from `data/access.json`; the admin is `richin-dev` unless `FAMILY_ADMIN` is set.
9. Deploy this updated project once through GitHub/Cloudflare Pages. The R2 binding takes effect after deployment. Family photos are stored in R2; D1 stores only the photo IDs in each person's existing `ph` field.

## First-time data initialization

The first authenticated visit to `/api/tree` copies the existing published `data.json` into D1 automatically. No manual data entry is needed. Later edits are stored in D1. Keep a backup of the original `data/` files in the repository.

## Local development

Cloudflare Pages' local D1 and R2 runtimes are recommended. Configure Wrangler locally and use `npx wrangler pages dev dist --d1 FAMILY_DB=family-tree-db --r2=FAMILY_PHOTOS` after `node scripts/build.mjs`. By default, local R2 operations use Wrangler's local storage and do not change the production bucket. For login variables, keep `.dev.vars` private and never commit it.

## Access and privacy

- Requests to `/api/tree` require the existing signed-in session.
- Admin can save all branches. Editors can save only filenames assigned in `data/access.json`.
- Public visitor access continues to use the generated `data.public.json` and hides phone, address, and blood group.
- D1 stores the complete family tree. Protect the Cloudflare account and D1 database; do not share database credentials.
- Only a signed-in admin can add, replace, or remove a person's photo. The editor accepts JPEG, PNG, and WebP images up to 10 MB, previews and resizes them to 320 pixels, and uploads a JPEG no larger than 600 KB. Replaced or removed photo objects are deleted from R2 after the tree save succeeds.
- This changes data persistence, not the static public-data build. To expose newly edited names/relationships to anonymous visitors as well, a public D1 read endpoint and privacy policy should be deliberately configured. Current direct-save UI is for signed-in family editing.
