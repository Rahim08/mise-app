import { initDb } from "./db/schema";
import { createWsServer } from "./ws/server";
import { registerMdns } from "./mdns";
import { startSyncQueue } from "./sync/queue";
import { createApiRouter } from "./api/routes";
import { config } from "./config";

console.log("🍽  Mise POS Server starting...");

// 1. Initialize local SQLite database
const db = initDb(config.dbPath);
console.log(`✓ SQLite ready: ${config.dbPath}`);

// 2. Start WebSocket server (real-time LAN communication)
const wss = createWsServer(db);
console.log(`✓ WebSocket server on :${config.wsPort}`);

// 3. Start HTTP server (REST API for iOS clients)
const apiRouter = createApiRouter(db);

const httpServer = Bun.serve({
  port: config.httpPort,
  async fetch(req) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = httpServer.upgrade(req, {
        data: { connectedAt: Date.now(), deviceId: null, role: null },
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return apiRouter(req);
  },
  websocket: wss,
});

console.log(`✓ HTTP server on :${config.httpPort}`);
console.log(`  WS endpoint: ws://localhost:${config.httpPort}/ws`);

// 4. Register mDNS so iOS devices find us automatically
registerMdns(config.httpPort);
console.log(`✓ mDNS registered as "${config.serviceName}.${config.serviceType}"`);

// 5. Start background Supabase sync
if (config.supabaseUrl && config.supabaseServiceKey) {
  startSyncQueue(db);
  console.log(`✓ Supabase sync started (interval: ${config.syncIntervalMs}ms)`);
} else {
  console.log("⚠  Supabase not configured — running in local-only mode");
}

console.log("\n🟢 Mise POS Server ready");
console.log(`   Local:   http://localhost:${config.httpPort}`);
console.log(`   Network: http://mise-pos.local:${config.httpPort}\n`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  db.close();
  process.exit(0);
});
