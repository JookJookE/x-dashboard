const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const { getConfig } = require('../config');
const { addLog, getStoredArticles } = require('../history');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WEIGHTS_FILE = path.join(DATA_DIR, 'viral_topic_weights.json');

// Default initial weights (Cold-start baseline)
const defaultWeights = {
  updatedAt: new Date().toISOString(),
  topKeywords: ['블라인드', '네이트판', '직장갈등', '단독', '충격', '테슬라', '엔비디아', 'AI', '주식', '연예'],
  categoryWeights: {
    '커뮤니티/사회': 2.5,
    '테크/AI': 2.2,
    '주식/경제': 1.8,
    '연예/방송': 1.5,
    '일반/기타': 1.0
  },
  aiInsightSummary: '실시간 수집 기사의 화제성과 바이럴 키워드를 바탕으로 10분 텔레그램 추천 기사를 자동 선별합니다.'
};

function getStoredWeights() {
  if (fs.existsSync(WEIGHTS_FILE)) {
    try {
      const data = fs.readFileSync(WEIGHTS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {}
  }
  return defaultWeights;
}

function saveStoredWeights(weights) {
  try {
    fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save viral topic weights:', e.message);
  }
}

/**
 * 🧠 Analyze Real-Time Trending Topics from Stored News Stream using Gemini AI
 */
async function analyzeViralTopics() {
  const config = getConfig();
  const articles = getStoredArticles();

  if (!articles || articles.length === 0) {
    return getStoredWeights();
  }

  addLog('INFO', `🧠 [실시간 화제성 AI 분석] 최신 수집된 뉴스/커뮤니티 ${Math.min(30, articles.length)}건 기반 인기 키워드 분석 시작...`);

  // Sample top 25 recent articles across various categories
  const sampleArticles = articles.slice(0, 25);
  const articleListText = sampleArticles.map((a, i) => `${i + 1}. [${a.categoryTag || a.category || '기타'}] ${a.title}`).join('\n');

  const prompt = `당신은 실시간 뉴스 및 SNS 화제성 분석 AI입니다.
아래는 최근 수집된 실시간 국내외 주요 기사 및 커뮤니티 게시글 목록입니다:

${articleListText}

위 기사들의 주요 트렌드, 자극성, 대중의 반응률을 분석하여, 지금 이 순간 가장 화제성이 높은 핵심 키워드와 카테고리 가중치를 다음 JSON 형식으로만 응답해 주세요:

\`\`\`json
{
  "topKeywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6"],
  "categoryWeights": {
    "커뮤니티/사회": 2.5,
    "테크/AI": 2.2,
    "주식/경제": 1.8,
    "연예/방송": 1.5,
    "일반/기타": 1.0
  },
  "aiInsightSummary": "현재 ~와 ~관련 이슈의 화제성이 가장 높으며, 텔레그램 추천에 우선 반영 중입니다."
}
\`\`\`
가중치는 1.0에서 3.0 사이의 소수로 지정하세요.`;

  try {
    const apiKey = config.geminiApiKey;
    if (!apiKey) return getStoredWeights();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    }, { timeout: 15000 });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    const newWeights = {
      updatedAt: new Date().toISOString(),
      topKeywords: parsed.topKeywords || defaultWeights.topKeywords,
      categoryWeights: parsed.categoryWeights || defaultWeights.categoryWeights,
      aiInsightSummary: parsed.aiInsightSummary || defaultWeights.aiInsightSummary
    };

    saveStoredWeights(newWeights);
    addLog('SUCCESS', `🧠 [실시간 화제성 AI 분석 완료] 인기 키워드: [${newWeights.topKeywords.slice(0, 5).join(', ')}] | ${newWeights.aiInsightSummary}`);
    return newWeights;
  } catch (err) {
    addLog('WARN', `⚠️ [실시간 화제성 AI 분석 실패] ${err.message} (기존 가중치 유지)`);
    return getStoredWeights();
  }
}

/**
 * ⏰ Calculate Viral Priority Score for an Article
 */
function calculateArticleViralScore(article, weights) {
  if (!article || !weights) return 1.0;

  let score = 1.0;
  const fullText = `${article.title || ''} ${article.category || ''} ${article.categoryTag || ''}`.toLowerCase();

  // 1. Category Weight Match
  const catWeights = weights.categoryWeights || {};
  Object.entries(catWeights).forEach(([catName, weight]) => {
    const keys = catName.split('/');
    if (keys.some(k => fullText.includes(k.toLowerCase()))) {
      score = Math.max(score, weight);
    }
  });

  // 2. High Performing Keyword Match (+0.4 per match)
  const topKeywords = weights.topKeywords || [];
  topKeywords.forEach(kw => {
    if (kw && fullText.includes(kw.toLowerCase())) {
      score += 0.4;
    }
  });

  // 3. Breaking News Boost (+0.5)
  if (article.isBreakingNews) {
    score += 0.5;
  }

  return score;
}

/**
 * Initialize 1-Hour Analytics Cron Job (0 * * * *)
 */
let analyticsJob = null;
function initXAnalyticsScheduler() {
  if (analyticsJob) {
    analyticsJob.stop();
  }

  // Run automatically at the start of every hour (0 * * * *)
  analyticsJob = cron.schedule('0 * * * *', async () => {
    try {
      await analyzeViralTopics();
    } catch (e) {
      console.error('Hourly viral analytics job error:', e.message);
    }
  });

  // Also trigger initial analysis 10 seconds after server startup
  setTimeout(async () => {
    try {
      await analyzeViralTopics();
    } catch (e) {}
  }, 10000);

  addLog('INFO', '⏰ [1시간 주기 실시간 화제성 분석 스케줄러 가동] 뉴스/커뮤니티 트렌드 기반 추천 가중치 자동 갱신');
}

/**
 * 👑 Get Top Ranked Articles sorted by AI Viral Score
 */
function getTopRankedArticles(limit = 5) {
  const articles = getStoredArticles();
  if (!articles || articles.length === 0) return { topArticle: null, topArticles: [] };

  const weights = getStoredWeights();
  const scored = articles
    .filter(a => a.title && a.title.trim().length > 0)
    .map(a => {
      const score = calculateArticleViralScore(a, weights);
      return { ...a, viralScore: Number(score.toFixed(2)) };
    });

  scored.sort((a, b) => b.viralScore - a.viralScore);

  const topArticle = scored[0] || null;
  const topArticles = scored.slice(0, limit);

  return { topArticle, topArticles, weights };
}

module.exports = {
  initXAnalyticsScheduler,
  analyzeViralTopics,
  getStoredWeights,
  calculateArticleViralScore,
  getTopRankedArticles
};


