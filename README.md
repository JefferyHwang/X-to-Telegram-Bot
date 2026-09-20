# X to Telegram

一个只负责“监控 X/Twitter 账号并把新推文链接发送到 Telegram 群组或频道”的独立服务。

- 通过 X API v2 按用户名轮询新帖子
- 默认不转发首次启动前的历史帖子
- SQLite 保存每个账号的 `since_id`，避免重复转发
- Telegram 发送失败时保留失败记录，下一次轮询自动重试
- 支持多个账号、排除回复和转推
- 支持只发送链接，或发送链接加推文正文

## 配置

```sh
cp .env.example .env
```

需要准备：

1. 在 Telegram 用 `@BotFather` 创建 Bot，拿到 `TELEGRAM_BOT_TOKEN`。
2. 把 Bot 加入目标群组或频道，并让它拥有发消息权限。
3. 将目标群组或频道的 ID 写入 `TELEGRAM_CHAT_ID`。频道 ID 通常是类似 `-100...` 的数字。
4. 在 X Developer Portal 创建应用，拿到 X API v2 Bearer Token，写入 `X_BEARER_TOKEN`。
5. 在 `X_MONITOR_USERNAMES` 中填写要监控的账号，例如 `perpvia,openai`，不要写 `@` 也可以。

默认 `X_FORWARD_MODE=link`，发送消息示例：

```text
New post from @perpvia

https://x.com/perpvia/status/123456789
```

如果要同时带正文，设置 `X_FORWARD_MODE=link_and_text`。

## 运行

```sh
npm start
```

启动后会立即执行一次同步，之后按照 `X_POLL_INTERVAL_SECONDS` 轮询。健康检查：

```sh
curl http://localhost:3000/health
```

可选地配置 `SYNC_ADMIN_TOKEN`，然后手动触发同步：

```sh
curl -X POST http://localhost:3000/sync \
  -H "Authorization: Bearer your-sync-token"
```

如果想立即把每个监控账号最近的一条推文同步到 Telegram，使用：

```sh
curl -X POST http://localhost:3000/sync/latest \
  -H "Authorization: Bearer your-sync-token"
```

这个接口不会重复发送已经成功发送过的最近推文；如果已经发送过，会在结果中显示 `existing: 1`。

## 首次启动行为

默认情况下，首次同步只记录每个账号当前最新帖子的 ID，不会把历史消息刷到 Telegram。确认配置正确后，如需从首次拉取到的帖子开始转发，设置：

```env
X_PUSH_EXISTING_ON_START=true
```

## 部署

服务需要持久化 `DB_PATH` 指向的目录，否则部署平台重启后会丢失去重游标。Docker 示例：

```sh
docker build -t x-to-telegram .
docker run --env-file .env -p 3000:3000 -v "$PWD/data:/app/data" x-to-telegram
```

## 测试

```sh
npm test
```

X API 和 Telegram API 都使用官方 HTTP API，代码没有引入第三方运行时依赖。
