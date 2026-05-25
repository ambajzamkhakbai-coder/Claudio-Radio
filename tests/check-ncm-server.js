// 快速验证本地 NCM API 能否正常启动并响应请求
const { serveNcmApi } = require('NeteaseCloudMusicApi');
const axios = require('axios');

async function test() {
  console.log('[Test] Starting NeteaseCloudMusicApi on port 3000...');
  try {
    await serveNcmApi({ port: 3000 });
    console.log('[Test] NCM API server started successfully on http://localhost:3000');
  } catch (err) {
    console.error('[Test] Failed to start NCM API:', err.message);
    process.exit(1);
  }

  // 等待 1 秒让服务就绪
  await new Promise(r => setTimeout(r, 1000));

  // 测试搜索接口
  try {
    const res = await axios.get('http://localhost:3000/cloudsearch', {
      params: { keywords: 'Bread If', limit: 3, type: 1 },
      timeout: 5000
    });
    if (res.data && res.data.result && res.data.result.songs) {
      console.log('[Test] Search API OK! Found songs:');
      res.data.result.songs.forEach(s => {
        console.log(`  - [${s.id}] ${s.name} - ${s.ar.map(a => a.name).join('/')}`);
      });
    } else {
      console.log('[Test] Search API returned unexpected structure:', JSON.stringify(res.data).substring(0, 200));
    }
  } catch (err) {
    console.error('[Test] Search API request failed:', err.message);
  }

  // 测试歌曲 URL 接口
  try {
    const res = await axios.get('http://localhost:3000/song/url/v1', {
      params: { id: 2023530089, level: 'exhigh' },
      timeout: 5000
    });
    if (res.data && res.data.data && res.data.data[0]) {
      const url = res.data.data[0].url;
      console.log(`[Test] Song URL API OK! URL: ${url ? url.substring(0, 80) + '...' : '(empty - need login cookie)'}`);
    }
  } catch (err) {
    console.error('[Test] Song URL API request failed:', err.message);
  }

  console.log('\n[Test] All checks done. Exiting...');
  process.exit(0);
}

test();
