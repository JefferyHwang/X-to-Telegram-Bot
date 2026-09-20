export function createTelegramApi({ botToken, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  async function sendMessage(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({ ok: false, description: `Telegram returned HTTP ${response.status}.` }));
      if (!response.ok || !result.ok) {
        throw new Error(result.description || `Telegram returned HTTP ${response.status}.`);
      }
      return result.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { sendMessage };
}
