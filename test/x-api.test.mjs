import test from "node:test";
import assert from "node:assert/strict";
import { createXApi } from "../src/x-api.mjs";

test("X API client resolves users and returns posts oldest first", async () => {
  const urls = [];
  const api = createXApi({
    bearerToken: "token",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("by/username")) return response({ data: { id: "42" } });
      return response({
        data: [
          { id: "102", text: "new" },
          { id: "101", note_tweet: { text: "old note tweet" } }
        ],
        meta: {}
      });
    }
  });

  assert.equal(await api.getUserId("perpvia"), "42");
  const posts = await api.getPosts("42", { includeReplies: false, includeReposts: false });
  assert.deepEqual(posts.map((post) => post.id), ["101", "102"]);
  assert.equal(posts[0].text, "old note tweet");
  assert.match(urls[1], /exclude=replies%2Cretweets/);
});

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
