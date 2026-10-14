// Firestore REST helpers; tokens are used only in the HTTPS Authorization header.
const ROOT = 'https://firestore.googleapis.com/v1/';
function decode(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number)) throw new Error('Firestore integer exceeds safe JSON precision.');
    return number;
  }
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  throw new Error('Unsupported Firestore field type; inspect schema before migration.');
}
function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot store non-finite rating.');
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
  throw new Error('Unsupported JSON value.');
}
function documentURL(project, document) {
  if (!/^[a-z][a-z0-9-]+$/.test(project)) throw new Error('Invalid Firebase project ID.');
  const segments = document.split('/');
  if (segments.length % 2 || segments.some(p => !p || p === '.' || p === '..')) throw new Error('Expected a Firestore document path.');
  return `${ROOT}projects/${project}/databases/(default)/documents/${segments.map(encodeURIComponent).join('/')}`;
}
async function request(url, token, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`Firestore request failed (HTTP ${response.status}). Check network access, credentials, and document permissions.`);
  return response.json();
}
function replacement(original, replayed, schema = 'id-confirmed') {
  // Preserve every original non-rating field and all Firestore value types.
  const players = original.fields.players.arrayValue.values || [];
  const matches = original.fields.matches.arrayValue.values || [];
  const playerById = new Map(replayed.players.map(p => [String(schema === 'named-history' ? p.name : p.id), p]));
  const matchById = new Map(replayed.matches.map((m, i) => [String(schema === 'named-history' ? i : m.id), m]));
  const patch = (entries, byId, keys) => entries.map(entry => {
    const copy = JSON.parse(JSON.stringify(entry));
    const id = String(decode(entry.mapValue.fields[schema === 'named-history' ? 'name' : 'id']));
    const record = byId.get(id);
    if (!record) throw new Error(`Replay lost a record: ${id}`);
    for (const key of keys) copy.mapValue.fields[key] = encode(record[key]);
    return copy;
  });
  return { fields: {
    players: { arrayValue: { values: patch(players, playerById, ['elo', 'rd', 'lastRatedAt', 'wins', 'losses']) } },
    matches: { arrayValue: { values: matches.map((entry, i) => {
      const record = matchById.get(String(schema === 'named-history' ? i : decode(entry.mapValue.fields.id)));
      if (schema === 'named-history') {
        const copy = JSON.parse(JSON.stringify(entry));
        for (const key of ['winnerChange', 'loserChange', 'ratingSystem', 'before']) copy.mapValue.fields[key] = encode(record[key]);
        return copy;
      }
      return record.eloApplied ? patch([entry], matchById, ['winnerChange', 'loserChange', 'ratingSystem'])[0] : entry;
    }) } },
    ratingSystem: encode(replayed.ratingSystem)
  } };
}
async function apply(url, token, original, replayed, fetcher = fetch, schema = 'id-confirmed') {
  if (!original.updateTime) throw new Error('Missing document updateTime; cannot safely apply.');
  const query = new URLSearchParams();
  for (const field of ['players', 'matches', 'ratingSystem']) query.append('updateMask.fieldPaths', field);
  query.set('currentDocument.updateTime', original.updateTime);
  const patch = replacement(original, replayed, schema);
  if (original.fields.revision) {
    const revision = decode(original.fields.revision);
    if (!Number.isSafeInteger(revision)) throw new Error('Invalid live revision.');
    patch.fields.revision = encode(revision + 1);
    query.append('updateMask.fieldPaths', 'revision');
  }
  if (original.fields.updatedAt) {
    const now = new Date().toISOString();
    patch.fields.updatedAt = 'timestampValue' in original.fields.updatedAt ? { timestampValue: now } : encode(now);
    query.append('updateMask.fieldPaths', 'updatedAt');
  }
  return request(`${url}?${query}`, token, { method: 'PATCH', body: JSON.stringify(patch) }, fetcher);
}
module.exports = { decode, encode, documentURL, request, replacement, apply };
