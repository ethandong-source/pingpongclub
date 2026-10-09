# Carroll Ping Pong Club

A public leaderboard and match history with an admin-managed roster. Players have names, ratings and records; they never create accounts or log in. An admin selects the winner and loser by name and enters a score. Elo and win/loss records update immediately, with K = 32 and a minimum Elo of 100. There is no participant confirmation step.

## Admin setup and deployment

Deploy the `betterLogging` branch on Render or Vercel. Keep the existing Firebase environment variables and add:

- `ADMIN_USERNAME`: your admin login name (defaults to `admin`).
- `ADMIN_PASSWORD`: a private password of at least 12 characters.
- `SESSION_SECRET`: a random secret of at least 32 characters; generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Set these in the hosting dashboard, never in GitHub or frontend code. Public views work without admin credentials; admin login remains disabled until they are configured. In Matches, log in to add player names and save results. In Players, rename, archive or reactivate a player. Names must be unique, ignoring capitalization and repeated spaces; use a distinguishing name when two players share a name. Renaming also updates their historical results. Archived players keep their history.

Admins can download a backup or undo the latest newly entered match. Undo restores the saved prior ratings exactly. Existing legacy results cannot be undone because they lack prior-rating snapshots. Stale submissions are rejected using a document revision, protecting against duplicate clicks and conflicting admins.

## Firestore data

Both backends use project `carrollpingpongclub`, database `(default)`, document `clubs/carroll-pingpong`. See [FIREBASE_SETUP.md](FIREBASE_SETUP.md). This is a native object with `version`, `players`, `matches`, `revision` and `updatedAt`. No player/account IDs, match IDs, account passwords or confirmation fields are stored. Admin credentials stay in server environment variables.

The first database read automatically migrates existing version 1 data, preserving player names, ratings, win/loss records and completed matches. Obsolete player accounts and confirmation metadata are removed. Old unconfirmed results are removed without changing ratings: they were never applied. Download a backup from the old deployment before deploying if you need to retain that obsolete data. The supplied club backup contains 10 players and 32 completed matches, all of which migrate.

## Local development

```sh
npm ci
# Copy .env.example to .env and configure credentials locally.
node --env-file=.env server.js
npm test
```

Tests use an isolated Firestore double and do not contact the real Firebase project. Backend APIs and environment files are never served as static files.
