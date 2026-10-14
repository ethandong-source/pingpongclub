#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { prepare } = require('./club-schema');
const firestore = require('./firestore');

async function main() {
  // Node 24 must explicitly use the cloud HTTPS proxy for native fetch.
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) require('node:http').setGlobalProxyFromEnv();
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') { options.apply = true; continue; }
    if (!['--plan-dir', '--input', '--project', '--document', '--starting-rating'].includes(args[i]) || args[i + 1] === undefined) throw new Error('Unknown or incomplete argument.');
    options[args[i].slice(2)] = args[++i];
  }
  if (!options['plan-dir']) throw new Error('Specify --plan-dir. Prepare first; --apply performs the live update.');
  const dir = path.resolve(options['plan-dir']);
  const token = process.env.FIRESTORE_ACCESS_TOKEN;
  const save = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (options.apply) {
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    if (plan.source !== 'firestore') throw new Error('A local export plan cannot be applied to Firestore; prepare from the live document first.');
    const original = JSON.parse(fs.readFileSync(path.join(dir, 'original.json'), 'utf8'));
    const prepared = JSON.parse(fs.readFileSync(path.join(dir, 'replayed.json'), 'utf8'));
    const fields = original.fields;
    const recalculated = prepare({ players: firestore.decode(fields.players), matches: firestore.decode(fields.matches) }, plan.settings);
    assert.deepEqual(prepared, recalculated.database, 'Prepared output differs from reproducible replay.');
    const url = firestore.documentURL(plan.project, plan.document);
    const current = await firestore.request(url, token);
    if (current.updateTime !== original.updateTime) throw new Error('Live document changed since preparation. Prepare a new plan before applying.');
    const updated = await firestore.apply(url, token, original, prepared, fetch, recalculated.schema);
    const expected = firestore.replacement(original, prepared, recalculated.schema).fields;
    for (const key of Object.keys(expected)) assert.deepEqual(firestore.decode(updated.fields[key]), firestore.decode(expected[key]));
    save('applied.json', { updateTime: updated.updateTime, appliedMatches: recalculated.appliedMatches, players: prepared.players.length });
    console.log('Firestore update applied and returned ratings verified.');
    return;
  }
  const project = options.project || 'carrollpingpongclub';
  const document = options.document || 'clubs/carroll-pingpong';
  let original, database;
  if (options.input) {
    original = JSON.parse(fs.readFileSync(options.input, 'utf8'));
    database = original.data && Array.isArray(original.data.players) ? original.data : original;
  } else {
    original = await firestore.request(firestore.documentURL(project, document), token);
    if (!original.fields?.players?.arrayValue || !original.fields?.matches?.arrayValue) {
      throw new Error(`Unsupported live schema. Expected players/matches arrays; available field names: ${Object.keys(original.fields || {}).join(', ')}. Inspect before migration.`);
    }
    database = { players: firestore.decode(original.fields.players), matches: firestore.decode(original.fields.matches) };
  }
  const config = options['starting-rating'] === undefined ? {} : { startingRating: Number(options['starting-rating']) };
  const result = prepare(database, config);
  const report = {
    appliedMatches: result.appliedMatches, pendingMatches: result.pendingMatches,
    players: result.database.players.map((player, i) => ({ id: player.id, name: player.name, oldRating: database.players[i].elo, newRating: player.elo, rd: player.rd, wins: player.wins, losses: player.losses }))
  };
  fs.mkdirSync(dir, { mode: 0o700 });
  save('original.json', original);
  save('replayed.json', result.database);
  save('report.json', report);
  save('plan.json', { source: options.input ? 'local' : 'firestore', project, document, schema: result.schema, settings: result.database.ratingSystem });
  console.log(`Prepared ${result.appliedMatches} confirmed matches and ${result.database.players.length} players; ${result.pendingMatches} pending matches excluded. Live data unchanged. Report: ${path.join(dir, 'report.json')}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
