const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'state.json');

// 内存中的数据镜像，初始结构对齐之前的 SQLite 规划
let dbData = {
  messages: [],      // 历史对话：{ role: 'user'|'model', content: string, timestamp: number }
  chatMemory: {      // 超过 30 天后的压缩对话记忆
    summaries: [],
    lastCompactedAt: 0
  },
  plays: [],         // 播放记录：{ id: string, name: string, artist: string, playedAt: number, skip: boolean }
  favorites: [],     // 收藏歌曲，服务端持久化，避免浏览器或服务重启后丢失
  preferences: {     // 用户偏好及系统配置
    neteaseCookie: '',
    geminiApiKey: '',
    geminiApiBase: '',
    fishAudioApiKey: '',
    weatherApiKey: ''
  }
};

// 加载数据库
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      dbData = JSON.parse(content);
      // 兼容性修正，确保基础结构完备
      if (!dbData.messages) dbData.messages = [];
      if (!dbData.chatMemory) dbData.chatMemory = { summaries: [], lastCompactedAt: 0 };
      if (!Array.isArray(dbData.chatMemory.summaries)) dbData.chatMemory.summaries = [];
      if (!dbData.chatMemory.lastCompactedAt) dbData.chatMemory.lastCompactedAt = 0;
      if (!dbData.plays) dbData.plays = [];
      if (!dbData.favorites) dbData.favorites = [];
      if (!dbData.preferences) dbData.preferences = {};
      if (compactExpiredMessages()) {
        saveDb();
      }
    } else {
      saveDb();
    }
  } catch (error) {
    console.error('Failed to load JSON database, using memory-only fallback:', error);
  }
}

// 延迟写入磁盘，防止高频写入导致性能损耗与文件冲突（防抖写入）
let saveTimeout = null;
function saveDb() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save JSON database to disk:', error);
    }
  }, 100); // 100ms 缓冲区
}

const CHAT_MEMORY_RETENTION_DAYS = 30;
const CHAT_MEMORY_RETENTION_MS = CHAT_MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_MEMORY_SUMMARIES = 24;

function formatDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sanitizeMemoryText(value, maxLength = 120) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function summarizeMessages(messages) {
  const userMessages = messages
    .filter(message => message.role === 'user')
    .map(message => sanitizeMemoryText(message.content, 80))
    .filter(Boolean);
  const modelMessages = messages
    .filter(message => message.role === 'model')
    .map(message => sanitizeMemoryText(message.content, 80))
    .filter(Boolean);

  const userSample = userMessages.slice(-8).join('；') || '没有明确用户发言';
  const modelSample = modelMessages.slice(-4).join('；') || '没有明确 Claudio 回复';
  return `用户近况/表达：${userSample}。Claudio 当时回应方向：${modelSample}。`;
}

function compactExpiredMessages(now = Date.now()) {
  const cutoff = now - CHAT_MEMORY_RETENTION_MS;
  const expired = [];
  const retained = [];

  for (const message of dbData.messages) {
    const timestamp = Number(message.timestamp) || now;
    if (timestamp < cutoff) {
      expired.push({ ...message, timestamp });
    } else {
      retained.push({ ...message, timestamp });
    }
  }

  const changed = expired.length > 0 || dbData.chatMemory.summaries.length > MAX_MEMORY_SUMMARIES;

  if (expired.length > 0) {
    dbData.chatMemory.summaries.push({
      from: expired[0].timestamp,
      to: expired[expired.length - 1].timestamp,
      count: expired.length,
      summary: summarizeMessages(expired),
      createdAt: now
    });
  }

  if (dbData.chatMemory.summaries.length > MAX_MEMORY_SUMMARIES) {
    const overflowSummaries = dbData.chatMemory.summaries.splice(
      0,
      dbData.chatMemory.summaries.length - MAX_MEMORY_SUMMARIES
    );
    const first = overflowSummaries[0];
    const last = overflowSummaries[overflowSummaries.length - 1];
    dbData.chatMemory.summaries.unshift({
      from: first.from,
      to: last.to,
      count: overflowSummaries.reduce((total, item) => total + (item.count || 0), 0),
      summary: `更早对话摘要合并：${overflowSummaries.map(item => sanitizeMemoryText(item.summary, 90)).join(' / ')}`,
      createdAt: now
    });
  }

  dbData.messages = retained;
  dbData.chatMemory.lastCompactedAt = now;
  return changed;
}

function getChatMemoryContext(options = {}) {
  const {
    now = Date.now(),
    maxRecent = 8,
    maxMonthly = 24,
    maxSummaries = 6
  } = options;
  const cutoff = now - CHAT_MEMORY_RETENTION_MS;
  const monthlyMessages = dbData.messages
    .filter(message => (Number(message.timestamp) || 0) >= cutoff)
    .slice(-maxMonthly);
  const recentMessages = monthlyMessages.slice(-maxRecent);
  const summaries = dbData.chatMemory.summaries.slice(-maxSummaries);

  return {
    retentionDays: CHAT_MEMORY_RETENTION_DAYS,
    summaries,
    monthlyMessages,
    recentMessages,
    summaryText: summaries.length
      ? summaries
        .map(item => `* ${formatDate(item.from)} 至 ${formatDate(item.to)}（${item.count} 条）：${item.summary}`)
        .join('\n')
      : '暂无超过 30 天的压缩记忆',
    monthlyText: monthlyMessages.length
      ? monthlyMessages
        .map(message => `* ${formatDate(message.timestamp)} ${message.role === 'user' ? '用户' : 'Claudio'}：${sanitizeMemoryText(message.content, 180)}`)
        .join('\n')
      : '暂无近 30 天聊天记忆',
    recentText: recentMessages.length
      ? recentMessages
        .map(message => `${message.role === 'user' ? '听众' : 'Claudio'}：${sanitizeMemoryText(message.content, 220)}`)
        .join('\n')
      : '暂无近期对话历史'
  };
}

// 数据库 API 封装
const db = {
  // --- 历史消息管理 ---
  getMessages: () => {
    return dbData.messages;
  },
  
  addMessage: (role, content) => {
    dbData.messages.push({
      role,
      content,
      timestamp: Date.now()
    });
    compactExpiredMessages();
    saveDb();
  },
  
  clearMessages: () => {
    dbData.messages = [];
    saveDb();
  },

  compactChatMemory: () => {
    compactExpiredMessages();
    saveDb();
    return db.getChatMemoryContext();
  },

  getChatMemoryContext,

  // --- 播放历史管理 ---
  getPlays: () => {
    return dbData.plays;
  },
  
  addPlay: (songId, name, artist, skip = false) => {
    dbData.plays.push({
      id: songId,
      name,
      artist,
      playedAt: Date.now(),
      skip
    });
    // 限制播放历史最大保留 100 条
    if (dbData.plays.length > 100) {
      dbData.plays.shift();
    }
    saveDb();
  },

  // --- 收藏歌曲管理 ---
  getFavorites: () => {
    return dbData.favorites;
  },

  setFavorites: (songs = []) => {
    const seen = new Set();
    dbData.favorites = songs
      .filter(song => song && song.id && !seen.has(String(song.id)) && seen.add(String(song.id)))
      .map(song => ({
        id: String(song.id),
        name: song.name || 'Unknown Track',
        artist: song.artist || 'Unknown Artist',
        savedAt: song.savedAt || Date.now()
      }));
    saveDb();
    return dbData.favorites;
  },

  // --- 用户配置/Cookie 管理 ---
  getPreference: (key) => {
    return dbData.preferences[key];
  },
  
  setPreference: (key, value) => {
    dbData.preferences[key] = value;
    saveDb();
  },
  
  getAllPreferences: () => {
    return dbData.preferences;
  }
};

// 立即初始化加载
loadDb();

module.exports = db;
