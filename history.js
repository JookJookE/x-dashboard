const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const FIRST_COLLECTED_FILE = path.join(DATA_DIR, 'first_collected.json');
const READ_STATUS_FILE = path.join(DATA_DIR, 'read_status.json');
const ARTICLES_DB_FILE = path.join(DATA_DIR, 'articles_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getReadStatusMap() {
  if (!fs.existsSync(READ_STATUS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(READ_STATUS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function markAsRead(articleId) {
  const map = getReadStatusMap();
  map[articleId] = true;
  try {
    fs.writeFileSync(READ_STATUS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) { }
  return map;
}

function markAllAsRead(articleIds = []) {
  const map = getReadStatusMap();
  articleIds.forEach(id => {
    map[id] = true;
  });
  try {
    fs.writeFileSync(READ_STATUS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) { }
  return map;
}

function getStoredArticles() {
  if (!fs.existsSync(ARTICLES_DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ARTICLES_DB_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveStoredArticles(freshArticles) {
  const existing = getStoredArticles();
  const map = new Map(existing.map(a => [a.id, a]));
  freshArticles.forEach(a => map.set(a.id, a));

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);

  let merged = Array.from(map.values())
    .filter(a => {
      const artDate = new Date(a.date);
      if (isNaN(artDate.getTime())) return false;
      // All categories retain 5 days DB retention
      return artDate >= fiveDaysAgo;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Semantic deduplication across DB entries per category
  try {
    const { isSimilarArticleTitle } = require('./scraper');
    if (typeof isSimilarArticleTitle === 'function') {
      const deduplicated = [];
      merged.forEach(art => {
        const isDup = deduplicated.some(existing =>
          existing.category === art.category && isSimilarArticleTitle(existing.title, art.title)
        );
        if (!isDup) {
          deduplicated.push(art);
        }
      });
      merged = deduplicated;
    }
  } catch (e) { }

  const finalStored = merged.slice(0, 500);

  try {
    fs.writeFileSync(ARTICLES_DB_FILE, JSON.stringify(finalStored, null, 2), 'utf8');
  } catch (e) { }
  return finalStored;
}

function getFirstCollectedMap() {
  if (!fs.existsSync(FIRST_COLLECTED_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FIRST_COLLECTED_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function getOrCreateFetchedAt(articleId, defaultTimestamp = null) {
  const map = getFirstCollectedMap();
  if (map[articleId]) {
    return map[articleId];
  }
  // Use passed scan batch timestamp (e.g. hourly scan time 03:00 or server startup time 02:50)
  const timestamp = defaultTimestamp || new Date().toISOString();
  map[articleId] = timestamp;
  try {
    fs.writeFileSync(FIRST_COLLECTED_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) { }
  return timestamp;
}

function getHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function getPostingStatusMap() {
  const history = getHistory();
  const statusMap = {};
  history.forEach(item => {
    if (!statusMap[item.articleId]) {
      statusMap[item.articleId] = { postedTweet: false, postedArticle: false };
    }
    if (item.type === 'tweet') {
      statusMap[item.articleId].postedTweet = true;
    } else if (item.type === 'article') {
      statusMap[item.articleId].postedArticle = true;
    }
  });
  return statusMap;
}

function isPosted(articleId) {
  const history = getHistory();
  return history.some(item => String(item.articleId) === String(articleId));
}

function markPostingStatus(articleId, type = 'tweet', title = '', link = '') {
  const history = getHistory();
  const existing = history.find(item => String(item.articleId) === String(articleId) && item.type === type);
  if (existing) return existing;

  const newRecord = {
    id: Date.now().toString(),
    articleId: String(articleId),
    type,
    title,
    link,
    usedAt: new Date().toISOString()
  };

  history.unshift(newRecord);
  const trimmed = history.slice(0, 1000);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {}

  // 🟩 Always increment streak count for today!
  incrementTodayXPostCount();

  return newRecord;
}

function markArticleAsUsed(articleId, title, link = '') {
  return markPostingStatus(articleId, 'tweet', title, link);
}

function getLogs() {
  if (!fs.existsSync(LOGS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function addLog(level, message) {
  const logs = getLogs();
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  console.log(`[${logEntry.timestamp}] [${level}] ${message}`);
  logs.unshift(logEntry);
  const trimmed = logs.slice(0, 300);
  fs.writeFileSync(LOGS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return logEntry;
}

const SAVED_DRAFTS_FILE = path.join(DATA_DIR, 'saved_drafts.json');

function getSavedDrafts() {
  if (!fs.existsSync(SAVED_DRAFTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SAVED_DRAFTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSavedDraft(draftData) {
  const drafts = getSavedDrafts();
  const newDraft = {
    id: `draft-${Date.now()}`,
    title: draftData.title || '임시 저장 트윗',
    text: draftData.text || '',
    hooks: draftData.hooks || [],
    tags: draftData.tags || [],
    imageUrl: draftData.imageUrl || '',
    mode: draftData.mode || 'talk',
    createdAt: new Date().toISOString()
  };
  drafts.unshift(newDraft);
  const trimmed = drafts.slice(0, 100);
  try {
    fs.writeFileSync(SAVED_DRAFTS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) { }
  return newDraft;
}

function deleteSavedDraft(draftId) {
  let drafts = getSavedDrafts();
  drafts = drafts.filter(d => String(d.id) !== String(draftId));
  try {
    fs.writeFileSync(SAVED_DRAFTS_FILE, JSON.stringify(drafts, null, 2), 'utf8');
  } catch (e) { }
  return drafts;
}

const TELEGRAM_QUEUE_FILE = path.join(DATA_DIR, 'telegram_queue_status.json');

function getTelegramQueueMap() {
  if (!fs.existsSync(TELEGRAM_QUEUE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TELEGRAM_QUEUE_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function markAsTelegramSent(articleId, data = {}) {
  const map = getTelegramQueueMap();
  map[articleId] = {
    sentAt: new Date().toISOString(),
    ...data
  };
  try {
    fs.writeFileSync(TELEGRAM_QUEUE_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) { }
  return map;
}

function isTelegramSent(articleId) {
  const map = getTelegramQueueMap();
  return Boolean(map[articleId]);
}

function getNextArticleForTelegramQueue() {
  const articles = getStoredArticles();
  const queueMap = getTelegramQueueMap();

  // Find the most recent article that hasn't been sent to Telegram yet
  const pending = articles.find(art => !queueMap[art.id] && art.title && art.title.trim().length > 0);
  return pending || null;
}

const DAILY_X_POST_FILE = path.join(DATA_DIR, 'daily_x_post_counts.json');

function getTodayKey() {
  // Format: YYYY-MM-DD in KST (UTC+9)
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().split('T')[0];
}

function getDailyXPostData() {
  if (!fs.existsSync(DAILY_X_POST_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DAILY_X_POST_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function getTodayXPostCount() {
  const data = getDailyXPostData();
  const todayKey = getTodayKey();
  return data[todayKey] || 0;
}

function incrementTodayXPostCount() {
  const data = getDailyXPostData();
  const todayKey = getTodayKey();
  const newCount = (data[todayKey] || 0) + 1;
  data[todayKey] = newCount;
  try {
    fs.writeFileSync(DAILY_X_POST_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
  return newCount;
}

function getStreakStats() {
  const data = getDailyXPostData();
  const history = getHistory();
  
  // Merge history events if daily counts file is fresh
  history.forEach(h => {
    const time = h.usedAt || h.timestamp;
    if (time) {
      const kstDate = new Date(new Date(time).getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
      data[kstDate] = (data[kstDate] || 0) + 1;
    }
  });

  const now = new Date();
  const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const days = [];
  // Generate last 30 days
  for (let i = 29; i >= 0; i--) {
    const d = new Date(kstNow);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const count = data[dateStr] || 0;
    
    // Level: 0 (0), 1 (1-2), 2 (3-4), 3 (5+)
    let level = 0;
    if (count >= 5) level = 3;
    else if (count >= 3) level = 2;
    else if (count >= 1) level = 1;

    days.push({
      date: dateStr,
      dayName: ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()],
      count,
      level
    });
  }

  // Calculate current streak
  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) {
      currentStreak++;
    } else {
      // If today has 0 but yesterday had > 0, don't break streak yet for today
      if (i === days.length - 1) continue;
      break;
    }
  }

  const todayKey = getTodayKey();
  const todayCount = data[todayKey] || 0;
  const totalCount = Object.values(data).reduce((a, b) => a + b, 0);

  return {
    days,
    currentStreak,
    todayCount,
    totalCount
  };
}

// ===== 🔒 Security Login History (최근 10회 접속 이력) =====
const LOGIN_HISTORY_FILE = path.join(DATA_DIR, 'login_history.json');

function getLoginHistory() {
  if (!fs.existsSync(LOGIN_HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOGIN_HISTORY_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

let lastRecordedLoginTime = 0;
let lastRecordedIp = '';

function recordLoginHistory(ip, userAgent) {
  const now = Date.now();
  // Prevent duplicate spam within 3 minutes for identical IP
  if (ip === lastRecordedIp && (now - lastRecordedLoginTime) < 3 * 60 * 1000) {
    return;
  }

  lastRecordedLoginTime = now;
  lastRecordedIp = ip;

  const history = getLoginHistory();

  // Detect Device Type
  let device = '💻 데스크톱 (PC)';
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) {
    device = '📱 iOS (아이폰/아이패드)';
  } else if (ua.includes('android')) {
    device = '📱 Android (스마트폰)';
  } else if (ua.includes('mobile')) {
    device = '📱 모바일 브라우저';
  } else if (ua.includes('macintosh') || ua.includes('mac os')) {
    device = '💻 Mac PC';
  }

  const cleanIp = (ip || '').replace('::ffff:', '').trim() || '127.0.0.1';

  const entry = {
    id: `log_${now}`,
    ip: cleanIp,
    device,
    userAgent: (userAgent || '').slice(0, 120),
    timestamp: new Date().toISOString()
  };

  history.unshift(entry);
  const trimmed = history.slice(0, 10); // Keep latest 10 logs only

  try {
    fs.writeFileSync(LOGIN_HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save login history:', e.message);
  }

  return entry;
}

module.exports = {
  getHistory,
  getStoredArticles,
  saveStoredArticles,
  getReadStatusMap,
  markAsRead,
  markAllAsRead,
  getPostingStatusMap,
  getOrCreateFetchedAt,
  isPosted,
  markPostingStatus,
  markArticleAsUsed,
  getLogs,
  addLog,
  getSavedDrafts,
  saveSavedDraft,
  deleteSavedDraft,
  getTelegramQueueMap,
  markAsTelegramSent,
  isTelegramSent,
  getNextArticleForTelegramQueue,
  getTodayXPostCount,
  incrementTodayXPostCount,
  getTodayKey,
  getStreakStats,
  getLoginHistory,
  recordLoginHistory
};


