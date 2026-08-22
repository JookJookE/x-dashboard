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

let cronJobTenMin = null;
let cronJobBreaking = null;

function initScheduler() {
  if (cronJobHourly) cronJobHourly.stop();
  if (cronJobTenMin) cronJobTenMin.stop();
  if (cronJobBreaking) cronJobBreaking.stop();

  // 1. Every 1 Hour Check (매시간 정각마다 신규 뉴스 자동 수집 및 DB 보관 - STRICT RULE: 0 * * * *)
  cronJobHourly = cron.schedule('0 * * * *', async () => {
    addLog('INFO', '⏰ [1시간 주기 정각 감지] 신규 뉴스 탐지 및 DB 보관 중...');
    try {
      const articles = await fetchLatestArticles(30);
      addLog('SUCCESS', `⏰ [1시간 주기 정각 감지] 총 ${articles.length}건의 최신 뉴스를 DB에 성공적으로 보관했습니다.`);
    } catch (e) {
      addLog('ERROR', `정각 뉴스 수집 실패: ${e.message}`);
    }
  });

  // 2. Every 10 Minutes Check (매 10분마다 실시간 핫이슈 or 엑친 스몰톡 1건 텔레그램 브리핑)
  cronJobTenMin = cron.schedule('*/10 * * * *', async () => {
    const config = getConfig();
    if (config.telegramQueueEnabled) {
      try {
        const { triggerTenMinuteBriefing } = require('./services/telegramQueueService');
        await triggerTenMinuteBriefing(false);
      } catch (teleErr) {
        addLog('ERROR', `텔레그램 10분 브리핑 실패: ${teleErr.message}`);
      }
    }
  });

  // 3. 🚨 Every 3 Minutes Check (3분 주기 초경량 실시간 속보 탐지 - 중대 속보 발생 시 10분 주기 독립 즉시 발송)
  cronJobBreaking = cron.schedule('*/3 * * * *', async () => {
    const config = getConfig();
    if (config.telegramQueueEnabled) {
      try {
        const { checkAndSendRealtimeBreakingNews } = require('./services/breakingNewsService');
        await checkAndSendRealtimeBreakingNews();
      } catch (brkErr) {}
    }
  });

  addLog('INFO', '⏰ 스케줄러 활성화: [정각: 뉴스 DB 수집] & [10분: 실시간 핫이슈/스몰톡] & [3분: 초경량 돌발속보 독립감지]');
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
  generateDailyDraftsJob: checkAndGenerateNewDrafts,
  getDailyDrafts
};
