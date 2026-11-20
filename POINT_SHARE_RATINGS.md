# Future-match point-share ratings

The first section documents the legacy policy. The current version-11 policy
below prohibits rating gains for losing players.

The club uses a custom score-based adaptation of Glicko-1, inspired by UTR's
comparison of actual performance with expected performance. It is not official
UTR, Glicko-1, or Glicko-2. New players start at 1000.

For each new match, set the actual score `S` to the player's points divided by
the total points scored by both sides. The Glicko expected result `E`, opponent
uncertainty adjustment, and individual rating deviation (RD) remain unchanged.
Use `S - E` in the usual Glicko update instead of a binary win/loss outcome.
Both players use pre-match ratings; ratings round to whole numbers after each
match. There is no 30-point cap. A shutout has the same effect as a binary win;
a close game has less extreme performance evidence. One match remains one
observation for RD, regardless of its number of points.

A player can gain rating in a loss. A winning player's change is floored at zero,
so a win can increase the rating or leave it unchanged, but never reduce it.
This protection applies individually to both doubles winners as well. Only the
winner's saved rating is clamped; RD and all opponents' performance updates still
use the original pre-match values. Past ratings and match snapshots are not
recalculated when this rule changes. The win/loss record
continues to reflect the actual result. Deltas are signed independently of the
result throughout the preview, history and profile chart. For compatibility,
stored `loserChange`/`loserChanges` still mean the amount subtracted: negative
values therefore represent a gain for the losing player.

Doubles compares team mean ratings, using the existing Glicko team uncertainty
adaptation and each player's own RD. All four players use their team's share of
points; their individual changes can differ. Singles and doubles share ratings.

## Forward-only activation

Deploy the compatible browser code first, then change only `ratingSystem.name`
to `point-share-glicko-1` and `ratingSystem.version` to `3`, incrementing the
document revision with an update-time precondition. Keep every player field and
every historical match byte-for-byte unchanged. Keep starting rating, RD settings,
and rounding settings. Save a backup immediately before activation. Existing
Firestore rules already require clients to retain the configured rating system.

The code continues to read historical `glicko-1` matches, including their saved
changes and snapshots. It never recalculates them. Backup restore preserves a
mixed history; Glicko replay rejects the new configuration to prevent an
accidental recalculation. Undo uses saved pre-match snapshots with either system.

This is a forward update from existing ratings, not UTR's rolling 30-match
average. Do not run a historical recalibration as part of this switch.

## Active score-aware Glicko policy (version 11)

Future matches now use `active-score-glicko-1`. This is a custom Glicko-1
adaptation, not standard Glicko or Glicko-2. The performance observation blends point share with the result:
`S_winner = 0.5 * winnerPoints / totalPoints + 0.5`, and
`S_loser = 1 - S_winner`. This reduces the influence of score margins by 50%
relative to the previous pure-point-share policy. Expected performance
still accounts for opponent rating and uncertainty. Each match is one observation;
longer games with the same point ratio do not get extra weight.

Before every new match, each player's RD is at least **250** (maximum 350).
Multiply the raw Glicko rating difference by **1/3**, then round
to a whole number and floor the saved RD at 250. This is two-thirds of version 10’s half-size adjustment (one-third less movement),
before winner/loser protections. The +3
minimum win and the fixed +3/0 mismatch rule still take precedence. Winning players gain
at least **3** points. Losing players can stay level or lose points; any
positive performance adjustment for a losing player is capped at zero. No 30-point cap. Doubles uses team means and
each participant's individual uncertainty with the same protections.

Hard mismatch rule: when the winning side’s pre-match rating exceeds the
losing side’s by strictly more than 200, every winner gets exactly +3 and every
loser gets 0, regardless of score or RD. Exactly 200 uses the normal formula.
An underdog victory uses the normal formula. Doubles compares team average
ratings and applies +3/0 to each participant. RD still updates normally.

The uncertainty floor prevents repeated play from making the ladder insensitive.
It does not guarantee every result causes a large change: expected results may
still move very little. Winner protection permits rating inflation; updates are
not zero-sum.

Examples with both pre-match RDs at the floor:

| Winner rating | Loser rating | Score | Winner change | Loser change |
| --- | --- | --- | --- | --- |
| 1000 | 1000 | 11–9 | +20 | −20 |
| 1000 | 1000 | 11–7 | +22 | −22 |
| 1000 | 1000 | 11–0 | +36 | −36 |
| 1400 | 1000 | 11–9 | +3 | 0 |
| 1400 | 1000 | 11–0 | +3 | 0 |

Deployment does not rewrite live ratings, uncertainty or match history. The
stored document's existing ratingSystem map remains compatible with Firestore
rules. `forNewMatch` resolves that configuration to the version-11 active policy
in both the form preview and transaction calculation; each newly recorded match
stores the active policy identifier. Legacy preview/replay formulas remain
for historical compatibility, but forward-only data cannot be replayed. Undo
restores the exact saved pre-match state, including the old RD.

Reference: https://www.glicko.net/glicko/glicko.pdf

## Independent singles and doubles ladders (November 19, 2026)

An explicitly requested full rebuild replaces the earlier forward-only policy
for this one migration. All recorded matches are replayed chronologically,
starting both pools at 1000 / RD 350, using the current version-10 active policy
for every match. The root `elo`, `rd`, `lastRatedAt`, `wins`, `losses` fields now
refer only to singles. `player.doubles` holds the same five fields for doubles.
Uncertainty, inactivity and records are independent; account archiving still
considers the most recent activity in either match type.

Every match keeps its original participants, score, date and attribution.
Rating changes and undo snapshots are rebuilt for the corresponding ladder.
`ratingPool` and `ratingPolicyVersion` record the pool and formula used. Deleted
members are simulated as opponents without restoring their accounts. New
players start at 1000 in each pool. Players without doubles games are shown in
the roster at 1000 but are not ranked in the doubles ladder.

`split-ratings.js` is an explicit offline operation, never an automatic read-time
migration. `scripts/rebuild-split-ratings.js BACKUP.json OUTPUT.json` prepares
a dry run from a full typed Firestore backup. Add `--apply` only for the intended
cutover; it patches players, matches and revision with an update-time
precondition, preserving the ratingSystem map and all unrelated Firestore fields.
If another result arrives, take a fresh backup and rerun instead of overwriting it.
Deploy the pool-aware UI/actions before applying the rebuild. Old open tabs
should be refreshed. Keep the original backup for recovery.


## November 19 sensitivity adjustment

Version 11 uses two-thirds of the previous sensitivity: 0.5 × 2/3 = 1/3 of
raw Glicko movement. It is the ongoing policy for future results. The +3 win
minimum, non-positive losing adjustments, fixed +3/0 mismatch rule, 50/50
weighting and independent rating pools remain.

Only November 19 matches (America/Chicago, including matches after midnight
UTC) are recalculated at this cutover. Their saved snapshots are rolled back in
reverse chronological order, then replayed forward under version 11. Earlier
match records and the starting state for the day are retained. Later dependent
matches cause the day-only operation to refuse rather than leaving inconsistent
ratings. Run the migration CLI with the optional final day argument:
`BACKUP.json OUTPUT.json --apply 2026-11-19`. Keep a fresh typed backup and the
optimistic update-time/revision checks, as for the independent-pool migration.
