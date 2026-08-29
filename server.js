const http = require("http");
const fs = require("fs");
const path = require("path");

// Render assigns process.env.PORT automatically
const PORT = process.env.PORT || 8000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.warn("Could not create data dir:", err);
  }
}

// Initial clean database: 0 accounts, 0 players, 0 matches
const INITIAL_DB = {
  version: 1,
  accounts: [],
  players: [],
  matches: []
};

// Database loader
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    saveDb(INITIAL_DB);
    return JSON.parse(JSON.stringify(INITIAL_DB));
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    saveDb(INITIAL_DB);
    return JSON.parse(JSON.stringify(INITIAL_DB));
  }
}

// Atomic file write
function saveDb(data) {
  try {
    const tempFile = DB_FILE + ".tmp";
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.error("Error saving database:", e);
    }
  }
}

let db = loadDb();

// Elo Calculation Engine
const K_FACTOR = 32;

function expectedProbability(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function calculateEloGain(winnerElo, loserElo) {
  const prob = expectedProbability(winnerElo, loserElo);
  const change = Math.round(K_FACTOR * (1 - prob));
  return Math.max(1, change);
}

// Helper: Parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// Helper: Send JSON response
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end(JSON.stringify(payload));
}

// MIME types for static files
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // ==========================================
  // API ENDPOINTS
  // ==========================================

  // 1. GET /api/data
  if (req.method === "GET" && pathname === "/api/data") {
    const publicPlayers = (db.players || []).map(p => ({
      id: p.id,
      name: p.name,
      username: p.username,
      elo: p.elo,
      wins: p.wins || 0,
      losses: p.losses || 0
    }));

    return sendJson(res, 200, {
      success: true,
      players: publicPlayers,
      matches: db.matches || [],
      serverTime: new Date().toISOString()
    });
  }

  // 2. POST /api/auth/signup
  if (req.method === "POST" && pathname === "/api/auth/signup") {
    try {
      const body = await parseJsonBody(req);
      const name = (body.name || "").trim();
      const username = (body.username || "").trim().toLowerCase();
      const password = body.password || "";

      if (!name || !username || !password) {
        return sendJson(res, 400, { error: "Name, username, and password are required." });
      }

      if (password.length < 4) {
        return sendJson(res, 400, { error: "Password must be at least 4 characters." });
      }

      const exists = (db.accounts || []).some(a => a.username.toLowerCase() === username);
      if (exists) {
        return sendJson(res, 409, { error: `Username "${username}" is already taken.` });
      }

      const playerId = Date.now();
      const newAccount = {
        id: playerId,
        name,
        username,
        password,
        createdAt: new Date().toISOString()
      };

      const newPlayer = {
        id: playerId,
        accountId: playerId,
        name,
        username,
        elo: 1000,
        wins: 0,
        losses: 0
      };

      if (!db.accounts) db.accounts = [];
      if (!db.players) db.players = [];

      db.accounts.push(newAccount);
      db.players.push(newPlayer);
      saveDb(db);

      console.log(`[AUTH] New player registered: ${name} (@${username})`);

      return sendJson(res, 201, {
        success: true,
        user: {
          id: newPlayer.id,
          name: newPlayer.name,
          username: newPlayer.username,
          elo: newPlayer.elo,
          wins: 0,
          losses: 0
        }
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 3. POST /api/auth/login
  if (req.method === "POST" && pathname === "/api/auth/login") {
    try {
      const body = await parseJsonBody(req);
      const username = (body.username || "").trim().toLowerCase();
      const password = body.password || "";

      const account = (db.accounts || []).find(a => a.username.toLowerCase() === username && a.password === password);
      if (!account) {
        return sendJson(res, 401, { error: "Incorrect username or password." });
      }

      const player = (db.players || []).find(p => String(p.id) === String(account.id)) || {
        id: account.id,
        name: account.name,
        username: account.username,
        elo: 1000,
        wins: 0,
        losses: 0
      };

      console.log(`[AUTH] Player logged in: ${player.name} (@${player.username})`);

      return sendJson(res, 200, {
        success: true,
        user: {
          id: player.id,
          name: player.name,
          username: player.username,
          elo: player.elo,
          wins: player.wins || 0,
          losses: player.losses || 0
        }
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 4. POST /api/auth/delete-account
  if (req.method === "POST" && pathname === "/api/auth/delete-account") {
    try {
      const body = await parseJsonBody(req);
      const userId = body.userId;

      if (!userId) {
        return sendJson(res, 400, { error: "User ID is required." });
      }

      const accIdx = (db.accounts || []).findIndex(a => String(a.id) === String(userId));
      const playerIdx = (db.players || []).findIndex(p => String(p.id) === String(userId));

      if (accIdx === -1 && playerIdx === -1) {
        return sendJson(res, 404, { error: "Account not found." });
      }

      const playerName = (db.players[playerIdx] || db.accounts[accIdx] || {}).name || "Player";

      if (accIdx !== -1) db.accounts.splice(accIdx, 1);
      if (playerIdx !== -1) db.players.splice(playerIdx, 1);

      db.matches = (db.matches || []).filter(m => {
        if (!m.eloApplied && (String(m.winnerId) === String(userId) || String(m.loserId) === String(userId))) {
          return false;
        }
        return true;
      });

      saveDb(db);
      console.log(`[AUTH] Account deleted: ${playerName} (ID: ${userId})`);

      return sendJson(res, 200, {
        success: true,
        message: `Account for ${playerName} was deleted.`
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 5. POST /api/matches
  if (req.method === "POST" && pathname === "/api/matches") {
    try {
      const body = await parseJsonBody(req);
      const winnerId = body.winnerId;
      const loserId = body.loserId;
      const reporterId = body.reporterId;
      const score = (body.score || "").trim() || "Score unrecorded";

      if (!winnerId || !loserId) {
        return sendJson(res, 400, { error: "Winner and loser are required." });
      }

      if (String(winnerId) === String(loserId)) {
        return sendJson(res, 400, { error: "Winner and loser must be different players." });
      }

      const winner = (db.players || []).find(p => String(p.id) === String(winnerId));
      const loser = (db.players || []).find(p => String(p.id) === String(loserId));

      if (!winner || !loser) {
        return sendJson(res, 404, { error: "Player records not found." });
      }

      const isReporterWinner = String(reporterId) === String(winner.id);
      const isReporterLoser = String(reporterId) === String(loser.id);

      if (!isReporterWinner && !isReporterLoser) {
        return sendJson(res, 403, { error: "Only a player involved in the match can submit the result." });
      }

      const matchId = Date.now();
      const newMatch = {
        id: matchId,
        winnerId: winner.id,
        loserId: loser.id,
        winnerName: winner.name,
        loserName: loser.name,
        score,
        date: new Date().toISOString(),
        winnerChange: null,
        loserChange: null,
        confirmations: {
          [winner.id]: isReporterWinner,
          [loser.id]: isReporterLoser
        },
        eloApplied: false
      };

      if (!db.matches) db.matches = [];
      db.matches.push(newMatch);
      saveDb(db);

      console.log(`[MATCH] Reported: ${winner.name} def. ${loser.name} (${score})`);

      return sendJson(res, 201, {
        success: true,
        match: newMatch
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 6. POST /api/matches/:id/confirm
  const matchConfirmRegex = /^\/api\/matches\/(\d+)\/confirm$/;
  if (req.method === "POST" && matchConfirmRegex.test(pathname)) {
    try {
      const matchId = pathname.match(matchConfirmRegex)[1];
      const body = await parseJsonBody(req);
      const userId = body.userId;

      const match = (db.matches || []).find(m => String(m.id) === String(matchId));
      if (!match) {
        return sendJson(res, 404, { error: "Match not found." });
      }

      const isWinner = String(userId) === String(match.winnerId);
      const isLoser = String(userId) === String(match.loserId);

      if (!isWinner && !isLoser) {
        return sendJson(res, 403, { error: "Only participants can confirm this match." });
      }

      if (match.eloApplied) {
        return sendJson(res, 400, { error: "Match is already finalized." });
      }

      if (!match.confirmations) match.confirmations = {};
      if (isWinner) match.confirmations[match.winnerId] = true;
      if (isLoser) match.confirmations[match.loserId] = true;

      const winnerConfirmed = !!match.confirmations[match.winnerId];
      const loserConfirmed = !!match.confirmations[match.loserId];

      let eloApplied = false;

      if (winnerConfirmed && loserConfirmed) {
        const winner = (db.players || []).find(p => String(p.id) === String(match.winnerId));
        const loser = (db.players || []).find(p => String(p.id) === String(match.loserId));

        if (winner && loser) {
          const delta = calculateEloGain(winner.elo, loser.elo);
          winner.elo += delta;
          loser.elo = Math.max(100, loser.elo - delta);
          winner.wins = (winner.wins || 0) + 1;
          loser.losses = (loser.losses || 0) + 1;

          match.winnerChange = delta;
          match.loserChange = delta;
          match.eloApplied = true;
          eloApplied = true;

          console.log(`[ELO] Finalized: ${winner.name} (+${delta} -> ${winner.elo}) vs ${loser.name} (-${delta} -> ${loser.elo})`);
        }
      }

      saveDb(db);

      return sendJson(res, 200, {
        success: true,
        match,
        eloApplied
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 7. POST /api/matches/:id/reject
  const matchRejectRegex = /^\/api\/matches\/(\d+)\/reject$/;
  if (req.method === "POST" && matchRejectRegex.test(pathname)) {
    try {
      const matchId = pathname.match(matchRejectRegex)[1];
      const body = await parseJsonBody(req);
      const userId = body.userId;

      const matchIdx = (db.matches || []).findIndex(m => String(m.id) === String(matchId));
      if (matchIdx === -1) {
        return sendJson(res, 404, { error: "Match not found." });
      }

      const match = db.matches[matchIdx];
      const isWinner = String(userId) === String(match.winnerId);
      const isLoser = String(userId) === String(match.loserId);

      if (!isWinner && !isLoser) {
        return sendJson(res, 403, { error: "Unauthorized: You cannot reject this match." });
      }

      if (match.eloApplied) {
        const winner = (db.players || []).find(p => String(p.id) === String(match.winnerId));
        const loser = (db.players || []).find(p => String(p.id) === String(match.loserId));

        if (winner && match.winnerChange) {
          winner.elo = Math.max(100, winner.elo - match.winnerChange);
          winner.wins = Math.max(0, (winner.wins || 0) - 1);
        }
        if (loser && match.loserChange) {
          loser.elo += match.loserChange;
          loser.losses = Math.max(0, (loser.losses || 0) - 1);
        }
      }

      db.matches.splice(matchIdx, 1);
      saveDb(db);

      console.log(`[MATCH] Removed match id: ${matchId}`);

      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 8. POST /api/reset
  if (req.method === "POST" && pathname === "/api/reset") {
    db = JSON.parse(JSON.stringify(INITIAL_DB));
    saveDb(db);
    return sendJson(res, 200, { success: true, message: "Database wiped to clean slate." });
  }

  // ==========================================
  // STATIC FILE SERVING
  // ==========================================
  let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache"
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const indexPath = path.join(__dirname, "index.html");
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(indexPath).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`===================================================`);
  console.log(`🏓 Carroll Ping Pong Club Server Running`);
  console.log(`📡 URL: http://0.0.0.0:${PORT}`);
  console.log(`===================================================`);
});
