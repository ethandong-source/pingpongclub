# Carroll Ping Pong Club

A public leaderboard and match history with an admin-managed roster. Players have names, ratings and records; they never create accounts or log in. An admin selects the winner and loser by name and enters a score. Elo and win/loss records update immediately. Ratings use Glicko-1 from the shared ratings.js module for the backend and browser preview. Each match is one rating period; new players start at 1000 with RD 350. Inactivity raises RD using c = sqrt((350² − 50²) / 100). Both participants update from their pre-match states, with whole-number ratings and unrounded RD. Changes may differ and are not capped at 30; point margin does not affect Glicko. There is no participant confirmation step.

## Admin setup and deployment

Deploy the `betterLogging` branch on Render or Vercel. Keep the existing Firebase environment variables. No admin environment variables are needed. On startup (or the first Vercel status/login request), the backend automatically creates the requested initial admin login in Firestore if there is no admin record. The repository contains only a salted password hash for that initial login. The session secret is generated privately at runtime.

An existing Firestore admin record is never replaced by deployment. Subsequent username/password changes are stored only in Firestore. The old `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `SESSION_SECRET` environment variables are no longer used.

Under Matches, sign in and open **Change admin login** to set a different username/password. The password is hashed automatically; no extra setup or public signup is needed. Keep Firebase keys in hosting settings, never frontend code or GitHub. In Matches, log in to add player names and save results. In Players, rename, archive or reactivate a player. Names must be unique, ignoring capitalization and repeated spaces; use a distinguishing name when two players share a name. Renaming also updates their historical results. Archived players keep their history.

Admins can download a backup or undo the latest newly entered match. Undo restores the saved prior ratings exactly. Existing legacy results cannot be undone because they lack prior-rating snapshots. Stale submissions are rejected using a document revision, protecting against duplicate clicks and conflicting admins.

## Firestore data

Both backends use project `carrollpingpongclub`, database `(default)`, document `clubs/carroll-pingpong`. See [FIREBASE_SETUP.md](FIREBASE_SETUP.md). This is a native object with `version`, `players`, `matches`, `admin`, `revision` and `updatedAt`. No player/account IDs, match IDs, account passwords or confirmation fields are stored. The `admin` object stores admin login information in Firestore. Public views and club backups exclude it.

The first database read automatically migrates existing version 1 data, preserving player names and completed matches, then rebuilding ratings and win/loss records with Glicko from full history. Obsolete player accounts and confirmation metadata are removed. Old unconfirmed results are removed without changing ratings: they were never applied. Download a backup from the old deployment before deploying if you need to retain that obsolete data. The supplied club backup contains 10 players and 32 completed matches, all of which migrate.

## Local development

```sh
npm ci
# Copy .env.example to .env and configure credentials locally.
node --env-file=.env server.js
npm test
```

Tests use an isolated Firestore double and do not contact the real Firebase project. Backend APIs and environment files are never served as static files.

Admins can delete a player from the roster. Recorded matches and opponents’ ratings remain intact. Names in historical matches cannot be reused for new players or renames, so different people do not share one history. A match involving a deleted player cannot be undone. Admin login editing is removed; the existing Firestore login remains unchanged.

## Glicko deployment and recovery

The betterLogging Firestore backend preserves RD, lastRatedAt, rating-system configuration, and pre-match undo snapshots in native fields. If rating metadata was stripped by an older deployment, the first read transaction replays the complete dated match history from 1000 and saves the recovered states under a revision check. Missing or invalid historical dates stop recovery instead of silently guessing. Deleted participants are replayed without restoring them to the roster. After migration, normal reads do not replay or change ratings. Undo restores rating, RD, last-rated date and counters. Existing admin credentials and roster names remain unchanged.
