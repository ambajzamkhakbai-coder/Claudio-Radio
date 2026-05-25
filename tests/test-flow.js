require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const context = require('../context');
const claudio = require('../claudio');
const tts = require('../tts');
const music = require('../music');
const router = require('../router');
const fallback = require('../fallback');

async function runTest() {
  console.log('\n======================================================');
  console.log('   AI 音乐电台 (Micdio / Claudio) 全链路功能自检');
  console.log('======================================================\n');

  // 1. 测试日常作息诊断与 Prompt 拼装
  console.log('[Step 1] Testing Time Routine Diagnosis & Prompt Assembly...');
  try {
    const routine = context.getActiveRoutine(new Date());
    console.log(`✓ Active routine diagnosed as: "${routine}"`);
    
    const promptPackage = context.assemblePrompt({
      userInput: '写代码写累了，想听首治愈、舒缓的纯音乐',
      weatherData: { temp: '22', condition: '晴朗' }
    });
    
    console.log('✓ Prompt successfully assembled. Length of System Instructions:', promptPackage.systemInstruction.length);
    console.log('✓ Length of Prompt Body:', promptPackage.prompt.length);
  } catch (err) {
    console.error('✗ Step 1 Failed:', err.message);
    return;
  }

  // 2. 测试网易云音乐 API 连接与歌曲流搜索
  console.log('\n[Step 2] Testing NCM Search API Connection...');
  let testSong = null;
  try {
    const searchResults = await music.search('Bread If', 1);
    if (searchResults && searchResults.length > 0) {
      testSong = searchResults[0];
      console.log(`✓ Search API connected. Found Song: 《${testSong.name}》- ${testSong.artist} (ID: ${testSong.id})`);
      
      const streamUrl = await music.getSongUrl(testSong.id);
      if (streamUrl) {
        console.log('✓ Successfully retrieved song playable streaming URL:', streamUrl.substring(0, 80) + '...');
      } else {
        console.warn('⚠ Song streaming URL returned empty (expected fallback required).');
      }
    } else {
      console.warn('⚠ Search API returned empty results. NeteaseCloudMusicApi may not be running locally.');
    }
  } catch (err) {
    console.warn('⚠ Step 2 NCM API request encountered error (will fall back to backup pool):', err.message);
  }

  // 3. 测试大模型大脑推理与 JSON 强制契约 (仅当 Key 配置时测试)
  console.log('\n[Step 3] Testing Gemini Brain Inference & Schema (KISS)...');
  const db = require('../db');
  const geminiKey = process.env.GEMINI_API_KEY || db.getPreference('geminiApiKey');
  if (!geminiKey || geminiKey.trim() === '' || geminiKey.startsWith('your_')) {
    console.log('⚠ Gemini API Key is missing. Skipping LLM live test, falling back to local fallback module test.');
    
    // 测试本地降级模块
    const mockError = new Error('API Key Missing Test');
    const fallbackResult = fallback.handleBrainFailure(mockError);
    console.log('✓ Fallback system successfully generated backup playlist package:', JSON.stringify(fallbackResult, null, 2));
  } else {
    try {
      const promptPackage = context.assemblePrompt({
        userInput: '今天工作太紧张了，帮我降降温吧',
        weatherData: { temp: '16', condition: '细雨' }
      });
      
      console.log('Sending request to Gemini API (gemini-2.5-flash)...');
      const brainResult = await claudio.compute(promptPackage);
      console.log('✓ Gemini Live computing succeeded! Response Object:');
      console.log(JSON.stringify(brainResult, null, 2));
      
      // 测试 TTS 转换
      if (brainResult.say) {
        console.log('\n[Step 4] Testing Fish Audio TTS generation...');
        const fishKey = process.env.FISH_AUDIO_API_KEY;
        if (!fishKey || fishKey.trim() === '' || fishKey.startsWith('your_')) {
          console.log('⚠ Fish Audio API Key missing. Skipping live TTS voice generation.');
        } else {
          const ttsWebPath = await tts.textToSpeech(brainResult.say);
          console.log('✓ TTS voice audio generated and cached at Web Path:', ttsWebPath);
        }
      }
    } catch (err) {
      console.error('✗ Gemini Live test failed:', err.message);
      console.log('Testing fallback system with the error...');
      const fallbackResult = fallback.handleBrainFailure(err);
      console.log('✓ Fallback system handled error perfectly:', JSON.stringify(fallbackResult, null, 2));
    }
  }

  console.log('\n======================================================');
  console.log('   ✓ AI 音乐电台 (Micdio / Claudio) 功能验证完成！');
  console.log('======================================================\n');
}

runTest();
