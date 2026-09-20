import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createContentSync } from "../src/content-sync.mjs";

test("initial poll creates a cursor without replaying history", async (context) => {
  const db = testDb(context);
  const sent = [];
  const module = createContentSync({
    db,
    config: config(),
    xApi: {
      getUserId: async () => "42",
      getPosts: async () => [{ id: "100", text: "old", createdAt: "2026-09-01T00:00:00.000Z" }]
    },
    telegramApi: { sendMessage: async (payload) => sent.push(payload) }
  });

  const result = await module.syncNow("test");
  assert.equal(result.initialized, 1);
  assert.equal(sent.length, 0);
  assert.equal(module.overview().monitors[0].sinceId, "100");
});

test("new posts are sent once and failed sends are retried", async (context) => {
  const db = testDb(context);
  const sent = [];
  let fail = true;
  let poll = 0;
  const module = createContentSync({
    db,
    config: config({ pushExistingOnStart: true, forwardMode: "link" }),
    xApi: {
      getUserId: async () => "42",
      getPosts: async () => {
        poll += 1;
        return poll === 1
          ? [{ id: "101", text: "first", createdAt: null }, { id: "102", text: "second", createdAt: null }]
          : [{ id: "101", text: "first", createdAt: null }, { id: "102", text: "second", createdAt: null }];
      }
    },
    telegramApi: {
      sendMessage: async (payload) => {
        if (fail) {
          fail = false;
          throw new Error("temporary Telegram failure");
        }
        sent.push(payload);
      }
    }
  });

  const first = await module.syncNow("test");
  assert.equal(first.failures.length, 1);
  assert.equal(sent.length, 0);

  const second = await module.syncNow("test");
  assert.equal(second.sent, 2);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /status\/101$/);
  assert.equal(module.overview().summary.sent, 2);

  const third = await module.syncNow("test");
  assert.equal(third.sent, 0);
  assert.equal(sent.length, 2);
});

test("latest sync sends the most recent post even after normal initialization", async (context) => {
  const db = testDb(context);
  const sent = [];
  const module = createContentSync({
    db,
    config: config(),
    xApi: {
      getUserId: async () => "42",
      getPosts: async () => [
        { id: "100", text: "old", createdAt: null },
        { id: "101", text: "latest", createdAt: null }
      ]
    },
    telegramApi: { sendMessage: async (payload) => sent.push(payload) }
  });

  await module.syncNow("startup");
  const result = await module.syncLatest("test");
  assert.equal(result.sent, 1);
  assert.equal(result.existing, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /status\/101$/);

  const duplicate = await module.syncLatest("test");
  assert.equal(duplicate.sent, 0);
  assert.equal(duplicate.existing, 1);
  assert.equal(sent.length, 1);
});

test("configured forum topic is included in Telegram messages", async (context) => {
  const db = testDb(context);
  const sent = [];
  const module = createContentSync({
    db,
    config: config({ pushExistingOnStart: true, telegramMessageThreadId: "123" }),
    xApi: {
      getUserId: async () => "42",
      getPosts: async () => [{ id: "200", text: "topic post", createdAt: null }]
    },
    telegramApi: { sendMessage: async (payload) => sent.push(payload) }
  });

  await module.syncNow("test");
  assert.equal(sent[0].message_thread_id, 123);
});

function config(overrides = {}) {
  return {
    telegramChatId: "-1001",
    xMonitorUsernames: ["perpvia"],
    pushExistingOnStart: false,
    includeReplies: false,
    includeReposts: false,
    forwardMode: "link",
    ...overrides
  };
}

function testDb(context) {
  const db = new DatabaseSync(":memory:");
  context.after(() => db.close());
  db.exec(`
    CREATE TABLE monitors (
      username TEXT PRIMARY KEY COLLATE NOCASE, x_user_id TEXT, since_id TEXT,
      initialized INTEGER NOT NULL DEFAULT 0, last_checked_at TEXT, last_success_at TEXT,
      last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE posts (
      post_id TEXT PRIMARY KEY, username TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      post_created_at TEXT, permalink TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL,
      sent_at TEXT, updated_at TEXT NOT NULL
    );
  `);
  return db;
}
