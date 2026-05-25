// ==================== 1. 全局配置与状态初始化 ====================
let currentTab = 'player';
let ws = null;
let activeSong = null;
let favoriteSongs = [];

// 音频双引擎
const ttsAudio = new Audio();
const musicAudio = new Audio();

// 统一音量变量 (0 到 100)
let userVolume = 80; 
let isDucking = false; // 当前是否处于音量降低（闪避）状态

// ==================== 2. DOM 元素获取 ====================
const DOM = {
  // 选项卡
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  themeToggle: document.getElementById('theme-toggle'),
  brandHome: document.getElementById('brand-home'),
  
  // 时钟
  clock: document.getElementById('clock-display'),
  date: document.getElementById('date-display'),
  
  // 播放器状态与元数据
  trackName: document.getElementById('track-name'),
  trackArtist: document.getElementById('track-artist'),
  playerStatus: document.getElementById('player-status'),
  visualizer: document.getElementById('bar-visualizer'),
  timeCurrent: document.getElementById('time-current'),
  timeDuration: document.getElementById('time-duration'),
  progressFill: document.getElementById('progress-fill'),
  progressBar: document.getElementById('progress-bar'),
  volSlider: document.getElementById('vol-slider'),
  
  // 控制按键
  btnPlayPause: document.getElementById('btn-play-pause'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnFav: document.getElementById('btn-fav'),
  btnFavToggle: document.getElementById('btn-fav-toggle'),
  btnChatToggle: document.getElementById('btn-chat-toggle'),
  favCount: document.getElementById('fav-count'),
  favPanel: document.getElementById('fav-panel'),
  favList: document.getElementById('fav-list'),
  
  // 聊天窗口
  chatHistory: document.getElementById('chat-history'),
  chatInput: document.getElementById('chat-input'),
  chatSubmit: document.getElementById('chat-submit'),
  chatContainer: document.querySelector('.chat-container'),
  wsStatus: document.getElementById('ws-status'),
  
  // 画像编辑器
  tasteEditor: document.getElementById('taste-editor'),
  btnGenerateWeeklyTaste: document.getElementById('btn-generate-weekly-taste'),
  btnSaveTaste: document.getElementById('btn-save-taste'),
  tasteSaveStatus: document.getElementById('taste-save-status'),
  
  // 秘钥设置
  geminiKey: document.getElementById('input-gemini-key'),
  geminiApiBase: document.getElementById('input-gemini-base'),
  fishKey: document.getElementById('input-fish-key'),
  btnSaveKeys: document.getElementById('btn-save-keys'),
  keysSaveStatus: document.getElementById('keys-save-status'),
  
  // 网易云
  ncmUsername: document.getElementById('ncm-username'),
  btnRefreshNcm: document.getElementById('btn-refresh-ncm'),

  // 方案 A：手动 Cookie 登录组件
  ncmCookieInput: document.getElementById('input-ncm-cookie'),
  btnSaveNcmCookie: document.getElementById('btn-save-ncm-cookie'),
  ncmCookieSaveStatus: document.getElementById('ncm-cookie-save-status')
};

// ==================== 2.5. 明暗主题切换 ====================
function applyTheme(theme) {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = safeTheme;
  localStorage.setItem('claudio-theme', safeTheme);

  if (DOM.themeToggle) {
    DOM.themeToggle.textContent = safeTheme === 'light' ? '☾ Dark' : '☀ Light';
    DOM.themeToggle.setAttribute(
      'aria-label',
      safeTheme === 'light' ? '切换到暗色模式' : '切换到亮色模式'
    );
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem('claudio-theme');
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');

  if (DOM.themeToggle) {
    DOM.themeToggle.addEventListener('click', () => {
      const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });
  }
}

initTheme();

// ==================== 2.6. 收藏歌曲 FAV ====================
function normalizeFavoriteSongs(songs) {
  const seen = new Set();
  return (Array.isArray(songs) ? songs : [])
    .filter(song => song && song.id && !seen.has(String(song.id)) && seen.add(String(song.id)))
    .map(song => ({
      id: String(song.id),
      name: song.name || '未知歌曲',
      artist: song.artist || '未知歌手',
      savedAt: song.savedAt || Date.now()
    }));
}

function readLocalFavoriteSongs() {
  try {
    return normalizeFavoriteSongs(JSON.parse(localStorage.getItem('claudio-favorites') || '[]'));
  } catch (err) {
    console.warn('[Favorites] Failed to parse favorites, resetting.', err);
    localStorage.setItem('claudio-favorites', '[]');
    return [];
  }
}

function getFavoriteSongs() {
  return favoriteSongs;
}

function saveFavoriteSongs(songs, options = {}) {
  const { persist = true } = options;
  favoriteSongs = normalizeFavoriteSongs(songs);
  localStorage.setItem('claudio-favorites', JSON.stringify(favoriteSongs));

  if (persist) {
    syncFavoriteSongsToServer(favoriteSongs);
  }
}

async function syncFavoriteSongsToServer(songs) {
  try {
    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs })
    });

    if (!response.ok) {
      throw new Error(`Favorites sync failed with ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data.songs)) {
      saveFavoriteSongs(data.songs, { persist: false });
    }
  } catch (err) {
    console.warn('[Favorites] Server sync failed; local cache retained.', err);
  }
}

async function hydrateFavoriteSongs() {
  const localSongs = readLocalFavoriteSongs();
  saveFavoriteSongs(localSongs, { persist: false });
  renderFavoriteSongs();

  try {
    const response = await fetch('/api/favorites');
    if (!response.ok) {
      throw new Error(`Favorites load failed with ${response.status}`);
    }

    const data = await response.json();
    const serverSongs = normalizeFavoriteSongs(data.songs);
    if (serverSongs.length > 0) {
      saveFavoriteSongs(serverSongs, { persist: false });
    } else if (localSongs.length > 0) {
      await syncFavoriteSongsToServer(localSongs);
    }
    renderFavoriteSongs();
  } catch (err) {
    console.warn('[Favorites] Server load failed; using local cache.', err);
  }
}

function isFavoriteSong(songId) {
  if (!songId) return false;
  return getFavoriteSongs().some(song => String(song.id) === String(songId));
}

function updateFavoriteButtonState() {
  if (!DOM.btnFav) return;
  const isActive = activeSong && isFavoriteSong(activeSong.id);
  DOM.btnFav.classList.toggle('active', !!isActive);
  DOM.btnFav.textContent = isActive ? '♥' : '♡';
  DOM.btnFav.title = isActive ? '已收藏当前歌曲' : '收藏当前歌曲';
}

function renderFavoriteSongs() {
  const favorites = getFavoriteSongs();
  if (DOM.favCount) DOM.favCount.textContent = favorites.length;
  if (!DOM.favList) return;

  DOM.favList.innerHTML = '';

  if (favorites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fav-empty';
    empty.textContent = '还没有收藏歌曲。播放一首歌后点爱心，它会出现在这里。';
    DOM.favList.appendChild(empty);
    updateFavoriteButtonState();
    return;
  }

  favorites.forEach((song, index) => {
    const row = document.createElement('div');
    row.className = 'fav-item';

    const number = document.createElement('span');
    number.className = 'fav-index';
    number.textContent = String(index + 1).padStart(2, '0');

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'fav-play';
    playButton.addEventListener('click', () => pickRecommendedSong(song, playButton));

    const name = document.createElement('strong');
    name.textContent = `《${song.name}》`;

    const artist = document.createElement('span');
    artist.className = 'fav-artist';
    artist.textContent = song.artist || '未知歌手';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'fav-remove';
    removeButton.title = '移出收藏';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => {
      saveFavoriteSongs(getFavoriteSongs().filter(item => String(item.id) !== String(song.id)));
      renderFavoriteSongs();
    });

    playButton.appendChild(name);
    row.appendChild(number);
    row.appendChild(playButton);
    row.appendChild(artist);
    row.appendChild(removeButton);
    DOM.favList.appendChild(row);
  });

  updateFavoriteButtonState();
}

function addCurrentSongToFavorites() {
  if (!activeSong || !activeSong.id) {
    appendChatBubble('claudio', '先播放一首歌，再把它放进 FAV 收藏夹吧。');
    return;
  }

  const favorites = getFavoriteSongs();
  if (!favorites.some(song => String(song.id) === String(activeSong.id))) {
    favorites.unshift({
      id: activeSong.id,
      name: activeSong.name,
      artist: activeSong.artist
    });
    saveFavoriteSongs(favorites);
    appendChatBubble('claudio', `已收藏《${activeSong.name}》，它现在在 FAV 里。`);
  }

  renderFavoriteSongs();
}

function toggleFavoritePanel() {
  if (!DOM.favPanel) return;
  DOM.favPanel.classList.toggle('open');
  if (DOM.btnFavToggle) {
    const isOpen = DOM.favPanel.classList.contains('open');
    DOM.btnFavToggle.title = isOpen ? '收起收藏列表' : '展开收藏列表';
  }
}

if (DOM.btnFav) {
  DOM.btnFav.addEventListener('click', addCurrentSongToFavorites);
}

if (DOM.btnFavToggle) {
  DOM.btnFavToggle.addEventListener('click', toggleFavoritePanel);
}

hydrateFavoriteSongs();

// ==================== 3. 复古电子点阵时钟驱动 ====================
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  // 电子大钟点阵显示
  DOM.clock.textContent = `${hours}:${minutes}`;
  
  // 日期元数据更新
  const weekdayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  
  const dayName = weekdayNames[now.getDay()];
  const monthName = monthNames[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  
  DOM.date.textContent = `${dayName}, ${day} ${monthName} ${year}`;
}
setInterval(updateClock, 1000);
updateClock();

// ==================== 4. 选项卡视窗导航 ====================
function switchTab(tabId) {
  DOM.tabBtns.forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });

  DOM.tabContents.forEach(c => c.classList.remove('active'));
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');

  currentTab = tabId;
  document.body.classList.remove('chat-expanded');
  updateChatExpandLabel();

  if (tabId === 'profile') loadTasteFile();
  if (tabId === 'settings') loadSettings();
}

DOM.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.getAttribute('data-tab');
    switchTab(tabId);
  });
});

if (DOM.brandHome) {
  DOM.brandHome.addEventListener('click', () => switchTab('home'));
}

// ==================== 5. 双音轨高质感播放引擎 ====================
// 设置音轨音量
function syncVolume() {
  const normalizedVolume = userVolume / 100;
  if (isDucking) {
    // 播报中：音乐压低至 20%，TTS 满音量
    musicAudio.volume = normalizedVolume * 0.2;
    ttsAudio.volume = normalizedVolume;
  } else {
    // 常规播放：音乐恢复正常，TTS 降至零
    musicAudio.volume = normalizedVolume;
    ttsAudio.volume = 0;
  }
}

// 模拟交叉淡化效果 (Crossfade / volume-slope)
function fadeAudio(audio, targetVolume, durationMs, callback) {
  const startVol = audio.volume;
  const steps = 20;
  const stepTime = durationMs / steps;
  const stepVal = (targetVolume - startVol) / steps;
  let currentStep = 0;

  const interval = setInterval(() => {
    currentStep++;
    audio.volume = Math.max(0, Math.min(1, startVol + stepVal * currentStep));
    
    if (currentStep >= steps) {
      clearInterval(interval);
      audio.volume = targetVolume;
      if (callback) callback();
    }
  }, stepTime);
}

// 播放主包核心逻辑（Ducking 音量避让机制的完美实践）
async function playBroadcastPackage(pkg) {
  console.log('[Player] Dispatched broadcast package:', pkg);

  if (!pkg || !pkg.song) {
    if (pkg && pkg.say && pkg.say.trim() !== '') {
      appendChatBubble('claudio', pkg.say);
    }
    restorePlayerStatusAfterConversation();
    return;
  }
  
  activeSong = pkg.song;
  updateFavoriteButtonState();
  
  // 0. 无条件在前端渲染大模型/本地大脑的文字回复气泡
  if (pkg.say && pkg.say.trim() !== '') {
    appendChatBubble('claudio', pkg.say);
  }
  
  // 1. 设置前端播放曲目元数据
  DOM.trackName.textContent = activeSong.name;
  DOM.trackArtist.textContent = activeSong.artist;
  
  // 2. 准备网易云歌曲流并加载，但先保持静音以防干扰 TTS 旁白
  musicAudio.src = activeSong.url;
  musicAudio.load();
  
  // 3. 检查是否有主持人 TTS 旁白
  if (pkg.ttsUrl) {
    
    // 进入 Ducking (音量闪避) 状态
    isDucking = true;
    syncVolume();
    
    // 播放旁白音频
    ttsAudio.src = pkg.ttsUrl;
    DOM.playerStatus.textContent = 'SPEAKING';
    DOM.visualizer.style.display = 'none'; // 说话时隐藏歌曲跳动动画
    
    // 启动背景音乐（静音或极低音播放）
    try {
      await musicAudio.play();
      await ttsAudio.play();
    } catch (e) {
      console.warn('[Player] Auto-play was blocked. Press Play to start.', e);
    }
    
    // 4. 监听旁白结束，实施音量优雅平滑淡回恢复 (Fade-Back BGM)
    ttsAudio.onended = () => {
      console.log('[Player] DJ voice ended. Restoring BGM volume...');
      isDucking = false;
      DOM.playerStatus.textContent = 'PLAYING';
      DOM.visualizer.style.display = 'flex';
      
      // 在 800ms 内淡回 full volume
      fadeAudio(musicAudio, userVolume / 100, 800);
    };
  } else {
    // 5. 无旁白直接切歌 (Crossfade)
    isDucking = false;
    syncVolume();
    DOM.playerStatus.textContent = 'PLAYING';
    DOM.visualizer.style.display = 'flex';
    
    try {
      await musicAudio.play();
    } catch (e) {
      console.warn('[Player] Audio play blocked.', e);
    }
  }
}

// 播放/暂停控制
DOM.btnPlayPause.addEventListener('click', () => {
  if (musicAudio.paused) {
    if (isDucking && ttsAudio.paused) {
      ttsAudio.play();
    }
    musicAudio.play();
    DOM.btnPlayPause.textContent = '⏸';
    DOM.playerStatus.textContent = isDucking ? 'SPEAKING' : 'PLAYING';
    DOM.visualizer.style.display = isDucking ? 'none' : 'flex';
  } else {
    musicAudio.pause();
    ttsAudio.pause();
    DOM.btnPlayPause.textContent = '▶';
    DOM.playerStatus.textContent = 'PAUSED';
    DOM.visualizer.style.display = 'none';
  }
});

// 手动强制切歌 (GET /api/next)
async function triggerNextTrack() {
  DOM.playerStatus.textContent = 'LOADING';
  DOM.trackName.textContent = '计算中...';
  DOM.trackArtist.textContent = 'Gemini AI DJ正在组装歌单';
  DOM.visualizer.style.display = 'none';
  
  try {
    const response = await fetch('/api/next');
    const data = await response.json();
    
    await playBroadcastPackage(data);
    DOM.btnPlayPause.textContent = '⏸';
  } catch (err) {
    console.error('Trigger next failed:', err);
    DOM.trackName.textContent = '电台信号流失';
    DOM.trackArtist.textContent = '请检查 API 密钥或网络状态';
  }
}

DOM.btnNext.addEventListener('click', triggerNextTrack);

// 进度条点击寻址跳转
DOM.progressBar.addEventListener('click', (e) => {
  if (!musicAudio.duration) return;
  const rect = DOM.progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const width = rect.width;
  const clickRatio = clickX / width;
  
  musicAudio.currentTime = musicAudio.duration * clickRatio;
});

// 监听播放进度，触发 10 秒高保真预载 (Prefetch)
let prefetchTriggered = false;
musicAudio.addEventListener('timeupdate', () => {
  if (!musicAudio.duration) return;
  
  const current = musicAudio.currentTime;
  const duration = musicAudio.duration;
  
  // 更新 UI 进度条
  const ratio = (current / duration) * 100;
  DOM.progressFill.style.width = `${ratio}%`;
  
  // 转换时间显示
  DOM.timeCurrent.textContent = formatTime(current);
  DOM.timeDuration.textContent = formatTime(duration);
  
  // 预载判定：当剩余时间小于 10 秒且本轮尚未触发预载时
  if (duration - current <= 10 && !prefetchTriggered) {
    prefetchTriggered = true;
    console.log('[Player] Prefetch triggered (10s remaining)! Fetching next assets...');
    
    // 发起异步 prefetch 请求，通告服务器提前备货
    fetch('/api/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastSong: activeSong })
    });
  }
});

// 重置预载状态
musicAudio.addEventListener('play', () => {
  prefetchTriggered = false;
});

// 一曲完毕，自动流转切歌
musicAudio.addEventListener('ended', () => {
  console.log('[Player] Track ended. Auto advancing...');
  triggerNextTrack();
});

// 音量滑块监听
DOM.volSlider.addEventListener('input', () => {
  userVolume = DOM.volSlider.value;
  syncVolume();
});

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// ==================== 6. 聊天窗口与实时对话 ====================
function updateChatExpandLabel() {
  if (!DOM.btnChatToggle) return;
  const expanded = document.body.classList.contains('chat-expanded');
  DOM.btnChatToggle.classList.toggle('active', expanded);
  DOM.btnChatToggle.textContent = expanded ? 'SHOW' : 'HIDE';
  DOM.btnChatToggle.title = expanded ? '收起对话区并显示时间组件' : '展开对话区并隐藏时间组件';
}

function toggleChatExpanded() {
  document.body.classList.toggle('chat-expanded');
  updateChatExpandLabel();
  DOM.chatHistory.scrollTop = DOM.chatHistory.scrollHeight;
}

if (DOM.btnChatToggle) {
  DOM.btnChatToggle.addEventListener('click', toggleChatExpanded);
}

function appendChatBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `msg bubble-${role}`;
  
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  const avatarImg = document.createElement('img');
  avatarImg.src = role === 'claudio' ? 'assets/claudio-avatar.png' : 'assets/user-avatar.jpg';
  avatarImg.alt = role === 'claudio' ? 'Claudio 头像' : '用户头像';
  avatar.appendChild(avatarImg);

  const content = document.createElement('div');
  content.className = 'msg-content';

  const paragraph = document.createElement('p');
  paragraph.textContent = text;

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = timeStr;

  content.appendChild(paragraph);
  content.appendChild(time);
  bubble.appendChild(avatar);
  bubble.appendChild(content);
  
  DOM.chatHistory.appendChild(bubble);
  // 自动滚动到底部
  DOM.chatHistory.scrollTop = DOM.chatHistory.scrollHeight;
}

function restorePlayerStatusAfterConversation() {
  if (activeSong && !musicAudio.paused) {
    DOM.playerStatus.textContent = isDucking ? 'SPEAKING' : 'PLAYING';
    DOM.visualizer.style.display = isDucking ? 'none' : 'flex';
    return;
  }

  DOM.playerStatus.textContent = activeSong ? 'PAUSED' : 'IDLE';
  DOM.visualizer.style.display = 'none';
}

function appendRecommendationBubble(say, candidates = []) {
  if (say && say.trim() !== '') {
    appendChatBubble('claudio', say);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg bubble-claudio';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  const avatarImg = document.createElement('img');
  avatarImg.src = 'assets/claudio-avatar.png';
  avatarImg.alt = 'Claudio 头像';
  avatar.appendChild(avatarImg);

  const content = document.createElement('div');
  content.className = 'msg-content';

  const title = document.createElement('p');
  title.className = 'recommendation-heading';
  title.textContent = candidates.length > 0
    ? '歌曲列表（点击任意一首即可播放）：'
    : '我暂时没拿到可播放候选歌，你可以换个描述再试一次。';
  content.appendChild(title);

  if (candidates.length > 0) {
    const list = document.createElement('div');
    list.className = 'recommendation-list';

    candidates.forEach((song, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recommendation-card';
      button.addEventListener('click', () => pickRecommendedSong(song, button));

      const name = document.createElement('span');
      name.className = 'recommendation-title';
      name.textContent = `${index + 1}. 《${song.name}》`;

      const artist = document.createElement('span');
      artist.className = 'recommendation-artist';
      artist.textContent = song.artist || '未知歌手';

      const reason = document.createElement('span');
      reason.className = 'recommendation-reason';
      reason.textContent = song.reason || '适合现在的气氛。';

      const action = document.createElement('span');
      action.className = 'recommendation-action';
      action.textContent = '▶ 点击播放';

      button.appendChild(name);
      button.appendChild(artist);
      button.appendChild(reason);
      button.appendChild(action);
      list.appendChild(button);
    });

    content.appendChild(list);
  }

  const now = new Date();
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  content.appendChild(time);

  bubble.appendChild(avatar);
  bubble.appendChild(content);
  DOM.chatHistory.appendChild(bubble);
  DOM.chatHistory.scrollTop = DOM.chatHistory.scrollHeight;
}

async function pickRecommendedSong(song, button) {
  const list = button.closest('.recommendation-list');
  const cards = list ? Array.from(list.querySelectorAll('.recommendation-card')) : [];
  if (list) {
    cards.forEach(card => {
      card.disabled = true;
    });
  }
  button.classList.add('selected');
  appendChatBubble('user', `播放《${song.name}》`);

  DOM.playerStatus.textContent = 'LOADING';
  DOM.trackName.textContent = '准备播放...';
  DOM.trackArtist.textContent = `${song.artist || '未知歌手'}`;

  try {
    const response = await fetch('/api/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId: song.id,
        songName: song.name,
        songArtist: song.artist
      })
    });

    if (!response.ok) {
      throw new Error(`Pick request failed with ${response.status}`);
    }

    const data = await response.json();
    await playBroadcastPackage(data);
    DOM.btnPlayPause.textContent = '⏸';
  } catch (err) {
    console.error('Pick recommended song failed:', err);
    cards.forEach(card => {
      card.disabled = false;
    });
    button.classList.remove('selected');
    appendChatBubble('claudio', '这首歌刚刚没接上信号，我们可以换一首候选试试。');
    restorePlayerStatusAfterConversation();
  }
}

async function handleChatResponse(data) {
  if (data.intent === 'chat') {
    if (data.say && data.say.trim() !== '') {
      appendChatBubble('claudio', data.say);
    }
    restorePlayerStatusAfterConversation();
    return;
  }

  if (data.intent === 'recommend') {
    appendRecommendationBubble(data.say, data.candidates || data.play || []);
    restorePlayerStatusAfterConversation();
    return;
  }

  await playBroadcastPackage(data);
  DOM.btnPlayPause.textContent = '⏸';
}

// 提交对话请求
async function submitChat() {
  const message = DOM.chatInput.value.trim();
  if (!message) return;
  
  appendChatBubble('user', message);
  DOM.chatInput.value = '';
  
  DOM.playerStatus.textContent = 'LOADING';
  
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        lastSong: activeSong
      })
    });
    
    if (!response.ok) {
      throw new Error(`Chat request failed with ${response.status}`);
    }

    const data = await response.json();
    await handleChatResponse(data);
  } catch (err) {
    console.error('Chat submit failed:', err);
    appendChatBubble('claudio', '电台波段受到了外界磁场干扰，没能收到你的声音，请检查你在 Settings 中配置的 API 秘钥。');
    DOM.playerStatus.textContent = 'PAUSED';
  }
}

DOM.chatSubmit.addEventListener('click', submitChat);
DOM.chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitChat();
});

// ==================== 7. WebSocket 长连接交互 ====================
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/stream`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    DOM.wsStatus.textContent = 'CONNECTED';
    DOM.wsStatus.style.color = 'var(--neon-green)';
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('[WS] Broadcast event received:', msg.type);
      
      // 捕获节律时段转变事件
      if (msg.type === 'ROUTINE_SHIFT') {
        appendChatBubble('claudio', `【时段电台通知】${msg.data.message}`);
        // 自动切歌播报新节目
        triggerNextTrack();
      }
    } catch (e) {
      console.error('[WS] Parse message error:', e);
    }
  };
  
  ws.onclose = () => {
    DOM.wsStatus.textContent = 'DISCONNECTED';
    DOM.wsStatus.style.color = 'var(--text-muted)';
    // 5秒后尝试重连
    setTimeout(connectWebSocket, 5000);
  };
}
connectWebSocket();

// ==================== 8. 用户画像与 taste.md 读写 ====================
async function loadTasteFile() {
  try {
    const response = await fetch('/api/taste');
    const data = await response.json();
    DOM.tasteEditor.value = data.content;
  } catch (err) {
    console.error('Load taste.md failed:', err);
  }
}

DOM.btnSaveTaste.addEventListener('click', async () => {
  const content = DOM.tasteEditor.value;
  DOM.tasteSaveStatus.textContent = '正在保存...';
  
  try {
    const response = await fetch('/api/taste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    
    if (data.success) {
      DOM.tasteSaveStatus.textContent = '✓ 偏好文件已落盘热更新';
      setTimeout(() => DOM.tasteSaveStatus.textContent = '', 3000);
    }
  } catch (err) {
    DOM.tasteSaveStatus.textContent = '✗ 保存失败';
  }
});

DOM.btnGenerateWeeklyTaste.addEventListener('click', async () => {
  DOM.tasteSaveStatus.textContent = '正在分析最近 7 天听歌记录...';
  DOM.btnGenerateWeeklyTaste.disabled = true;

  try {
    const response = await fetch('/api/taste/generate-weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '生成失败');
    }

    DOM.tasteEditor.value = data.content;
    const source = data.generatedBy === 'ai' ? 'AI 已生成' : '本地规则已生成';
    DOM.tasteSaveStatus.textContent = `✓ ${source}：${data.summary.total} 次播放 / ${data.summary.uniqueSongs} 首歌`;
    setTimeout(() => DOM.tasteSaveStatus.textContent = '', 5000);
  } catch (err) {
    console.error('Generate weekly taste failed:', err);
    DOM.tasteSaveStatus.textContent = `✗ ${err.message}`;
  } finally {
    DOM.btnGenerateWeeklyTaste.disabled = false;
  }
});

// ==================== 9. Settings 密钥配置与网易云扫码 ====================
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    
    // 渲染已配置密钥 (星号占位)
    if (data.preferences.geminiApiKey) DOM.geminiKey.value = '••••••••••••••••••••••••';
    if (data.preferences.geminiApiBase) DOM.geminiApiBase.value = data.preferences.geminiApiBase;
    if (data.preferences.fishAudioApiKey) DOM.fishKey.value = '••••••••••••••••••••••••';
    if (typeof data.preferences.neteaseCookie === 'string') {
      DOM.ncmCookieInput.value = data.preferences.neteaseCookie;
    }
    
    // 渲染网易云登录状态
    renderNcmStatus(data.netease, data.preferences.neteaseCookie || '');
  } catch (err) {
    console.error('Load settings failed:', err);
  }
}

function renderNcmStatus(ncmData, savedCookie = '') {
  if (ncmData.loggedIn) {
    DOM.ncmUsername.innerHTML = `✅ 已登录为：<strong>${ncmData.nickname}</strong>`;
  } else if (savedCookie.trim()) {
    DOM.ncmUsername.innerHTML = '✅ 已登录（Cookie 凭证已保存，等待账号昵称验证）';
  } else {
    DOM.ncmUsername.innerHTML = '❌ 未登录 (请输入下方 Cookie)';
  }
}

// 刷新状态按钮
DOM.btnRefreshNcm.addEventListener('click', loadSettings);

// 保存秘钥
DOM.btnSaveKeys.addEventListener('click', async () => {
  const geminiApiKey = DOM.geminiKey.value.startsWith('••') ? undefined : DOM.geminiKey.value;
  const geminiApiBase = DOM.geminiApiBase.value.trim();
  const fishAudioApiKey = DOM.fishKey.value.startsWith('••') ? undefined : DOM.fishKey.value;
  
  DOM.keysSaveStatus.textContent = '正在保存...';
  
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiApiKey, geminiApiBase, fishAudioApiKey })
    });
    const data = await response.json();
    if (data.success) {
      DOM.keysSaveStatus.textContent = '✓ 秘钥配置已保存';
      setTimeout(() => DOM.keysSaveStatus.textContent = '', 3000);
      loadSettings();
    }
  } catch (err) {
    DOM.keysSaveStatus.textContent = '✗ 保存失败';
  }
});

// 绑定方案 A 手动输入 Cookie 登录事件
DOM.btnSaveNcmCookie.addEventListener('click', async () => {
  const cookie = DOM.ncmCookieInput.value.trim();
  
  if (!cookie) {
    DOM.ncmCookieSaveStatus.className = 'save-status-msg error';
    DOM.ncmCookieSaveStatus.textContent = '✗ Cookie 凭证不能为空！';
    return;
  }
  
  DOM.ncmCookieSaveStatus.className = 'save-status-msg';
  DOM.ncmCookieSaveStatus.textContent = '正在保存凭证并验证登录...';
  
  try {
    const response = await fetch('/api/ncm/save-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie })
    });
    const data = await response.json();
    if (data.success) {
      DOM.ncmCookieSaveStatus.className = 'save-status-msg success';
      DOM.ncmCookieSaveStatus.textContent = '✓ 凭证已成功保存！正在刷新登录状态...';

      // 3秒后清空状态提示
      setTimeout(() => DOM.ncmCookieSaveStatus.textContent = '', 3000);

      renderNcmStatus(data.netease || {}, cookie);

      // 自动刷新设置，更新账号状态
      await loadSettings();
      appendChatBubble('claudio', '极客凭证登录成功！你的专属网易云音乐曲库已就绪，电台立刻开启你的专属旋律！');
    } else {
      DOM.ncmCookieSaveStatus.className = 'save-status-msg error';
      DOM.ncmCookieSaveStatus.textContent = `✗ 保存失败：${data.error || '未知错误'}`;
    }
  } catch (err) {
    DOM.ncmCookieSaveStatus.className = 'save-status-msg error';
    DOM.ncmCookieSaveStatus.textContent = '✗ 网络连接失败，请检查后端服务是否正常。';
  }
});

// ==================== 10. 初始化引导与强注销缓存 ====================
// 强力注销所有现存 Service Worker 并清空所有浏览器 Cache Storage
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (let registration of registrations) {
      registration.unregister();
      console.log('[SW] Unregistered active service worker successfully.');
    }
  });
}

if ('caches' in window) {
  caches.keys().then(function(names) {
    for (let name of names) {
      caches.delete(name);
      console.log('[Cache] Cleared browser storage cache:', name);
    }
  });
}

// 初始触发电台首首歌计算播放
window.addEventListener('load', () => {
  DOM.trackName.textContent = '电台处于空闲';
  DOM.trackArtist.textContent = '点击播放或与DJ对话开启旅程';
  DOM.btnPlayPause.textContent = '▶';
  DOM.playerStatus.textContent = 'IDLE';
  DOM.visualizer.style.display = 'none';
  updateFavoriteButtonState();
});
