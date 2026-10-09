# Firebase storage setup for betterLogging

This branch changes only backend storage. Player signup/login, Elo, match reporting, and two-player confirmations are retained. The frontend is unchanged. Both Render's Node backend and the Vercel API now store the existing JSON database in Cloud Firestore.

Configured project: **carrollpingpongclub**. Firestore database: **(default)**.

## What information to share

Send only:

- Firebase **Project ID** (not the project display name).
- Firestore **database ID**, normally `(default)`.
- Confirmation that Cloud Firestore has been created.

Do not send a service-account private key in chat or commit it to GitHub. No frontend Firebase API key, authDomain, appId, or Firebase Authentication setup is needed for this backend-only integration.

## Configure Firebase

1. In the Firebase console, create/select the project.
2. Under Build → Firestore Database, create a **Cloud Firestore Standard edition** database. Keep `(default)` unless you need a named database. Choose a region near your Render service.
3. For a dedicated club project, use the rules in `firestore.rules` to deny direct browser access. The server uses its service account, which authenticates using IAM rather than browser security rules. Do not replace a shared project's existing rules without considering its other apps.
4. Open Project settings → Service accounts and generate a private key. Keep the downloaded JSON file private. Its `project_id`, `client_email`, and `private_key` fields are used below. The service account needs permission to read and write Firestore documents.

## Configure Render

Before any redeployment, download a private copy of the live database from your existing `/api/backup` endpoint, or back up its `data/db.json` file. The current local-file deployment's live data does not automatically travel with GitHub code. Original backups include existing account passwords; store them privately.

In the Render web service's Environment settings, add:

```text
FIREBASE_PROJECT_ID=carrollpingpongclub
FIREBASE_CLIENT_EMAIL=<client_email from the service-account JSON>
FIREBASE_PRIVATE_KEY=<private_key from the service-account JSON>
FIRESTORE_DATABASE_ID=(default)
FIRESTORE_DOCUMENT_PATH=clubs/carroll-pingpong
```

For `FIREBASE_PRIVATE_KEY`, paste the full PEM private key including BEGIN/END lines. Actual newlines or literal `\n` sequences both work. Do not include extra surrounding quotation marks in Render's value field.

Use Node.js **22 or newer**, build command `npm ci`, and start command `npm start`. This branch includes a lockfile. Old `DATABASE_URL`, `KV_REST_API_*`, and `UPSTASH_REDIS_REST_*` settings are no longer used by the backend.

Configure the same variables in Vercel if you use that deployment too. If both hosts should share data, use the same project, database ID, and document path.

## Import the existing players and matches BEFORE switching the live site

The import is an offline command, not a new public API endpoint. It preserves all existing accounts/passwords, player IDs/ratings, match records, and confirmations. It refuses to overwrite an existing club document.

1. Obtain a private backup from the old live app before redeploying. The script accepts either the backup response `{ "data": { ... } }` or a raw `db.json` object.
2. Stop new match/account entries while taking the final backup and switching storage, so new entries are not left behind in the old file.
3. In a local checkout of this branch, run `npm ci`.
4. Create an uncommitted `.env` with the Firebase settings above. Use `.env.example` as the format reference and keep your private backup outside the repository or in the ignored `backups/` folder.
5. Import with:

```bash
node --env-file=.env scripts/import-firestore.js /absolute/path/to/private-backup.json
```

With the variables already exported in your terminal, you can instead run:

```bash
npm run import:firestore -- /absolute/path/to/private-backup.json
```

6. The script prints record counts, never password or key contents. In Firestore, check document `clubs/carroll-pingpong`. It contains the fields `state` (the existing club JSON as a string), `revision`, and `updatedAt`.
7. Once imported, configure Render to deploy `betterLogging` and redeploy. This GitHub update itself does not change Render's deployment-branch setting.
8. Open `/api/status`. It should show `storage: "firebase-firestore"`, `persistent: true`, and the same imported counts. Log in with an existing player account, record/confirm a match, and verify the data survives a restart.

If a valid Firestore connection exists but the club document has not been imported yet, the app starts with an empty club. It does not silently copy an unrelated local starter file. Import first to avoid accidentally starting a fresh database. If someone has already created a document, export it and reconcile the data before retrying the import; the script never overwrites it.

## How the storage implementation works

- Requests read fresh state from Firestore, rather than using stale process memory.
- Saves are awaited before returning success.
- A Firestore transaction checks the revision, so a stale request cannot overwrite another instance's changes. A conflicting write returns 409; refresh and retry.
- Requests within one running instance are serialized. A storage error returns an error instead of switching to temporary local files.
- Existing accounts and passwords keep their original format; this change does not add Firebase Authentication or remove player accounts.
- The current small club fits in one document. The code limits saved JSON to 900,000 bytes; split players/matches into collections before reaching that limit.
- The frontend still polls every three seconds. Each refresh now reads one document; Firestore's free daily read quota depends on traffic. Consider increasing polling intervals later if needed.
- No Firebase credentials are written into static frontend files or GitHub. Old local data paths and backend storage-module paths are blocked by the Node static-file server.
- The original API authorization behavior is retained; Firestore rules protect direct database access, not the website's existing backend endpoints.

## Verification

Run `npm test`. Tests cover preservation/import, conflicting writes, storage failures, document size validation, and unchanged signup/login/match-confirmation behavior through both Node and Vercel backends. Tests use an in-memory Firestore test double; they do not connect to your live project. A live project test still requires the credentials configured above.

Official references:

- https://firebase.google.com/docs/admin/setup
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/security/get-started
