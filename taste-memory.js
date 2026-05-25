const fs = require('fs');
const path = require('path');

const TASTE_FILE = path.join(__dirname, 'taste.md');
const MEMORY_SECTION_TITLE = '## 对话学习记忆';

function cleanFragment(value) {
  return value
    .replace(/[。！？!?,，；;：:]+$/g, '')
    .replace(/^(一点|一些|几首|几支|那种|这种|类型|风格|音乐|歌|歌曲|曲子)\s*/g, '')
    .trim()
    .slice(0, 80);
}

function extractPreferenceObservations(input) {
  const text = (input || '').trim();
  if (!text) return [];

  const observations = [];
  const patterns = [
    {
      regex: /(?:^|[，,。！？!?\s])(?:我|本人)?(?:很|挺|比较|更|特别|超|最)?(?:喜欢|爱听|常听|偏爱|最近喜欢|最近在听)\s*([^，,。！？!?；;]+)/g,
      format: value => `用户喜欢/常听：${value}`
    },
    {
      regex: /(?:^|[，,。！？!?\s])(?:以后|之后|后面)?(?:可以|帮我|给我)?(?:多放|多推荐|常放)\s*([^，,。！？!?；;]+)/g,
      format: value => `用户希望多推荐：${value}`
    },
    {
      regex: /(?:^|[，,。！？!?\s])(?:我|本人)?(?:不喜欢|不太喜欢|讨厌|反感|听不惯)\s*([^，,。！？!?；;]+)/g,
      format: value => `用户不喜欢/避雷：${value}`
    },
    {
      regex: /(?:^|[，,。！？!?\s])(?:以后|之后|后面)?(?:少放|别放|不要放|不要推荐|避开|避雷)\s*([^，,。！？!?；;]+)/g,
      format: value => `用户希望少推荐：${value}`
    },
    {
      regex: /(?:^|[，,。！？!?\s])(?:我的)?(?:听歌风格|音乐口味|音乐品味|听歌品味)(?:是|偏向|比较偏|更偏)?\s*([^，,。！？!?；;]+)/g,
      format: value => `用户自述听歌风格：${value}`
    }
  ];

  for (const { regex, format } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const fragment = cleanFragment(match[1]);
      if (fragment.length >= 2) {
        observations.push(format(fragment));
      }
    }
  }

  return [...new Set(observations)];
}

function rememberTasteFromText(input) {
  const observations = extractPreferenceObservations(input);
  if (observations.length === 0) return [];

  let content = '';
  try {
    if (fs.existsSync(TASTE_FILE)) {
      content = fs.readFileSync(TASTE_FILE, 'utf8');
    }
  } catch (err) {
    console.error('[TasteMemory] Failed to read taste.md:', err.message);
    return [];
  }

  const newObservations = observations.filter(item => !content.includes(item));
  if (newObservations.length === 0) return [];

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const prefix = content.includes(MEMORY_SECTION_TITLE)
    ? ''
    : `\n${MEMORY_SECTION_TITLE}\n`;
  const lines = newObservations.map(item => `* ${timestamp} 从对话学习：${item}`).join('\n');

  try {
    fs.appendFileSync(TASTE_FILE, `${prefix}${lines}\n`, 'utf8');
    console.log(`[TasteMemory] Learned ${newObservations.length} taste observation(s) from dialogue.`);
  } catch (err) {
    console.error('[TasteMemory] Failed to append taste.md:', err.message);
    return [];
  }

  return newObservations;
}

module.exports = {
  extractPreferenceObservations,
  rememberTasteFromText
};
