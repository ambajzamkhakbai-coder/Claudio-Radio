const claudio = require('./claudio');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const ARTIST_TAGS = [
  { pattern: /Gareth\.?T|郑润泽|沈以诚|颜人中|李荣浩|陈粒|房东的猫|夏日入侵企画/i, tags: ['新世代华语流行', '温柔独立流行', '细腻情绪表达'] },
  { pattern: /张雨生|伍佰|周传雄|刘若英|Carpenters|Bread|久石譲|久石让/i, tags: ['经典怀旧', '旋律叙事', '情绪沉淀'] },
  { pattern: /Ailee|G\.E\.M|邓紫棋|Kelly Clarkson/i, tags: ['高爆发力女声', '情绪张力', '流行抒情'] },
  { pattern: /国风堂|哦漏/i, tags: ['国风', '古风叙事'] },
  { pattern: /苏打绿|五月天|万能青年旅店/i, tags: ['乐队', '独立摇滚', '华语经典'] }
];

const SONG_TAGS = [
  { pattern: /海|夏|Summer|想去海边|大海|海屿你/i, tags: ['夏日感', '海风感', '开阔放松'] },
  { pattern: /小半|一半一半|玻璃|颜色|形容|如果呢|寂寞|后来|知我/i, tags: ['细腻抒情', '轻忧郁', '故事感'] },
  { pattern: /New Boy|晚安|恋人|唯一/i, tags: ['温暖陪伴', '轻快流行'] }
];

function getRecentPlays(plays, days = 7) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return (plays || [])
    .filter(play => Number(play.playedAt) >= since)
    .filter(play => play && play.name && play.artist);
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function inferTags(plays) {
  const tagScores = new Map();

  function addTags(tags) {
    for (const tag of tags) {
      tagScores.set(tag, (tagScores.get(tag) || 0) + 1);
    }
  }

  for (const play of plays) {
    const artist = play.artist || '';
    const name = play.name || '';

    for (const rule of ARTIST_TAGS) {
      if (rule.pattern.test(artist)) addTags(rule.tags);
    }
    for (const rule of SONG_TAGS) {
      if (rule.pattern.test(name)) addTags(rule.tags);
    }
  }

  return [...tagScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function summarizePlayData(plays) {
  const recentPlays = getRecentPlays(plays);
  const artists = countBy(recentPlays, play => play.artist);
  const songs = countBy(recentPlays, play => `《${play.name}》 - ${play.artist}`);
  const tags = inferTags(recentPlays);

  return {
    recentPlays,
    artists,
    songs,
    tags,
    total: recentPlays.length,
    uniqueSongs: songs.length,
    uniqueArtists: artists.length
  };
}

function renderFallbackProfile(summary) {
  const topTags = summary.tags.slice(0, 8).map(item => item.name);
  const topArtists = summary.artists.slice(0, 8).map(item => item.name);
  const topSongs = summary.songs.slice(0, 10).map(item => item.name);
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });

  return `# 用户音乐偏好 (Music Taste Profile)

> 基于最近 7 天播放记录自动生成。生成时间：${generatedAt}
> 样本量：${summary.total} 次播放，${summary.uniqueSongs} 首不同歌曲，${summary.uniqueArtists} 组不同歌手。

## 核心偏好
* **近期主要曲风/气质**：${topTags.length ? topTags.join('、') : '样本较少，暂以温和流行与舒缓陪伴为主'}。
* **近期高频歌手**：${topArtists.length ? topArtists.join('、') : '暂无足够歌手样本'}。
* **近期代表歌曲**：${topSongs.length ? topSongs.join('、') : '暂无足够歌曲样本'}。

## 听歌习惯推断
* 倾向选择旋律清晰、情绪细腻、适合陪伴工作/放松的歌曲。
* 对华语流行、独立流行、经典怀旧和轻忧郁叙事类歌曲接受度较高。
* 当用户明确点歌时，优先满足具体歌曲；当用户只说想听某种感觉时，优先推荐与上述画像相近的候选歌曲。

## 推荐策略
* 自动电台推荐时，优先选择：${topTags.slice(0, 5).join('、') || '温柔、旋律性强、低打扰'} 的歌曲。
* 避免连续推荐同一首歌或同一歌手，尽量在相近气质中做轻微变化。
* 下午和工作时段可以偏向轻快、温柔、有陪伴感的歌；傍晚和深夜可以偏向故事感、怀旧感和低刺激度。

## 负面偏好（避雷指南）
* 当前近 7 天记录中没有明确负反馈。若用户在对话中说“不喜欢/少放/别放”，请优先遵守对话学习记忆。
`;
}

async function renderAiProfile(summary, currentTaste = '') {
  const compactPlays = summary.recentPlays.slice(-80).map((play, index) => {
    const time = new Date(play.playedAt).toLocaleString('zh-CN', { hour12: false });
    return `${index + 1}. ${time} 《${play.name}》 - ${play.artist}`;
  }).join('\n');

  const result = await claudio.compute({
    systemInstruction: `你是一个专业音乐品味画像分析师。你必须只输出 JSON 对象，格式为 {"intent":"chat","say":"完整 markdown 画像","play":[],"reason":"weekly taste profile","segue":"crossfade"}。say 字段必须是完整的 taste.md 内容，不要包裹代码块。`,
    prompt: `
请基于最近 7 天播放记录，生成一份可直接覆盖 taste.md 的中文 Markdown 用户音乐画像。

要求：
1. 标题必须是 "# 用户音乐偏好 (Music Taste Profile)"。
2. 必须包含：核心偏好、近期高频歌手、近期代表歌曲、听歌习惯推断、推荐策略、负面偏好（避雷指南）。
3. 请根据歌曲名和歌手合理推断曲风/气质，不要编造不存在的播放记录。
4. 如果原画像中有明确长期偏好，请保留但用最近 7 天数据校准优先级。
5. 文风简洁，适合之后直接放进 AI 电台 prompt。

【原画像】
${currentTaste || '暂无'}

【最近 7 天播放记录】
${compactPlays || '暂无播放记录'}
`
  });

  if (!result || typeof result.say !== 'string' || !result.say.includes('# 用户音乐偏好')) {
    throw new Error('AI profile result is empty or malformed.');
  }

  return result.say.trim() + '\n';
}

async function generateWeeklyTasteProfile(plays, currentTaste = '') {
  const summary = summarizePlayData(plays);
  if (summary.total === 0) {
    throw new Error('最近 7 天还没有播放记录，暂时无法生成画像。');
  }

  try {
    const content = await renderAiProfile(summary, currentTaste);
    return { content, summary, generatedBy: 'ai' };
  } catch (err) {
    console.warn('[TasteProfiler] AI generation failed, falling back to local profiler:', err.message);
    return {
      content: renderFallbackProfile(summary),
      summary,
      generatedBy: 'local'
    };
  }
}

module.exports = {
  WEEK_MS,
  generateWeeklyTasteProfile,
  summarizePlayData
};
