const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultConfig = {
  xAppKey: '',
  xAppSecret: '',
  xAccessToken: '',
  xAccessSecret: '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  targetUrl: 'https://heisenberg.kr/wp-json/wp/v2/posts',
  scheduleTime: '07:00', // Set to 07:00 AM daily
  autoPostEnabled: true,  // Auto daily draft generation enabled
  maxTweetLength: 280,
  authPassword: '1234',
  customPromptTemplate: `내가 직접 내 트위터 팔로워들에게 핵심 지식과 기술 인사이트를 설명해 주는 어조(기술 전문가/인플루언서 톤앤매너)로 X 포스트를 작성해 주세요.`
};

function getConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('Error creating default config file:', err);
    }
    return defaultConfig;
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch (err) {
    console.error('Error loading config file, using default:', err);
    return defaultConfig;
  }
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
