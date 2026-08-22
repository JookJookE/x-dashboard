const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig } = require('../config');
const { addLog, getStoredArticles, saveArticles } = require('../history');
const { generateHotIssueTweet } = require('../summarizer');
const { generateAll3CaptureCards } = require('./cardNewsServerService');
const { isSimilarArticleTitle } = require('../scraper');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BREAKING_LOG_FILE = path.join(DATA_DIR, 'breaking_news_sent.json');

// 🛡️ 안전 제한: 1시간당 최대 1건, 하루 최대 3건, 발송 후 최소 45분 쿨다운
const COOLDOWN_MS = 45 * 60 * 1000; // 45분
const MAX_HOURLY_BREAKING = 1;
const MAX_DAILY_BREAKING = 3;

// 🚨 진짜 대형 속보에만 포함되는 중대 국가/글로벌/금융 비상 키워드
const CRITICAL_BREAKING_KEYWORDS = [
  '계엄', '전쟁', '공습', '미사일', '침공', '대통령실', '탄핵', '비상계엄',
  '대형참사', '지진', '쓰나미', '화재사고', '전면전', '금리인하', '금리인상',
  '기준금리', '한은', '연준', 'fomc', '빅컷', '디폴트', '뱅크런', '파산',
  '단독', '긴급', '1보', '2보', '속보'
];

// 🚫 사소한 가십/연예/스포츠/단순홍보성 낚시 속보 제외 필터
const EXCLUDE_TOPICS = [
  '열애', '결혼', '이혼', '출산', '화보', '예능', '드라마', '영화',
  '골', '승리', '패배', '홈런', '올림픽', '콘서트', '팬미팅', '시청률',
  '이벤트', '할인', '특가', '신제품', '출시'
];

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function getTelegramConfig() {
  const config = getConfig();
  const rawToken = process.env.TELEGRAM_BRIEFING_BOT_TOKEN || config.telegramBriefingBotToken || process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken;
  const rawChatId = process.env.TELEGRAM_BRIEFING_CHAT_ID || config.telegramBriefingChatId || process.env.TELEGRAM_CHAT_ID || config.telegramChatId;
  const token = (rawToken || '').toString().trim();
  const chatId = (rawChatId || '').toString().trim();
  const cleanToken = token.startsWith('bot') ? token.slice(3) : token;
  return { token: cleanToken, chatId };
}

function getBreakingLog() {
  if (fs.existsSync(BREAKING_LOG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BREAKING_LOG_FILE, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveBreakingLog(list) {
  try {
    fs.writeFileSync(BREAKING_LOG_FILE, JSON.stringify(list.slice(-50), null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save breaking news log:', e.message);
  }
}

/**
 * Check rate limits: Cooldown, Hourly, Daily limit
 */
function canSendBreakingNews() {
  const log = getBreakingLog();
  const now = Date.now();

  if (log.length === 0) return true;

  const lastSent = log[log.length - 1];
  const lastTime = new Date(lastSent.sentAt).getTime();

  // 1. Cooldown Check (최소 45분 간격)
  if (now - lastTime < COOLDOWN_MS) {
    return false;
  }

  // 2. Hourly Check (최근 1시간 내 1건 제한)
  const oneHourAgo = now - (60 * 60 * 1000);
  const hourlyCount = log.filter(item => new Date(item.sentAt).getTime() > oneHourAgo).length;
  if (hourlyCount >= MAX_HOURLY_BREAKING) {
    return false;
  }

  // 3. Daily Check (최근 24시간 내 최대 3건 제한)
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const dailyCount = log.filter(item => new Date(item.sentAt).getTime() > oneDayAgo).length;
  if (dailyCount >= MAX_DAILY_BREAKING) {
    return false;
  }

  return true;
}

/**
 * 📡 Fetch lightweight breaking news feed (Yonhap & Google Breaking Headlines)
 */
async function fetchLightweightBreakingFeed() {
  const urls = [
    'https://www.yonhapnewstv.co.kr/browse/feed/',
    'https://news.google.com/rss/headlines/section/topic/NATION?hl=ko&gl=KR&ceid=KR:ko'
  ];

  const candidateArticles = [];

  for (const feedUrl of urls) {
    try {
      const res = await axios.get(feedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 4000
      });

      const xml = res.data;
      const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)];

      for (let i = 0; i < items.length && i < 10; i++) {
        const itemXml = items[i][0];
        const titleMatch = itemXml.match(/<title>(.*?)<\/title>/i);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
        const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
        const descMatch = itemXml.match(/<description>(.*?)<\/description>/i);

        if (titleMatch) {
          const title = cleanHtml(titleMatch[1]);
          const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
          const pubDate = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();
          const desc = descMatch ? cleanHtml(descMatch[1]) : '';

          // Only articles published within the last 45 minutes
          if (Date.now() - pubDate <= 45 * 60 * 1000) {
            candidateArticles.push({
              id: `breaking-${Buffer.from(title.slice(0, 30)).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`,
              title,
              link,
              contentSnippet: desc,
              source: '연합뉴스/주요속보',
              date: new Date(pubDate).toISOString(),
              category: '속보',
              categoryTag: '🚨 실시간 초긴급 속보',
              isBreakingNews: true
            });
          }
        }
      }
    } catch (e) {}
  }

  return candidateArticles;
}

/**
 * 🎯 Strict Breaking News Verification: Is this a TRULY critical breaking news?
 */
function isTrulyCriticalBreakingNews(article) {
  if (!article || !article.title) return false;
  const title = article.title.toLowerCase();

  // 1. Exclude trivia/gossip/sports/promotions
  for (const ex of EXCLUDE_TOPICS) {
    if (title.includes(ex.toLowerCase())) {
      return false;
    }
  }

  // 2. Must contain explicit breaking tag OR major crisis keywords
  const hasBreakingTag = title.includes('[속보]') || title.includes('[긴급]') || title.includes('[1보]') || title.includes('[2보]') || title.includes('(속보)') || title.includes('(긴급)') || title.includes('【속보】');
  
  let matchCount = 0;
  for (const kw of CRITICAL_BREAKING_KEYWORDS) {
    if (title.includes(kw.toLowerCase())) {
      matchCount++;
    }
  }

  // If explicit breaking tag exists + at least 1 critical topic, or multiple critical disaster/war/financial keywords
  if (hasBreakingTag && matchCount >= 1) return true;
  if (matchCount >= 2) return true;

  return false;
}

/**
 * 🚀 Execute lightweight real-time check & dispatch if critical
 */
async function checkAndSendRealtimeBreakingNews() {
  if (!canSendBreakingNews()) {
    return { success: false, reason: 'rate_limited_or_cooldown' };
  }

  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    return { success: false, reason: 'no_telegram_config' };
  }

  const candidates = await fetchLightweightBreakingFeed();
  if (candidates.length === 0) return { success: true, count: 0 };

  const log = getBreakingLog();
  const storedArticles = getStoredArticles();

  for (const cand of candidates) {
    // 1. Strict filter: Must be truly critical
    if (!isTrulyCriticalBreakingNews(cand)) continue;

    // 2. Duplicate check against past sent breaking log
    const alreadySent = log.some(l => isSimilarArticleTitle(l.title, cand.title));
    if (alreadySent) continue;

    // 3. Duplicate check against stored DB
    const isDbDuplicate = storedArticles.some(a => a.isTelegramSent && isSimilarArticleTitle(a.title, cand.title));
    if (isDbDuplicate) continue;

    // 🎯 Found a REAL critical breaking news!
    addLog('INFO', `🚨 [돌발 초긴급 속보 포착] "${cand.title}" -> 텔레그램 즉시 발송 시작`);

    try {
      // 1. Generate 3 Capture Cards
      let imageCards = null;
      let mediaMessageIds = [];
      try {
        imageCards = await generateAll3CaptureCards(cand);
        const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
        const validCards = [];
        if (imageCards.photoCard?.filepath && fs.existsSync(imageCards.photoCard.filepath)) {
          validCards.push({ path: imageCards.photoCard.filepath, label: '📸 1. [속보 캡처: 제목+사진]' });
        }
        if (imageCards.bodyCard?.filepath && fs.existsSync(imageCards.bodyCard.filepath)) {
          validCards.push({ path: imageCards.bodyCard.filepath, label: '📄 2. [속보 캡처: 제목+본문]' });
        }
        if (imageCards.titleCard?.filepath && fs.existsSync(imageCards.titleCard.filepath)) {
          validCards.push({ path: imageCards.titleCard.filepath, label: '📝 3. [속보 캡처: 제목만]' });
        }

        if (validCards.length > 0) {
          const mediaList = validCards.map((c, idx) => ({
            type: 'photo',
            media: `attach://photo_${idx}`,
            caption: c.label
          }));

          const buffers = [
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"\r\n\r\n${JSON.stringify(mediaList)}\r\n`)
          ];

          validCards.forEach((c, idx) => {
            const imgBuffer = fs.readFileSync(c.path);
            const filename = path.basename(c.path);
            buffers.push(
              Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo_${idx}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
              imgBuffer,
              Buffer.from(`\r\n`)
            );
          });

          buffers.push(Buffer.from(`--${boundary}--\r\n`));
          const bodyBuffer = Buffer.concat(buffers);

          const mediaRes = await axios.post(`https://api.telegram.org/bot${token}/sendMediaGroup`, bodyBuffer, {
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuffer.length },
            timeout: 20000
          });

          if (mediaRes.data?.result && Array.isArray(mediaRes.data.result)) {
            mediaMessageIds = mediaRes.data.result.map(m => m.message_id);
          }
        }
      } catch (imgErr) {}

      // 2. Generate Prompt & Action Button
      const issueResult = await generateHotIssueTweet(cand).catch(() => ({ text: `🚨 [초긴급 속보] "${cand.title}"\n\n현재 실시간 상황 파악 중입니다.` }));
      const tweetText = issueResult.text || issueResult;
      const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

      const formattedMessage = `🚨 <b>[실시간 초긴급 속보]</b> (국내외 주요 속보)\n\n` +
        `📝 <b>실시간 긴급 트윗 초안:</b>\n` +
        `<code>${tweetText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n\n` +
        `📌 <b>원본 속보:</b> ${cand.title}\n` +
        `🔗 <a href="${cand.link}">원문 기사 확인하기</a>\n\n` +
        `💡 <b>[🚀 𝕏에 바로 올리기]로 실시간 타임라인을 선점하세요!</b>`;

      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: '🚀 𝕏에 속보 바로 올리기 (자동입력) ↗', url: tweetIntentUrl }],
          [{ text: '🔗 원본 속보 기사 보기 ↗', url: cand.link }]
        ]
      };

      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: formattedMessage,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true
      }, { timeout: 10000 });

      // 3. Record in Log & DB
      log.push({
        id: cand.id,
        title: cand.title,
        sentAt: new Date().toISOString()
      });
      saveBreakingLog(log);

      cand.isTelegramSent = true;
      cand.sentAt = new Date().toISOString();
      storedArticles.unshift(cand);
      saveArticles(storedArticles);

      addLog('SUCCESS', `🚨 [초긴급 속보 즉시 발송 완료] "${cand.title}"`);
      return { success: true, sentArticle: cand.title };
    } catch (sendErr) {
      addLog('ERROR', `속보 전송 실패: ${sendErr.message}`);
    }
  }

  return { success: true, count: 0 };
}

module.exports = {
  checkAndSendRealtimeBreakingNews,
  canSendBreakingNews,
  isTrulyCriticalBreakingNews
};
