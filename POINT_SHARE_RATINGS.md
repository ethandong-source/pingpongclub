# Future-match point-share ratings

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

A player can gain rating in a loss or lose rating in a win. The win/loss record
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
