const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'state.json');

// 内存中的数据镜像，初始结构对齐之前的 SQLite 规划
let dbData = {
  messages: [],      // 历史对话：{ role: 'user'|'model', content: string, timestamp: number }
  plays: [],         // 播放记录：{ id: string, name: string, artist: string, playedAt: number, skip: boolean }
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
      if (!dbData.plays) dbData.plays = [];
      if (!dbData.preferences) dbData.preferences = {};
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
    // 限制历史记忆最大为 50 条，防止 Prompt 溢出
    if (dbData.messages.length > 50) {
      dbData.messages.shift();
    }
    saveDb();
  },
  
  clearMessages: () => {
    dbData.messages = [];
    saveDb();
  },

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
