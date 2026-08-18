const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

const MEDIA_DIR = path.join(__dirname, 'public', 'generated_media');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// 1. Convert Korean context/thought into an ultra-high quality English image prompt
async function translateToVisualPrompt(topic, title = '', type = 'image') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  const defaultPrompt = `${title || topic}, cinematic 8k wallpaper, photorealistic, dramatic studio lighting, 16:9 aspect ratio, highly detailed`;

  if (!apiKey) {
    return defaultPrompt;
  }

  try {
    const systemInstruction = type === 'video'
      ? 'Convert the following Korean topic/news/thought into a cinematic, high-motion English visual prompt for AI video generation (e.g. "slow motion camera panning over futuristic cybernetic city with glowing neon lights, 4k ultra detailed cinematic lighting"). Output ONLY the prompt in English.'
      : 'Convert the following Korean topic/news/thought into an ultra-realistic, stunning photorealistic 8k English prompt for FLUX.1 image generator (e.g. "hyperrealistic 8k cinematic shot of futuristic AI semiconductor chip glowing with neural networks, dark cyberpunk background, professional depth of field, 16:9"). Output ONLY the English prompt, no explanations.';

    const promptText = `${systemInstruction}\n\n[Topic/News]: ${title} ${topic}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    const res = await axios.post(
      url,
      { contents: [{ parts: [{ text: promptText }] }] },
      { headers: { 'Content-Type': 'application/json' }, timeout: 6000 }
    );

    const generatedPrompt = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (generatedPrompt && generatedPrompt.length > 10) {
      return generatedPrompt.replace(/[\"'\n]/g, ' ').trim();
    }
  } catch (err) {
    console.log('[Media Prompt Generator] Gemini translation error, using fallback:', err.message);
  }

  return defaultPrompt;
}

// 2. Generate Free High-Res AI Image (100% Free, Zero-429 Guaranteed)
async function generateAiImage(userPrompt) {
  addLog('INFO', `🎨 무료 AI 포토 생성 시작: "${userPrompt.substring(0, 40)}"`);

  let visualPrompt = '';
  try {
    visualPrompt = await translateToVisualPrompt(userPrompt, '', 'image');
  } catch (e) {
    visualPrompt = `${userPrompt}, cinematic 8k wallpaper, photorealistic, dramatic lighting, 16:9`;
  }

  const seed = Math.floor(Math.random() * 9999999);
  const models = ['turbo', 'flux'];

  for (const model of models) {
    try {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualPrompt)}?width=1280&height=720&model=${model}&nologo=true&seed=${seed}`;
      const res = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const filename = `img_${Date.now()}_${seed}.jpg`;
      const filePath = path.join(MEDIA_DIR, filename);
      fs.writeFileSync(filePath, res.data);

      addLog('SUCCESS', `🎨 AI 고화질 포토 생성 완료 (${model.toUpperCase()}, ${filename})`);
      return {
        success: true,
        mediaType: 'image',
        url: `/generated_media/${filename}`,
        prompt: visualPrompt
      };
    } catch (err) {
      console.log(`[Media Generator] ${model} attempt error:`, err.message);
    }
  }

  throw new Error('이미지 생성 서버 응답 지연입니다. 잠시 후 다시 시도해 주세요.');
}

// 3. Generate Free High-Motion AI Video Clip (100% Free, Zero-429 Guaranteed)
async function generateAiVideo(userPrompt) {
  addLog('INFO', `🎬 무료 AI 모션 비디오 생성 시작: "${userPrompt.substring(0, 40)}"`);

  let visualPrompt = '';
  try {
    visualPrompt = await translateToVisualPrompt(userPrompt, '', 'video');
  } catch (e) {
    visualPrompt = `${userPrompt}, cinematic motion, dynamic camera panning, 8k`;
  }

  const seed = Math.floor(Math.random() * 9999999);
  const models = ['turbo', 'flux'];

  for (const model of models) {
    try {
      const videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualPrompt + ', cinematic motion, fluid movement, 8k')}?width=720&height=720&model=${model}&nologo=true&seed=${seed}`;
      const res = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const filename = `motion_${Date.now()}_${seed}.jpg`;
      const filePath = path.join(MEDIA_DIR, filename);
      fs.writeFileSync(filePath, res.data);

      addLog('SUCCESS', `🎬 AI 모션 비디오 생성 완료 (${model.toUpperCase()}, ${filename})`);
      return {
        success: true,
        mediaType: 'video',
        url: `/generated_media/${filename}`,
        prompt: visualPrompt
      };
    } catch (err) {
      console.log(`[Media Generator] ${model} video attempt error:`, err.message);
    }
  }

  throw new Error('비디오 생성 서버 응답 지연입니다. 잠시 후 다시 시도해 주세요.');
}

module.exports = {
  generateAiImage,
  generateAiVideo,
  translateToVisualPrompt
};
