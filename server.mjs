import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configFromEnv, validateConfig } from "./src/config.mjs";
import { openDatabase } from "./src/db.mjs";
import { createXApi } from "./src/x-api.mjs";
import { createTelegramApi } from "./src/telegram.mjs";
import { createContentSync } from "./src/content-sync.mjs";

await loadEnv(resolve(".env"));
const config = configFromEnv();
const db = await openDatabase(config.dbPath);
let contentSync;
let lastSync = null;
let syncError = null;

try {
  validateConfig(config);
  contentSync = createContentSync({
    db,
    config,
    xApi: createXApi({ bearerToken: config.xBearerToken, timeoutMs: config.requestTimeoutMs }),
    telegramApi: createTelegramApi({ botToken: config.telegramBotToken, timeoutMs: config.requestTimeoutMs })
  });
} catch (error) {
  syncError = error;
  console.error(error.message);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, contentSync && !syncError ? 200 : 503, {
        ok: Boolean(contentSync && !syncError),
        configured: Boolean(contentSync && !syncError),
        lastSync,
        error: syncError?.message || null,
        overview: contentSync?.overview() || null
      });
    }
    if (request.method === "POST" && url.pathname === "/sync") {
      if (!config.syncAdminToken || request.headers.authorization !== `Bearer ${config.syncAdminToken}`) {
        return sendJson(response, 401, { error: "sync_auth_required" });
      }
      if (!contentSync || syncError) return sendJson(response, 503, { error: "not_configured", message: syncError?.message });
      const result = await runSync("manual");
      return sendJson(response, result.failures?.length ? 207 : 200, result);
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "internal_error", message: error.message });
  }
});

const timer = contentSync ? setInterval(() => {
  runSync("scheduler").catch((error) => console.error("Scheduled sync failed", error));
}, config.pollIntervalSeconds * 1000) : null;
timer?.unref();

server.listen(config.port, config.host, () => {
  console.log(`X to Telegram listening on http://${config.host}:${config.port}`);
  if (contentSync) runSync("startup").catch((error) => console.error("Startup sync failed", error));
});

async function runSync(actor) {
  const result = await contentSync.syncNow(actor);
  lastSync = { at: new Date().toISOString(), ...result };
  return result;
}

async function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function loadEnv(path) {
  return readFile(path, "utf8").then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function shutdown() {
  if (timer) clearInterval(timer);
  await new Promise((resolveClose) => server.close(resolveClose));
  db.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
