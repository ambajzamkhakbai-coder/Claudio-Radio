const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const db = require('./db');

// 从环境变量或数据库动态获取 Gemini API Key，数据库存储的 Key 具有更高优先级，且进行严格的首尾空格和换行符清洗
function getApiKey() {
  const dbKey = db.getPreference('geminiApiKey');
  if (dbKey && dbKey.trim() !== '') {
    return dbKey.trim();
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

// 动态获取 API Base URL，并进行严格的 trim 清洗过滤
function getApiBase() {
  const dbBase = db.getPreference('geminiApiBase');
  if (dbBase && dbBase.trim() !== '') {
    return dbBase.trim();
  }
  return (process.env.GEMINI_API_BASE || '').trim();
}

/**
 * 健壮的 JSON 清洗函数，能够剥离 Markdown 围栏并提取合法 JSON 字符串
 * @param {string} rawText 
 * @returns {Object}
 */
function cleanAndParseJson(rawText) {
  let cleaned = rawText.trim();
  
  // 1. 移除非法的前导字符，截取 JSON 核心大括号块
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }
  
  // 2. 剥离 Markdown 围栏（如 ```json ... ```）
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/, '');
  
  try {
    return JSON.parse(cleaned.trim());
  } catch (error) {
    console.error('JSON Parse failed after cleaning. Raw Text:', rawText);
    throw new Error('Invalid JSON format returned by AI Model.');
  }
}

function extractUserInputFromPrompt(prompt) {
  const userInputMatch = prompt.match(/【听众刚刚对你说的话】\n听众："(.+?)"/);
  return userInputMatch ? userInputMatch[1].trim() : '';
}

function parseSongsFromPrompt(prompt) {
  const songs = [];
  const songRegex = /(\d+)\.\s*\[ID:\s*(\d+)\]\s*《(.+?)》\s*-\s*(.+)/g;
  let match;

  while ((match = songRegex.exec(prompt)) !== null) {
    songs.push({
      id: match[2],
      name: match[3],
      artist: match[4].trim(),
      source: 'ncm'
    });
  }

  if (songs.length === 0) {
    songs.push(
      { id: '2023530089', name: 'If', artist: 'Bread', source: 'ncm' },
      { id: '139774', name: 'Yesterday Once More', artist: 'Carpenters', source: 'ncm' },
      { id: '5264641', name: 'Rain', artist: '苏打绿', source: 'ncm' }
    );
  }

  return songs;
}

function isExplicitMusicRequest(text) {
  if (!text) return false;

  const normalized = text.toLowerCase();
  return [
    /推荐.*(歌|音乐|曲|歌单)/,
    /(歌|音乐|曲|歌单).*(推荐|列表|清单|候选|来几首|给几首)/,
    /(有没有|有什么|来点|给点|整点).*(歌|音乐|曲|歌单)/,
    /(让我看看|给我看看|看看).*(推荐|列表|歌单|候选)/,
    /(想听|要听|听点|听首|听歌|播放|放点|放首|帮我放|给我放|来首|来点|点一首|点歌)/,
    /(音乐|歌曲|歌单|旋律).*(推荐|来点|安排|放|听)/,
    /(抒情|开心|伤感|治愈|轻松|舒缓|提神|专注|睡前|摇滚|民谣|爵士|电子|纯音乐|lofi|lo-fi).*(歌|音乐|曲)/,
    // 换歌/切换/再来一批 — 用户拒绝当前列表，要求新的候选歌曲
    /^(换歌|换几首|换一批|换换|换一个|换首|换点|切换|切歌)$/,
    /^(听别的|其他的|别的歌|别首歌|另外的|其他歌)$/,
    /^(再来几首|再来点|再来一批|还有吗|别的呢|继续推荐|继续来|再推荐|再换|再换几首)$/,
    /(不好听|不喜欢|不对味|不适合|不要这个|不要这首|换种风格|换风格|换个风格|不对胃口|没感觉|听腻了)/,
    /^(有没有别的|有没有其他|有没有其他的)/,
    /换.*(歌|首|曲|一批|几首|一下|个)/,
    /(歌|首|曲).*(换|切换|替换)/
  ].some(pattern => pattern.test(normalized));
}

function pickSongCandidates(songs, count = 3) {
  const uniqueSongs = [];
  const seen = new Set();

  for (const song of songs) {
    if (!song || !song.id || seen.has(String(song.id))) continue;
    seen.add(String(song.id));
    uniqueSongs.push(song);
  }

  return uniqueSongs.slice(0, count).map(song => ({
    id: song.id,
    name: song.name,
    artist: song.artist,
    source: song.source || 'ncm',
    reason: song.reason || `这首歌适合现在的氛围，可以先听听它的颜色。`
  }));
}

function normalizeBrainResult(resultObj, inputContext) {
  const prompt = inputContext.prompt || '';
  const userInput = extractUserInputFromPrompt(prompt);
  const explicitMusicRequest = isExplicitMusicRequest(userInput);
  const availableSongs = parseSongsFromPrompt(prompt);

  if (!['chat', 'recommend', 'play'].includes(resultObj.intent)) {
    resultObj.intent = (resultObj.play && resultObj.play.length > 0) ? 'play' : 'chat';
  }
  if (typeof resultObj.say !== 'string') resultObj.say = '';
  if (!Array.isArray(resultObj.play)) resultObj.play = [];
  if (typeof resultObj.reason !== 'string') resultObj.reason = '电台常规推荐';

  if (userInput && !explicitMusicRequest) {
    resultObj.intent = 'chat';
    resultObj.play = [];
    resultObj.reason = '闲聊对话，不切歌';
  }

  if (userInput && explicitMusicRequest) {
    resultObj.intent = 'recommend';
    resultObj.play = pickSongCandidates(
      resultObj.play.length >= 3 ? resultObj.play : resultObj.play.concat(availableSongs),
      3
    );
    resultObj.say = '给你三首，点歌名就能播放。';
    resultObj.reason = resultObj.reason || '听众明确表达了听歌意愿，返回候选歌曲供选择';
  }

  if (!userInput && resultObj.intent === 'recommend') {
    resultObj.intent = 'play';
    resultObj.play = pickSongCandidates(resultObj.play.length ? resultObj.play : availableSongs, 1);
  }

  if (!['ducking', 'crossfade'].includes(resultObj.segue)) {
    resultObj.segue = resultObj.say && resultObj.intent !== 'chat' ? 'ducking' : 'crossfade';
  }

  return resultObj;
}

/**
 * 本地拟真大模型大脑 (Local SimBrain)，100% 毫秒级免网络离线连通，提供超高情商 DJ 模拟
 * @param {Object} inputContext 
 * @returns {Object} 格式符合强 JSON 契约的播放包
 */
function generateLocalSimReply(inputContext) {
  const prompt = inputContext.prompt || '';
  
  // 1. 简易提取当前作息时段
  let routine = '极客编程';
  const routineMatch = prompt.match(/听众作息时段分析：当前正处于「(.+?)」时段/);
  if (routineMatch) {
    routine = routineMatch[1];
  }
  
  // 2. 简易提取听众输入
  const userInput = extractUserInputFromPrompt(prompt);
  
  // 3. 解析当前备选曲库贴纸中的歌曲
  const songs = parseSongsFromPrompt(prompt);
  
  // 随机挑选一首曲目
  const targetSong = songs[Math.floor(Math.random() * songs.length)];
  
  // 4. 根据作息时段和用户输入，高情商编排主持人旁白
  let sayContent = '';
  let reason = '';
  
  // 模拟对用户输入的特别温情回应
  if (userInput) {
    const keywords = ['累', '疲惫', '辛苦', '压力', '紧张', '烦'];
    const hasStress = keywords.some(k => userInput.includes(k));
    const wantsMusic = isExplicitMusicRequest(userInput);
    
    if (wantsMusic) {
      const candidates = pickSongCandidates(songs, 3);
      return {
        intent: 'recommend',
        say: '给你三首，点歌名就能播放。',
        play: candidates,
        reason: '听众明确表达了听歌意愿，本地大脑返回候选歌曲供选择。',
        segue: 'crossfade'
      };
    }

    if (hasStress) {
      sayContent = `听到你说有点累，我先不急着切歌。我们就在这里慢一点，先把肩膀放下来，喝口水也算一种小型重启。你想聊聊卡住的地方，还是只想让我陪你安静一会儿？`;
      reason = '听众表达了疲惫和压力，但没有明确要求听歌，因此只进行闲聊安慰。';
    } else {
      sayContent = `收到你的留言：“${userInput}”。我在呢，可以陪你聊生活、心情、产品、天气，或者任何忽然冒出来的小念头。想听歌时直接说，我再给你列歌单。`;
      reason = '听众进行普通闲聊，本地大脑只回复文本，不切歌。';
    }

    return {
      intent: 'chat',
      say: sayContent,
      play: [],
      reason: reason,
      segue: 'crossfade'
    };
  } else {
    // 节律常态播放播报
    if (routine.includes('编程') || routine.includes('极客')) {
      sayContent = `这里是克劳迪奥点播台。极客的双手在键盘上编织未来，而音乐是敲击代码时最温润的伴侣。接下来这首《${targetSong.name}》送给正在专心写 Bug 和修 Bug 的你，愿代码如流水般顺畅！`;
      reason = '极客编程时段常态陪伴，推荐备选池中极富律动与专注感的歌曲。';
    } else if (routine.includes('深夜') || routine.includes('睡眠')) {
      sayContent = `夜已深了，万籁俱寂，只剩下电台的微光还在守护着你。我是你的深夜守护者克劳迪奥。放空所有心事，听听这首《${targetSong.name}》，愿它化作一片轻柔的羽毛，带你进入甜甜的梦乡。`;
      reason = '深夜伴眠时段，本地大脑挑选温柔、呢喃老歌进行抚慰播报。';
    } else if (routine.includes('早安') || routine.includes('唤醒')) {
      sayContent = `叮咚！早安！新的一天拉开序幕啦。我是你的清晨唤醒官克劳迪奥。深呼吸，迎接第一缕阳光，接下来送上充满朝气的《${targetSong.name}》，让我们踩着明快的鼓点，出发！`;
      reason = '清晨唤醒，推荐动感明亮的开工歌曲。';
    } else {
      sayContent = `哈喽，收音机前的你还好吗？我是电台主持克劳迪奥。在这个悠闲的片刻，不需要想太多。静静聆听这首《${targetSong.name}》，让心情随着音符一起自由飞翔。`;
      reason = `电台日常陪伴播报，精选《${targetSong.name}》开启温馨体验。`;
    }
  }
  
  return {
    intent: 'play',
    say: sayContent,
    play: [
      {
        id: targetSong.id,
        name: targetSong.name,
        artist: targetSong.artist,
        source: 'ncm'
      }
    ],
    reason: reason,
    segue: 'ducking'
  };
}

/**
 * 调度 大脑进行计算推理的核心方法，完美融合 Google 官方与 OpenAI / DeepSeek 双通道
 * @param {Object} inputContext - 由 context.assemblePrompt 生成的上下文
 * @returns {Promise<Object>} 严格对齐 JSON 契约的数据对象
 */
async function compute(inputContext) {
  const apiKey = getApiKey();
  
  // 1. 如果 API Key 填的是 local / sim / antigravity / offline，直接免网络运行本地拟真大脑
  if (apiKey && ['local', 'sim', 'antigravity', 'offline'].includes(apiKey.trim().toLowerCase())) {
    console.log('[Claudio] Local SimBrain mode activated! Bypassing network API calls.');
    return generateLocalSimReply(inputContext);
  }

  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API Key is not configured. Please fill it in Settings or .env file.');
  }

  let apiBase = getApiBase();
  
  // 智能纠错：如果用户把控制台域名 platform.deepseek.com 填作 API 域名，自动纠正为 api.deepseek.com
  if (apiBase && apiBase.includes('platform.deepseek.com')) {
    apiBase = apiBase.replace('platform.deepseek.com', 'api.deepseek.com');
    console.warn('[Claudio] Auto-corrected misconfigured "platform.deepseek.com" to "api.deepseek.com"');
  }

  const isSkKey = apiKey.startsWith('sk-');

  // 如果是 sk- 开头的 Key，或者显式配置了 Base URL，则自动流转至 OpenAI 兼容引擎
  if (isSkKey || apiBase !== '') {
    let modelName = 'gemini-2.5-flash'; // 默认中转模型名

    // 智能容错：如果是 sk- 开头且 Base URL 留空，通过密钥长度指纹自识别服务商
    if (apiBase === '') {
      if (apiKey.length === 35) { // sk- (3) + 32位 hex = 35位，代表 DeepSeek 官方
        apiBase = 'https://api.deepseek.com';
        modelName = 'deepseek-chat';
        console.log('[Claudio] 35-char DeepSeek Key fingerprint detected! Automatically routing to DeepSeek Official: https://api.deepseek.com');
      } else { // 默认为 67位 的硅基流动等中转站
        apiBase = 'https://api.siliconflow.cn/v1';
        modelName = 'Qwen/Qwen2.5-7B-Instruct';
        console.log('[Claudio] 67-char or general Key fingerprint detected. Automatically routing to SiliconFlow: https://api.siliconflow.cn/v1');
      }
    } else {
      // 若用户显式配了 Base URL，则根据 Base URL 进行二次智能模型甄别
      if (apiBase.includes('deepseek.com')) {
        modelName = 'deepseek-chat';
        console.log('[Claudio] Switched AI engine channel to DeepSeek Official (model: deepseek-chat).');
      } else if (apiBase.includes('siliconflow')) {
        modelName = 'Qwen/Qwen2.5-7B-Instruct';
        console.log('[Claudio] Switched AI engine channel to SiliconFlow (model: Qwen/Qwen2.5-7B-Instruct).');
      } else {
        console.log(`[Claudio] Switched AI engine channel to Custom OpenAI-compatible Proxy (model: ${modelName}).`);
      }
    }

    try {
      // 格式化 API Base，确保其不以 / 结尾，并附带正确的聊天路由
      let requestUrl = apiBase;
      if (requestUrl.endsWith('/')) {
        requestUrl = requestUrl.slice(0, -1);
      }
      if (!requestUrl.endsWith('/chat/completions')) {
        requestUrl += '/chat/completions';
      }

      console.log(`[Claudio HTTP] Dispatching request to: ${requestUrl}`);
      const response = await axios.post(
        requestUrl,
        {
          model: modelName,
          messages: [
            { role: 'system', content: inputContext.systemInstruction },
            { role: 'user', content: inputContext.prompt }
          ],
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000 // 15秒超时防挂起
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('Empty response returned by OpenAI-compatible API.');
      }

      const rawText = response.data.choices[0].message.content;
      const resultObj = cleanAndParseJson(rawText);
      
      return normalizeBrainResult(resultObj, inputContext);

    } catch (error) {
      console.error('OpenAI-compatible compute failed:', error.message);
      if (error.response && error.response.data) {
        console.error('Error Response Details:', JSON.stringify(error.response.data));
      }
      throw error;
    }

  } else {
    // 官方 Google Gemini API 驱动模式（修正构造器 Bug）
    try {
      console.log('[Claudio] Switched AI engine channel to Google Official Generative AI (model: gemini-2.5-flash).');
      const ai = new GoogleGenerativeAI(apiKey);
      
      const model = ai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: inputContext.systemInstruction
      });

      const response = await model.generateContent({
        contents: inputContext.prompt,
        generationConfig: {
          responseMimeType: 'application/json'
        }
      });

      const rawText = response.text();
      const resultObj = cleanAndParseJson(rawText);
      
      return normalizeBrainResult(resultObj, inputContext);

    } catch (error) {
      console.error('Google Gemini official compute failed:', error);
      throw error;
    }
  }
}

module.exports = {
  compute,
  cleanAndParseJson
};
