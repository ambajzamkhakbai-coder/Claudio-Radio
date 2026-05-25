require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const router = require('./router');
const tts = require('./tts');
const music = require('./music');
const socket = require('./socket');
const scheduler = require('./scheduler');
const fallback = require('./fallback');
const tasteProfiler = require('./taste-profiler');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8080;

// 开启 JSON 及 Form 数据解析能力
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 托管 public 静态目录，并强制设置无缓存响应头以求最新代码秒级生效
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // 强制关闭 html, js, css 以及 sw.js 的缓存，使任何紧急重构立刻生效
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// 全局预加载数据内存双缓冲区
let prefetchCache = null;

// 辅助方法：拼装完整的播放数据（含 Netease 音频直链与 Fish Audio TTS）
async function compilePlayPackage(brainResult) {
  let ttsUrl = '';
  let songInfo = null;
  
  try {
    // 1. 如果有主持旁白，并发进行 TTS 转换
    if (brainResult.say && brainResult.say.trim() !== '') {
      ttsUrl = await tts.textToSpeech(brainResult.say);
    }
    
    // 2. 如果大脑推荐了歌曲，尝试获取可播音频流
    if (brainResult.play && brainResult.play.length > 0) {
      const target = brainResult.play[0]; // 默认取推荐首选
      let songUrl = await music.getSongUrl(target.id);
      
      // 降级兜底：如果网易云没有返回有效音频 URL (可能版权或失效)，则尝试搜索获取
      if (!songUrl) {
        console.warn(`[Server] NCM song ID ${target.id} stream url missing. Attempt fallback search...`);
        const searchResults = await music.search(`${target.name} ${target.artist}`);
        if (searchResults && searchResults.length > 0) {
          songUrl = await music.getSongUrl(searchResults[0].id);
          target.id = searchResults[0].id; // 替换为可播放的 ID
        }
      }
      
      // 如果搜索也未成功，则调用 fallback 匹配本地外链资源
      if (!songUrl) {
        const fallbackSong = fallback.handleSongStreamFailure(target.id);
        songUrl = fallbackSong.url;
        target.id = fallbackSong.id;
        target.name = fallbackSong.name;
        target.artist = fallbackSong.artist;
      }
      
      if (songUrl) {
        songInfo = {
          id: target.id,
          name: target.name,
          artist: target.artist,
          url: songUrl
        };
      }
    }
  } catch (err) {
    console.error('[Server] Compilation of play package failed:', err.message);
  }

  // 3. 如果没能获取到有效音乐，则提供一个经典备用兜底歌曲 (Bread 的 If，契合参考图)
  if (!songInfo) {
    songInfo = {
      id: '2023530089', // Bread - If 在网易云的常用 ID (或类似可用 ID)
      name: 'If',
      artist: 'Bread',
      url: 'https://music.163.com/song/media/outer/url?id=2023530089.mp3' // 物理外链兜底
    };
  }

  return {
    say: brainResult.say || '',
    ttsUrl: ttsUrl,
    song: songInfo,
    reason: brainResult.reason || '常规播放',
    segue: brainResult.segue || 'crossfade'
  };
}

// ==================== RESTful API 路由 ====================

// --- 1. 与 AI 对话 (POST /api/chat) ---
app.post('/api/chat', async (req, res) => {
  const { message, lastSong } = req.body;
  console.log(`[HTTP] POST /api/chat - Message: "${message}"`);
  
  try {
    // 调配意图路由器
    const routeResult = await router.route({
      userInput: message,
      lastSong: lastSong || undefined
    });
    
    // 如果是直接快捷指令且需要跳转 (比如 "下一首")
    if (routeResult.isDirect && routeResult.action === 'next') {
      return res.redirect('/api/next');
    }
    
    // 如果是特定指定搜索词直连
    if (routeResult.isDirect && routeResult.action === 'search_play') {
      const searchSongs = await music.search(routeResult.query, 1);
      if (searchSongs && searchSongs.length > 0) {
        const directPackage = await compilePlayPackage({
          say: `好的，应你的要求，这就为你播放 ${searchSongs[0].name}。`,
          play: [{ id: searchSongs[0].id, name: searchSongs[0].name, artist: searchSongs[0].artist }],
          reason: '用户搜歌直连',
          segue: 'ducking'
        });
        db.addPlay(directPackage.song.id, directPackage.song.name, directPackage.song.artist);
        return res.json({ intent: 'play', ...directPackage });
      } else {
        return res.status(404).json({ error: `抱歉，没有搜到歌曲「${routeResult.query}」` });
      }
    }

    // 根据 AI 返回的 intent 进行分流处理
    const intent = routeResult.intent || 'play';

    if (intent === 'chat') {
      // 纯闲聊模式：只返回文字回复，不切歌
      console.log('[Server] Intent: chat - No song change.');
      return res.json({
        intent: 'chat',
        say: routeResult.say || '',
        reason: routeResult.reason || '闲聊对话'
      });
    }

    if (intent === 'recommend') {
      // 推荐模式：返回候选歌曲列表供用户选择，不自动播放
      console.log('[Server] Intent: recommend - Returning song candidates.');
      const candidates = (routeResult.play || []).map(song => ({
        id: song.id,
        name: song.name,
        artist: song.artist,
        source: song.source || 'ncm',
        reason: song.reason || ''
      }));
      return res.json({
        intent: 'recommend',
        say: routeResult.say || '',
        candidates: candidates,
        play: candidates,
        reason: routeResult.reason || '歌曲推荐'
      });
    }

    // 默认 play 模式：直接编译播放包
    const playPackage = await compilePlayPackage(routeResult);
    db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
    res.json({ intent: 'play', ...playPackage });

  } catch (err) {
    if (message && message.trim()) {
      console.error('[Server] Chat route failed, returning non-playing chat fallback:', err.message);
      return res.json({
        intent: 'chat',
        say: '我这边的大模型线路有点抖，但不会擅自帮你切歌。你可以继续跟我聊，或者稍后再说“想听点音乐”，我再给你列几首候选。',
        reason: '对话推理失败，安全降级为不切歌闲聊'
      });
    }

    try {
      const fallbackResult = fallback.handleBrainFailure(err);
      const playPackage = await compilePlayPackage(fallbackResult);
      db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
      res.json({ intent: 'play', ...playPackage });
    } catch (fallbackErr) {
      res.status(500).json({ error: fallbackErr.message });
    }
  }
});

// --- 1.5. 用户从候选列表中选歌 (POST /api/pick) ---
app.post('/api/pick', async (req, res) => {
  const { songId, songName, songArtist } = req.body;
  console.log(`[HTTP] POST /api/pick - User picked: "${songName}" by ${songArtist} (ID: ${songId})`);
  
  try {
    const playPackage = await compilePlayPackage({
      say: '',
      play: [{ id: songId, name: songName, artist: songArtist, source: 'ncm' }],
      reason: `用户从候选列表中手动选择了《${songName}》`,
      segue: 'crossfade'
    });
    db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
    res.json({ intent: 'play', ...playPackage });
  } catch (err) {
    console.error('[Server] Pick song failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 2. 强制切歌 (GET /api/next) ---
app.get('/api/next', async (req, res) => {
  console.log('[HTTP] GET /api/next - Track skip triggered');
  
  try {
    // 1. 优先提取由 prefetchCache 双缓冲区备好的无延迟资源
    if (prefetchCache) {
      console.log('[Server] Prefetch buffer hit! Zero latency playback response dispatched.');
      const playPackage = prefetchCache;
      prefetchCache = null; // 消费缓冲区
      
      db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
      return res.json(playPackage);
    }
    
    // 2. 缓冲区未命中（如高频连击），现场组装计算
    console.log('[Server] Prefetch buffer miss. Computing on-the-fly...');
    const routeResult = await router.route({
      triggerSource: '用户手动切歌'
    });
    
    const playPackage = await compilePlayPackage(routeResult);
    db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
    res.json(playPackage);

  } catch (err) {
    try {
      const fallbackResult = fallback.handleBrainFailure(err);
      const playPackage = await compilePlayPackage(fallbackResult);
      db.addPlay(playPackage.song.id, playPackage.song.name, playPackage.song.artist);
      res.json(playPackage);
    } catch (fallbackErr) {
      res.status(500).json({ error: fallbackErr.message });
    }
  }
});

// --- 3. 音频预加载 (POST /api/prefetch) ---
app.post('/api/prefetch', async (req, res) => {
  const { lastSong } = req.body;
  console.log('[HTTP] POST /api/prefetch - Asynchronous preload triggered');

  // 防止高频触发预载
  if (prefetchCache) {
    return res.json({ success: true, message: 'Prefetch cache already warm.' });
  }

  // 异步进行大模型计算与 TTS/音频拉取，绝不阻塞前端播放
  (async () => {
    try {
      const routeResult = await router.route({
        triggerSource: '系统自动预载',
        lastSong: lastSong || undefined
      });
      
      prefetchCache = await compilePlayPackage(routeResult);
      console.log(`[Prefetch] Preload pool successfully filled. Next song will be: 《${prefetchCache.song.name}》`);
      socket.broadcast('PREFETCH_READY', { songName: prefetchCache.song.name });
    } catch (err) {
      console.error('[Prefetch] Async prefetch pipeline failed:', err.message);
    }
  })();

  res.json({ success: true, message: 'Prefetch pipeline scheduled.' });
});

// --- 4. 品味偏好查询与保存 (GET / POST /api/taste) ---
app.get('/api/taste', (req, res) => {
  const tastePath = path.join(__dirname, 'taste.md');
  if (fs.existsSync(tastePath)) {
    const content = fs.readFileSync(tastePath, 'utf8');
    return res.json({ content });
  }
  res.json({ content: '' });
});

app.post('/api/taste', (req, res) => {
  const { content } = req.body;
  const tastePath = path.join(__dirname, 'taste.md');
  try {
    fs.writeFileSync(tastePath, content, 'utf8');
    res.json({ success: true, message: 'Taste file updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update taste file.' });
  }
});

app.post('/api/taste/generate-weekly', async (req, res) => {
  const tastePath = path.join(__dirname, 'taste.md');

  try {
    const currentTaste = fs.existsSync(tastePath) ? fs.readFileSync(tastePath, 'utf8') : '';
    const result = await tasteProfiler.generateWeeklyTasteProfile(db.getPlays(), currentTaste);
    fs.writeFileSync(tastePath, result.content, 'utf8');

    res.json({
      success: true,
      content: result.content,
      generatedBy: result.generatedBy,
      summary: {
        total: result.summary.total,
        uniqueSongs: result.summary.uniqueSongs,
        uniqueArtists: result.summary.uniqueArtists,
        topArtists: result.summary.artists.slice(0, 5),
        topTags: result.summary.tags.slice(0, 8)
      }
    });
  } catch (err) {
    console.error('[Server] Weekly taste profile generation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// --- 5. 秘钥与偏好设置 (GET / POST /api/settings) ---
app.get('/api/settings', async (req, res) => {
  const preferences = db.getAllPreferences();
  const ncmStatus = await music.getLoginStatus();
  
  res.json({
    preferences: {
      geminiApiKey: preferences.geminiApiKey || '',
      geminiApiBase: preferences.geminiApiBase || '',
      fishAudioApiKey: preferences.fishAudioApiKey || '',
      neteaseCookie: preferences.neteaseCookie || ''
    },
    netease: ncmStatus
  });
});

app.post('/api/settings', (req, res) => {
  const { geminiApiKey, geminiApiBase, fishAudioApiKey } = req.body;
  
  if (typeof geminiApiKey === 'string') db.setPreference('geminiApiKey', geminiApiKey);
  if (typeof geminiApiBase === 'string') db.setPreference('geminiApiBase', geminiApiBase);
  if (typeof fishAudioApiKey === 'string') db.setPreference('fishAudioApiKey', fishAudioApiKey);
  
  res.json({ success: true, message: 'Settings updated successfully.' });
});

// --- 6. 网易云 Cookie 保存路由 ---

// 保存前端或手动输入的 Cookie 到数据库
app.post('/api/ncm/save-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (cookie) {
    db.setPreference('neteaseCookie', cookie);
    console.log('[NCM] Cookie successfully updated via direct POST.');
    const ncmStatus = await music.getLoginStatus();
    res.json({ success: true, message: 'Cookie saved successfully.', netease: ncmStatus });
  } else {
    res.status(400).json({ error: 'Cookie is empty.' });
  }
});

// ==================== 初始化与服务启动 ====================

// 绑定 WebSocket 协议升级
socket.init(server);

// 启动日常作息调度系统
scheduler.start();

// 启动端口监听
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  AI 音乐电台 (Micdio / Claudio) 服务端成功挂载！`);
  console.log(`  运行端口: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // 一体化自动在后台拉起本地网易云 API 服务，实现完全的"免配置一键运行"
  setTimeout(() => {
    try {
      console.log('[NCM API] Attempting to auto-start local NeteaseCloudMusicApi...');
      const { serveNcmApi } = require('NeteaseCloudMusicApi');
      serveNcmApi({ port: 3000 })
        .then(() => {
          console.log('[NCM API] Local NeteaseCloudMusicApi started successfully on http://localhost:3000');
        })
        .catch(err => {
          console.warn('[NCM API] Failed to bind port 3000 (possibly already running):', err.message);
        });
    } catch (err) {
      console.warn('[NCM API] "NeteaseCloudMusicApi" package is not fully ready yet. Fallback to external NCM API or mock streaming.');
      console.warn('          Detailed Error:', err.message);
    }
  }, 1000); // 延迟1秒启动，保证主Express服务优先完成端口绑定并输出日志
});
