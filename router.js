const context = require('./context');
const claudio = require('./claudio');
const db = require('./db');
const tasteMemory = require('./taste-memory');

// 高频直接指令正则列表，绕过 AI 实施秒级直连
const COMMAND_REGEXES = {
  skip: /^(下一首|切歌|播放下一首|next|skip)$/i,
  ncmSearch: /^\/play\s*(.+)$/i
};

function cleanSongQuery(query) {
  return (query || '')
    .replace(/^(一下|一下子|一首|首|点|些|个)\s*/g, '')
    .replace(/的(歌|歌曲)$/g, '')
    .replace(/(这首歌|这首|这歌|这支歌|这支|歌曲|歌)$/g, '')
    .replace(/[。！？!?,，；;]+$/g, '')
    .trim();
}

function isVagueMusicRequest(query) {
  const text = cleanSongQuery(query).toLowerCase();
  if (!text) return true;

  const vagueWords = [
    '推荐', '几首', '一些', '一点', '点儿', '随便', '歌单', '音乐', '歌曲',
    '风格', '类型', '适合', '类似', '治愈', '轻松', '舒缓', '提神', '专注',
    '睡前', '白噪音', '纯音乐', 'lofi', 'lo-fi', '摇滚', '民谣', '爵士',
    '电子', '华语', '英文', '日语', 'city pop', '独立', '流行'
  ];

  if (/[《「『].+[》」』]/.test(query)) return false;
  if (/的.+/.test(text) && !/(治愈|轻松|舒缓|提神|专注|睡前|类似|适合)的/.test(text)) return false;
  return vagueWords.some(word => text.includes(word)) && text.length <= 16;
}

function extractDirectSongQuery(input) {
  const inputStr = (input || '').trim();
  if (!inputStr) return '';

  if (COMMAND_REGEXES.ncmSearch.test(inputStr)) {
    return cleanSongQuery(inputStr.match(COMMAND_REGEXES.ncmSearch)[1]);
  }

  const directPatterns = [
    /^(?:直接|立刻|马上)?(?:播放|播一下|播|放一下|放|放首|放一首|帮我放|给我放|来首|来一首)\s*(.+)$/i,
    /^听\s*(.+)$/i,
    /^(?:我)?(?:想听|要听)\s*(.+)$/i,
    /^搜索播放\s*(.+)$/i
  ];

  for (const pattern of directPatterns) {
    const match = inputStr.match(pattern);
    if (!match) continue;

    const query = cleanSongQuery(match[1]);
    if (query && !isVagueMusicRequest(query)) {
      return query;
    }
  }

  return '';
}

function isRecommendationRequest(input) {
  const text = (input || '').trim().toLowerCase();
  if (!text) return false;

  return [
    /推荐.*(歌|音乐|曲|歌单)/,
    /(歌|音乐|曲|歌单).*(推荐|列表|清单|候选|来几首|给几首)/,
    /(有没有|有什么|来点|给点|整点).*(歌|音乐|曲|歌单).*推荐?/,
    /(让我看看|给我看看|看看).*(推荐|列表|歌单|候选)/,
    /(抒情|开心|伤感|治愈|轻松|舒缓|提神|专注|睡前|摇滚|民谣|爵士|电子|纯音乐|lofi|lo-fi).*(歌|音乐|曲).*(推荐|一下|几首)?/,
    // 换歌/切换意图 等同推荐请求
    /^(换歌|换几首|换一批|换换|换一个|换首|换点|切换|切歌|听别的|其他的|别的歌|再来几首|还有吗)$/,
    /(换|切|替换|更新|刷新).*(歌|曲|列表|推荐)/,
    /(不好听|不喜欢|不对味|不适合|换种风格|换个风格|没感觉|听腻了)/
  ].some(pattern => pattern.test(text));
}

/**
 * 核心意图分流处理方法
 * @param {Object} options
 * @param {string} options.userInput - 听众发送的文本消息
 * @param {Object} options.weatherData - 实时天气数据
 * @param {Object} options.lastSong - 上一首曲目信息
 * @returns {Promise<Object>} 返回最终供 PWA 播放的指令包，格式符合 JSON 契约
 */
async function route(options = {}) {
  const { userInput, weatherData, lastSong } = options;
  const inputStr = (userInput || '').trim();

  // --- 1. 意图分流：快捷简单指令直连 ---

  // 1.1 手动切歌指令
  if (COMMAND_REGEXES.skip.test(inputStr)) {
    console.log('[Router] Direct command detected: SKIP');
    return {
      isDirect: true,
      action: 'next',
      say: '', // 不说话
      reason: '用户手动切歌，直接切盘',
      segue: 'crossfade'
    };
  }

  // 1.2 明确格式的搜索播放（如："/play 晴天" 或 "放首周杰伦的七里香"）
  let searchQuery = extractDirectSongQuery(inputStr);

  if (searchQuery) {
    console.log(`[Router] Direct command detected: SEARCH_PLAY -> "${searchQuery}"`);
    db.addMessage('user', inputStr);
    tasteMemory.rememberTasteFromText(inputStr);
    return {
      isDirect: true,
      action: 'search_play',
      query: searchQuery,
      say: '', // 直连默认不说话
      reason: `用户要求播放特定曲目: ${searchQuery}`,
      segue: 'crossfade'
    };
  }

  // --- 2. 意图分流：自然语言与认知意图流转至 Gemini 大脑 ---
  console.log(`[Router] AI Cognitive Intent detected: "${inputStr || '常规电台节律触发'}"`);
  
  // 记录用户对话至历史记忆表
  if (inputStr) {
    db.addMessage('user', inputStr);
    tasteMemory.rememberTasteFromText(inputStr);
  }

  const promptPackage = context.assemblePrompt({
    userInput: inputStr || undefined,
    weatherData,
    triggerSource: inputStr
      ? (isRecommendationRequest(inputStr) ? '用户明确要求推荐歌曲列表' : '用户对话触发')
      : '系统电台调度',
    lastSong
  });

  // 投喂 Gemini 大脑推理
  const brainResult = await claudio.compute(promptPackage);

  // 记录 AI 的播报回答至历史记忆表
  if (brainResult.say) {
    db.addMessage('model', brainResult.say);
  }

  return {
    isDirect: false,
    ...brainResult
  };
}

module.exports = {
  route
};
