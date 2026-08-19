const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig } = require('../config');
const { 
  getStoredArticles, 
  markAsTelegramSent, 
  getTelegramQueueMap, 
  addLog 
} = require('../history');
const { generateSummary } = require('../summarizer');
const { generateCardNewsImage } = require('./cardNewsServerService');

let isWorkerRunning = false;

function getTelegramConfig() {
  const config = getConfig();
  // Use dedicated briefing bot if set, otherwise fallback to general bot
  const rawToken = process.env.TELEGRAM_BRIEFING_BOT_TOKEN || config.telegramBriefingBotToken || process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken;
  const rawChatId = process.env.TELEGRAM_BRIEFING_CHAT_ID || config.telegramBriefingChatId || process.env.TELEGRAM_CHAT_ID || config.telegramChatId;
  const token = (rawToken || '').toString().trim();
  const chatId = (rawChatId || '').toString().trim();
  const cleanToken = token.startsWith('bot') ? token.slice(3) : token;
  return { token: cleanToken, chatId };
}

/**
 * Check if current time is within quiet hours (00:00 ~ 06:59 KST)
 */
function isQuietHours() {
  const now = new Date();
  const kstHours = new Date(now.getTime() + (9 * 60 * 60 * 1000)).getUTCHours();
  // 00:00 to 06:59 (0, 1, 2, 3, 4, 5, 6)
  return kstHours >= 0 && kstHours < 7;
}

/**
 * Send photo with direct 1-Click X Web Intent Button to Telegram
 * Unlimited posting with 0-cost & 0-ban risk
 */
async function sendTelegramCardWithButtons(imagePath, caption, article) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    throw new Error('텔레그램 봇 토큰과 Chat ID가 설정되지 않았습니다.');
  }

  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const imageBuffer = fs.readFileSync(imagePath);
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;

  // Direct 1-Click X Web Intent URL (Includes article URL for auto photo preview card)
  const articleUrl = article.link || article.url || '';
  let tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`;
  if (articleUrl && !articleUrl.includes('heisenberg.kr/wp-json')) {
    tweetIntentUrl += `&url=${encodeURIComponent(articleUrl)}`;
  }


  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🚀 𝕏에 바로 올리기 (원클릭) ↗', url: tweetIntentUrl }
      ],
      [
        { text: '📰 기사 원문 보기 ↗', url: articleUrl }
      ]
    ]
  };

  // Truncate caption if exceeding Telegram photo caption limit (1024 chars)
  let safeCaption = caption;
  if (safeCaption.length > 950) {
    safeCaption = safeCaption.slice(0, 940) + '...';
  }

  const filename = path.basename(imagePath);

  let bodyBuffer = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${safeCaption}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n${JSON.stringify(inlineKeyboard)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const response = await axios.post(url, bodyBuffer, {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': bodyBuffer.length
    },
    timeout: 15000
  });

  return response.data;
}

/**
 * Select Top 5 diverse, non-duplicate pending articles
 * Covers: IT/AI, Coin, Stock/Economy, Community/Gossip/Blind
 */
function selectTop5DiversePendingArticles(maxCount = 5) {
  const articles = getStoredArticles();
  const queueMap = getTelegramQueueMap();

  // Filter only unsent articles with non-empty titles
  const unsent = articles.filter(a => !queueMap[a.id] && a.title && a.title.trim().length > 0);
  if (unsent.length === 0) return [];

  const itArticles = [];
  const coinArticles = [];
  const economyArticles = [];
  const commArticles = [];
  const otherArticles = [];

  unsent.forEach(art => {
    const cat = (art.category || '').toLowerCase();
    const tag = (art.categoryTag || '').toLowerCase();
    
    if (cat.includes('coin') || tag.includes('코인') || tag.includes('가상자산')) {
      coinArticles.push(art);
    } else if (cat.includes('stock') || cat.includes('economy') || tag.includes('주식') || tag.includes('경제')) {
      economyArticles.push(art);
    } else if (cat.includes('it') || cat.includes('tech') || cat.includes('heisenberg') || tag.includes('반도체') || tag.includes('ai')) {
      itArticles.push(art);
    } else if (cat.includes('blind') || cat.includes('gossip') || cat.includes('mindset') || cat.includes('idol') || cat.includes('comm')) {
      commArticles.push(art);
    } else {
      otherArticles.push(art);
    }
  });

  const selected = [];

  // Pick balanced top items
  if (itArticles.length > 0) selected.push(itArticles[0]);
  if (coinArticles.length > 0) selected.push(coinArticles[0]);
  if (economyArticles.length > 0) selected.push(economyArticles[0]);
  if (commArticles.length > 0) selected.push(commArticles[0]);

  // Second pass for depth
  if (selected.length < maxCount && itArticles.length > 1) selected.push(itArticles[1]);
  if (selected.length < maxCount && commArticles.length > 1) selected.push(commArticles[1]);
  if (selected.length < maxCount && economyArticles.length > 1) selected.push(economyArticles[1]);

  // Fill remaining slots from unsent pool
  for (const art of unsent) {
    if (selected.length >= maxCount) break;
    if (!selected.some(s => s.id === art.id)) {
      selected.push(art);
    }
  }

  return selected.slice(0, maxCount);
}

/**
 * Process a single article: generate summary + card image + send to telegram
 */
async function processAndSendArticle(article) {
  if (!article) return null;

  addLog('INFO', `🤖 [텔레그램 브리핑] 기사 카드뉴스 생성 중: "${article.title}"`);

  // 1. Generate AI Tweet Text (Hybrid / Reaction Mode)
  let tweetText = '';
  try {
    const summaryResult = await generateSummary(article, 'hybrid');
    tweetText = summaryResult.text || `${article.title}\n\n#테크 #인사이트`;
  } catch (err) {
    tweetText = `${article.title}\n\n#테크 #경제 #인사이트`;
  }

  // 2. Generate Server-side Card News (photo vs title mode)
  let cardResult = null;
  try {
    cardResult = await generateCardNewsImage(article);
    addLog('SUCCESS', `🎨 [텔레그램 브리핑] 카드뉴스 렌더링 완료 (${cardResult.mode} 모드): ${cardResult.filename}`);
  } catch (err) {
    console.error('Card news generation failed, using fallback:', err);
  }

  if (!cardResult || !cardResult.filepath) {
    throw new Error('카드뉴스 이미지 생성에 실패했습니다.');
  }

  // 3. Send to Telegram with Direct 1-Click X Intent Button
  const teleRes = await sendTelegramCardWithButtons(cardResult.filepath, tweetText, article);
  const messageId = teleRes.result?.message_id;

  // 4. Mark as sent in DB history
  markAsTelegramSent(article.id, {
    messageId,
    title: article.title,
    text: tweetText,
    imagePath: cardResult.filepath,
    mode: cardResult.mode
  });

  addLog('SUCCESS', `📱 [텔레그램 발송 완료] "${article.title.slice(0, 25)}..."`);
  return { success: true, articleId: article.id, messageId };
}

/**
 * Trigger Hourly Telegram Briefing (Sends Top 5 Diverse Articles)
 * Respects 00:00 ~ 06:59 KST Quiet Hours unless force=true
 */
async function triggerHourlyTelegramBriefing(force = false) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    return { success: false, message: '텔레그램 봇 토큰 또는 Chat ID가 설정되지 않았습니다.' };
  }

  if (!force && isQuietHours()) {
    addLog('INFO', '🌙 [텔레그램 야간 정적 모드] 00:00 ~ 07:00 KST 사이에는 취침 방해 방지를 위해 발송을 건너뜁니다.');
    return { success: true, skipped: true, reason: 'quiet_hours' };
  }

  const top5Articles = selectTop5DiversePendingArticles(5);
  if (top5Articles.length === 0) {
    addLog('INFO', '⏰ [1시간 텔레그램 브리핑] 발송할 새로운 미발행 기사가 없습니다.');
    return { success: true, count: 0 };
  }

  addLog('INFO', `🚀 [1시간 텔레그램 브리핑] 엄선된 핵심 기사 ${top5Articles.length}건 순차 발송을 시작합니다...`);

  let sentCount = 0;
  for (const article of top5Articles) {
    try {
      await processAndSendArticle(article);
      sentCount++;
      // 1.5 second interval between messages to respect Telegram limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      addLog('ERROR', `텔레그램 개별 발송 실패: ${err.message}`);
    }
  }

  addLog('SUCCESS', `🎉 [1시간 텔레그램 브리핑 완료] 총 ${sentCount}건의 핵심 기사 카드뉴스를 발송했습니다.`);
  return { success: true, count: sentCount };
}

/**
 * Initialize Telegram Service Worker
 */
function initTelegramQueueWorker() {
  isWorkerRunning = true;
  addLog('SUCCESS', '🚀 [텔레그램 브리핑 서비스 가동] 정각 1시간 브리핑 대기 중 (07:00~23:00 운영, 무제한 원클릭 포스팅 지원)');
}

/**
 * Stop Telegram Service Worker
 */
function stopTelegramQueueWorker() {
  isWorkerRunning = false;
  addLog('INFO', '⏸️ [텔레그램 브리핑 서비스] 일시 중지되었습니다.');
}

function isQueueActive() {
  return isWorkerRunning;
}

module.exports = {
  initTelegramQueueWorker,
  stopTelegramQueueWorker,
  isQueueActive,
  triggerHourlyTelegramBriefing,
  processAndSendArticle,
  sendTelegramCardWithButtons,
  selectTop5DiversePendingArticles,
  isQuietHours
};
