const DEFAULTS = Object.freeze({
  host: "0.0.0.0",
  port: 3000,
  dbPath: "./data/x-to-telegram.sqlite",
  pushExistingOnStart: false,
  includeReplies: false,
  includeReposts: false,
  pollIntervalSeconds: 300,
  requestTimeoutMs: 15000,
  forwardMode: "link"
});

export function configFromEnv(env = process.env) {
  const config = {
    ...DEFAULTS,
    host: String(env.HOST || DEFAULTS.host),
    port: integerValue(env.PORT, DEFAULTS.port, 1, 65535, "PORT"),
    dbPath: String(env.DB_PATH || DEFAULTS.dbPath),
    telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
    telegramChatId: String(env.TELEGRAM_CHAT_ID || "").trim(),
    xBearerToken: String(env.X_BEARER_TOKEN || "").trim(),
    xMonitorUsernames: uniqueUsernames(env.X_MONITOR_USERNAMES),
    pushExistingOnStart: booleanValue(env.X_PUSH_EXISTING_ON_START, DEFAULTS.pushExistingOnStart),
    includeReplies: booleanValue(env.X_INCLUDE_REPLIES, DEFAULTS.includeReplies),
    includeReposts: booleanValue(env.X_INCLUDE_REPOSTS, DEFAULTS.includeReposts),
    pollIntervalSeconds: integerValue(env.X_POLL_INTERVAL_SECONDS, DEFAULTS.pollIntervalSeconds, 30, 86400, "X_POLL_INTERVAL_SECONDS"),
    requestTimeoutMs: integerValue(env.X_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs, 1000, 120000, "X_REQUEST_TIMEOUT_MS"),
    forwardMode: forwardModeValue(env.X_FORWARD_MODE),
    syncAdminToken: String(env.SYNC_ADMIN_TOKEN || "").trim()
  };
  return config;
}

export function validateConfig(config) {
  const missing = [];
  if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegramChatId) missing.push("TELEGRAM_CHAT_ID");
  if (!config.xBearerToken) missing.push("X_BEARER_TOKEN");
  if (!config.xMonitorUsernames.length) missing.push("X_MONITOR_USERNAMES");
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
}

function uniqueUsernames(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/^@/, "").toLowerCase())
    .filter((item) => /^[a-z0-9_]{1,15}$/i.test(item)))];
}

function booleanValue(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function integerValue(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function forwardModeValue(value) {
  const mode = String(value || DEFAULTS.forwardMode).trim().toLowerCase();
  if (!['link', 'link_and_text'].includes(mode)) {
    throw new Error("X_FORWARD_MODE must be 'link' or 'link_and_text'.");
  }
  return mode;
}
