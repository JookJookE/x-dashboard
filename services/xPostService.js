const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const { getConfig } = require('../config');
const { addLog } = require('../history');

function getTwitterClient() {
  const config = getConfig();
  const appKey = process.env.TWITTER_API_KEY || config.xAppKey;
  const appSecret = process.env.TWITTER_API_SECRET || config.xAppSecret;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN || config.xAccessToken;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET || config.xAccessSecret;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error('X(트위터) API 키가 설정되지 않았습니다. .env 또는 설정 메뉴에서 4개 키를 입력해 주세요.');
  }

  return new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret
  });
}

/**
 * Upload image and post tweet
 * @param {Object} params
 * @param {string} params.text - Tweet body text
 * @param {string} params.imagePath - Absolute or relative local image path
 */
async function postTweetWithMedia({ text, imagePath }) {
  const client = getTwitterClient();

  if (!text || text.trim().length === 0) {
    throw new Error('트윗 본문 내용이 없습니다.');
  }

  let mediaId = null;

  if (imagePath && fs.existsSync(imagePath)) {
    try {
      addLog('INFO', `📤 X 미디어 업로드 시작: ${imagePath}`);
      mediaId = await client.v1.uploadMedia(imagePath);
      addLog('SUCCESS', `✅ X 미디어 업로드 성공 (Media ID: ${mediaId})`);
    } catch (mediaErr) {
      console.error('X media upload error:', mediaErr);
      addLog('ERROR', `❌ X 미디어 업로드 실패: ${mediaErr.message}`);
      // Fallback: Continue without media or rethrow depending on requirement
    }
  }

  try {
    // Trim text to safe X tweet length (X max 280 weight characters)
    let safeText = text.trim();
    if (safeText.length > 250) {
      safeText = safeText.slice(0, 245) + '...';
    }

    const tweetPayload = {
      text: safeText
    };

    if (mediaId) {
      tweetPayload.media = {
        media_ids: [mediaId]
      };
    }

    addLog('INFO', `🚀 X 트윗 게시 요청 중...`);
    const response = await client.v2.tweet(tweetPayload);
    const tweetId = response.data.id;
    const tweetUrl = `https://x.com/i/web/status/${tweetId}`;

    addLog('SUCCESS', `🎉 X 트윗 게시 완료! URL: ${tweetUrl}`);
    return {
      success: true,
      tweetId,
      tweetUrl
    };
  } catch (err) {
    console.error('X tweet post error:', err);
    let detailedMsg = err.message;
    if (err.data?.detail) {
      detailedMsg = err.data.detail;
    } else if (err.data?.errors?.[0]?.message) {
      detailedMsg = `${err.data.title || 'Error'}: ${err.data.errors[0].message}`;
    }
    
    // Check for common permission error (Read-only app)
    if (err.code === 403 || (detailedMsg && detailedMsg.toLowerCase().includes('permission'))) {
      detailedMsg += ' (💡 X Developer Portal에서 App Permissions가 "Read and write"로 설정되어 있고 Access Token이 재발급되었는지 확인해 주세요.)';
    }

    addLog('ERROR', `❌ X 트윗 게시 실패: ${detailedMsg}`);
    throw new Error(`X 포스팅 실패: ${detailedMsg}`);
  }
}


/**
 * Verify Twitter credentials
 */
async function testTwitterConnection() {
  try {
    const client = getTwitterClient();
    const user = await client.v2.me();
    return {
      success: true,
      username: user.data?.username,
      name: user.data?.name
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  getTwitterClient,
  postTweetWithMedia,
  testTwitterConnection
};
