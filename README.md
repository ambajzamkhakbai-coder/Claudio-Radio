# Claudio Radio

Personal AI music radio built with Node.js, Express, Gemini, Fish Audio, and Netease Cloud Music API.

一个运行在本地的个人 AI 音乐电台项目。它把 AI 对话、歌曲推荐、TTS 旁白、听歌口味画像和网页播放器组合在一起，让 `Claudio` 像一个会聊天、会理解情绪、也会帮你选歌的私人 DJ。

## Overview | 项目简介

`Claudio Radio` is a local-first AI radio experience.

- Chat naturally with an AI DJ instead of using a traditional search-only player.
- Ask for music, get candidate tracks first, then pick what to play.
- Turn DJ narration into voice with Fish Audio TTS.
- Use real Netease tracks when available, with local and public API fallback.
- Maintain a persistent taste profile based on recent listening history.

`Claudio Radio` 是一个本地优先的 AI 电台：

- 不是单纯点歌播放器，而是一个可对话的 AI DJ。
- 当用户明确想听歌时，先返回候选歌曲，再由用户确认播放。
- 用 Fish Audio 生成主持人口播旁白。
- 优先使用真实网易云曲库与播放链接，并带有本地与公网镜像兜底。
- 根据最近播放记录生成和维护用户口味画像。

## Core Features | 核心特性

### 1. Conversational AI DJ | 对话式 AI DJ

- Regular chat does not forcibly switch songs.
- Explicit music requests are routed into recommendation or playback flow.
- Direct commands such as `next`, `skip`, or `/play <keywords>` are fast-pathed before LLM reasoning.

普通聊天不会乱切歌；只有明确表达“想听歌”时，系统才进入推荐或播放流程。像 `next`、`skip`、`/play 关键词` 这类指令会绕过大模型，直接进入快速路径。

### 2. Candidate-first music flow | 先推荐再播放

- `intent=chat`: text reply only
- `intent=recommend`: return candidate tracks for user selection
- `intent=play`: build a full playback package with narration, TTS URL, song URL, and segue mode

系统围绕三种意图工作：`chat` 只回复文本，`recommend` 返回候选歌单，`play` 直接生成完整播放包。

### 3. Taste profile editing and generation | 口味画像编辑与生成

- The profile is stored in [taste.md](./taste.md).
- Users can edit it in the UI.
- A weekly profile can be regenerated from recent play history.

用户口味画像保存在 [taste.md](./taste.md)，可以在前端直接编辑，也可以基于最近播放记录自动重新生成。

### 4. Local persistence | 本地持久化

- Chat history, play history, and runtime preferences are stored in `state.json`.
- API keys and Netease cookie can be saved through the Settings page.

对话历史、播放历史和运行配置保存在 `state.json` 中；Gemini、Fish Audio、网易云 Cookie 也可以通过设置页写入。

### 5. Local NCM API with fallback | 本地网易云接口与兜底机制

- The server attempts to auto-start `NeteaseCloudMusicApi` on port `3000`.
- If local API is unavailable, the project probes public mirrors.
- If a track stream is unavailable, the app falls back to search or a backup stream.

服务启动后会尝试自动拉起本地 `NeteaseCloudMusicApi`。如果本地接口不可用，会探测公网镜像；如果具体歌曲流地址失效，还会继续搜索或回退到备用音源。

## Tech Stack | 技术栈

- Backend: Node.js, Express, WebSocket (`ws`)
- LLM: Google Gemini via `@google/generative-ai`
- TTS: Fish Audio
- Music source: `NeteaseCloudMusicApi`
- Scheduling: `node-cron` plus interval-based routine scanning
- Frontend: Vanilla HTML, CSS, JavaScript
- Persistence: local JSON file storage

## Quick Start | 快速开始

### Prerequisites | 环境要求

- Node.js 18+ recommended
- npm
- A Gemini API key
- A Fish Audio API key if you want TTS narration
- Optional: Netease Cloud Music account cookie for better playback availability and daily recommendations

建议使用 `Node.js 18+`。如果要启用 AI 推荐，需要 Gemini API Key；如果要启用语音旁白，需要 Fish Audio API Key。网易云登录 Cookie 是可选项，但会显著提升可用曲目和每日推荐能力。

### Install | 安装

```bash
npm install
```

### Configure | 配置

Create `.env` from `.env.example` and fill in the keys:

基于 `.env.example` 创建 `.env`，并补齐配置：

```env
PORT=8080
GEMINI_API_KEY=your_gemini_api_key_here
FISH_AUDIO_API_KEY=your_fish_audio_api_key_here
FISH_AUDIO_VOICE_ID=7f113a778e884144b60e33ef72d763ed
OPENWEATHER_API_KEY=your_openweather_api_key_here
WEATHER_CITY=Beijing
NETEASE_API_URL=http://localhost:3000
```

Optional runtime setting:

可选运行时配置：

```env
GEMINI_API_BASE=https://your-proxy-or-compatible-endpoint
```

You can also override the Gemini key, Gemini base URL, Fish Audio key, and Netease cookie from the Settings page inside the app.

这些配置也可以在应用的设置页中动态覆盖。

### Run | 启动

```bash
npm run dev
```

or:

```bash
node server.js
```

Open:

```text
http://localhost:8080
```

## Runtime Behavior | 运行机制

### Playback pipeline | 播放流水线

1. User sends chat text or a direct playback command.
2. `router.js` decides whether the request is direct, chat-only, recommend, or play.
3. `claudio.js` produces structured JSON when LLM reasoning is needed.
4. `server.js` compiles the play package:
   - optional DJ narration
   - optional Fish Audio TTS file
   - song lookup and playback URL resolution
   - fallback handling if a stream is unavailable
5. Frontend receives the package and updates the player.

### Routine-aware radio behavior | 按作息切换的电台节奏

The app infers a current routine such as coding, commute, evening, or late night from local time. A scheduler scans routine changes and broadcasts them to connected clients through WebSocket.

项目会根据本地时间推断当前所处时段，例如编程、通勤、夜晚或深夜，并通过调度器扫描时段变化，再通过 WebSocket 通知前端。

### Prefetch | 预加载

The server keeps a prefetch cache for the next song package, reducing the latency of `next` operations.

服务端会预先计算下一首歌的播放包，用于降低切歌延迟。

## API | 接口概览

### HTTP

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/chat` | Main chat and AI routing entry |
| `POST` | `/api/pick` | Pick a recommended candidate song |
| `GET` | `/api/next` | Force skip to the next track |
| `POST` | `/api/prefetch` | Trigger async prefetch for next playback package |
| `GET` | `/api/taste` | Read `taste.md` |
| `POST` | `/api/taste` | Save `taste.md` |
| `POST` | `/api/taste/generate-weekly` | Regenerate taste profile from recent plays |
| `GET` | `/api/settings` | Read runtime settings and Netease login status |
| `POST` | `/api/settings` | Save Gemini and Fish Audio related settings |
| `POST` | `/api/ncm/save-cookie` | Save Netease cookie |

### WebSocket

- Endpoint: `/stream`
- Example server events:
  - `INIT_ACK`
  - `PREFETCH_READY`
  - `ROUTINE_SHIFT`

WebSocket 端点是 `/stream`，用于前后端之间的实时状态同步和广播。

## Project Structure | 项目结构

```text
.
|-- server.js
|-- router.js
|-- claudio.js
|-- context.js
|-- music.js
|-- tts.js
|-- db.js
|-- socket.js
|-- scheduler.js
|-- fallback.js
|-- taste-memory.js
|-- taste-profiler.js
|-- playlists.json
|-- taste.md
|-- state.json (generated at runtime)
|-- prompts/
|   `-- dj-persona.md
|-- public/
|   |-- index.html
|   |-- index.css
|   |-- app.js
|   |-- manifest.json
|   `-- sw.js
`-- tests/
    |-- test-flow.js
    |-- check-ncm-server.js
    `-- check-ncm-pkg.js
```

### Important files | 关键文件

- [server.js](./server.js): HTTP API, playback package assembly, and app bootstrap
- [router.js](./router.js): intent routing and direct command handling
- [claudio.js](./claudio.js): Gemini integration and local fallback brain logic
- [context.js](./context.js): prompt assembly, routine inference, and song pool context
- [music.js](./music.js): Netease API probing, search, stream URL lookup, and login status
- [tts.js](./tts.js): Fish Audio TTS generation and cache storage
- [db.js](./db.js): JSON-based local persistence

## Testing | 测试与排查

There is no dedicated `npm test` script in the current project. Instead, the repo includes standalone verification scripts:

当前项目没有独立的 `npm test` 脚本，而是提供了几个可直接执行的检查脚本：

```bash
node tests/check-ncm-pkg.js
node tests/check-ncm-server.js
node tests/test-flow.js
```

Use them to verify:

- package availability for `NeteaseCloudMusicApi`
- local NCM server startup on port `3000`
- end-to-end flow including prompt assembly, music lookup, LLM behavior, fallback, and TTS

这些脚本主要用于验证网易云接口、本地服务启动、全链路推荐逻辑以及 TTS/降级行为。

## Notes and Limitations | 注意事项与限制

- This project is designed for local or self-hosted usage.
- `state.json` contains runtime state and should not be committed with personal secrets.
- TTS requires a valid Fish Audio key.
- Better Netease playback availability may require a valid cookie.
- Public NCM mirrors can change or become unavailable over time.
- If Gemini is unavailable, the app falls back to local simulated DJ logic.

这个项目的定位是本地运行或自部署。`state.json` 会保存运行期状态，不适合提交真实个人数据。Fish Audio、网易云 Cookie 和公网镜像的可用性都会直接影响体验；Gemini 不可用时，系统会降级到本地模拟 DJ 逻辑。

## License

This repository is licensed under the MIT License unless you choose to change it.

当前仓库默认采用 MIT License。
