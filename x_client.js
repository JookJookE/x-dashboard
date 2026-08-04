const { TwitterApi } = require('twitter-api-v2');
const { getConfig } = require('./config');
const { addLog, addHistoryRecord } = require('./history');

function getTwitterClient() {
  const config = getConfig();
  if (
    !config.xAppKey ||
    !config.xAppSecret ||
    !config.xAccessToken ||
    !config.xAccessSecret
  ) {
    return null;
  }

  return new TwitterApi({
    appKey: config.xAppKey,
    appSecret: config.xAppSecret,
    accessToken: config.xAccessToken,
    accessSecret: config.xAccessSecret
  });
}

async function testXConnection() {
  const client = getTwitterClient();
  if (!client) {
    return {
      success: false,
      message: 'X API 키가 완제 설정되지 않았습니다. 4개 키(App Key, App Secret, Access Token, Access Secret)를 모두 입력해 주세요.'
    };
  }

  try {
    const user = await client.v2.me();
    addLog('SUCCESS', `X 계정 인증 성공: @${user.data.username} (${user.data.name})`);
    return {
      success: true,
      username: user.data.username,
      name: user.data.name,
      message: `인증 성공: @${user.data.username} 계정과 정상 연결되었습니다.`
    };
  } catch (err) {
    const msg = err.data?.detail || err.message || 'X API 인증 오류';
    addLog('ERROR', `X 계정 인증 실패: ${msg}`);
    return {
      success: false,
      message: `인증 실패: ${msg}`
    };
  }
}

async function postToX(tweetText, articleData = {}) {
  const client = getTwitterClient();

  if (!client) {
    const errorMsg = 'X API 키가 설정되어 있지 않아 공식 API로 포스팅할 수 없습니다. 웹 의도(Web Intent) 기능을 이용하거나 API 키를 설정하세요.';
    addLog('WARN', errorMsg);
    return {
      success: false,
      isWebIntentAvailable: true,
      webIntentUrl: generateWebIntentUrl(tweetText),
      message: errorMsg
    };
  }

  try {
    addLog('INFO', `X (Twitter) 포스팅 전송 시작: "${tweetText.substring(0, 40)}..."`);
    const tweet = await client.v2.tweet(tweetText);

    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/user/status/${tweetId}`;

    addLog('SUCCESS', `X 포스팅 완료! Tweet ID: ${tweetId}`);

    // Record in history
    addHistoryRecord({
      articleId: articleData.id || 'manual-' + Date.now(),
      title: articleData.title || '직접 작성한 트윗',
      link: articleData.link || '',
      tweetId,
      tweetUrl,
      tweetText
    });

    return {
      success: true,
      tweetId,
      tweetUrl,
      message: `X에 성공적으로 올라갔습니다! (ID: ${tweetId})`
    };
  } catch (err) {
    const errorDetails = err.data?.detail || err.message || '알 수 없는 오류';
    addLog('ERROR', `X 포스팅 전송 실패: ${errorDetails}`);
    return {
      success: false,
      isWebIntentAvailable: true,
      webIntentUrl: generateWebIntentUrl(tweetText),
      message: `X 포스팅 실패: ${errorDetails}`
    };
  }
}

function generateWebIntentUrl(text) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

module.exports = {
  testXConnection,
  postToX,
  generateWebIntentUrl
};
