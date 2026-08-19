const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig } = require('../config');
const { 
  getStoredArticles, 
  markAsTelegramSent, 
  getTelegramQueueMap, 
  markPostingStatus,
  addLog 
} = require('../history');
const { generateSummary } = require('../summarizer');
const { generateCardNewsImage } = require('./cardNewsServerService');

let pollingInterval = null;
let lastUpdateId = 0;
let isPollingActive = false;
let isWorkerRunning = false;

// In-memory cache for pending telegram messages: { [articleId]: { text, imagePath, messageId, article } }
const pendingPostsCache = new Map();

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
 * Send photo with action buttons to Telegram
 */
async function sendTelegramCardWithButtons(imagePath, caption, article) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    throw new Error('텔레그램 봇 토큰과 Chat ID가 설정되지 않았습니다.');
  }

  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const imageBuffer = fs.readFileSync(imagePath);
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🚀 𝕏에 올리기 (승인)', callback_data: `post_x:${article.id}` },
        { text: '🗑️ 건너뛰기', callback_data: `skip_x:${article.id}` }
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
 * Edit message caption and inline keyboard
 */
async function editTelegramCaption(chatId, messageId, newCaption, inlineKeyboard = []) {
  const { token } = getTelegramConfig();
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/editMessageCaption`;
  try {
    let safeCaption = newCaption;
    if (safeCaption.length > 950) {
      safeCaption = safeCaption.slice(0, 940) + '...';
    }

    await axios.post(url, {
      chat_id: chatId,
      message_id: messageId,
      caption: safeCaption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    }, { timeout: 8000 });
  } catch (err) {
    console.error('Failed to edit telegram message caption:', err.message);
  }
}

/**
 * Answer Telegram callback query
 */
async function answerTelegramCallback(callbackQueryId, text = '', showAlert = false) {
  const { token } = getTelegramConfig();
  if (!token) return;
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    await axios.post(url, {
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: showAlert
    }, { timeout: 5000 });
  } catch (e) {}
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

  // 2. Generate Server-side Card News (100% Photo + Title format)
  let cardResult = null;
  try {
    cardResult = await generateCardNewsImage(article);
    addLog('SUCCESS', `🎨 [텔레그램 브리핑] 카드뉴스 렌더링 완료: ${cardResult.filename}`);
  } catch (err) {
    console.error('Card news generation failed, using fallback:', err);
  }

  if (!cardResult || !cardResult.filepath) {
    throw new Error('카드뉴스 이미지 생성에 실패했습니다.');
  }

  // 3. Send to Telegram with Interactive Buttons
  const teleRes = await sendTelegramCardWithButtons(cardResult.filepath, tweetText, article);
  const messageId = teleRes.result?.message_id;

  // 4. Save to pending post cache
  pendingPostsCache.set(String(article.id), {
    articleId: article.id,
    title: article.title,
    text: tweetText,
    imagePath: cardResult.filepath,
    imageUrl: cardResult.url,
    link: article.link || article.url || '',
    messageId,
    timestamp: Date.now()
  });

  // 5. Mark as sent in DB history
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
 * Handle Telegram button callback clicks (🚀 𝕏에 올리기 / 🗑️ 건너뛰기)
 */
async function handleTelegramCallbackQuery(callbackQuery) {
  const data = callbackQuery.data || '';
  const messageId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;
  const callbackQueryId = callbackQuery.id;

  if (data.startsWith('post_x:')) {
    const articleId = data.replace('post_x:', '');

    let pending = pendingPostsCache.get(String(articleId));
    if (!pending) {
      const queueMap = getTelegramQueueMap();
      const stored = queueMap[articleId];
      if (stored) {
        pending = {
          articleId,
          text: stored.text,
          imagePath: stored.imagePath,
          imageUrl: `/thumbnails/${path.basename(stored.imagePath || '')}`
        };
      }
    }

    if (!pending || !pending.text) {
      await answerTelegramCallback(callbackQueryId, '⚠️ 포스팅 데이터를 찾을 수 없습니다.');
      return;
    }

    // Direct X Web Intent URL (Pure Tweet Text Only - No Article Link)
    const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(pending.text)}`;

    // Mark as Posted with checkmark in caption
    const postedCaption = `✅ <b>[𝕏에 올림 완료]</b>\n\n${pending.text}`;

    const newKeyboard = [
      [
        { text: '🌐 𝕏 작성창으로 이동 (글 자동입력) ↗', url: tweetIntentUrl }
      ],
      [
        { text: '📰 기사 원문 보기 ↗', url: pending.link || 'https://x.com' }
      ]
    ];


    await editTelegramCaption(chatId, messageId, postedCaption, newKeyboard);
    await answerTelegramCallback(callbackQueryId, '✅ [𝕏에 올림] 처리되었습니다! 작성창 버튼을 눌러 바로 발행하세요.');
    
    markPostingStatus(articleId, 'tweet');
    addLog('SUCCESS', `🎉 [텔레그램 승인] 𝕏 올림 완료 마킹: ${articleId}`);

  } else if (data.startsWith('skip_x:')) {
    const articleId = data.replace('skip_x:', '');
    await answerTelegramCallback(callbackQueryId, '🗑️ 건너뛰기 완료');
    await editTelegramCaption(chatId, messageId, `🗑️ <b>[건너뜀]</b> 해당 기사는 스킵되었습니다.`, []);
    addLog('INFO', `⏭️ [텔레그램 승인] 기사 스킵 처리됨: ${articleId}`);
  }
}

/**
 * Start Telegram Long Polling to listen for button clicks
 */
async function pollTelegramUpdates() {
  if (!isPollingActive) return;
  const { token } = getTelegramConfig();
  if (!token) {
    setTimeout(pollTelegramUpdates, 5000);
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`;
    const response = await axios.get(url, { timeout: 15000 });
    const updates = response.data?.result || [];

    for (const update of updates) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      if (update.callback_query) {
        await handleTelegramCallbackQuery(update.callback_query);
      }
    }
  } catch (err) {
    // Network or timeout errors in polling are normal
  }

  if (isPollingActive) {
    setTimeout(pollTelegramUpdates, 1500);
  }
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
  stopTelegramQueueWorker();

  isPollingActive = true;
  isWorkerRunning = true;

  // Start Long Polling for button clicks
  pollTelegramUpdates();

  addLog('SUCCESS', '🚀 [텔레그램 브리핑 서비스 가동] 실시간 버튼 상호작용 및 정각 브리핑 대기 중 (07:00~23:00 운영)');
}

/**
 * Stop Telegram Service Worker
 */
function stopTelegramQueueWorker() {
  isPollingActive = false;
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
