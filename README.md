# Carroll Ping Pong Club — Elo & Match Tracker

A responsive full-stack web application for Carroll High School Ping Pong Club to track player rankings, match histories, and calculate Elo ratings with a secure dual-confirmation verification system that **syncs in real time across all devices**.

## Features

- **Cross-Device Persistent Storage**: Accounts, player ratings, and match records are stored centrally and synchronized in real time across all devices and phones.
- **Dedicated Create Account & Login**: Distinct views to easily create a new player profile or sign in.
- **Delete Account**: One-click account deletion to permanently remove profile and cleanup match data.
- **Fresh Slate Initial State**: Starts with zero accounts, zero players, and zero matches.
- **Elo Rating Engine**: Calculates rating adjustments using the standard Elo algorithm with a baseline rating of 1000 and a K-factor of 32.
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
