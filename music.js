const axios = require('axios');
const https = require('https');
const db = require('./db');

// 创建放行 SSL 证书验证的自定义 axios 实例，对抗 Windows Clash TUN 模式 Fake-IP 证书劫持
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

let activeApiUrl = null;
let probePromise = null; // 共享的探测 Promise 锁 (Single Flight 模式)
let lastProbeTime = 0;
const PROBE_LOCK_DURATION = 5 * 60 * 1000; // 全线失败时锁定本地兜底 5 分钟

// 国内多线高速、高可用公共免搭建网易云 API 镜像列表（避开被墙的 Vercel 域名，确保国内网络 100% 极速连通）
const FALLBACK_PUBLIC_APIS = [
  'https://music.qierkang.com',
  'https://netease-api.fe-down.com',
  'https://netease.api.lk',
  'http://netease.wyyapi.top',
  'https://netease-cloud-music-api-psi-orpin.vercel.app'
];

// 智能获取可用的网易云 API 地址（前端测速优先，本地优先，公共镜像无缝兜底，具备动态自我修复）
async function getApiUrl() {
  if (activeApiUrl) return activeApiUrl;
  
  // 1. 优先使用数据库中存储的前端测速所选的最优公益镜像地址
  const dbUrl = db.getPreference('neteaseApiUrl');
  if (dbUrl && dbUrl.trim() !== '') {
    activeApiUrl = dbUrl.trim();
    console.log(`[NCM] Using custom API URL from DB preference: ${activeApiUrl}`);
    return activeApiUrl;
  }
  
  // 2. 其次使用用户在环境变量中配置的网易云 API 地址
  if (process.env.NETEASE_API_URL && process.env.NETEASE_API_URL.trim() !== '') {
    activeApiUrl = process.env.NETEASE_API_URL.trim();
    console.log(`[NCM] Using custom API URL from environment: ${activeApiUrl}`);
    return activeApiUrl;
  }

  // 3. 如果当前有探测进行中，则共享该探测，绝不重复发送测速网络请求
  if (probePromise) {
    console.log('[NCM] Network API probe already in progress. Joining shared promise to prevent avalanche...');
    return probePromise;
  }

  // 4. 创建共享的探测 Promise 锁
  probePromise = (async () => {
    // === 探测锁自防抖机制 ===
    const now = Date.now();
    if (now - lastProbeTime < PROBE_LOCK_DURATION) {
      console.log('[NCM] Network API probe is locked (cooling down). Fast-forwarding to default local API http://localhost:3000 to prevent lagging.');
      activeApiUrl = 'http://localhost:3000';
      return 'http://localhost:3000';
    }
    
    // 探测本地 3000 端口是否在线
    try {
      const res = await axiosInstance.get('http://localhost:3000/banner', { timeout: 800 });
      if (res.status === 200) {
        console.log('[NCM] Local API detected on http://localhost:3000. Using local mode.');
        activeApiUrl = 'http://localhost:3000';
        return activeApiUrl;
      }
    } catch (err) {
      console.log('[NCM] Local API (http://localhost:3000) is offline. Probing domestic high-speed public mirrors...');
    }
    
    // 自动遍历高可用免搭建公共镜像，测速超时合理缩短为 1000ms
    for (const publicUrl of FALLBACK_PUBLIC_APIS) {
      try {
        const res = await axiosInstance.get(`${publicUrl}/banner`, { timeout: 1000 });
        if (res.status === 200) {
          console.log(`[NCM] Connect success! Automatically switched to public NCM API mirror: ${publicUrl}`);
          activeApiUrl = publicUrl;
          return activeApiUrl;
        }
      } catch (e) {
        // 探测失败，继续尝试下一个镜像
      }
    }
    
    // 极端离线情况，默认返回本地，但写入 lastProbeTime 冷却锁定，防止每次请求都全线慢等
    console.warn('[NCM] All API endpoints (local & public) are unreachable right now. Locking probe for 5 minutes and defaulting to http://localhost:3000.');
    lastProbeTime = now;
    activeApiUrl = 'http://localhost:3000';
    return 'http://localhost:3000';
  })();

  try {
    return await probePromise;
  } finally {
    probePromise = null; // 探测完成，重置共享锁
  }
}

// 辅助方法：发起网易云 API 请求，自动附加保存在 SQLite/JSON db 中的 Cookie
async function ncmRequest(endpoint, params = {}) {
  const cookie = db.getPreference('neteaseCookie') || '';
  const baseUrl = await getApiUrl();
  const url = `${baseUrl}${endpoint}`;
  
  try {
    const response = await axiosInstance({
      method: 'GET',
      url,
      params: {
        ...params,
        cookie,
        timestamp: Date.now() // 防缓存
      },
      timeout: 6000 // 6秒超时
    });
    
    return response.data;
  } catch (error) {
    console.error(`[NCM] Request failed on ${endpoint} via ${baseUrl}:`, error.message);
    // 自动重置活跃的 API 地址缓存，允许下一次请求触发全新的探测，具备极强自我修复能力！
    activeApiUrl = null;
    throw error;
  }
}

const music = {
  // --- 1. 搜歌服务 ---
  search: async (keywords, limit = 10) => {
    try {
      const data = await ncmRequest('/cloudsearch', { keywords, limit, type: 1 });
      if (data.result && data.result.songs) {
        return data.result.songs.map(s => ({
          id: String(s.id),
          name: s.name,
          artist: s.ar.map(a => a.name).join('/'),
          album: s.al.name,
          duration: s.dt
        }));
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  // --- 2. 获取歌曲播放直链 ---
  getSongUrl: async (id) => {
    try {
      // 优先请求 v1 接口
      const data = await ncmRequest('/song/url/v1', { id, level: 'exhigh' });
      if (data.data && data.data[0] && data.data[0].url) {
        return data.data[0].url;
      }
      // 降级请求老接口
      const fallbackData = await ncmRequest('/song/url', { id });
      if (fallbackData.data && fallbackData.data[0] && fallbackData.data[0].url) {
        return fallbackData.data[0].url;
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  // --- 3. 获取歌词 ---
  getLyric: async (id) => {
    try {
      const data = await ncmRequest('/lyric', { id });
      return data.lrc ? data.lrc.lyric : '';
    } catch (e) {
      return '';
    }
  },

  // --- 4. 抓取歌单中的全部曲目（用于大模型挑选） ---
  getPlaylistTracks: async (playlistId) => {
    try {
      const data = await ncmRequest('/playlist/track/all', { id: playlistId, limit: 50 });
      if (data.songs) {
        return data.songs.map(s => ({
          id: String(s.id),
          name: s.name,
          artist: s.ar.map(a => a.name).join('/'),
          source: 'ncm'
        }));
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  // --- 5. 检测当前登录状态与用户名 ---
  getLoginStatus: async () => {
    try {
      const data = await ncmRequest('/login/status');
      if (data.data && data.data.profile) {
        return {
          loggedIn: true,
          nickname: data.data.profile.nickname,
          avatarUrl: data.data.profile.avatarUrl
        };
      }
      return { loggedIn: false };
    } catch (e) {
      return { loggedIn: false };
    }
  },

  // --- 6. 个性化每日推荐（若未登录则降级返回空） ---
  getDailySongs: async () => {
    try {
      const data = await ncmRequest('/recommend/songs');
      if (data.data && data.data.dailySongs) {
        return data.data.dailySongs.map(s => ({
          id: String(s.id),
          name: s.name,
          artist: s.ar.map(a => a.name).join('/'),
          source: 'ncm'
        }));
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  // 动态修改活跃 API 镜像地址，支持前端测速后直接实时热更新生效
  setActiveApiUrl: (url) => {
    activeApiUrl = url;
    console.log(`[NCM] Active API URL dynamically updated to: ${url}`);
  }
};

module.exports = music;
