# Deploy the club on Render Static Sites

Use the `render-static` branch. The existing Node deployment and its private Firestore document are separate.

## 1. Configure Firebase

1. Register a **Web app** under Project settings in your Firebase project and copy its web configuration. No Firebase Authentication setup is needed.
2. Review [firestore.static.rules](firestore.static.rules). Anyone can read and submit updates to `clubPublic/carroll-pingpong` directly. The editor password only reveals the controls in the browser, so use a throwaway password.
3. Apply the rules to the same database the site will read. If the project has other rules, add just the exact `match /clubPublic/carroll-pingpong` block. If it uses the repository's original deny-all rules, deploy the complete static ruleset for the default database with:

   ```sh
   firebase deploy --only firestore:rules --config firebase.static.json --project carrollpingpongclub
   ```

The existing Node server uses a service account and can still read its private document. Do not make the old `clubs/carroll-pingpong` document public; it contains the old admin login data.

## 2. Copy the latest club data

When ready to switch, stop entering scores on the old site and use **Matches → Download data backup**. On your computer, using an account authorized to write to the project:

```sh
npm ci
gcloud auth application-default login
FIREBASE_PROJECT_ID=carrollpingpongclub npm run import:static -- /path/to/club-backup.json
```

Alternatively, provide local Application Default Credentials via `GOOGLE_APPLICATION_CREDENTIALS`. Keep service-account files private. The importer copies the roster, matches, and ratings, excludes admin credentials, and refuses to overwrite an existing static document. Once you switch, record matches only on the static site: the two deployments use separate Firestore documents.

## 3. Create the Render service

In Render, choose **New → Static Site** and connect the repository.

| Setting | Value |
| --- | --- |
| Branch | `render-static` |
| Build command | `npm run build:static` |
| Publish directory | `dist` |
| `FIREBASE_WEB_CONFIG` | Web configuration as JSON with `apiKey`, `projectId`, and `appId` |
| `CLUB_EDIT_CODE` | A throwaway editor password |
| `SKIP_INSTALL_DEPS` | `true` (optional; the build script has no dependencies) |

Use the default Firestore database unless you configured another one. For a named database, set `FIREBASE_DATABASE_ID` for the import and Render build and apply the rules to that database. Do not set `LOCAL_FIRESTORE_EMULATOR` on Render.

Render serves only `dist/`. Node runs the build command; there is no server or start command at runtime. Verify the standings, a player profile, and the editor on the new URL before sharing it. Render assigns a separate URL for the static site; this branch does not transfer the old `onrender.com` hostname.

References: [Firebase web setup](https://firebase.google.com/docs/web/setup) and [Render static sites](https://render.com/docs/static-sites).
