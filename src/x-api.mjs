export function createXApi({ bearerToken, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  async function getUserId(username) {
    const payload = await request(`/2/users/by/username/${encodeURIComponent(username)}`);
    if (!payload?.data?.id) throw new Error(`X user @${username} was not found.`);
    return String(payload.data.id);
  }

  async function getPosts(userId, { sinceId, includeReplies = false, includeReposts = false } = {}) {
    const posts = [];
    let paginationToken = "";
    const maxPages = sinceId ? 5 : 1;

    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({
        max_results: "100",
        "tweet.fields": "id,text,created_at,note_tweet",
      });
      if (sinceId) query.set("since_id", String(sinceId));
      if (paginationToken) query.set("pagination_token", paginationToken);
      const exclude = [];
      if (!includeReplies) exclude.push("replies");
      if (!includeReposts) exclude.push("retweets");
      if (exclude.length) query.set("exclude", exclude.join(","));

      const payload = await request(`/2/users/${encodeURIComponent(userId)}/tweets?${query}`);
      for (const item of payload.data || []) {
        posts.push({
          id: String(item.id),
          text: String(item.note_tweet?.text || item.text || ""),
          createdAt: item.created_at || null
        });
      }
      paginationToken = String(payload.meta?.next_token || "");
      if (!paginationToken) break;
    }

    return [...new Map(posts.map((post) => [post.id, post])).values()]
      .sort((left, right) => comparePostIds(left.id, right.id));
  }

  async function request(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`https://api.x.com${path}`, {
        headers: { authorization: `Bearer ${bearerToken}` },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.title || `X API returned HTTP ${response.status}.`);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { getUserId, getPosts };
}

export function comparePostIds(left, right) {
  if (/^\d+$/.test(String(left)) && /^\d+$/.test(String(right))) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a === b ? 0 : a > b ? 1 : -1;
  }
  return String(left).localeCompare(String(right));
}
