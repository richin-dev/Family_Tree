# Private Google Drive photo storage

This project stores uploaded photos in a private Google Drive folder. Only a signed-in family user can view photos; only the family admin can upload, replace, or remove them. Google Drive files are never made public. Cloudflare Pages streams a photo to an authenticated user after checking the family tree and session.

The editor accepts JPEG/JPG or PNG originals up to 2 MiB (2,097,152 bytes) and 40 megapixels. The admin can draw a freeform crop; the editor keeps that crop's aspect ratio, scales its longest side to at most 300 px, converts it to JPEG, and rejects results over 600,000 bytes. The upload endpoint independently validates that the received data is a JPEG no larger than 300 × 300 pixels and 600,000 bytes. D1 stores the Drive file ID and the person's existing photo ID. The Google refresh token is encrypted in D1 using `SESSION_SECRET`.

## Google Cloud setup

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Configure the OAuth consent screen for an external app. Add the Google account that will own the photos as a test user while setting up.
3. Create an OAuth client with application type **Web application**.
4. Add this exact authorized redirect URI:

   `https://family-tree-private-4yd.pages.dev/api/drive/callback`

   Use the stable project domain, not a one-deployment `*.family-tree-private-4yd.pages.dev` address. If the site's domain changes, update this URI and reconnect Drive.

5. Enable the narrow `drive.file` scope when configuring the consent screen. It lets this app create and access its own Drive files; it does not grant access to all files in the account. See [Google's Drive scopes guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Cloudflare setup

1. In the Pages project, confirm the `FAMILY_DB` D1 binding points to the existing `family-tree-db` database.
2. In a terminal opened in this project folder, apply the new migration:

   ```powershell
   npx wrangler d1 migrations apply family-tree-db --remote
   ```

   This adds the photo ID map and encrypted Drive connection record. It does not alter the existing family tree row.

3. In the Pages project's **Settings → Variables and Secrets**, add these runtime values for **Production**:

   - `GOOGLE_CLIENT_ID` — Text value from the Google OAuth client.
   - `GOOGLE_CLIENT_SECRET` — Secret/Encrypt value from the Google OAuth client.

   Keep the existing `SESSION_SECRET` and `AUTH_USERS` secrets. Never put credentials in build-time variables or source files.

4. Deploy the project after the migration and variables are ready.
5. Sign in to the site as the family admin. If Drive is not connected yet, sign-in sends the admin to Google authorization automatically. To reconnect later, open:

   `https://family-tree-private-4yd.pages.dev/api/drive/connect`

   Choose the Google account that should own the photos and approve access. The site requests offline access with the `drive.file` scope. The refresh token is encrypted and stored in D1; it is never shown in the browser. After authorization, use the **Return to Family Tree** link.
6. The first upload creates a private **Family Tree Photos** folder in that Drive. Do not enable public link sharing for the folder or its files.

Google recommends offline OAuth access for server apps that must reach Drive when the user is not present. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server). If the OAuth app remains in **Testing**, Google refresh tokens expire after seven days; move it to **In production** before relying on persistent uploads. See [Google's refresh-token guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

## Notes

- Only authenticated sessions can request `/photos/...`; visitors without a valid family login will not receive photo bytes.
- Photo uploads and removals remain admin-only.
- If Google access is revoked or the refresh token expires, reconnect by signing in as admin and opening `/api/drive/connect` again.
- Changing `SESSION_SECRET` makes the stored refresh token unreadable; reconnect Drive after rotating that secret.
- Drive storage uses the chosen Google account's available storage and API quota.
- Never share OAuth client secrets, session secrets, or the D1 database contents in chat or screenshots.
