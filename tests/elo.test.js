const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const cases = [{ winner: 1000, loser: 1000, delta: 162 }];
const { createRequire } = require('node:module');
const { preview } = require('../ratings');
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

// Execute the real backend with a temporary database and no remote credentials.
async function startBackend(kind, ratings, history = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingpong-elo-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'data/db.json'), JSON.stringify({
    version: 1,
    accounts: [{ id: 'winner', name: 'Winner', username: 'winner', password: 'test-only' }],
    players: [
      { id: 'winner', name: 'Winner', elo: ratings.winner, wins: 0, losses: 0 },
      { id: 'loser', name: 'Loser', elo: ratings.loser, wins: 0, losses: 0 }
    ],
    matches: history
  }));
  let server;
  const context = vm.createContext({
    require(name) {
      if (name === 'http') return { createServer(handler) { server = http.createServer(handler); return server; } };
      if (name === 'path') return { ...path, join(...parts) {
        if (parts[0] === '/tmp' && parts[1] === 'data') return path.join(dir, 'tmp-data');
        return path.join(...parts);
      } };
      return createRequire(path.join(root, kind === 'server' ? 'server.js' : 'api/index.js'))(name);
    },
    __dirname: kind === 'server' ? dir : path.join(dir, 'api'),
    process: { env: { PORT: '0' } },
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    URL, fetch
  });
  const filename = kind === 'server' ? 'server.js' : 'api/index.js';
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  if (kind === 'api') {
    server = http.createServer(context.module.exports);
    server.listen(0, '127.0.0.1');
  }
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    async request(route, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    },
    async close() {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

for (const kind of ['server', 'api']) {
  for (const ratings of cases) {
    test(`${kind}: ${ratings.winner} vs ${ratings.loser} applies ±${ratings.delta} once and rolls back`, async () => {
      const backend = await startBackend(kind, ratings);
      try {
        const login = await backend.request('/api/auth/login', { username: 'winner', password: 'test-only' });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.id, 'winner');
        const report = await backend.request('/api/matches', {
          winnerId: 'winner', loserId: 'loser', reporterId: 'winner', score: '11-5'
        });
        assert.equal(report.status, 201);
        assert.equal(report.body.match.eloApplied, false);
        let data = (await backend.request('/api/data')).body;
        assert.equal(data.players[0].elo, ratings.winner);
        assert.equal(data.players[1].elo, ratings.loser);
        const route = `/api/matches/${report.body.match.id}`;
        const confirm = await backend.request(`${route}/confirm`, { userId: 'loser' });
        assert.equal(confirm.status, 200);
        assert.equal(confirm.body.eloApplied, true);
        close(confirm.body.match.winnerChange, ratings.delta);
        close(confirm.body.match.loserChange, ratings.delta);
        assert.equal((await backend.request(`${route}/confirm`, { userId: 'loser' })).status, 400);
        data = (await backend.request('/api/data')).body;
        close(data.players[0].elo, ratings.winner + ratings.delta);
        close(data.players[0].rd, 290.2305060910912);
        close(data.players[1].elo, ratings.loser - ratings.delta);
        assert.equal(data.players[0].wins, 1);
        assert.equal(data.players[1].losses, 1);
        assert.equal((await backend.request(`${route}/reject`, { userId: 'winner' })).status, 200);
        data = (await backend.request('/api/data')).body;
        assert.equal(data.players[0].elo, ratings.winner);
        assert.equal(data.players[1].elo, ratings.loser);
        assert.equal(data.players[0].wins, 0);
        assert.equal(data.players[1].losses, 0);
        assert.equal(data.matches.length, 0);
      } finally {
        await backend.close();
      }
    });
  }
}

test('browser preview shows Glicko changes', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = html.match(/function updateEloPreview\(\) \{[\s\S]*?\n\}/)[0];
  for (const ratings of cases) {
    const elements = {
      winner: { value: 'winner' }, loser: { value: 'loser' },
      eloPreview: { classList: { add() {}, remove() {} } }, eloPreviewText: {}
    };
    vm.runInNewContext(`${source}\nupdateEloPreview();`, {
      document: { getElementById: id => elements[id] },
      ClubRatings: { preview },
      clubState: { players: [{ id: 'winner', elo: ratings.winner }, { id: 'loser', elo: ratings.loser }] }
    });
    assert.equal(elements.eloPreviewText.textContent, `Winner +${Math.round(ratings.delta)} / Loser -${Math.round(ratings.delta)} rating`);
  }
});

for (const kind of ['server', 'api']) {
  test(`${kind}: backdated confirmation and historical removal replay later matches`, async () => {
    const history = [
      { id: 1, winnerId: 'winner', loserId: 'loser', date: '2026-01-01', eloApplied: false, confirmations: { winner: true, loser: false } },
      { id: 2, winnerId: 'loser', loserId: 'winner', date: '2026-01-02', eloApplied: true, winnerChange: 32, loserChange: 32 }
    ];
    const backend = await startBackend(kind, { winner: 1000, loser: 1000 }, history);
    try {
      const confirmation = await backend.request('/api/matches/1/confirm', { userId: 'loser' });
      assert.equal(confirmation.status, 200);
      let data = (await backend.request('/api/data')).body;
      close(data.matches[0].winnerChange, 162);
      assert.ok(data.matches[1].winnerChange > 162);
      assert.equal(data.players[0].wins, 1);
      assert.equal(data.players[0].losses, 1);
      assert.equal((await backend.request('/api/matches/1/reject', { userId: 'winner' })).status, 200);
      data = (await backend.request('/api/data')).body;
      assert.equal(data.matches.length, 1);
      close(data.matches[0].winnerChange, 162);
      close(data.players[0].elo, 838);
      assert.equal(data.players[0].wins, 0);
      assert.equal(data.players[0].losses, 1);
    } finally { await backend.close(); }
  });
}
