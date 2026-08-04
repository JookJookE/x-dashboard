const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { fetchLatestArticles } = require('./scraper');
const { generateSummary } = require('./summarizer');
const { addLog, isPosted, markArticleAsUsed } = require('./history');

const DRAFTS_FILE = path.join(__dirname, 'data', 'daily_drafts.json');
let cronJobHourly = null;
let cronJobMorning = null;

function getDailyDrafts() {
  if (!fs.existsSync(DRAFTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveDailyDrafts(drafts) {
  try {
    // Keep top 50 recent drafts
    const trimmed = drafts.slice(0, 50);
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving daily drafts:', e);
  }
}

function initScheduler() {
  if (cronJobHourly) cronJobHourly.stop();

  // Every 1 Hour Check (매시간 정각마다 신규 뉴스 자동 감지 및 DB 보관 - Gemini API 미호출)
  cronJobHourly = cron.schedule('0 * * * *', async () => {
    addLog('INFO', '⏰ [1시간 주기 정각 감지] 신규 뉴스 탐지 중... (Gemini API 미호출, DB 수집만 수행)');
    try {
      const articles = await fetchLatestArticles(30);
      addLog('SUCCESS', `⏰ [1시간 주기 정각 감지] 총 ${articles.length}건의 최신 뉴스를 DB에 성공적으로 보관했습니다.`);
    } catch (e) {
      addLog('ERROR', `정각 뉴스 수집 실패: ${e.message}`);
    }
  });

  addLog('INFO', '⏰ 스케줄러 활성화: 매시간 정각 최신 뉴스 수집 작동 중 (Gemini API 0회 소모)');
}

async function checkAndGenerateNewDrafts(targetCount = 5) {
  try {
    const articles = await fetchLatestArticles(30);
    return { success: true, count: articles.length };
  } catch (err) {
    addLog('ERROR', `뉴스 수집 중 오류 발생: ${err.message}`);
    return { success: false, message: err.message };
  }
}

module.exports = {
  initScheduler,
  checkAndGenerateNewDrafts,
  getDailyDrafts
};
