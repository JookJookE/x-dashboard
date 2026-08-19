const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultConfig = {
  xAppKey: process.env.TWITTER_API_KEY || '',
  xAppSecret: process.env.TWITTER_API_SECRET || '',
  xAccessToken: process.env.TWITTER_ACCESS_TOKEN || '',
  xAccessSecret: process.env.TWITTER_ACCESS_SECRET || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  targetUrl: 'https://heisenberg.kr/wp-json/wp/v2/posts',

  scheduleTime: '07:00', // Set to 07:00 AM daily
  autoPostEnabled: true,  // Auto daily draft generation enabled
  telegramQueueEnabled: true, // 3-minute Telegram approval queue
  maxTweetLength: 280,
  authPassword: process.env.AUTH_PASSWORD || 'rudghlWkd!',
  customPromptTemplate: `내가 직접 내 트위터 팔로워들에게 핵심 지식과 기술 인사이트를 설명해 주는 어조(기술 전문가/인플루언서 톤앤매너)로 X 포스트를 작성해 주세요.`,
  telegramEnabled: false,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramBriefingBotToken: process.env.TELEGRAM_BRIEFING_BOT_TOKEN || '',
  telegramBriefingChatId: process.env.TELEGRAM_BRIEFING_CHAT_ID || '',
  emailEnabled: false,
  emailHost: 'smtp.gmail.com',
  emailPort: 587,
  emailUser: '',
  emailPass: '',
  emailTo: ''
};

function getConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      fileConfig = JSON.parse(data);
    } catch (err) {
      console.error('Error loading config file, using default:', err);
    }
  } else {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('Error creating default config file:', err);
    }
  }

  // Merge defaultConfig -> fileConfig -> process.env overrides
  const config = { ...defaultConfig, ...fileConfig };
  if (process.env.TWITTER_API_KEY) config.xAppKey = process.env.TWITTER_API_KEY;
  if (process.env.TWITTER_API_SECRET) config.xAppSecret = process.env.TWITTER_API_SECRET;
  if (process.env.TWITTER_ACCESS_TOKEN) config.xAccessToken = process.env.TWITTER_ACCESS_TOKEN;
  if (process.env.TWITTER_ACCESS_SECRET) config.xAccessSecret = process.env.TWITTER_ACCESS_SECRET;
  if (process.env.TELEGRAM_BOT_TOKEN) config.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) config.telegramChatId = process.env.TELEGRAM_CHAT_ID;
  if (process.env.TELEGRAM_BRIEFING_BOT_TOKEN) config.telegramBriefingBotToken = process.env.TELEGRAM_BRIEFING_BOT_TOKEN;
  if (process.env.TELEGRAM_BRIEFING_CHAT_ID) config.telegramBriefingChatId = process.env.TELEGRAM_BRIEFING_CHAT_ID;
  if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;

  return config;
}

function saveConfig(newConfig) {
  try {
    let current = defaultConfig;
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        current = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      } catch (e) {}
    }
    const updated = { ...defaultConfig, ...current, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error('Error saving config file:', err);
    throw err;
  }
}

module.exports = {
  getConfig,
  saveConfig
};
