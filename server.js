const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { getConfig, saveConfig } = require('./config');
const { getHistory, getLogs, addLog, getPostingStatusMap, markPostingStatus, getStoredArticles, saveStoredArticles, getReadStatusMap, markAsRead, markAllAsRead, getSavedDrafts, saveSavedDraft, deleteSavedDraft, getStreakStats } = require('./history');
const { fetchLatestArticles } = require('./scraper');
const { generateSummary, generateThoughtTweet, generatePollTweet, generateThreadTweet } = require('./summarizer');
const { generateNewsInfographicSvg } = require('./imageGenerator');
const { VISUAL_PRESETS, searchVisualMedia, generateVisualTweet } = require('./visualMediaService');
const { getGitInfo, pullAndApplyUpdates, initGitAutoSync } = require('./gitAutoSync');
const { initScheduler, generateDailyDraftsJob, getDailyDrafts } = require('./scheduler');
const { sendTelegramMessage, sendEmailMessage, notifyNewTunnelUrl } = require('./notifier');
const { initTelegramQueueWorker, stopTelegramQueueWorker, isQueueActive, triggerHourlyTelegramBriefing, processAndSendArticle, getGoldenHourInfo } = require('./services/telegramQueueService');
const { postTweetWithMedia, testTwitterConnection } = require('./services/xPostService');
const { generateCardNewsImage } = require('./services/cardNewsServerService');



const app = express();
const PORT = process.env.PORT || 3000;
const LOCAL_WIFI_IP = '192.168.0.10';

app.use(cors());
app.use(express.json());

// Public Health Check Endpoint (For 24/7 Keep-Alive Pings)
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Image Proxy Endpoint for CORS-free Clipboard Copying
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('No URL provided');
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (err) {
    res.status(500).send('Proxy fetch failed: ' + err.message);
  }
});



// HTTP Basic Security Authentication for Tunnel & External Access
const { recordLoginHistory, getLoginHistory } = require('./history');

app.use((req, res, next) => {
  const config = getConfig();
  const authUsername = config.authUsername || 'la5454';
  const authPassword = config.authPassword || 'rudghlWkd!';

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="X Tweet Generator Secure Access"');
    return res.status(401).send('🔒 보안 로그인이 필요합니다.');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];

  const isUserValid = (user === authUsername || user === 'admin' || !user);
  const isPassValid = (pass === authPassword);

  if (isUserValid && isPassValid) {
    // Record login access (IP & timestamp) on HTML page/main entry loads
    if (req.path === '/' || req.path === '/index.html' || req.path.startsWith('/api/status')) {
      const clientIp = req.headers['cf-connecting-ip'] || 
                       req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                       req.socket?.remoteAddress || 
                       req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || '';
      recordLoginHistory(clientIp, userAgent);
    }
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="X Tweet Generator Secure Access"');
    return res.status(401).send('🔒 아이디 또는 비밀번호가 올바르지 않습니다.');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/login-history', (req, res) => {
  try {
    const history = getLoginHistory();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



app.get('/api/status', (req, res) => {
  const config = getConfig();
  const logs = getLogs();
  const drafts = getDailyDrafts();

  res.json({
    success: true,
    status: {
      scheduleTime: config.scheduleTime,
      autoPostEnabled: config.autoPostEnabled,
      draftsCount: drafts.length,
      localWifiUrl: `http://${LOCAL_WIFI_IP}:${PORT}`,
      latestLog: logs[0] || null,
      totalDbCount: getStoredArticles().length
    }
  });
});

let articlesCache = getStoredArticles();
let lastCacheTime = articlesCache.length > 0 ? Date.now() : 0;
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes memory cache

app.get('/api/articles', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 300;
    const forceRefresh = req.query.refresh === 'true';
    // Always load from DB file first if cache is empty
    if (!articlesCache || articlesCache.length === 0) {
      articlesCache = getStoredArticles();
    }

    // STRICT SCALING RULE: Only run expensive scraping if forceRefresh=true ([🔄 수집] button clicked)
    if (forceRefresh) {
      const freshArticles = await fetchLatestArticles(limit);
      articlesCache = freshArticles;
    } else {
      articlesCache = getStoredArticles();
    }

    const articlesToReturn = articlesCache.slice(0, limit);
    const statusMap = getPostingStatusMap();
    const readMap = getReadStatusMap();
    const articlesWithStatus = articlesToReturn.map(art => {
      const st = statusMap[art.id] || { postedTweet: false, postedArticle: false };
      const isRead = readMap[art.id] || false;
      return {
        ...art,
        postedTweet: st.postedTweet,
        postedArticle: st.postedArticle,
        isRead
      };
    });

    const totalDbCount = getStoredArticles().length;
    const unreadCount = articlesWithStatus.filter(a => !a.isRead).length;
    res.json({ success: true, totalCount: totalDbCount, unreadCount, articles: articlesWithStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/mark-read', (req, res) => {
  try {
    const { articleId } = req.body;
    if (!articleId) {
      return res.status(400).json({ success: false, message: 'articleId 필수' });
    }
    markAsRead(articleId);
    res.json({ success: true, message: '기사가 확인 처리되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/telegram/trigger-briefing', async (req, res) => {
  try {
    const { triggerTenMinuteBriefing } = require('./services/telegramQueueService');
    const result = await triggerTenMinuteBriefing(true); // force=true for manual dashboard test
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/mark-all-read', (req, res) => {
  try {
    const articles = getStoredArticles();
    const allIds = articles.map(a => a.id);
    markAllAsRead(allIds);
    addLog('SUCCESS', `✅ 모든 기사 (${allIds.length}건) 일괄 읽음(확인) 처리 완료`);
    res.json({ success: true, message: '모든 기사가 일괄 확인 처리되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/mark-posted', (req, res) => {
  try {
    const { articleId, type, title, link } = req.body;
    if (!articleId || !type) {
      return res.status(400).json({ success: false, message: 'articleId 및 type 필수' });
    }

    markPostingStatus(articleId, type, title || '', link || '');
    addLog('SUCCESS', `📌 포스팅 상태 업데이트 완료: [기사 ID: ${articleId}] (${type === 'tweet' ? '✅ X 일반글 포스팅' : '📰 X 아티클 포스팅'})`);

    res.json({ success: true, message: '포스팅 상태가 업데이트되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/extract-image', async (req, res) => {
  try {
    const { title, url } = req.body;
    if (!title && !url) {
      return res.status(400).json({ success: false, message: '기사 제목 또는 링크가 필요합니다.' });
    }

    let targetUrl = url || '';

    // 1. Resolve Google redirect link if needed
    if (targetUrl && targetUrl.includes('news.google.com')) {
      try {
        const gRes = await axios.get(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 4000,
          maxRedirects: 5
        });
        if (gRes.request?.res?.responseUrl && !gRes.request.res.responseUrl.includes('news.google.com')) {
          targetUrl = gRes.request.res.responseUrl;
        }
      } catch (e) { }
    }

    // 2. Fetch direct webpage (Nate Pann, Blind, Naver, Hankyung, Chosun, etc.)
    if (targetUrl && !targetUrl.includes('news.google.com')) {
      try {
        const directRes = await axios.get(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000,
          responseType: 'arraybuffer'
        });

        const iconv = require('iconv-lite');
        let dHtml = directRes.data.toString('utf-8');
        if (dHtml.toLowerCase().includes('charset=euc-kr')) {
          dHtml = iconv.decode(directRes.data, 'EUC-KR');
        }

        // 2a. Meta og:image & twitter:image
        const ogMatches = [
          ...dHtml.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi),
          ...dHtml.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/gi),
          ...dHtml.matchAll(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi)
        ];

        for (const og of ogMatches) {
          if (og && og[1]) {
            let photo = og[1].replace(/&amp;/g, '&').trim();
            if (photo.startsWith('//')) photo = 'https:' + photo;
            const pLower = photo.toLowerCase();
            if (!pLower.includes('logo') && !pLower.includes('icon') && !pLower.includes('avatar') && !pLower.includes('banner')) {
              return res.json({ success: true, imageUrl: photo });
            }
          }
        }

        // 2b. Article body images (Nate Pann fimg, Blind image, Naver news photo)
        const bodyImgs = [
          ...dHtml.matchAll(/<img[^>]*src=["'](https?:\/\/[^"']+)["']/gi),
          ...dHtml.matchAll(/<img[^>]*src=["'](\/\/[^"']+)["']/gi)
        ];

        for (const m of bodyImgs) {
          let src = m[1].replace(/&amp;/g, '&').trim();
          if (src.startsWith('//')) src = 'https:' + src;
          const sLower = src.toLowerCase();

          const isPhoto = sLower.includes('fimg') || sLower.includes('download.jsp') || sLower.includes('imgnews') ||
            sLower.includes('upload') || sLower.includes('article') || sLower.includes('content') ||
            /\.(jpg|jpeg|png|webp)(\?|$)/i.test(sLower);

          if (isPhoto && !sLower.includes('logo') && !sLower.includes('icon') && !sLower.includes('btn') && !sLower.includes('stat') && !sLower.includes('emoticon')) {
            return res.json({ success: true, imageUrl: src });
          }
        }
      } catch (e) { }
    }

    // 3. High-precision Naver News Photo Search by Title
    const cleanTitle = (title || '').replace(/\[.*?\]/g, '').replace(/ - .*$/, '').trim();
    if (cleanTitle) {
      try {
        const searchUrl = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(cleanTitle)}`;
        const searchRes = await axios.get(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 6000
        });

        const html = searchRes.data;
        const imgMatches = [...html.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)];

        for (const m of imgMatches) {
          let src = m[1].replace(/&amp;/g, '&');
          let checkUrl = src;
          const paramMatch = src.match(/src=([^&]+)/);
          if (paramMatch && paramMatch[1]) {
            checkUrl = decodeURIComponent(paramMatch[1]);
          }
          const lower = checkUrl.toLowerCase();
          if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower) || lower.includes('imgnews') || lower.includes('search.pstatic.net')) {
            if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('profile') && !lower.includes('spg')) {
              return res.json({ success: true, imageUrl: checkUrl });
            }
          }
        }
      } catch (e) { }
    }

    // 4. Daum News Photo Search Backup
    if (cleanTitle) {
      try {
        const daumUrl = `https://search.daum.net/search?w=news&q=${encodeURIComponent(cleanTitle)}`;
        const dRes = await axios.get(daumUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000
        });
        const dHtml = dRes.data;
        const dImgs = [...dHtml.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)];
        for (const m of dImgs) {
          const src = m[1].replace(/&amp;/g, '&');
          const lower = src.toLowerCase();
          if ((lower.includes('daumcdn.net') || lower.includes('fname=')) && !lower.includes('logo') && !lower.includes('icon') && !lower.includes('static')) {
            return res.json({ success: true, imageUrl: src });
          }
        }
      } catch (e) { }
    }

    return res.json({ success: false, message: '원문 기사에서 대표 이미지를 찾을 수 없습니다.' });
  } catch (err) {
    return res.json({ success: false, message: `원문 이미지 추출 실패: ${err.message}` });
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const article = req.body;
    if (!article || !article.title) {
      return res.status(400).json({ success: false, message: '아티클 정보가 필요합니다.' });
    }
    const mode = article.mode || 'block';
    const summary = await generateSummary(article, mode);
    res.json({
      success: true,
      summary: summary.text,
      hooks: summary.hooks || [],
      tags: summary.tags || [],
      isAiGenerated: summary.isAiGenerated,
      mode: summary.mode
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/generate-thumbnail', (req, res) => {
  try {
    const { title, category, categoryTag } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: '기사 제목이 필요합니다.' });
    }
    const imageUrl = generateNewsInfographicSvg(title, category, categoryTag || '');
    addLog('SUCCESS', `🎨 고화질 16:9 썸네일 이미지 생성 완료: ${imageUrl}`);
    res.json({ success: true, imageUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 🎙️ 내 생각/자유 메모 ➔ AI 트윗 정제 API =====
app.post('/api/summarize-thought', async (req, res) => {
  try {
    const { thought, mode } = req.body;
    if (!thought || thought.trim().length === 0) {
      return res.status(400).json({ success: false, message: '생각이나 메모 내용을 입력해주세요.' });
    }
    const result = await generateThoughtTweet(thought.trim(), mode || 'block');
    res.json({ success: true, summary: result.text, mode: result.mode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/daily-drafts', (req, res) => {
  res.json({ success: true, drafts: getDailyDrafts() });
});

app.post('/api/generate-daily-drafts', async (req, res) => {
  try {
    addLog('INFO', '오늘의 트윗 초안 일괄 생성을 수동으로 실행했습니다.');
    const result = await generateDailyDraftsJob();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ success: true, logs: getLogs() });
});

app.get('/api/config', (req, res) => {
  const config = getConfig();
  res.json({
    success: true,
    config: {
      ...config,
      // Masking or providing for form inputs
      xAppKey: config.xAppKey ? '••••••••' + config.xAppKey.slice(-4) : '',
      hasXAppKey: Boolean(config.xAppKey),
      hasXAppSecret: Boolean(config.xAppSecret),
      hasXAccessToken: Boolean(config.xAccessToken),
      hasXAccessSecret: Boolean(config.xAccessSecret),
      telegramQueueEnabled: Boolean(config.telegramQueueEnabled),
      telegramBotToken: config.telegramBotToken ? '••••••••' : '',
      telegramChatId: config.telegramChatId || ''
    }
  });
});

app.post('/api/config', (req, res) => {
  try {
    const updated = saveConfig(req.body);
    addLog('SUCCESS', '⚙️ 시스템 설정이 성공적으로 업데이트되었습니다.');
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ===== User Saved Drafts (⭐ 임시 보관함) =====
app.get('/api/user-drafts', (req, res) => {
  res.json({ success: true, drafts: getSavedDrafts() });
});

app.post('/api/user-drafts', (req, res) => {
  try {
    const draft = saveSavedDraft(req.body);
    addLog('SUCCESS', `⭐ 트윗이 '나만의 임시 보관함'에 저장되었습니다: "${draft.title}"`);
    res.json({ success: true, draft, message: '보관함에 저장되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/user-drafts/:id', (req, res) => {
  try {
    const drafts = deleteSavedDraft(req.params.id);
    addLog('INFO', `🗑️ 임시 보관함에서 항목이 삭제되었습니다. (남은 항목: ${drafts.length}건)`);
    res.json({ success: true, drafts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 30-Day X Posting Streak Stats (포스팅 잔디밭) =====
app.get('/api/streak-stats', (req, res) => {
  try {
    const stats = getStreakStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== Twitter Realtime Golden Hour (골든타임 뱃지) =====
app.get('/api/golden-hour', (req, res) => {
  try {
    const info = getGoldenHourInfo();
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 🧠 AI Viral Topic Weights & Analytics =====
const { initXAnalyticsScheduler, getStoredWeights } = require('./services/xAnalyticsService');
initXAnalyticsScheduler();

app.get('/api/analytics/viral-weights', (req, res) => {
  try {
    const weights = getStoredWeights();
    res.json({ success: true, weights });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== X Poll & Thread Generators =====
app.post('/api/generate-poll', async (req, res) => {
  try {
    const { article } = req.body;
    if (!article) return res.status(400).json({ success: false, message: 'article data required' });
    const pollResult = await generatePollTweet(article);
    res.json({ success: true, poll: pollResult });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/generate-thread', async (req, res) => {
  try {
    const { article } = req.body;
    if (!article) return res.status(400).json({ success: false, message: 'article data required' });
    const threadResult = await generateThreadTweet(article);
    res.json({ success: true, thread: threadResult });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

let globalPublicUrl = `http://${LOCAL_WIFI_IP}:${PORT}`;

function setGlobalPublicUrl(url) {
  if (url) globalPublicUrl = url;
}

function getGlobalPublicUrl() {
  return globalPublicUrl;
}

// ===== 🧵 1-Click Thread Bridge Page (스마트폰 2번 글 자동 복사 & 1번 글 작성창 리다이렉트) =====
app.get('/bridge/thread', async (req, res) => {
  try {
    const { id } = req.query;
    let tweet1 = '';
    let tweet2 = '';

    if (id) {
      const { getTelegramQueueMap } = require('./history');
      const queueMap = getTelegramQueueMap();
      const item = queueMap[id];
      if (item?.threadInfo?.tweet1 && item?.threadInfo?.tweet2) {
        tweet1 = item.threadInfo.tweet1;
        tweet2 = item.threadInfo.tweet2;
      }
    }

    if (!tweet1 || !tweet2) {
      tweet1 = '다들 이번 이슈 어떻게 보고 계신가요? 🧵 (1/2)';
      tweet2 = '자세한 내용과 생각거리는 타래에서 이어집니다. (2/2)';
    }

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🧵 𝕏 2단 스레드 올리기</title>
  <style>
    body {
      background: #0f172a;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      text-align: center;
      box-sizing: border-box;
    }
    .card {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 28px 24px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 4px solid rgba(255,255,255,0.15);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 18px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .msg { font-size: 17px; font-weight: 800; color: #38bdf8; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; line-height: 1.5; }
    .btn-manual {
      margin-top: 20px;
      background: #2563eb;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <div class="msg">📋 2번 글을 클립보드에 복사 완료!</div>
    <div class="sub">1번 글이 채워진 𝕏 작성창으로 이동합니다.<br>게시 후 <b>[답글]</b>에 바로 붙여넣기(Ctrl+V) 하세요!</div>
    <a id="x-link" href="#" class="btn-manual" style="display:none;">🚀 𝕏 작성창으로 바로 이동</a>
  </div>
  <script>
    const tweet1 = ${JSON.stringify(tweet1)};
    const tweet2 = ${JSON.stringify(tweet2)};
    const targetUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweet1);

    // 1. Copy part 2 to clipboard
    if (navigator.clipboard && tweet2) {
      navigator.clipboard.writeText(tweet2).catch(() => {});
    }

    const linkEl = document.getElementById('x-link');
    if (linkEl) linkEl.href = targetUrl;

    // 2. Redirect to X Intent
    setTimeout(() => {
      window.location.href = targetUrl;
    }, 400);
  </script>
</body>
</html>`;

    res.send(html);
  } catch (e) {
    res.status(500).send('오류 발생: ' + e.message);
  }
});

// Initialize background 07:00 AM scheduler
initScheduler();

const { spawn } = require('child_process');

function startCloudflareTunnel() {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (fs.existsSync(cloudflaredPath)) {
    const tunnelProc = require('child_process').spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${PORT}`]);
    let tunnelUrlFound = false;
    let fullOutput = '';
    let fallbackTriggered = false;

    function handleData(data) {
      const text = data.toString();
      fullOutput += text;
      
      // 🚨 Cloudflare 429 차단 감지 시 백업 터널(Localtunnel)로 우회
      if ((text.includes('429 Too Many Requests') || text.includes('failed to unmarshal')) && !fallbackTriggered) {
         fallbackTriggered = true;
         console.log(`\n🚨 [터널 경고] Cloudflare 임시 차단(429) 감지. 백업 터널(Localtunnel)로 우회 가동합니다...`);
         try { tunnelProc.kill(); } catch (e) {}
         startLocaltunnelFallback();
         return;
      }

      const match = fullOutput.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !tunnelUrlFound && !fallbackTriggered) {
        tunnelUrlFound = true;
        const tunnelUrl = match[0];
        setGlobalPublicUrl(tunnelUrl);
        const config = getConfig();
        const username = config.authUsername || 'la5454';
        console.log(`\n=======================================================`);
        console.log(`🌐 외부(LTE/5G/스마트폰) 접속 주소:`);
        console.log(`👉 ${tunnelUrl}`);
        console.log(`🔑 보안 로그인: 아이디 ${username} / 설정하신 비밀번호`);
        console.log(`=======================================================\n`);
        addLog('SUCCESS', `🌐 Cloudflare 외부 접속 터널이 활성화되었습니다: ${tunnelUrl}`);
        notifyNewTunnelUrl(tunnelUrl);
      }
    }

    if (tunnelProc.stdout) tunnelProc.stdout.on('data', handleData);
    if (tunnelProc.stderr) tunnelProc.stderr.on('data', handleData);
  }
}

function startLocaltunnelFallback() {
  const os = require('os');
  const { spawn } = require('child_process');
  const npxCmd = os.platform() === 'win32' ? 'npx.cmd' : 'npx';
  // 윈도우에서 .cmd 파일 실행 시 shell: true 필수 (EINVAL 방지)
  const ltProc = spawn(npxCmd, ['localtunnel', '--port', PORT.toString()], { shell: true });
  let urlFound = false;
  let fullText = '';

  function handleLtData(data) {
    const text = data.toString();
    fullText += text;
    const match = fullText.match(/https:\/\/[a-zA-Z0-9-]+\.loca\.lt/);
    if (match && !urlFound) {
      urlFound = true;
      const tunnelUrl = match[0];
      setGlobalPublicUrl(tunnelUrl);
      console.log(`\n=======================================================`);
      console.log(`🌐 백업 터널(LTE/스마트폰) 접속 주소 [Localtunnel]:`);
      console.log(`👉 ${tunnelUrl}`);
      console.log(`⚠️ 참고: 처음 접속 시 'Click to Continue' 버튼을 눌러주세요.`);
      console.log(`=======================================================\n`);
      addLog('SUCCESS', `🌐 백업 터널(Localtunnel) 활성화 완료: ${tunnelUrl}`);
      notifyNewTunnelUrl(tunnelUrl);
    }
  }

  if (ltProc.stdout) ltProc.stdout.on('data', handleLtData);
  if (ltProc.stderr) ltProc.stderr.on('data', handleLtData);
}



// Notification Test APIs

app.post('/api/test-telegram', async (req, res) => {
  try {
    const { token, chatId } = req.body;
    const msg = `🔔 <b>X 트윗 생성기 텔레그램 알림 테스트 성공!</b>\n\n이 메시지가 보이시면 텔레그램 연동이 정상적으로 완료된 것입니다.`;
    await sendTelegramMessage(msg, token, chatId);
    addLog('SUCCESS', '📲 텔레그램 테스트 알림이 발송되었습니다.');
    res.json({ success: true, message: '텔레그램 테스트 메시지가 발송되었습니다!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/test-email', async (req, res) => {
  try {
    const subject = `🔔 [X Dashboard] 이메일 알림 테스트`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h3 style="color: #1d9bf0;">🔔 이메일 알림 테스트 성공</h3>
        <p>이메일 연동이 정상적으로 설정되었습니다!</p>
      </div>
    `;
    await sendEmailMessage(subject, html, req.body);
    addLog('SUCCESS', '📧 이메일 테스트 알림이 발송되었습니다.');
    res.json({ success: true, message: '이메일 테스트 메시지가 발송되었습니다!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 🗺️ Korean Gourmet Food Map API (맛집 지도 CRUD) =====
const RESTAURANTS_DB_FILE = path.join(DATA_DIR, 'restaurants_db.json');

function getRestaurantsDb() {
  if (!fs.existsSync(RESTAURANTS_DB_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(RESTAURANTS_DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveRestaurantsDb(list) {
  try {
    fs.writeFileSync(RESTAURANTS_DB_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving restaurants DB:', e);
    return false;
  }
}

app.get('/api/restaurants', (req, res) => {
  try {
    const list = getRestaurantsDb();
    res.json({ success: true, count: list.length, restaurants: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/restaurants', (req, res) => {
  try {
    const { name, category, region, address, lat, lng, rating, signature, review, tweetTemplate } = req.body;
    if (!name || !region || !lat || !lng) {
      return res.status(400).json({ success: false, message: '가게명, 지역, 위도/경도 좌표는 필수입니다.' });
    }

    const list = getRestaurantsDb();
    const newRestaurant = {
      id: `rest_${Date.now()}`,
      name: name.trim(),
      category: category || 'korean',
      region: region.trim(),
      address: (address || '').trim(),
      lat: Number(lat),
      lng: Number(lng),
      rating: Number(rating) || 4.5,
      signature: (signature || '').trim(),
      review: (review || '').trim(),
      tweetTemplate: (tweetTemplate || '').trim() || `🍽️ [${region}] ${name} 다녀왔습니다! 시그니처 메뉴(${signature || name}) 강추 🔥 #${name.replace(/\s+/g, '')} #${region}맛집`,
      createdAt: new Date().toISOString()
    };

    list.unshift(newRestaurant);
    saveRestaurantsDb(list);
    addLog('SUCCESS', `📍 [맛집 등록 완료] ${newRestaurant.name} (${newRestaurant.region})이(가) 지도에 등록되었습니다.`);
    res.json({ success: true, restaurant: newRestaurant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/restaurants/:id', (req, res) => {
  try {
    const { id } = req.params;
    let list = getRestaurantsDb();
    const prevLen = list.length;
    list = list.filter(r => r.id !== id);
    if (list.length === prevLen) {
      return res.status(404).json({ success: false, message: '해당 맛집을 찾을 수 없습니다.' });
    }
    saveRestaurantsDb(list);
    addLog('INFO', `🗑️ [맛집 삭제] 맛집이 삭제되었습니다.`);
    res.json({ success: true, message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== Trending Keywords API (No DB Storage) =====

// ===== 🌐 Google Trends Realtime Keywords (5-Min Memory Cache & Guaranteed Fallback) =====
let cachedTrendingData = {
  kr: [
    { rank: 1, keyword: "엔비디아", traffic: "10K+", relatedNews: "AI 반도체 실적 및 시장 전망" },
    { rank: 2, keyword: "테슬라", traffic: "5K+", relatedNews: "자율주행 및 로보택시 이슈" },
    { rank: 3, keyword: "비트코인", traffic: "5K+", relatedNews: "가상자산 ETF 및 금리 인하 기대감" },
    { rank: 4, keyword: "블라인드", traffic: "2K+", relatedNews: "직장인 커뮤니티 화제글" },
    { rank: 5, keyword: "네이트판", traffic: "2K+", relatedNews: "온라인 사연 결말 화제" },
    { rank: 6, keyword: "금리 인하", traffic: "1K+", relatedNews: "미 연준 기준금리 발표 전망" },
    { rank: 7, keyword: "삼성전자", traffic: "1K+", relatedNews: "차세대 HBM 공급 계약" },
    { rank: 8, keyword: "애플", traffic: "1K+", relatedNews: "새로운 AI 기능 업데이트 공개" }
  ],
  us: [
    { rank: 1, keyword: "Nvidia", traffic: "20K+", relatedNews: "AI Chip earnings report" },
    { rank: 2, keyword: "Tesla", traffic: "10K+", relatedNews: "Full Self Driving update" },
    { rank: 3, keyword: "Bitcoin", traffic: "10K+", relatedNews: "Crypto market surges" }
  ],
  updatedAt: new Date().toISOString()
};

async function fetchAndCacheTrendingKeywords() {
  try {
    const [krRes, usRes] = await Promise.allSettled([
      axios.get('https://trends.google.co.kr/trending/rss?geo=KR', { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, 
        timeout: 4000 
      }),
      axios.get('https://trends.google.com/trending/rss?geo=US', { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, 
        timeout: 4000 
      })
    ]);

    function parseTrendingRss(xml) {
      if (!xml) return [];
      const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)];
      return items.slice(0, 10).map((m, idx) => {
        const titleMatch = m[0].match(/<title>(.*?)<\/title>/i);
        const trafficMatch = m[0].match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/i);
        const newsMatch = m[0].match(/<ht:news_item_title>(.*?)<\/ht:news_item_title>/i);
        return {
          rank: idx + 1,
          keyword: titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '',
          traffic: trafficMatch ? trafficMatch[1] : '',
          relatedNews: newsMatch ? newsMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
        };
      }).filter(t => t.keyword);
    }

    const krTrends = krRes.status === 'fulfilled' ? parseTrendingRss(krRes.value.data) : [];
    const usTrends = usRes.status === 'fulfilled' ? parseTrendingRss(usRes.value.data) : [];

    if (krTrends.length > 0) cachedTrendingData.kr = krTrends;
    if (usTrends.length > 0) cachedTrendingData.us = usTrends;
    cachedTrendingData.updatedAt = new Date().toISOString();
  } catch (e) {}
}

// Pre-fetch on startup & periodic background refresh
setInterval(fetchAndCacheTrendingKeywords, 3 * 60 * 1000);
setTimeout(fetchAndCacheTrendingKeywords, 1000);

app.get('/api/trending', async (req, res) => {
  const now = Date.now();
  // 1. Instant response from cache
  if (cachedTrendingData.kr.length > 0) {
    // If cache older than 3 minutes, refresh asynchronously in background
    if (!cachedTrendingData.updatedAt || (now - new Date(cachedTrendingData.updatedAt).getTime()) > 3 * 60 * 1000) {
      fetchAndCacheTrendingKeywords();
    }
    return res.json({ success: true, ...cachedTrendingData });
  }

  // 2. Fallback fetch
  await fetchAndCacheTrendingKeywords();
  return res.json({ success: true, ...cachedTrendingData });
});

app.get('/api/trending-articles', async (req, res) => {
  try {
    const keyword = req.query.keyword;
    const region = req.query.region || 'kr';
    if (!keyword) return res.status(400).json({ success: false, message: 'keyword 필수' });

    addLog('INFO', `🔍 [실시간 수동/인기 검색] "${keyword}" 기사 수집 시도`);

    const hl = region === 'us' ? 'en-US' : 'ko';
    const gl = region === 'us' ? 'US' : 'KR';
    const ceid = region === 'us' ? 'US:en' : 'KR:ko';

    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

    let items = [];
    let fetchSource = '';

    // 1차 시도: 구글 뉴스 직통 수집 (2초 타임아웃)
    try {
      const directRes = await axios.get(googleUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 2000
      });

      if (directRes.data && typeof directRes.data === 'string' && directRes.data.includes('<item>')) {
        const rawMatches = [...directRes.data.matchAll(/<item>[\s\S]*?<\/item>/gi)];
        if (rawMatches.length > 0) {
          items = rawMatches.map(m => {
            const titleMatch = m[0].match(/<title>(.*?)<\/title>/i);
            const linkMatch = m[0].match(/<link>(.*?)<\/link>/i);
            const dateMatch = m[0].match(/<pubDate>(.*?)<\/pubDate>/i);
            const descMatch = m[0].match(/<description>(.*?)<\/description>/i);
            return {
              title: titleMatch ? titleMatch[1] : '',
              link: linkMatch ? linkMatch[1] : '',
              pubDate: dateMatch ? dateMatch[1] : '',
              description: descMatch ? descMatch[1] : ''
            };
          });
          fetchSource = 'direct';
        }
      }
    } catch (directErr) { }

    // 3차 시도: Bing 뉴스 RSS 수집
    if (!fetchSource || items.length === 0) {
      try {
        const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=rss&setlang=${region === 'us' ? 'en-US' : 'ko-KR'}`;
        const bingRes = await axios.get(bingUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000
        });
        if (bingRes.data && typeof bingRes.data === 'string' && bingRes.data.includes('<item>')) {
          const rawMatches = [...bingRes.data.matchAll(/<item>[\s\S]*?<\/item>/gi)];
          if (rawMatches.length > 0) {
            items = rawMatches.map(m => {
              const titleMatch = m[0].match(/<title>(.*?)<\/title>/i);
              const linkMatch = m[0].match(/<link>(.*?)<\/link>/i);
              const dateMatch = m[0].match(/<pubDate>(.*?)<\/pubDate>/i);
              const descMatch = m[0].match(/<description>(.*?)<\/description>/i);
              return {
                title: titleMatch ? titleMatch[1] : '',
                link: linkMatch ? linkMatch[1] : '',
                pubDate: dateMatch ? dateMatch[1] : '',
                description: descMatch ? descMatch[1] : ''
              };
            });
            fetchSource = 'bing';
          }
        }
      } catch (bErr) {
        addLog('WARN', `⚠️ [3차 Bing 백업 실패 ➔ 4차 rss2json 전환] "${keyword}" Bing 지연 (${bErr.message}).`);
      }
    }

    // 4차 시도: rss2json 백업 우회
    if (!fetchSource || items.length === 0) {
      try {
        const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
        const rssRes = await axios.get(proxyUrl, { timeout: 6000 });
        if (rssRes.data.status === 'ok') {
          items = rssRes.data.items || [];
          if (items.length > 0) fetchSource = 'rss2json';
        }
      } catch (r2jErr) { }
    }

    if (items.length === 0) {
      addLog('ERROR', `❌ [검색 실패] "${keyword}" 관련 기사를 찾을 수 없거나 차단됨`);
      return res.status(500).json({ success: false, message: 'Google News blocked or empty' });
    }

    const articles = items.slice(0, 5).map((item, idx) => {
      let title = (item.title || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();

      const sourceIndex = title.lastIndexOf(' - ');
      let sourceName = '';
      if (sourceIndex > 0) {
        sourceName = title.substring(sourceIndex + 3).trim();
        title = title.substring(0, sourceIndex).trim();
      }

      let rawSnippet = (item.description || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();

      const link = item.link || '';
      const isoDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

      return {
        id: `trending-${idx}-${Date.now()}`,
        category: 'trending',
        categoryTag: `🔍 ${keyword}`,
        title,
        source: sourceName || '뉴스',
        link,
        date: isoDate,
        excerpt: rawSnippet.substring(0, 300),
        contentSnippet: `${keyword} 뉴스 (${sourceName || '뉴스'}): ${rawSnippet.substring(0, 1500)}`
      };
    }).filter(a => a.title.length > 0);

    if (fetchSource === 'direct') {
      addLog('SUCCESS', `⚡ [1차 구글 직통 성공] "${keyword}" 구글 서버 직접 연결 수집 완료 (${articles.length}건)`);
    } else if (fetchSource === 'cf') {
      addLog('SUCCESS', `🚀 [2차 Cloudflare 구글 성공] "${keyword}" Cloudflare 구글 뉴스 원본 수집 완료 (${articles.length}건)`);
    } else if (fetchSource === 'bing') {
      addLog('SUCCESS', `🔄 [3차 Bing 백업 성공] "${keyword}" Bing News 엔진 수집 완료 (${articles.length}건)`);
    } else {
      addLog('SUCCESS', `🌐 [4차 rss2json 성공] "${keyword}" rss2json 백업 수집 완료 (${articles.length}건)`);
    }

    res.json({ success: true, keyword, articles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/trending-images', async (req, res) => {
  try {
    const keyword = req.query.keyword;
    if (!keyword) return res.status(400).json({ success: false, message: 'keyword 필수' });

    const images = [];
    const seen = new Set();

    // 1. Fetch Naver Image Search results for high-res real photos
    try {
      const naverUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(keyword)}`;
      const naverRes = await axios.get(naverUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 6000
      });

      const html = String(naverRes.data);

      // Match originalUrl, _g_img or src
      const matches = [
        ...html.matchAll(/"originalUrl":"(https?:\/\/[^"]+)"/gi),
        ...html.matchAll(/"thumbnail":"(https?:\/\/[^"]+)"/gi),
        ...html.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi)
      ];

      matches.forEach(m => {
        let imgUrl = m[1].replace(/\\/g, '').replace(/&amp;/g, '&');
        if (
          imgUrl &&
          !seen.has(imgUrl) &&
          !imgUrl.includes('logo') &&
          !imgUrl.includes('icon') &&
          !imgUrl.includes('favicon') &&
          !imgUrl.includes('googleusercontent.com') &&
          !imgUrl.includes('ssl.pstatic.net/sstatic') &&
          !imgUrl.includes('static.naver')
        ) {
          seen.add(imgUrl);
          images.push({ title: `📷 "${keyword}" 실시간 관련 이미지`, imageUrl: imgUrl });
        }
      });
    } catch (e) { }

    // 2. Fallback / Supplement with Daum Image Search if fewer than 10
    if (images.length < 10) {
      try {
        const daumUrl = `https://search.daum.net/search?w=img&q=${encodeURIComponent(keyword)}`;
        const daumRes = await axios.get(daumUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 6000
        });
        const dHtml = String(daumRes.data);
        const dMatches = [...dHtml.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi)];
        dMatches.forEach(m => {
          let imgUrl = m[1].replace(/&amp;/g, '&');
          if (
            imgUrl &&
            !seen.has(imgUrl) &&
            !imgUrl.includes('logo') &&
            !imgUrl.includes('icon') &&
            !imgUrl.includes('favicon') &&
            !imgUrl.includes('googleusercontent.com') &&
            !imgUrl.includes('daumcdn.net/daumtop')
          ) {
            seen.add(imgUrl);
            images.push({ title: `📷 "${keyword}" 실시간 관련 이미지`, imageUrl: imgUrl });
          }
        });
      } catch (e) { }
    }

    res.json({ success: true, keyword, images: images.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 📸 웹 비주얼 미디어 (화보/직캠/핫클립) 탐색 및 바이럴 X 트윗 API =====
app.get('/api/visual-presets', (req, res) => {
  res.json({ success: true, presets: VISUAL_PRESETS });
});

app.get('/api/visual-media', async (req, res) => {
  try {
    const keyword = req.query.keyword || '여돌 직캠 MP4';
    const page = parseInt(req.query.page || '1', 10);
    const mediaList = await searchVisualMedia(keyword, page);
    res.json({ success: true, keyword, media: mediaList });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



app.post('/api/generate-visual-tweet', async (req, res) => {
  try {
    const { titleOrTopic, style, imageUrl, mediaDate } = req.body;
    if (!titleOrTopic && !imageUrl) {
      return res.status(400).json({ success: false, message: '미디어 주제나 이미지가 필요합니다.' });
    }
    const result = await generateVisualTweet(titleOrTopic || '비주얼 화보', style || 'shock', imageUrl || '', mediaDate || '연도미상');
    res.json({ 
      success: true, 
      text: result.text, 
      isAiGenerated: result.isAiGenerated, 
      style: result.style,
      suggestedTags: result.suggestedTags || [] 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/save-media-to-desktop', async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: '미디어 URL이 필요합니다.' });
    }

    const os = require('os');
    const desktopPath = path.join(os.homedir(), 'Desktop', 'X_Media_Downloads');
    if (!fs.existsSync(desktopPath)) {
      fs.mkdirSync(desktopPath, { recursive: true });
    }

    const mediaRes = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const contentType = mediaRes.headers['content-type'] || '';
    let ext = '.jpg';
    if (contentType.includes('gif') || url.toLowerCase().includes('.gif')) ext = '.gif';
    else if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';
    else if (contentType.includes('mp4') || url.toLowerCase().includes('.mp4')) ext = '.mp4';

    const safeTitle = (title || 'x_media')
      .replace(/[\/\\:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 30);
    const filename = `${safeTitle}_${Date.now()}${ext}`;
    const targetFile = path.join(desktopPath, filename);

    fs.writeFileSync(targetFile, mediaRes.data);
    addLog('SUCCESS', `💾 바탕화면 전용 폴더 저장 완료: ${filename}`);

    // Automatically open/reveal the saved file in Windows Explorer
    const { exec } = require('child_process');
    try {
      exec(`explorer.exe /select,"${targetFile}"`);
    } catch (openErr) {}

    res.json({
      success: true,
      filename,
      folderPath: desktopPath,
      filePath: targetFile
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/open-desktop-folder', (req, res) => {
  try {
    const os = require('os');
    const { exec } = require('child_process');
    const desktopPath = path.join(os.homedir(), 'Desktop', 'X_Media_Downloads');
    if (!fs.existsSync(desktopPath)) {
      fs.mkdirSync(desktopPath, { recursive: true });
    }
    exec(`explorer.exe "${desktopPath}"`);
    res.json({ success: true, folderPath: desktopPath });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 🔄 깃허브(GitHub) 원격 코드 동기화 & 자동 배포 API =====
app.get('/api/git-info', async (req, res) => {
  const info = await getGitInfo();
  res.json(info);
});

// ===== 🤖 텔레그램 3분 큐 & X(트위터) 승인 포스팅 API =====
app.get('/api/telegram-queue/status', (req, res) => {
  const config = getConfig();
  res.json({
    success: true,
    enabled: Boolean(config.telegramQueueEnabled),
    isActive: isQueueActive()
  });
});

app.post('/api/telegram-queue/toggle', (req, res) => {
  try {
    const config = getConfig();
    const newEnabled = !config.telegramQueueEnabled;
    saveConfig({ telegramQueueEnabled: newEnabled });

    if (newEnabled) {
      initTelegramQueueWorker();
    } else {
      stopTelegramQueueWorker();
    }

    res.json({ success: true, enabled: newEnabled, isActive: isQueueActive() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/telegram-queue/trigger-next', async (req, res) => {
  try {
    const result = await triggerHourlyTelegramBriefing(true);
    res.json({ success: true, result, message: '핵심 5개 기사 텔레그램 발송 완료' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/telegram-queue/send-article', async (req, res) => {
  try {
    const { articleId } = req.body;
    const articles = getStoredArticles();
    const target = articles.find(a => String(a.id) === String(articleId));
    if (!target) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }
    const result = await processAndSendArticle(target);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/twitter/test-auth', async (req, res) => {
  const result = await testTwitterConnection();
  res.json(result);
});

app.post('/api/twitter/post-direct', async (req, res) => {
  try {
    const { text, imagePath } = req.body;
    const result = await postTweetWithMedia({ text, imagePath });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const startServer = (port, retries = 5) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 X 트윗 생성기 대시보드 실행 중`);
    console.log(`💻 PC 접속 주소: http://localhost:${port}`);
    console.log(`📱 스마트폰(내부 와이파이) 접속 주소: http://${LOCAL_WIFI_IP}:${port}`);
    console.log(`=======================================================`);
    addLog('INFO', `서버가 포트 ${port}에서 성공적으로 시작되었습니다.`);
    startCloudflareTunnel();

    // Start GitHub Auto-Sync (checks every 30s)
    initGitAutoSync(30);

    // Initialize Telegram 3-Minute Queue Worker if enabled
    const config = getConfig();
    if (config.telegramQueueEnabled) {
      try {
        initTelegramQueueWorker();
      } catch (teleErr) {
        addLog('WARN', `텔레그램 큐 워커 시작 지연: ${teleErr.message}`);
      }
    }

    // Trigger initial article fetch asynchronously on server startup
    setTimeout(async () => {
      try {
        addLog('INFO', '🚀 [서버 시작] 최신 뉴스 초기 수집을 시작합니다...');
        const freshArticles = await fetchLatestArticles(35);
        articlesCache = freshArticles;
        addLog('SUCCESS', `🚀 [서버 시작] 최신 뉴스 초기 수집 완료 (${freshArticles.length}건)`);
      } catch (e) {
        addLog('WARN', `서버 시작 뉴스 수집 지연: ${e.message}`);
      }
    }, 2000);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`🚨 포트 ${port} 충돌 감지 (EADDRINUSE)! 백그라운드 경합 중... 1.5초 후 재시도합니다 (남은 횟수: ${retries - 1})`);
      if (retries === 0) {
        console.error('❌ 포트 확보에 최종 실패했습니다. 루프 재시작을 위해 자폭합니다.');
        process.exit(1);
      }
      setTimeout(() => {
        server.close();
        startServer(port, retries - 1);
      }, 1500);
    } else {
      console.error('❌ 알 수 없는 서버 구동 에러:', e);
    }
  });
};

startServer(PORT);

module.exports = {
  app,
  getGlobalPublicUrl,
  setGlobalPublicUrl
};


