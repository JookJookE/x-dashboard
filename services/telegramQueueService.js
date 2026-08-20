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
const { 
  generateSummary, 
  generateTwitterSmallTalk, 
  generateHotIssueTweet, 
  generatePollTweet, 
  generateThreadTweet 
} = require('../summarizer');
const { isSimilarArticleTitle } = require('../scraper');
const { generateAll3CaptureCards } = require('./cardNewsServerService');

let pollingInterval = null;
let lastUpdateId = 0;
let isPollingActive = false;
let isWorkerRunning = false;

// In-memory cache for pending telegram messages: { [id]: { text, type, article, mediaMessageIds, textMessageId } }
const pendingPostsCache = new Map();

function getTelegramConfig() {
  const config = getConfig();
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
  return kstHours >= 0 && kstHours < 7;
}

/**
 * ⏰ Detect Twitter Traffic Peak Time (Golden Hour in KST)
 */
function getGoldenHourInfo() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const hours = kst.getUTCHours();
  const minutes = kst.getUTCMinutes();
  const timeVal = hours + (minutes / 60);

  // 1. Morning Commute: 07:30 ~ 09:00 (7.5 ~ 9.0)
  if (timeVal >= 7.5 && timeVal <= 9.0) {
    return { isGolden: true, label: '🌅 [골든타임: 출근길 피크]', tag: '🔥 출근길 트래픽 폭발' };
  }
  // 2. Lunch Peak: 11:50 ~ 13:00 (11.83 ~ 13.0)
  if (timeVal >= 11.83 && timeVal <= 13.0) {
    return { isGolden: true, label: '🍱 [골든타임: 점심시간 피크]', tag: '🔥 점심시간 피드 폭발' };
  }
  // 3. Evening Commute: 18:00 ~ 19:30 (18.0 ~ 19.5)
  if (timeVal >= 18.0 && timeVal <= 19.5) {
    return { isGolden: true, label: '🚇 [골든타임: 퇴근길 피크]', tag: '🔥 퇴근길 도파민 피크' };
  }
  // 4. Night Golden Hour: 22:30 ~ 24:00 (22.5 ~ 24.0)
  if (timeVal >= 22.5 && timeVal < 24.0) {
    return { isGolden: true, label: '🌙 [골든타임: 심야 감성 피크]', tag: '🔥 심야 타임라인 피크' };
  }

  return { isGolden: false, label: '', tag: '' };
}

/**
 * Delete a message from Telegram chat
 */
async function deleteTelegramMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  const { token } = getTelegramConfig();
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/deleteMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      message_id: messageId
    }, { timeout: 6000 });
  } catch (err) {}
}

/**
 * Send 3 Capture Cards as a Telegram Media Group Album (📸 제목+사진 / 📄 제목+본문 / 📝 제목만)
 * Returns array of created message_ids
 */
async function sendTelegramCaptureMediaGroup(imageCards, articleTitle) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) return [];

  try {
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const url = `https://api.telegram.org/bot${token}/sendMediaGroup`;

    const mediaList = [];
    const validCards = [];

    if (imageCards.photoCard?.filepath && fs.existsSync(imageCards.photoCard.filepath)) {
      validCards.push({ path: imageCards.photoCard.filepath, label: '📸 1. [기사 캡처: 제목+사진]' });
    }
    if (imageCards.bodyCard?.filepath && fs.existsSync(imageCards.bodyCard.filepath)) {
      validCards.push({ path: imageCards.bodyCard.filepath, label: '📄 2. [기사 캡처: 제목+본문]' });
    }
    if (imageCards.titleCard?.filepath && fs.existsSync(imageCards.titleCard.filepath)) {
      validCards.push({ path: imageCards.titleCard.filepath, label: '📝 3. [기사 캡처: 제목만]' });
    }

    if (validCards.length === 0) return [];

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

    if (res.data?.result && Array.isArray(res.data.result)) {
      return res.data.result.map(m => m.message_id);
    }
    return [];
  } catch (err) {
    console.error('Failed to send telegram media group:', err.message);
    return [];
  }
}

/**
 * Send text message with action buttons to Telegram
 */
async function sendTelegramTextMessage({ titleHeader, tweetText, id, type, originalTitle, originalLink, pollInfo, threadInfo }) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    throw new Error('텔레그램 봇 토큰과 Chat ID가 설정되지 않았습니다.');
  }

  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🚀 𝕏에 바로 올리기 (글 자동입력) ↗', url: tweetIntentUrl }
      ]
    ]
  };

  // Add Thread & Poll intent options if available
  const subRow = [];
  if (pollInfo?.tweetText) {
    const pollText = `${pollInfo.tweetText}\n\n[투표 항목]\n` + pollInfo.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    const pollIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(pollText)}`;
    subRow.push({ text: '🗳️ 투표형으로 올리기 ↗', url: pollIntentUrl });
  }
  if (threadInfo?.tweet1) {
    const threadIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(threadInfo.tweet1)}`;
    subRow.push({ text: '🧵 스레드 1편 올리기 ↗', url: threadIntentUrl });
  }
  if (subRow.length > 0) {
    inlineKeyboard.inline_keyboard.push(subRow);
  }

  inlineKeyboard.inline_keyboard.push([
    { text: '✅ 𝕏 올림 완료 (사진 정리)', callback_data: `post_x:${id}` },
    { text: '🗑️ 건너뛰기', callback_data: `skip_x:${id}` }
  ]);

  if (originalLink) {
    inlineKeyboard.inline_keyboard.push([
      { text: '📰 관련 기사/원문 보기 ↗', url: originalLink }
    ]);
  }

  const goldenInfo = getGoldenHourInfo();

  let formattedMessage = '';
  if (goldenInfo.isGolden) {
    formattedMessage += `${goldenInfo.label}\n`;
  }
  formattedMessage += `${titleHeader}\n\n`;
  formattedMessage += `━━━━━━━━━━━━━━━━━━━━━\n`;
  formattedMessage += `${tweetText}\n`;
  formattedMessage += `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (pollInfo?.options && pollInfo.options.length > 0) {
    formattedMessage += `🗳️ <b>[추천 X 투표 선택지]</b>:\n`;
    pollInfo.options.forEach((opt, idx) => {
      formattedMessage += `   ${idx + 1}️⃣ ${opt}\n`;
    });
    formattedMessage += `\n`;
  }

  if (originalTitle) {
    formattedMessage += `📌 <i>참고: ${originalTitle.slice(0, 45)}...</i>\n`;
  }
  formattedMessage += `💡 <b>[🚀 𝕏에 바로 올리기]로 게시 후 [✅ 𝕏 올림 완료]를 누르면 사진이 깔끔하게 자동 정리됩니다.</b>`;

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
 * 🛡️ Select 1 best pending real-time issue article
 * - 100% Cross-Press Semantic Deduplication: Ignores articles with same event/content from other press within 24h
 * - Detects Breaking News if covered simultaneously by >= 3 press
 */
function selectNextPendingArticle() {
  const articles = getStoredArticles();
  const queueMap = getTelegramQueueMap();

  // 1. Gather all article titles sent within the last 24 hours
  const now = Date.now();
  const sentArticleTitles = [];
  Object.values(queueMap).forEach(q => {
    if (q.sentAt && (now - new Date(q.sentAt).getTime()) < 24 * 60 * 60 * 1000) {
      if (q.articleTitle) sentArticleTitles.push(q.articleTitle);
    }
  });

  // 2. Filter unsent articles with valid titles and NO cross-press content duplicate
  const unsent = articles.filter(a => {
    if (queueMap[a.id]) return false;
    if (!a.title || a.title.trim().length === 0) return false;

    // Cross-press duplicate check against recently sent articles
    const isDuplicateContent = sentArticleTitles.some(sentTitle => isSimilarArticleTitle(sentTitle, a.title));
    if (isDuplicateContent) {
      return false; // Skip duplicate topic from other media!
    }

    return true;
  });

  if (unsent.length === 0) return null;

  // 3. Priority topics (Gossip, Blind, Nate Pann, Crime/Accident, War, Entertainment, Tech)
  const priorityArticles = unsent.filter(a => {
    const text = `${a.title} ${a.category || ''} ${a.categoryTag || ''}`.toLowerCase();
    return text.includes('커뮤니티') || text.includes('네이트판') || text.includes('블라인드') ||
           text.includes('더쿠') || text.includes('사건') || text.includes('사고') || 
           text.includes('전쟁') || text.includes('논란') || text.includes('단독') || 
           text.includes('충격') || text.includes('폭로') || text.includes('연예');
  });

  const selected = priorityArticles.length > 0 ? priorityArticles[0] : unsent[0];

  // 4. Check if it is a Breaking Mega Issue (Covered by >= 3 different press in stored DB)
  const similarCount = articles.filter(other => isSimilarArticleTitle(other.title, selected.title)).length;
  if (similarCount >= 3) {
    selected.isBreakingNews = true;
  }

  return selected;
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
    if (!pending) {
      const queueMap = getTelegramQueueMap();
      pending = queueMap[id];
    }

    // 1. Delete photo album: Try explicit mediaMessageIds FIRST + Preceding Fallback
    let mediaIdsToDelete = [];
    if (pending?.mediaMessageIds && Array.isArray(pending.mediaMessageIds) && pending.mediaMessageIds.length > 0) {
      mediaIdsToDelete = pending.mediaMessageIds;
    } else if (messageId) {
      mediaIdsToDelete = [messageId - 1, messageId - 2, messageId - 3, messageId - 4];
    }

    for (const mId of mediaIdsToDelete) {
      await deleteTelegramMessage(chatId, mId);
    }

    const tweetText = pending?.text || (callbackQuery.message?.text?.split('━━━━━━━━━━━━━━━━━━━━━')?.[1]?.trim()) || '𝕏에 게시된 콘텐츠';
    const originalTitle = pending?.articleTitle || pending?.title || '';
    const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

    let postedText = `✅ <b>[𝕏에 올림 완료]</b>\n\n`;
    if (originalTitle) {
      postedText += `📌 <b>${originalTitle}</b>\n`;
    }
    postedText += `━━━━━━━━━━━━━━━━━━━━━\n${tweetText}\n━━━━━━━━━━━━━━━━━━━━━\n🎉 X(트위터) 게시 완료 상태로 전환되었습니다. (사진 정리됨)`;

    const newKeyboard = [
      [
        { text: '🌐 𝕏 작성창 다시 열기 ↗', url: tweetIntentUrl }
      ]
    ];

    // 2. Edit text message to concise completed state with reopen button
    await editTelegramMessageText(chatId, messageId, postedText, newKeyboard);
    await answerTelegramCallback(callbackQueryId, '✅ [𝕏 올림 완료]로 마킹되었습니다! (사진 정리됨)', false);
    
    // 3. Update status in database & history
    markPostingStatus(id, 'tweet');
    addLog('SUCCESS', `🎉 [텔레그램 승인 & 사진 정리 완료] 𝕏 올림 마킹: ${id}`);

  } else if (data.startsWith('skip_x:')) {
    const id = data.replace('skip_x:', '');
    let pending = pendingPostsCache.get(String(id));
    if (!pending) {
      const queueMap = getTelegramQueueMap();
      pending = queueMap[id];
    }

    // 1. Delete photos
    let mediaIdsToDelete = [];
    if (pending?.mediaMessageIds && Array.isArray(pending.mediaMessageIds) && pending.mediaMessageIds.length > 0) {
      mediaIdsToDelete = pending.mediaMessageIds;
    } else if (messageId) {
      mediaIdsToDelete = [messageId - 1, messageId - 2, messageId - 3, messageId - 4];
    }

    for (const mId of mediaIdsToDelete) {
      await deleteTelegramMessage(chatId, mId);
    }

    const originalTitle = pending?.articleTitle || pending?.title || '';
    let skippedText = `🗑️ <b>[건너뜀]</b> 해당 트윗 멘트는 스킵되었습니다.`;
    if (originalTitle) {
      skippedText += `\n📌 <i>${originalTitle}</i>`;
    }

    // 2. Edit text message to skipped state
    await editTelegramMessageText(chatId, messageId, skippedText, []);
    await answerTelegramCallback(callbackQueryId, '🗑️ 건너뛰기 완료', false);
    addLog('INFO', `⏭️ [텔레그램 스킵 & 사진 정리 완료] ${id}`);
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
  } catch (err) {}

  if (isPollingActive) {
    setTimeout(pollTelegramUpdates, 1500);
  }
}

/**
 * ⏱️ Trigger 10-Minute Telegram Briefing
 */
async function triggerTenMinuteBriefing(force = false) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    return { success: false, message: '텔레그램 봇 토큰 또는 Chat ID가 설정되지 않았습니다.' };
  }

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
  let mediaMessageIds = [];
  let pollInfo = null;
  let threadInfo = null;

  if (article) {
    // 1. Generate 3 Capture Cards in parallel (📸 제목+사진 / 📄 제목+본문 / 📝 제목만)
    try {
      addLog('INFO', `📸 [카드뉴스 3종 캡처 생성 중] "${article.title.slice(0, 25)}..."`);
      const imageCards = await generateAll3CaptureCards(article);
      mediaMessageIds = await sendTelegramCaptureMediaGroup(imageCards, article.title);
    } catch (imgErr) {
      console.error('Failed to generate/send 3 capture cards:', imgErr.message);
    }

    // 2. Generate engaging tweet + Poll + Thread in parallel
    try {
      const [issueResult, pRes, tRes] = await Promise.all([
        generateHotIssueTweet(article).catch(() => ({ text: `오늘 "${article.title}" 소식 보는데 다들 어떻게 생각하시나요? 🤔` })),
        generatePollTweet(article).catch(() => null),
        generateThreadTweet(article).catch(() => null)
      ]);
      tweetText = issueResult.text || issueResult;
      pollInfo = pRes;
      threadInfo = tRes;
    } catch (e) {
      const cleanTitle = (article.title || '').replace(/\[.*?\]/g, '').trim();
      tweetText = `오늘 "${cleanTitle}" 소식 보는데...\n\n다들 이 이슈 어떻게 보고 계신가요? 🤔`;
    }

    itemId = String(article.id);
    originalTitle = article.title;
    originalLink = article.link || '';

    if (article.isBreakingNews) {
      titleHeader = `🚨 <b>[초긴급 속보 감지]</b> (${article.categoryTag || article.category || '실시간'})`;
    } else {
      titleHeader = `🔥 <b>[실시간 핫이슈 트윗 멘트]</b> (${article.categoryTag || article.category || '실시간'})`;
    }
  } else {
    // 3. Small Talk
    const smallTalk = await generateTwitterSmallTalk();
    tweetText = smallTalk.text;
    itemId = `smalltalk_${Date.now()}`;
    titleHeader = `💬 <b>[소통 / 스몰톡 멘트]</b> (답글 유도)`;
  }

  // Send text message to Telegram
  const sendRes = await sendTelegramTextMessage({
    titleHeader,
    tweetText,
    id: itemId,
    type: article ? 'issue' : 'smalltalk',
    originalTitle,
    originalLink,
    pollInfo,
    threadInfo
  });

  const textMessageId = sendRes.result?.message_id;

  // Persist in DB
  markAsTelegramSent(itemId, {
    text: tweetText,
    articleTitle: originalTitle || '소통 스몰톡',
    type: article ? 'hot_issue' : 'small_talk',
    mediaMessageIds,
    textMessageId
  });

  // Cache in memory
  pendingPostsCache.set(itemId, {
    text: tweetText,
    id: itemId,
    title: originalTitle,
    articleTitle: originalTitle,
    mediaMessageIds,
    textMessageId
  });

  addLog('SUCCESS', `📱 [10분 텔레그램 발송 완료] ${titleHeader.replace(/<[^>]*>/g, '')} - "${tweetText.slice(0, 25)}..."`);

  return { 
    success: true, 
    itemId, 
    messageId: textMessageId, 
    type: article ? 'hot_issue' : 'small_talk',
    tweetText 
  };
}

async function triggerHourlyTelegramBriefing(force = false) {
  return triggerTenMinuteBriefing(force);
}

function initTelegramQueueWorker() {
  stopTelegramQueueWorker();
  isPollingActive = true;
  isWorkerRunning = true;
  pollTelegramUpdates();
  addLog('SUCCESS', '🚀 [텔레그램 10분 실시간 브리핑 가동] 3종 캡처 카드 & 중복 필터링 엔진 대기 중 (07:00~23:59 운영)');
}

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
  isQuietHours,
  getGoldenHourInfo
};
