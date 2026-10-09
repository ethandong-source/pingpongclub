"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { handle } = require("./lib/club");

// Serve only the frontend. Never expose data files, environment files or backend source.
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return handle(req, res);
  if (!["GET", "HEAD"].includes(req.method) || !["/", "/index.html"].includes(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  try {
    const html = await fs.readFile(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(req.method === "HEAD" ? undefined : html);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Could not load the website.");
  }
});
require("./lib/admin-auth").getAdmin().then(() => {
  server.listen(process.env.PORT || 8000, "0.0.0.0", () => console.log("Ping Pong Club server started."));
}).catch(error => { console.error("Could not initialize Firestore:", error.message); process.exit(1); });
