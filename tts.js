const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');

// 定义旁白静态资源缓存目录
const CACHE_DIR = path.join(__dirname, 'public', 'cache', 'tts');

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// 从数据库或环境变量获取 Key
function getApiKey() {
  const dbKey = db.getPreference('fishAudioApiKey');
  if (dbKey && dbKey.trim() !== '') {
    return dbKey;
  }
  return process.env.FISH_AUDIO_API_KEY;
}

// 获取选定的温柔知性女声 Voice ID
function getVoiceId() {
  return process.env.FISH_AUDIO_VOICE_ID || '7f113a778e884144b60e33ef72d763ed';
}

/**
 * 文本转语音 (TTS) 接口封装，支持强力 MD5 哈希静态缓存
 * @param {string} text - 主持人播报旁白文本
 * @returns {Promise<string>} 返回旁白音频的静态 HTTP 访问路径 (如 '/cache/tts/{hash}.mp3')
 */
async function textToSpeech(text) {
  if (!text || text.trim() === '') {
    return '';
  }

  ensureCacheDir();

  // 1. 对文本计算其 MD5 哈希值，作为缓存的文件名
  const hash = crypto.createHash('md5').update(text.trim()).digest('hex');
  const filename = `${hash}.mp3`;
  const localPath = path.join(CACHE_DIR, filename);
  const webPath = `/cache/tts/${filename}`;

  // 2. 如果哈希缓存命中，直接以 1ms 延迟返回，完全节省 API 耗用与网络等待
  if (fs.existsSync(localPath)) {
    console.log(`[TTS] Hash cache hit! MD5: ${hash}`);
    return webPath;
  }

  // 3. 缓存未命中，调用 Fish Audio 官方接口生成
  const apiKey = getApiKey();
  if (!apiKey || apiKey.trim() === '') {
    console.warn('[TTS] Fish Audio API Key is missing. TTS generation skipped.');
    return ''; // 触发上游降级无旁白播放
  }

  const voiceId = getVoiceId();
  console.log(`[TTS] Generating new voice segment. Text length: ${text.length} chars.`);

  try {
    const response = await axios({
      method: 'POST',
      url: 'https://api.fish.audio/v1/tts',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: text,
        reference_id: voiceId,
        format: 'mp3'
      },
      responseType: 'arraybuffer', // 以二进制 Buffer 接收音频流
      timeout: 8000 // 8s 超时
    });

    // 4. 将音频流写入本地静态缓存文件
    fs.writeFileSync(localPath, response.data);
    console.log(`[TTS] Voice segment generated and cached: ${filename}`);
    
    return webPath;

  } catch (error) {
    console.error('[TTS] Fish Audio generation failed:', error.message);
    // 失败降级，返回空字符串让播放器自动静音切歌
    return '';
  }
}

module.exports = {
  textToSpeech
};
