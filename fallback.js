/**
 * AI 音乐电台异常边界兜底与降级中心 (Fallback Center)
 */

// 预定义的高品质免费外链兜底音乐池，在网易云接口或版权缺失时启用
const BACKUP_MUSIC_POOL = [
  {
    id: '2023530089',
    name: 'If',
    artist: 'Bread',
    url: 'https://music.163.com/song/media/outer/url?id=2023530089.mp3'
  },
  {
    id: '139774',
    name: 'Yesterday Once More',
    artist: 'Carpenters',
    url: 'https://music.163.com/song/media/outer/url?id=139774.mp3'
  },
  {
    id: '5264641',
    name: 'Rain',
    artist: '苏打绿',
    url: 'https://music.163.com/song/media/outer/url?id=5264641.mp3'
  }
];

const fallback = {
  /**
   * 当 Gemini API 推理失败或格式化崩塌时的降级处理
   * @param {Error} error - 产生的错误实例
   * @returns {Object} 格式符合 JSON 契约的降级播放包
   */
  handleBrainFailure: (error) => {
    console.warn('[Fallback] Brain failure triggered. Recovering automatically...', error.message);
    
    // 随机挑选一首经典兜底歌曲
    const randomSong = BACKUP_MUSIC_POOL[Math.floor(Math.random() * BACKUP_MUSIC_POOL.length)];
    
    return {
      say: '刚刚信号受到了一点干扰，不过没关系。主持人克劳迪奥先为你送上一首温暖的老歌，愿音符拂去你的倦意。',
      play: [
        {
          id: randomSong.id,
          name: randomSong.name,
          artist: randomSong.artist,
          source: 'ncm'
        }
      ],
      reason: `Gemini大脑计算失败兜底，错误: ${error.message}`,
      segue: 'ducking'
    };
  },

  /**
   * 当网易云歌曲流请求完全失败时的降级方案
   * @param {string} songId - 失败的歌曲 ID
   * @returns {Object} 歌曲的直链包
   */
  handleSongStreamFailure: (songId) => {
    console.warn(`[Fallback] Song stream failure for ID: ${songId}. Fallback to public backup pool.`);
    
    // 优先尝试从内置池中匹配同 ID 的歌曲直链
    const matched = BACKUP_MUSIC_POOL.find(s => s.id === String(songId));
    if (matched) {
      return matched;
    }
    
    // 匹配失败则默认返回面包合唱团的 If
    return BACKUP_MUSIC_POOL[0];
  }
};

module.exports = fallback;
