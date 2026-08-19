const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const QUOTA_FILE = path.join(DATA_DIR, 'youtube_quota.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAX_DAILY_QUOTA = 10000;
const COST_PER_SEARCH = 100; // YouTube Data API v3 search.list consumes 100 units

function getTodayString() {
  const now = new Date();
  // 한국 표준시(KST, UTC+9) 기준 날짜 문자열
  const kstOffset = 9 * 60;
  const kstTime = new Date(now.getTime() + (now.getTimezoneOffset() + kstOffset) * 60 * 1000);
  return `${kstTime.getFullYear()}-${String(kstTime.getMonth() + 1).padStart(2, '0')}-${String(kstTime.getDate()).padStart(2, '0')}`;
}

function loadQuotaData() {
  const today = getTodayString();
  const defaultData = {
    date: today,
    usedQuota: 0,
    searchCalls: 0,
    lastUpdated: new Date().toISOString()
  };

  if (!fs.existsSync(QUOTA_FILE)) {
    try {
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
    } catch (e) {}
    return defaultData;
  }

  try {
    const raw = fs.readFileSync(QUOTA_FILE, 'utf8');
    const data = JSON.parse(raw);
    // 날짜가 바뀌었으면 자동 리셋
    if (data.date !== today) {
      const resetData = {
        date: today,
        usedQuota: 0,
        searchCalls: 0,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(resetData, null, 2), 'utf8');
      return resetData;
    }
    return { ...defaultData, ...data };
  } catch (err) {
    return defaultData;
  }
}

function recordYouTubeUsage(units = COST_PER_SEARCH) {
  try {
    const current = loadQuotaData();
    current.usedQuota = (current.usedQuota || 0) + units;
    current.searchCalls = (current.searchCalls || 0) + 1;
    current.lastUpdated = new Date().toISOString();
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(current, null, 2), 'utf8');
    return current;
  } catch (e) {
    console.error('Error recording YouTube quota usage:', e);
  }
}

function getYouTubeQuotaStatus() {
  const data = loadQuotaData();
  const used = data.usedQuota || 0;
  const remaining = Math.max(0, MAX_DAILY_QUOTA - used);
  const remainingCalls = Math.floor(remaining / COST_PER_SEARCH);
  const percentUsed = Math.min(100, parseFloat(((used / MAX_DAILY_QUOTA) * 100).toFixed(1)));

  return {
    date: data.date,
    usedQuota: used,
    maxQuota: MAX_DAILY_QUOTA,
    remainingQuota: remaining,
    searchCalls: data.searchCalls || 0,
    remainingCalls,
    percentUsed,
    lastUpdated: data.lastUpdated,
    consoleUrl: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas'
  };
}

function resetYouTubeQuota(targetUnits = 0) {
  try {
    const today = getTodayString();
    const calls = Math.floor(targetUnits / COST_PER_SEARCH);
    const updated = {
      date: today,
      usedQuota: targetUnits,
      searchCalls: calls,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (e) {
    console.error('Error resetting YouTube quota:', e);
  }
}

module.exports = {
  recordYouTubeUsage,
  getYouTubeQuotaStatus,
  resetYouTubeQuota,
  MAX_DAILY_QUOTA,
  COST_PER_SEARCH
};

