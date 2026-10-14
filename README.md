# Carroll Ping Pong Club — Elo & Match Tracker

A responsive full-stack web application for Carroll High School Ping Pong Club to track player rankings, match histories, and calculate Elo ratings with a secure dual-confirmation verification system that **syncs in real time across all devices**.

## Features

- **Cross-Device Persistent Storage**: Accounts, player ratings, and match records are stored centrally and synchronized in real time across all devices and phones.
- **Dedicated Create Account & Login**: Distinct views to easily create a new player profile or sign in.
- **Delete Account**: One-click account deletion to permanently remove profile and cleanup match data.
- **Fresh Slate Initial State**: Starts with zero accounts, zero players, and zero matches.
- **Glicko Rating Engine**: Uses published Glicko-1 equations with a baseline rating of 1000 and initial rating deviation (RD) of 350. Each confirmed match is a rating period. Ratings and match changes are rounded to whole numbers after every match, with no 2× multiplier or rating floor.
- **Dual-Confirmation Verification**: Reported matches remain pending until both participants verify the result, preventing fraudulent or erroneous rating changes.
- **Dynamic Leaderboard**: Real-time club rankings sorted by Elo, matches played, win-loss records, and win percentages.
- **Vercel-Ready**: Pre-configured for seamless 1-click deployment on Vercel with Vercel Serverless Functions and Vercel KV / Upstash Redis support.

## Deploying to Vercel (Step-by-Step)

### 1. Import Project into Vercel
1. Go to [Vercel.com](https://vercel.com) and click **Add New...** > **Project**.
2. Select your GitHub repository (`pingpongclub`).
3. Click **Deploy**.

### 2. Enable Persistent Cross-Device Storage (Vercel KV)
Because serverless functions on Vercel are stateless, add free persistent storage in 1 click:
1. In your Vercel Project Dashboard, click the **Storage** tab.
2. Click **Create Database** and choose **KV** (or Upstash Redis).
3. Connect it to your project. Vercel automatically injects the environment variables (`KV_REST_API_URL` and `KV_REST_API_TOKEN`).
4. Redeploy (or push a new commit) — your app is now 100% persistent across all devices globally!

## Local Development

```bash
npm start
# or
node server.js
```

Open `http://localhost:8000` in your browser.

## Rating replay and Firestore migration

Chess.com uses the Glicko family of rating systems. This club implements published
Glicko-1, not a claim of Chess.com’s exact private production configuration.
New players start at 1000 with RD 350. Each confirmed match is one rating period;
both players are updated from their pre-match ratings and RD. Daily inactivity
increases RD by `sqrt(RD² + c² × elapsedDays)`, capped at 350, with
`c = sqrt((350² − 50²) / 100)`. These club defaults are stored with the replay.
Stored ratings and match changes are rounded to the nearest whole number after each match, before the next match is calculated. Rating deviation (RD) retains full precision as an internal uncertainty measure.

All official matches (`eloApplied: true`) are replayed by `date`, then numeric-aware
match ID for ties. Pending matches do not affect ratings. Account data is preserved.
Deleted participants are reconstructed from their historical IDs and the same baseline,
without recreating their accounts. A replay requires complete history from each player’s
starting rating; partial imports or prior nonstandard initial ratings require review.
Confirmation and removal of historical matches replay the remaining history.

Run `node --test tests/*.test.js` to validate the worked Glicko example, both backend
confirmation/removal flows, previews, replay, and Firestore update safeguards.

Prepare a local export without modifying its source or any live service:

```bash
node scripts/recalibrate.js --input backup.json --plan-dir /tmp/local-glicko-plan
```

For `carrollpingpongclub` → `(default)` → `clubs/carroll-pingpong`, allow the network destination below. If access requires authentication, configure
`FIRESTORE_ACCESS_TOKEN` securely with read/update access to that document. Allow
`firestore.googleapis.com`. Never put token values in source files or chat.
Prepare from the live document:

```bash
node scripts/recalibrate.js --plan-dir /tmp/firestore-glicko-plan
```

The document must contain `players` and `matches` arrays. Both the repository’s
ID/confirmation schema and the live name-based completed-match schema are supported.
Other schemas stop preparation and require an adapter. Preparation
creates a private original backup, recalculated data, rating-change report, and plan.
Review the report, then apply the same plan:

```bash
node scripts/recalibrate.js --plan-dir /tmp/firestore-glicko-plan --apply
```

The update changes rating/counter fields inside players and official matches,
rebuilds live undo snapshots, adds rating-system metadata, and advances revision/updatedAt when present. It preserves other fields and Firestore timestamps.
A document update-time precondition rejects concurrent changes, requiring a new plan.
A local export plan cannot be applied directly to Firestore. The app’s existing runtime
storage adapters remain file/PostgreSQL/KV; this migration tool does not deploy the app
or switch its live runtime to Firestore. The live migration was applied and verified on 2026-10-13: 14 players and 49 matches,
using the 1000 baseline, RD 350, and the documented inactivity setting. Revision advanced
from 29 to 30. No token was needed for these operations through the configured proxy.
This does not establish that the production website has deployed the new calculation code.
