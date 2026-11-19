# Future-match point-share ratings

The first section documents the legacy policy. The current version-5 policy
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

## Active score-aware Glicko policy (version 5)

Future matches now use `active-score-glicko-1`. This is a custom Glicko-1
adaptation, not standard Glicko or Glicko-2. The point fraction remains the
performance observation: `S = pointsWon / totalPoints`. Expected performance
still accounts for opponent rating and uncertainty. Each match is one observation;
longer games with the same point ratio do not get extra weight.

Before every new match, each player's RD is at least **250** (maximum 350).
After the normal Glicko calculation, multiply the rating difference by **1.5**,
round to a whole number, and floor the saved RD at 250. Winning players gain
at least **1** point. Losing players can stay level or lose points; any
positive performance adjustment for a losing player is capped at zero. No 30-point cap. Doubles uses team means and
each participant's individual uncertainty with the same protections.

The uncertainty floor prevents repeated play from making the ladder insensitive.
It does not guarantee every result causes a large change: expected results may
still move very little. Winner protection permits rating inflation; updates are
not zero-sum.

Examples with both pre-match RDs at the floor:

| Winner rating | Loser rating | Score | Winner change | Loser change |
| --- | --- | --- | --- | --- |
| 1000 | 1000 | 11–9 | +16 | −16 |
| 1000 | 1000 | 11–7 | +36 | −36 |
| 1000 | 1000 | 11–0 | +160 | −160 |
| 1400 | 1000 | 11–9 | +1 | 0 |
| 1400 | 1000 | 11–0 | +52 | −52 |

Deployment does not rewrite live ratings, uncertainty or match history. The
stored document's existing ratingSystem map remains compatible with Firestore
rules. `forNewMatch` resolves that configuration to the version-5 active policy
in both the form preview and transaction calculation; each newly recorded match
stores the active policy identifier. Legacy preview/replay formulas remain
for historical compatibility, but forward-only data cannot be replayed. Undo
restores the exact saved pre-match state, including the old RD.

Reference: https://www.glicko.net/glicko/glicko.pdf
