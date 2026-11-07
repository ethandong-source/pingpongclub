// Use the same singles/doubles replay adapter as the live Firestore backend.
module.exports = { prepare: require('../lib/glicko').prepare };
