const fs = require('fs');
const path = require('path');
const db = require('./db');
const music = require('./music');

let songPoolCache = []; // { id, name, artist } 的真实歌曲曲库缓存池
let lastPoolFetchTime = 0;
const POOL_CACHE_DURATION = 10 * 60 * 1000; // 缓存 10 分钟

// 异步构建真实的歌曲池缓存
async function updateSongPool() {
  const now = Date.now();
  if (songPoolCache.length > 0 && now - lastPoolFetchTime < POOL_CACHE_DURATION) {
    return;
  }

  // 异步执行，绝不阻塞主线程
  (async () => {
    try {
      console.log('[Context] Rebuilding active song pool assets from Netease playlists...');
      const playlistsPath = path.join(__dirname, 'playlists.json');
      if (!fs.existsSync(playlistsPath)) return;
      const playlistsData = JSON.parse(fs.readFileSync(playlistsPath, 'utf8'));
      let tempPool = [];
      
      // 遍历所有类别的所有歌单，并发抓取歌曲
      if (playlistsData.categories) {
        const fetchPromises = [];
        for (const catKey in playlistsData.categories) {
          const cat = playlistsData.categories[catKey];
          if (cat.neteasePlaylists) {
            for (const pl of cat.neteasePlaylists) {
              fetchPromises.push((async () => {
                try {
                  const tracks = await music.getPlaylistTracks(pl.id);
                  if (tracks && tracks.length > 0) {
                    tempPool = tempPool.concat(tracks);
                  }
                } catch (e) {
                  // 单个歌单拉取失败不阻断全局
                }
              })());
            }
          }
        }
        await Promise.all(fetchPromises);
      }

      // 动态并入网易云每日推荐（如果用户已扫码登录的话）
      try {
        const dailySongs = await music.getDailySongs();
        if (dailySongs && dailySongs.length > 0) {
          console.log(`[Context] Integrated ${dailySongs.length} Daily Recommend Songs into the active pool!`);
          tempPool = tempPool.concat(dailySongs);
        }
      } catch (dailyErr) {
        // 未登录或获取推荐失败
      }

      if (tempPool.length > 0) {
        // 数组去重
        const uniqueMap = {};
        songPoolCache = tempPool.filter(s => {
          if (!s.id || uniqueMap[s.id]) return false;
          uniqueMap[s.id] = true;
          return true;
        });
        lastPoolFetchTime = now;
        console.log(`[Context] Active song pool rebuilt successfully with ${songPoolCache.length} playable tracks.`);
      }
    } catch (err) {
      console.error('[Context] Failed to rebuild active song pool:', err.message);
    }
  })();
}

// 首次加载自动触发后台预拉取
updateSongPool();

// 安全读取物理文件
function safeReadFile(filename, defaultContent = '') {
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (error) {
    console.error(`Failed to read file: ${filename}`, error);
  }
  return defaultContent;
}

// 分析当前时间属于哪个作息时段
function getActiveRoutine(now = new Date()) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const timeVal = hours * 100 + minutes; // 如 08:30 -> 830, 23:00 -> 2300

  if (isWeekend) {
    if (timeVal >= 900 && timeVal < 1130) {
      return '悠闲上午（周末放松，悠闲慵懒）';
    } else if (timeVal >= 1400 && timeVal < 1800) {
      return '户外/娱乐（充满活力，欢快娱乐）';
    } else if (timeVal >= 2230 || timeVal < 830) {
      return '深度睡眠（陪伴助眠，白噪音环境音）';
    }
    return '周末悠闲时光';
  } else {
    if (timeVal >= 700 && timeVal < 830) {
      return '早安唤醒（节奏明快，朝气蓬勃）';
    } else if (timeVal >= 900 && timeVal < 1200) {
      return '极客编程（纯音乐或Lofi，极低打扰，专注写代码）';
    } else if (timeVal >= 1200 && timeVal < 1400) {
      return '午休充电（温和流行、爵士乐）';
    } else if (timeVal >= 1400 && timeVal < 1800) {
      return '下午冲刺（律动感独立摇滚、电子流行）';
    } else if (timeVal >= 1800 && timeVal < 2000) {
      return '晚间通勤（轻松City Pop、节奏流行乐）';
    } else if (timeVal >= 2000 && timeVal < 2300) {
      return '个人时光（温婉抒情歌、独立民谣）';
    } else {
      return '深夜酒馆（极低声播报，伴随白噪音或呢喃老歌，静心助眠）';
    }
  }
}

/**
 * 组装大模型运行时上下文盒子的核心方法
 * @param {Object} options 
 * @param {string} options.userInput 用户在聊天框中的输入或对话指令 (可选)
 * @param {Object} options.weatherData 实时的天气状况 (可选，结构为 { temp: string, condition: string })
 * @param {string} options.triggerSource 触发源，例如 'scheduler' (节律触发), 'user_skip' (用户手动切歌)等
 * @param {Object} options.lastSong 上一首播放完毕的歌（用于桥接播报） (可选)
 */
function assemblePrompt(options = {}) {
  const { userInput, weatherData, triggerSource, lastSong } = options;
  const now = new Date();
  
  // 1. 系统提示词人设
  const djPersona = safeReadFile(path.join('prompts', 'dj-persona.md'));
  
  // 2. 用户偏好语料
  const taste = safeReadFile('taste.md');
  
  // 3. 运行守则
  const mscRules = safeReadFile('msc-rules.md');
  
  // 触发后台曲库异步更新（完全异步零阻塞）
  updateSongPool();

  // 4. 真实精选曲库池贴纸拼装
  let playlistStr = '';
  if (songPoolCache.length > 0) {
    playlistStr = songPoolCache.map((s, idx) => `${idx + 1}. [ID: ${s.id}] 《${s.name}》 - ${s.artist}`).join('\n');
  } else {
    playlistStr = `1. [ID: 2023530089] 《If》 - Bread\n2. [ID: 139774] 《Yesterday Once More》 - Carpenters\n3. [ID: 5264641] 《Rain》 - 苏打绿`;
  }
  
  // 5. 当前环境上下文：时间、静态日程、天气
  const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const formattedTime = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdayNames[now.getDay()]} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const currentRoutine = getActiveRoutine(now);
  
  const weatherStr = weatherData 
    ? `当前天气：温度 ${weatherData.temp}℃，天气状况为「${weatherData.condition}」`
    : `当前天气：暂时无法获取实时天气，默认温和`;
  
  // 6. 持久化历史记忆与已播曲目（防重复）
  const playHistory = db.getPlays()
    .slice(-10) // 仅提供最近播放的10首歌以防防重复
    .map(p => `《${p.name}》- ${p.artist} (${p.skip ? '被中途跳过' : '完整听完'})`)
    .join(', ');
  
  const recentDialogues = db.getMessages()
    .slice(-6) // 获取最近三轮历史对话作为短期上下文记忆
    .map(m => `${m.role === 'user' ? '听听听众说' : 'DJ Claudio播报'}: ${m.content}`)
    .join('\n');

  // 构建拼装的运行时 Prompt
  let promptBody = `
========= 运行时电台上下文拼装盒 =========

【当前时刻与大自然环境】
* 当前时间：${formattedTime}
* 听众作息时段分析：当前正处于「${currentRoutine}」时段
* ${weatherStr}

【听众个人品味画像 (taste.md)】
${taste}

【电台播放与交互规则守则 (msc-rules.md)】
${mscRules}

【电台当前海量真实备选曲库贴纸 (100% 可播音源)】
${playlistStr}

【上一首刚刚播放完的歌曲】
${lastSong ? `《${lastSong.name}》- ${lastSong.artist}` : '无（电台刚刚开启，这是第一首歌）'}

【防重复过滤：最近播放过的 10 首歌】
[ ${playHistory || '暂无播放记录'} ]

【近期与听众的实时对话记忆】
${recentDialogues || '暂无近期对话历史'}
`;

  // 如果听众有最新主动输入，则追加输入上下文
  if (userInput) {
    promptBody += `\n【听众刚刚对你说的话】\n听众："${userInput}"\n（请根据听众的话语自主判断意图：如果听众只是闲聊/打招呼/吐槽/倾诉，intent 设为 "chat"，play 为空数组，像朋友一样自然回应；如果听众明确表达了想听歌的意愿，intent 设为 "recommend"，在 play 中从曲库推荐 3 首候选歌曲并附带 reason。）`;
  }
  
  promptBody += `\n\n【核心约束硬规则】\n1. 必须在 JSON 中包含 "intent" 字段，值为 "chat"、"recommend" 或 "play" 之一。\n2. 当 intent 为 "recommend" 或 "play" 时，请务必且只能从上面的【电台当前海量真实备选曲库贴纸】中挑选歌曲！\n3. 当 intent 为 "chat" 时，play 必须为空数组 []，不要推荐歌曲。\n4. 坚决禁止凭空捏造任何不在曲库贴纸中的歌曲 ID！\n5. 请在返回的 JSON 对象中，将 play 数组内的歌曲 id、name、artist 完美对应曲库里的值输出。`;
  
  // 附加触发原因
  if (triggerSource) {
    promptBody += `\n【系统触发源头】\n本轮推理是由「${triggerSource}」事件触发的。`;
  }

  promptBody += `\n\n请结合以上全部上下文贴纸，做出符合你 DJ 身份的决策，输出完全对齐 System Instructions 的纯 JSON 数据：`;

  return {
    systemInstruction: djPersona,
    prompt: promptBody
  };
}

module.exports = {
  assemblePrompt,
  getActiveRoutine
};
