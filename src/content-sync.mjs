import { comparePostIds } from "./x-api.mjs";

export function createContentSync({ db, xApi, telegramApi, config, now = () => new Date() }) {
  seedMonitors(db, config.xMonitorUsernames, now().toISOString());
  let activeRun = null;

  async function syncNow(actor = "scheduler") {
    if (activeRun) {
      const result = await activeRun;
      return { ...result, joinedExistingRun: true };
    }
    activeRun = runSync(actor).finally(() => { activeRun = null; });
    return activeRun;
  }

  async function syncLatest(actor = "manual_latest") {
    if (activeRun) {
      const result = await activeRun;
      return { ...result, joinedExistingRun: true };
    }
    activeRun = runLatest(actor).finally(() => { activeRun = null; });
    return activeRun;
  }

  async function runLatest(actor) {
    const startedAt = now().toISOString();
    const result = { actor, startedAt, checked: 0, discovered: 0, sent: 0, existing: 0, failures: [] };

    for (const username of config.xMonitorUsernames) {
      const monitor = db.prepare("SELECT * FROM monitors WHERE username = ?").get(username);
      if (!monitor) continue;
      result.checked += 1;
      try {
        const userId = monitor.x_user_id || await xApi.getUserId(username);
        const posts = await xApi.getPosts(userId, {
          includeReplies: config.includeReplies,
          includeReposts: config.includeReposts
        });
        const post = posts.at(-1);
        if (!post) {
          markMonitorSuccess(db, username, userId, monitor.since_id, startedAt);
          continue;
        }

        const permalink = `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(post.id)}`;
        const existing = db.prepare("SELECT status FROM posts WHERE post_id = ?").get(post.id);
        if (existing?.status === "sent") {
          result.existing += 1;
        } else {
          if (insertPost(db, post, username, permalink, now().toISOString())) result.discovered += 1;
          await deliverPost(db, telegramApi, config, post, username, permalink, now);
          result.sent += 1;
        }
        markMonitorSuccess(db, username, userId, maxPostId(monitor.since_id, post.id), startedAt);
      } catch (error) {
        const message = cleanError(error);
        db.prepare("UPDATE monitors SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE username = ?")
          .run(startedAt, message, startedAt, username);
        result.failures.push({ username, error: message });
      }
    }
    return result;
  }

  async function runSync(actor) {
    const startedAt = now().toISOString();
    const result = { actor, startedAt, checked: 0, initialized: 0, discovered: 0, sent: 0, existing: 0, failures: [] };

    for (const username of config.xMonitorUsernames) {
      const monitor = db.prepare("SELECT * FROM monitors WHERE username = ?").get(username);
      if (!monitor) continue;
      result.checked += 1;
      try {
        const userId = monitor.x_user_id || await xApi.getUserId(username);
        const posts = await xApi.getPosts(userId, {
          sinceId: monitor.since_id,
          includeReplies: config.includeReplies,
          includeReposts: config.includeReposts
        });

        if (!monitor.initialized && !config.pushExistingOnStart) {
          const newest = posts.at(-1)?.id || monitor.since_id || null;
          markMonitorSuccess(db, username, userId, newest, startedAt);
          result.initialized += 1;
          continue;
        }

        let checkpoint = monitor.since_id || null;
        for (const post of posts) {
          if (checkpoint && comparePostIds(post.id, checkpoint) <= 0) continue;
          const permalink = `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(post.id)}`;
          const inserted = insertPost(db, post, username, permalink, now().toISOString());
          if (!inserted) {
            const existing = db.prepare("SELECT status FROM posts WHERE post_id = ?").get(post.id);
            if (existing?.status === "sent") {
              checkpoint = maxPostId(checkpoint, post.id);
              result.existing += 1;
              continue;
            }
          } else {
            result.discovered += 1;
          }

          await deliverPost(db, telegramApi, config, post, username, permalink, now);
          checkpoint = maxPostId(checkpoint, post.id);
          result.sent += 1;
        }
        markMonitorSuccess(db, username, userId, checkpoint, startedAt);
      } catch (error) {
        const message = cleanError(error);
        db.prepare("UPDATE monitors SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE username = ?")
          .run(startedAt, message, startedAt, username);
        result.failures.push({ username, error: message });
      }
    }

    return result;
  }

  function overview() {
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM posts
    `).get();
    return {
      monitors: db.prepare("SELECT * FROM monitors ORDER BY username COLLATE NOCASE").all().map(presentMonitor),
      summary: {
        posts: Number(summary.total || 0),
        sent: Number(summary.sent || 0),
        pending: Number(summary.pending || 0),
        failed: Number(summary.failed || 0)
      },
      recentPosts: db.prepare("SELECT * FROM posts ORDER BY COALESCE(post_created_at, created_at) DESC, post_id DESC LIMIT 50").all().map(presentPost)
    };
  }

  return { syncNow, syncLatest, overview };
}

async function deliverPost(db, telegramApi, config, post, username, permalink, now) {
  const row = db.prepare("SELECT status, attempts FROM posts WHERE post_id = ?").get(post.id);
  if (row?.status === "sent") return;

  const attempts = Number(row?.attempts || 0) + 1;
  db.prepare("UPDATE posts SET status = 'pending', attempts = ?, last_error = NULL, updated_at = ? WHERE post_id = ?")
    .run(attempts, now().toISOString(), post.id);
  try {
    await telegramApi.sendMessage({
      chat_id: config.telegramChatId,
      ...(config.telegramMessageThreadId ? { message_thread_id: Number(config.telegramMessageThreadId) } : {}),
      text: formatMessage(config.forwardMode, username, post.text, permalink),
      disable_web_page_preview: false,
      reply_markup: { inline_keyboard: [[{ text: "View on X", url: permalink }]] }
    });
    const sentAt = now().toISOString();
    db.prepare("UPDATE posts SET status = 'sent', sent_at = COALESCE(sent_at, ?), last_error = NULL, updated_at = ? WHERE post_id = ?")
      .run(sentAt, sentAt, post.id);
  } catch (error) {
    const message = cleanError(error);
    db.prepare("UPDATE posts SET status = 'failed', last_error = ?, updated_at = ? WHERE post_id = ?")
      .run(message, now().toISOString(), post.id);
    throw new Error(`Post ${post.id} could not be sent to Telegram: ${message}`);
  }
}

function seedMonitors(db, usernames, at) {
  const statement = db.prepare("INSERT OR IGNORE INTO monitors (username, created_at, updated_at) VALUES (?, ?, ?)");
  for (const username of usernames) statement.run(username, at, at);
}

function insertPost(db, post, username, permalink, at) {
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO posts (
      post_id, username, text, post_created_at, permalink, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(post.id, username, post.text, post.createdAt, permalink, at, at);
  return Boolean(inserted.changes);
}

function markMonitorSuccess(db, username, userId, sinceId, at) {
  db.prepare(`
    UPDATE monitors
    SET x_user_id = ?, since_id = ?, initialized = 1, last_checked_at = ?,
        last_success_at = ?, last_error = NULL, updated_at = ?
    WHERE username = ?
  `).run(userId, sinceId || null, at, at, at, username);
}

function formatMessage(mode, username, text, permalink) {
  if (mode === "link") return `New post from @${username}\n\n${permalink}`;
  return `New post from @${username}\n\n${truncate(text, 3800)}\n\n${permalink}`;
}

function presentMonitor(row) {
  return {
    username: row.username,
    userId: row.x_user_id,
    sinceId: row.since_id,
    initialized: Boolean(row.initialized),
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error
  };
}

function presentPost(row) {
  return {
    id: row.post_id,
    username: row.username,
    text: row.text,
    createdAt: row.post_created_at,
    permalink: row.permalink,
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error,
    sentAt: row.sent_at
  };
}

function maxPostId(left, right) {
  if (!left) return right;
  return comparePostIds(left, right) >= 0 ? left : right;
}

function truncate(value, maximum) {
  const text = String(value || "");
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

function cleanError(error) {
  return String(error?.name === "AbortError" ? "Request timed out." : error?.message || error || "Unknown error").slice(0, 500);
}
