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
- **Vercel-Ready**: Pre-configured for seamless 1-click deployment on Vercel with Vercel Serverless Functions and Firebase Firestore storage.

## Persistent storage with Firebase

This branch uses **Cloud Firestore** for both the Render/Node server and the Vercel API. See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for Firebase project settings, secret environment variables, and the existing-data import command.

Back up and import the current live database **before redeploying**. Existing accounts, player ratings, match records, and confirmations are preserved; no player/account behavior is changed. Firebase credentials belong in hosting environment settings, never frontend code or GitHub.

## Local Development

```bash
npm ci
# Configure Firebase credentials in an uncommitted .env first.
node --env-file=.env server.js
```

Open `http://localhost:8000` in your browser.
