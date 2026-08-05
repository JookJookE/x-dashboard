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
  } catch (e) {}
  return map;
}

function markAllAsRead(articleIds = []) {
  const map = getReadStatusMap();
  articleIds.forEach(id => {
    map[id] = true;
  });
  try {
    fs.writeFileSync(READ_STATUS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {}
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
  
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  
  const merged = Array.from(map.values())
    .filter(a => new Date(a.date) >= fiveDaysAgo)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 500);
    
  try {
    fs.writeFileSync(ARTICLES_DB_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {}
  return merged;
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
  } catch (e) {}
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
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
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
  addLog
};
