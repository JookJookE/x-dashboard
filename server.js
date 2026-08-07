const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { getConfig, saveConfig } = require('./config');
const { getHistory, getLogs, addLog, getPostingStatusMap, markPostingStatus, getStoredArticles, saveStoredArticles, getReadStatusMap, markAsRead, markAllAsRead, getSavedDrafts, saveSavedDraft, deleteSavedDraft } = require('./history');
const { fetchLatestArticles } = require('./scraper');
const { generateSummary } = require('./summarizer');
const { generateNewsInfographicSvg } = require('./imageGenerator');
const { initScheduler, generateDailyDraftsJob, getDailyDrafts } = require('./scheduler');

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

// Self Keep-Alive Timer: Ping /ping every 10 minutes to prevent Render Free Tier from sleeping
setInterval(async () => {
  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://x-dashboard-4snc.onrender.com';
    await axios.get(`${renderUrl}/ping`, { timeout: 5000 });
  } catch (e) {}
}, 10 * 60 * 1000);

// HTTP Basic Security Authentication for Tunnel & External Access
app.use((req, res, next) => {
  const config = getConfig();
  const authPassword = config.authPassword || '1234';

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="X Tweet Generator Secure Access"');
    return res.status(401).send('🔒 비밀번호 인증이 필요합니다.');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const pass = auth[1];

  if (pass === authPassword) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="X Tweet Generator Secure Access"');
    return res.status(401).send('🔒 비밀번호가 올바르지 않습니다.');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// API Routes

app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getConfig() });
});

app.post('/api/config', (req, res) => {
  try {
    const updated = saveConfig(req.body);
    addLog('INFO', '설정 정보가 업데이트되었습니다.');
    initScheduler();
    res.json({ success: true, config: updated, message: '설정이 저장되었습니다.' });
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
      latestLog: logs[0] || null
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
    // STRICT SCALING RULE: Only fetch new articles if forceRefresh=true ([🔄 수집] button) or empty initial cache
    if (forceRefresh || articlesCache.length === 0) {
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

    // 1. Direct fetch if url is non-Google link
    if (url && !url.includes('news.google.com')) {
      try {
        const directRes = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000
        });
        const dHtml = directRes.data;
        const ogMatch = dHtml.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                        dHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (ogMatch && ogMatch[1] && !ogMatch[1].toLowerCase().includes('logo')) {
          let photo = ogMatch[1].replace(/&amp;/g, '&');
          if (photo.startsWith('//')) photo = 'https:' + photo;
          return res.json({ success: true, imageUrl: photo });
        }
      } catch (e) {}
    }

    // 2. High-precision News Photo Search by Title
    const cleanTitle = (title || '').replace(/\[.*?\]/g, '').replace(/ - .*$/, '').trim();
    if (!cleanTitle) {
      return res.json({ success: false, message: '원문 기사에서 대표 이미지를 찾을 수 없습니다.' });
    }

    const searchUrl = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(cleanTitle)}`;
    const searchRes = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 6000
    });

    const html = searchRes.data;
    const imgMatches = [...html.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)];

    for (const m of imgMatches) {
      const src = m[1].replace(/&amp;/g, '&');
      const srcLower = src.toLowerCase();

      if (srcLower.includes('imgnews.pstatic.net') || srcLower.includes('search.pstatic.net')) {
        const paramMatch = src.match(/src=([^&]+)/);
        if (paramMatch && paramMatch[1]) {
          const originUrl = decodeURIComponent(paramMatch[1]);
          if (!originUrl.toLowerCase().includes('logo') && !originUrl.toLowerCase().includes('icon')) {
            return res.json({ success: true, imageUrl: originUrl });
          }
        } else if (!srcLower.includes('logo') && !srcLower.includes('icon')) {
          return res.json({ success: true, imageUrl: src });
        }
      }
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

// Initialize background 07:00 AM scheduler
initScheduler();

const { spawn } = require('child_process');

function startCloudflareTunnel() {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (fs.existsSync(cloudflaredPath)) {
    const tunnelProc = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${PORT}`]);
    let tunnelUrlFound = false;

    tunnelProc.stderr.on('data', (data) => {
      const msg = data.toString();
      const match = msg.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !tunnelUrlFound) {
        tunnelUrlFound = true;
        const tunnelUrl = match[0];
        console.log(`\n=======================================================`);
        console.log(`🌐 외부(LTE/5G/스마트폰) 접속 주소:`);
        console.log(`👉 ${tunnelUrl}`);
        console.log(`🔑 보안 로그인: 아이디 admin / 설정하신 비밀번호`);
        console.log(`=======================================================\n`);
        addLog('SUCCESS', `🌐 Cloudflare 외부 접속 터널이 활성화되었습니다: ${tunnelUrl}`);
      }
    });

    tunnelProc.on('error', (err) => {
      console.log(`[터널 안내] cloudflared 터널 시작 중: ${err.message}`);
    });
  }
}

// ===== Trending Keywords API (No DB Storage) =====

app.get('/api/trending', async (req, res) => {
  try {
    const [krRes, usRes] = await Promise.allSettled([
      axios.get('https://trends.google.co.kr/trending/rss?geo=KR', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
      axios.get('https://trends.google.com/trending/rss?geo=US', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
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

    res.json({ success: true, kr: krTrends, us: usTrends, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/trending-articles', async (req, res) => {
  try {
    const keyword = req.query.keyword;
    const region = req.query.region || 'kr';
    if (!keyword) return res.status(400).json({ success: false, message: 'keyword 필수' });

    const hl = region === 'us' ? 'en-US' : 'ko';
    const gl = region === 'us' ? 'US' : 'KR';
    const ceid = region === 'us' ? 'US:en' : 'KR:ko';
    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;

    const rssRes = await axios.get(url, { 
      timeout: 15000 
    });
    
    if (rssRes.data.status !== 'ok') return res.status(500).json({ success: false, message: 'Google News blocked or empty' });
    const items = rssRes.data.items || [];

    const articles = items.slice(0, 5).map((item, idx) => {
      const titleMatch = [null, item.title || ''];
      const linkMatch = [null, item.link || ''];
      const dateMatch = [null, item.pubDate || ''];
      const descMatch = [null, item.description || ''];

      let title = titleMatch ? titleMatch[1] : '';
      title = title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
      const sourceIdx = title.lastIndexOf(' - ');
      if (sourceIdx > 0) title = title.substring(0, sourceIdx);

      const link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
      const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
      let snippet = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim() : title;

      return {
        id: `trending-${idx}-${Date.now()}`,
        category: 'trending',
        categoryTag: `🔍 ${keyword}`,
        date: isoDate,
        link,
        title,
        contentSnippet: snippet.substring(0, 1500)
      };
    });

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
    } catch (e) {}

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
      } catch (e) {}
    }

    res.json({ success: true, keyword, images: images.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 X 트윗 생성기 대시보드 실행 중`);
  console.log(`💻 PC 접속 주소: http://localhost:${PORT}`);
  console.log(`📱 스마트폰(내부 와이파이) 접속 주소: http://${LOCAL_WIFI_IP}:${PORT}`);
  console.log(`=======================================================`);
  addLog('INFO', `서버가 포트 ${PORT}에서 성공적으로 시작되었습니다.`);
  startCloudflareTunnel();
});
