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
const { generateSummary, generateTwitterSmallTalk, generateHotIssueTweet } = require('../summarizer');
const { generateAll3CaptureCards } = require('./cardNewsServerService');

let pollingInterval = null;
let lastUpdateId = 0;
let isPollingActive = false;
let isWorkerRunning = false;

// In-memory cache for pending telegram messages: { [id]: { text, type, article } }
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
 * Send 3 Capture Cards as a Telegram Media Group Album (📸 제목+사진 / 📝 제목+본문 / 📄 제목만)
 */
async function sendTelegramCaptureMediaGroup(imageCards, articleTitle) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) return null;

  try {
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const url = `https://api.telegram.org/bot${token}/sendMediaGroup`;

    const mediaList = [];
    const validCards = [];

    if (imageCards.photoCard?.filepath && fs.existsSync(imageCards.photoCard.filepath)) {
      validCards.push({ path: imageCards.photoCard.filepath, label: '📸 1. [기사 캡처: 제목+사진]' });
    }
    if (imageCards.bodyCard?.filepath && fs.existsSync(imageCards.bodyCard.filepath)) {
      validCards.push({ path: imageCards.bodyCard.filepath, label: '📝 2. [기사 캡처: 제목+본문]' });
    }
    if (imageCards.titleCard?.filepath && fs.existsSync(imageCards.titleCard.filepath)) {
      validCards.push({ path: imageCards.titleCard.filepath, label: '📄 3. [기사 캡처: 제목만]' });
    }

    if (validCards.length === 0) return null;

    validCards.forEach((c, idx) => {
      mediaList.push({
        type: 'photo',
        media: `attach://photo_${idx}`,
        caption: c.label
      });
    });

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

    const res = await axios.post(url, bodyBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      },
      timeout: 20000
    });

    return res.data;
  } catch (err) {
    console.error('Failed to send telegram media group:', err.message);
    return null;
  }
}

/**
 * Send text message with action buttons to Telegram
 */
async function sendTelegramTextMessage({ titleHeader, tweetText, id, type, originalTitle, originalLink }) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    throw new Error('텔레그램 봇 토큰과 Chat ID가 설정되지 않았습니다.');
  }

  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🚀 𝕏에 바로 올리기 (글 자동입력) ↗', url: tweetIntentUrl }
      ],
      [
        { text: '✅ 𝕏 올림 완료 마킹', callback_data: `post_x:${id}` },
        { text: '🗑️ 건너뛰기', callback_data: `skip_x:${id}` }
      ]
    ]
  };

  if (originalLink) {
    inlineKeyboard.inline_keyboard.push([
      { text: '📰 관련 기사/원문 보기 ↗', url: originalLink }
    ]);
  }

  let formattedMessage = `${titleHeader}\n\n`;
  formattedMessage += `━━━━━━━━━━━━━━━━━━━━━\n`;
  formattedMessage += `${tweetText}\n`;
  formattedMessage += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (originalTitle) {
    formattedMessage += `📌 <i>참고: ${originalTitle.slice(0, 45)}...</i>\n`;
  }
  formattedMessage += `💡 <b>위 3종 캡처 카드(제목+사진/제목+본문/제목만) 중 원하는 이미지를 선택하여 저장 후 함께 올려보세요!</b>`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await axios.post(url, {
    chat_id: chatId,
    text: formattedMessage,
    parse_mode: 'HTML',
    reply_markup: inlineKeyboard,
    disable_web_page_preview: true
  }, { timeout: 10000 });

  return response.data;
}

/**
 * Edit message text and inline keyboard
 */
async function editTelegramMessageText(chatId, messageId, newText, inlineKeyboard = []) {
  const { token } = getTelegramConfig();
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
      disable_web_page_preview: true
    }, { timeout: 8000 });
  } catch (err) {
    console.error('Failed to edit telegram message text:', err.message);
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
 * Select 1 best pending real-time issue article (Gossip, Crime/Accident, War, Entertainment, Community, Tech)
 */
function selectNextPendingArticle() {
  const articles = getStoredArticles();
  const queueMap = getTelegramQueueMap();

  // Filter only unsent articles with valid titles
  const unsent = articles.filter(a => !queueMap[a.id] && a.title && a.title.trim().length > 0);
  if (unsent.length === 0) return null;

  // Priority: Community/Gossip/Blind/Nate/War/Crime first, then IT/Stock/General
  const priorityArticles = unsent.filter(a => {
    const text = `${a.title} ${a.category || ''} ${a.categoryTag || ''}`.toLowerCase();
    return text.includes('커뮤니티') || text.includes('네이트판') || text.includes('블라인드') ||
           text.includes('더쿠') || text.includes('사건') || text.includes('사고') || 
           text.includes('전쟁') || text.includes('논란') || text.includes('단독') || 
           text.includes('충격') || text.includes('폭로') || text.includes('연예');
  });

  if (priorityArticles.length > 0) {
    return priorityArticles[0];
  }

  return unsent[0];
}

/**
 * Handle Telegram button callback clicks (✅ 𝕏 올림 완료 / 🗑️ 건너뛰기)
 */
async function handleTelegramCallbackQuery(callbackQuery) {
  const data = callbackQuery.data || '';
  const messageId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;
  const callbackQueryId = callbackQuery.id;

  if (data.startsWith('post_x:')) {
    const id = data.replace('post_x:', '');
    let pending = pendingPostsCache.get(String(id));

    const tweetText = pending?.text || '𝕏에 게시된 콘텐츠';
    const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

    const postedText = `✅ <b>[𝕏에 올림 완료]</b>\n\n━━━━━━━━━━━━━━━━━━━━━\n${tweetText}\n━━━━━━━━━━━━━━━━━━━━━\n🎉 X(트위터) 게시 완료 상태로 전환되었습니다.`;

    const newKeyboard = [
      [
        { text: '🌐 𝕏 작성창 다시 열기 ↗', url: tweetIntentUrl }
      ]
    ];

    await editTelegramMessageText(chatId, messageId, postedText, newKeyboard);
    await answerTelegramCallback(callbackQueryId, '✅ [𝕏에 올림 완료]로 마킹되었습니다!');
    
    markPostingStatus(id, 'tweet');
    addLog('SUCCESS', `🎉 [텔레그램 승인] 𝕏 올림 완료 마킹: ${id}`);

  } else if (data.startsWith('skip_x:')) {
    const id = data.replace('skip_x:', '');
    await answerTelegramCallback(callbackQueryId, '🗑️ 건너뛰기 완료');
    await editTelegramMessageText(chatId, messageId, `🗑️ <b>[건너뜀]</b> 해당 트윗 멘트는 스킵되었습니다.`, []);
    addLog('INFO', `⏭️ [텔레그램 승인] 트윗 스킵 처리됨: ${id}`);
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
 * ⏱️ Trigger 10-Minute Telegram Briefing (Sends 3 Capture Cards + Real-time Issue or Small Talk)
 * Strictly respects 00:00 ~ 06:59 KST Quiet Hours unless force=true
 */
async function triggerTenMinuteBriefing(force = false) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    return { success: false, message: '텔레그램 봇 토큰 또는 Chat ID가 설정되지 않았습니다.' };
  }

  // 🌙 Strict Quiet Hours Check: 00:00 ~ 06:59 KST
  if (!force && isQuietHours()) {
    addLog('INFO', '🌙 [텔레그램 야간 정적 모드] 00:00 ~ 07:00 KST 사이에는 취침 방해 방지를 위해 발송을 건너뜁니다.');
    return { success: true, skipped: true, reason: 'quiet_hours' };
  }

  addLog('INFO', '⏱️ [10분 주기 실시간 트윗 탐색] 실시간 핫이슈 및 3종 캡처 카드 검토 중...');

  const article = selectNextPendingArticle();

  let titleHeader = '';
  let tweetText = '';
  let itemId = '';
  let originalTitle = '';
  let originalLink = '';

  if (article) {
    // 1. Generate 3 Capture Cards in parallel (📸 제목+사진 / 📝 제목+본문 / 📄 제목만)
    try {
      addLog('INFO', `📸 [카드뉴스 3종 캡처 생성 중] "${article.title.slice(0, 25)}..."`);
      const imageCards = await generateAll3CaptureCards(article);
      await sendTelegramCaptureMediaGroup(imageCards, article.title);
    } catch (imgErr) {
      console.error('Failed to generate/send 3 capture cards:', imgErr.message);
    }

    // 2. Generate engaging, likeable, balanced Twitter prompt (Style 1 or Style 2)
    try {
      const issueResult = await generateHotIssueTweet(article);
      tweetText = issueResult.text || issueResult;
    } catch (e) {
      const cleanTitle = (article.title || '').replace(/\[.*?\]/g, '').trim();
      tweetText = `오늘 "${cleanTitle}" 소식 보는데...\n\n취지는 알겠지만 당장 현실에서 어떻게 풀어나갈지가 관건일 듯하네요.\n\n다들 이 이슈 어떻게 보고 계신가요? 🤔`;
    }

    itemId = String(article.id);
    originalTitle = article.title;
    originalLink = article.link || '';
    titleHeader = `🔥 <b>[실시간 핫이슈 트윗 멘트]</b> (${article.categoryTag || article.category || '실시간'})`;

    // Mark in history queue map
    markAsTelegramSent(article.id, {
      text: tweetText,
      articleTitle: article.title,
      type: 'hot_issue'
    });
  } else {
    // 3. No new issue or duplicates -> Generate Twitter Small Talk / Banter (엑친 소통 멘트)
    const smallTalk = await generateTwitterSmallTalk();
    tweetText = smallTalk.text;
    itemId = `smalltalk_${Date.now()}`;
    titleHeader = `💬 <b>[엑친 소통 / 스몰톡 멘트]</b> (답글 유도)`;

    // Store in queue map
    markAsTelegramSent(itemId, {
      text: tweetText,
      articleTitle: '엑친 소통 스몰톡',
      type: 'small_talk'
    });
  }

  // Cache in memory
  pendingPostsCache.set(itemId, {
    text: tweetText,
    id: itemId,
    title: originalTitle
  });

  // Send message to Telegram
  const sendRes = await sendTelegramTextMessage({
    titleHeader,
    tweetText,
    id: itemId,
    type: article ? 'issue' : 'smalltalk',
    originalTitle,
    originalLink
  });

  const messageId = sendRes.result?.message_id;
  addLog('SUCCESS', `📱 [10분 텔레그램 발송 완료] ${titleHeader.replace(/<[^>]*>/g, '')} - "${tweetText.slice(0, 25)}..." (3종 캡처 앨범 동시 발송)`);

  return { 
    success: true, 
    itemId, 
    messageId, 
    type: article ? 'hot_issue' : 'small_talk',
    tweetText 
  };
}

/**
 * Backwards compatibility wrapper for hourly trigger
 */
async function triggerHourlyTelegramBriefing(force = false) {
  return triggerTenMinuteBriefing(force);
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

  addLog('SUCCESS', '🚀 [텔레그램 10분 실시간 브리핑 가동] 3종 캡처 카드 & 호감형 트윗 멘트 발송 대기 중 (07:00~23:59 운영)');
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
  triggerTenMinuteBriefing,
  triggerHourlyTelegramBriefing,
  isQuietHours
};
