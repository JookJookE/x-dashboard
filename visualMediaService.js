const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');
const { recordYouTubeUsage, getYouTubeQuotaStatus } = require('./quotaTracker');

// Last YouTube Operation Status
let lastYouTubeStatus = { status: 'idle', message: '', timestamp: Date.now() };

function getLatestYouTubeStatus() {
  return lastYouTubeStatus;
}

// Preset Visual Keyword Categories (3 Essential Basic Presets)
const VISUAL_PRESETS = [
  { id: 'video_archive', name: '🎬 여돌 직캠 MP4', query: '여돌 직캠 MP4' },
  { id: 'idol_fancam', name: '💃 여돌 움짤', query: '여돌 움짤' },
  { id: 'influencer', name: '✨ 모델/화보 고화질', query: '인스타 모델 비주얼 화보' }
];

/**
 * Direct Social Media Link Parser:
 * Extracts highest quality MP4 video / HD image, title, and date from any direct URL
 */
async function parseDirectSnsUrl(url) {
  const cleanUrl = url.trim();

  // 1. X / Twitter Tweet URL
  if (cleanUrl.includes('x.com/') || cleanUrl.includes('twitter.com/')) {
    const tweetMatch = cleanUrl.match(/status\/(\d+)/);
    if (tweetMatch) {
      const tweetId = tweetMatch[1];
      try {
        const fxUrl = `https://api.fxtwitter.com/status/${tweetId}`;
        const res = await axios.get(fxUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000
        });
        const tweet = res.data?.tweet;
        if (tweet) {
          const author = tweet.author?.name || tweet.author?.screen_name || 'X User';
          const text = tweet.text || '';
          const video = tweet.media?.videos?.[0];
          const photo = tweet.media?.photos?.[0];
          const mediaUrl = video?.url || photo?.url || '';
          const isVideo = !!video;
          
          return {
            id: 'x_' + tweetId,
            title: `[X @${tweet.author?.screen_name || 'tweet'}] ${text.substring(0, 45)}`,
            url: mediaUrl,
            mediaType: isVideo ? 'video' : 'image',
            thumbnail: video?.thumbnail_url || photo?.url || mediaUrl,
            date: tweet.created_at || '최신',
            source: 'X (Twitter)',
            rawText: text
          };
        }
      } catch (e) {}
    }
  }

  // 2. YouTube / Shorts URL
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    let videoId = '';
    const vMatch = cleanUrl.match(/[?&]v=([^&#]+)/) || cleanUrl.match(/youtu\.be\/([^?&#]+)/) || cleanUrl.match(/shorts\/([^?&#]+)/);
    if (vMatch) videoId = vMatch[1];

    if (videoId) {
      const thumb = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
      return {
        id: 'yt_' + videoId,
        title: `[YouTube 영상] ID: ${videoId}`,
        url: thumb,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        mediaType: 'image',
        thumbnail: thumb,
        date: '최신',
        source: 'YouTube'
      };
    }
  }

  // 3. Direct Image / Video URL
  if (cleanUrl.startsWith('http')) {
    const isVideo = cleanUrl.toLowerCase().includes('.mp4') || cleanUrl.toLowerCase().includes('.webm');
    const isGif = cleanUrl.toLowerCase().includes('.gif');
    return {
      id: 'direct_' + Date.now(),
      title: `[직접 링크] ${cleanUrl.substring(0, 40)}`,
      url: cleanUrl,
      mediaType: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
      thumbnail: cleanUrl,
      date: '직접 입력',
      source: 'Direct Link'
    };
  }

  return null;
}

// YouTube Search In-Memory Cache (5-minute TTL to prevent repeated quota waste)
const youtubeSearchCache = new Map();
const YOUTUBE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * [파이프라인 A] YouTube Data API v3: 최근 24시간 이내 아이돌 직캠/영상 수집
 * @param {string} keyword 검색 키워드 (한국어)
 * @param {string} apiKey YouTube Data API v3 key
 * @returns {Array} 미디어 아이템 배열
 */
async function fetchYouTubeVideos(keyword, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    lastYouTubeStatus = { status: 'not_configured', message: 'YouTube API 키 미설정', timestamp: Date.now() };
    return [];
  }

  // 1. 사전 쿼터 확인 (이미 10,000 units를 다 썼으면 API 호출을 건너뛰고 자동 제외)
  const quota = getYouTubeQuotaStatus();
  if (quota.remainingQuota <= 0) {
    const msg = 'YouTube 일일 쿼터(10,000)를 모두 사용하여 YouTube 수집을 자동 제외하고 커뮤니티 미디어로 대체 수집합니다.';
    addLog('WARN', `🚨 [YouTube 제외] ${msg}`);
    lastYouTubeStatus = { status: 'quota_exceeded', message: msg, timestamp: Date.now() };
    return [];
  }
  
  const cacheKey = (keyword || '').trim().toLowerCase();
  const cached = youtubeSearchCache.get(cacheKey);
  const now = Date.now();

  // 2. 5분 이내 동일 키워드 검색 시 쿼터 소모 없이 캐시 즉시 반환 (중복 쿼터 소모 0%)
  if (cached && (now - cached.timestamp < YOUTUBE_CACHE_TTL_MS)) {
    addLog('INFO', `⚡ [YouTube 캐시 로드] "${keyword}" 캐시 재사용 (쿼터 소모: 0 units)`);
    lastYouTubeStatus = { status: 'cached', message: '5분 내 캐시된 YouTube 직캠 로드 완료', timestamp: now };
    return cached.results;
  }

  const results = [];
  try {
    // 24시간 전 ISO 문자열 생성
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 키워드 → 영어 매핑 (YouTube 검색 정밀도 향상)
    const koToEnMap = {
      '에스파': 'aespa', '카리나': 'karina aespa', '윈터': 'winter aespa',
      '아이브': 'IVE', '장원영': 'wonyoung ive', '안유진': 'yujin ive',
      '뉴진스': 'newjeans', '르세라핌': 'le sserafim', '블랙핑크': 'blackpink',
      '트와이스': 'TWICE', '아이유': 'IU', '지수': 'jisoo', '리사': 'LISA',
      '레드벨벳': 'red velvet', '여자아이들': '(G)I-DLE', '스트레이키즈': 'stray kids'
    };
    let ytKeyword = keyword;
    for (const [ko, en] of Object.entries(koToEnMap)) {
      if (keyword.includes(ko)) { ytKeyword = en; break; }
    }
    // 직캠/영상 카테고리면 fancam 접미사 추가
    const isVideoKw = keyword.includes('직캠') || keyword.includes('MP4') || keyword.includes('영상');
    const searchQ = isVideoKw ? `${ytKeyword} fancam` : `${ytKeyword} kpop`;

    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQ)}&type=video&order=date&publishedAfter=${encodeURIComponent(since)}&maxResults=15&key=${apiKey}`;
    const res = await axios.get(url, { timeout: 6000 });

    // 쿼터 기록 (search.list 호출 1회 = 100 units)
    recordYouTubeUsage(100);

    for (const item of (res.data.items || [])) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const snippet = item.snippet || {};
      const thumb = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '';
      const title = snippet.title || ytKeyword;
      const publishedAt = snippet.publishedAt || '';
      let dateStr = '최신';
      if (publishedAt) {
        const d = new Date(publishedAt);
        dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      }
      results.push({
        id: 'yt_' + videoId,
        title: `[YouTube] ${title.substring(0, 60)}`,
        url: thumb,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        mediaType: 'youtube',
        thumbnail: thumb,
        date: dateStr,
        source: 'YouTube',
        youtubeId: videoId,
        channelTitle: snippet.channelTitle || ''
      });
    }

    if (results.length > 0) {
      addLog('SUCCESS', `🎬 [YouTube API] "${searchQ}" 24시간 이내 직캠 ${results.length}건 수집 성공 (100 쿼터 차감)`);
      // 5분 캐시 저장
      youtubeSearchCache.set(cacheKey, { timestamp: now, results });
      lastYouTubeStatus = { status: 'success', message: `YouTube 24h 직캠 ${results.length}건 정상 수집 완료`, timestamp: now };
    }
  } catch (e) {
    const errorMsg = e.response?.data?.error?.message || e.message;
    const isQuotaExceeded = errorMsg.includes('quota') || e.response?.status === 403;
    if (isQuotaExceeded) {
      const msg = 'YouTube 일일 쿼터(10,000)가 소진되어 YouTube가 제외되었습니다. (자정 자동 리셋)';
      addLog('ERROR', `🚨 [YouTube 쿼터 소진 차단] ${msg} (${errorMsg})`);
      lastYouTubeStatus = { status: 'quota_exceeded', message: msg, timestamp: Date.now() };
    } else {
      const msg = `YouTube API 키 오류 또는 권한 문제로 YouTube가 제외되었습니다. (${errorMsg})`;
      addLog('WARN', `⚠️ [YouTube API 제외] ${msg} -> 커뮤니티/포털 미디어로 대체 수집`);
      lastYouTubeStatus = { status: 'error', message: msg, timestamp: Date.now() };
    }
  }
  return results;
}



/**
 * YouTube API v3 키 유효성 및 연결 테스트
 * 비용이 100 units인 search.list 대신, 단 1 unit만 소모하는 videos.list(초경량 검증)를 사용하여
 * 사용자의 일일 검색 쿼터가 낭비되지 않도록 안전하게 검증합니다.
 * @param {string} apiKey 
 * @returns {Promise<{success: boolean, message: string, details?: any}>}
 */
async function testYouTubeApiConnection(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      message: 'YouTube API 키가 입력되지 않았습니다.'
    };
  }

  try {
    // 💡 videos.list(비용: 단 1 unit)를 사용하여 쿼터 낭비 0%로 키 유효성 검증
    const testUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=Ks-_Mh1QhMc&key=${apiKey.trim()}`;
    const res = await axios.get(testUrl, { timeout: 6000 });

    const firstItem = res.data?.items?.[0];
    const sampleTitle = firstItem?.snippet?.title || 'YouTube Official';

    addLog('SUCCESS', `✅ [YouTube API 테스트] 초경량(1 unit) 연결 확인 완료: API 키 유효 (테스트 응답 정상)`);

    return {
      success: true,
      message: `인증 성공! YouTube Data API v3가 정상 작동 중입니다. (1 unit 초경량 테스트로 쿼터 차감 없음)`,
      details: {
        status: '정상 작동',
        sampleTitle
      }
    };
  } catch (err) {
    const errorData = err.response?.data?.error;
    const errorMsg = errorData?.message || err.message || '알 수 없는 오류';
    const reason = errorData?.errors?.[0]?.reason || '';

    let friendlyMessage = `연결 실패: ${errorMsg}`;
    if (reason === 'quotaExceeded' || errorMsg.includes('quota')) {
      friendlyMessage = '❌ 일일 할당량(10,000 쿼터)이 초과되었습니다. 내일 자정(KST)에 자동 리셋됩니다.';
    } else if (reason === 'keyInvalid' || errorMsg.includes('API key not valid')) {
      friendlyMessage = '❌ YouTube API 키가 올바르지 않습니다. Google Cloud Console에서 키를 다시 확인해 주세요.';
    } else if (reason === 'accessNotConfigured' || errorMsg.includes('has not been used')) {
      friendlyMessage = '❌ Google Cloud Console에서 "YouTube Data API v3" 서비스가 활성화(Enable)되지 않았습니다.';
    }

    addLog('ERROR', `❌ [YouTube API 테스트 실패] ${friendlyMessage}`);

    return {
      success: false,
      message: friendlyMessage,
      rawError: errorMsg
    };
  }
}



/**
 * [파이프라인 B] 더쿠(Theqoo) 핫게시판 크롤링 시도 → 실패 시 DCInside 아이돌 갤러리 폴백
 * 실시간 아이돌 커뮤니티 GIF/이미지 원본 미디어 링크 파싱
 * @param {string} keyword 검색 키워드
 * @returns {Array} 미디어 아이템 배열
 */
async function fetchCommunityMedia(keyword) {
  const results = [];
  const seen = new Set();

  // --- 더쿠 시도 ---
  const theqooAttempted = await (async () => {
    try {
      const searchEncoded = encodeURIComponent(keyword.replace('MP4','').replace('직캠','').trim());
      // 더쿠 연예 핫게시판 - 검색 파라미터 포함
      const theqooUrl = `https://theqoo.net/hot?filter_mode=hot&page=1`;
      const res = await axios.get(theqooUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://theqoo.net/',
          'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'navigate',
          'Cache-Control': 'no-cache'
        },
        timeout: 5000,
        maxRedirects: 3
      });

      const html = String(res.data);
      // CloudFlare 챌린지 감지 → 폴백
      if (html.includes('cf-browser-verification') || html.includes('Just a moment') || html.includes('cf_chl_opt')) {
        return false;
      }

      // 이미지 추출
      const imgMatches = [...html.matchAll(/src=["'](https?:\/\/[^"']+(?:\.jpg|\.jpeg|\.png|\.gif|\.webp))[^"']*/gi)];
      for (const m of imgMatches) {
        const imgUrl = m[1].replace(/&amp;/g, '&');
        if (!seen.has(imgUrl) && !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('avatar')) {
          seen.add(imgUrl);
          results.push({
            id: 'theqoo_' + Math.random().toString(36).substring(2, 9),
            title: `[더쿠 핫게시판] ${keyword}`,
            url: imgUrl,
            mediaType: imgUrl.toLowerCase().includes('.gif') ? 'gif' : 'image',
            thumbnail: imgUrl,
            date: '최신',
            source: '더쿠'
          });
          if (results.length >= 10) break;
        }
      }
      return results.length > 0;
    } catch (e) {
      return false; // 연결 실패 → DCInside 폴백
    }
  })();

  // --- DCInside 아이돌 갤러리 폴백 ---
  if (!theqooAttempted && results.length === 0) {
    try {
      // DCInside 마이너 갤러리: 아이돌 관련 갤러리 ID 매핑
      const gallMap = {
        '에스파': 'aespa', '카리나': 'aespa', '아이브': 'ive2', '장원영': 'ive2',
        '뉴진스': 'newjeans', '블랙핑크': 'blackpink', '트와이스': 'twice',
        '르세라핌': 'lesserafim', '여자아이들': 'gidle', '아이유': 'iu'
      };
      let gallId = 'idol'; // 기본: 아이돌 통합 갤러리
      for (const [ko, id] of Object.entries(gallMap)) {
        if (keyword.includes(ko)) { gallId = id; break; }
      }

      const dcUrl = `https://gall.dcinside.com/mgallery/board/lists/?id=${gallId}&page=1&list_num=30`;
      const res = await axios.get(dcUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://gall.dcinside.com/',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        },
        timeout: 5000
      });
      const html = String(res.data);

      // 썸네일 이미지 URL 추출
      const thumbMatches = [...html.matchAll(/data-original=["'](https?:\/\/[^"']+)['"]/gi),
                           ...html.matchAll(/src=["'](https?:\/\/[^"']*(?:\.jpg|\.jpeg|\.png|\.gif|\.webp)[^"']*)['"]/gi)];
      for (const m of thumbMatches) {
        const imgUrl = m[1].replace(/&amp;/g, '&');
        if (!seen.has(imgUrl) && !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('profile_img') && !imgUrl.includes('static')) {
          seen.add(imgUrl);
          results.push({
            id: 'dc_' + Math.random().toString(36).substring(2, 9),
            title: `[DCInside] ${keyword}`,
            url: imgUrl,
            mediaType: imgUrl.toLowerCase().includes('.gif') ? 'gif' : 'image',
            thumbnail: imgUrl,
            date: '최신',
            source: 'DCInside'
          });
          if (results.length >= 10) break;
        }
      }
    } catch (e) {
      // DCInside도 실패하면 그냥 스킵
    }
  }

  return results;
}

/**
 * Fetch direct high-resolution photos, animated GIFs, and pure MP4 videos
 * Multi-Tier Pipeline:
 *  0. Direct SNS URL Parser (X/Twitter, YouTube, Direct Links)
 *  1. [NEW] YouTube Data API v3 (최근 24시간 직캠/영상 - 영상 카테고리 한정)
 *  2. [NEW] 더쿠 핫게시판 크롤링 시도 → DCInside 갤러리 폴백 (아이돌 커뮤니티 실시간 GIF/이미지)
 *  3. Tenor MP4 Direct Video Archive (Dedicated for pure .mp4 videos & moving gifs)
 *  4. Bing Image & GIF HD Search (Primary, 0% IP block, direct original high-res murl)
 *  5. Naver Image Search (Secondary HD with anti-block headers)
 *  6. Daum Image Search (Tertiary fallback)
 */
async function searchVisualMedia(keyword = '여돌 직캠 MP4', page = 1) {
  const mediaList = [];
  const seen = new Set();
  const cleanKeyword = keyword.trim();

  // 0. Direct URL Check
  if (cleanKeyword.startsWith('http://') || cleanKeyword.startsWith('https://')) {
    const directResult = await parseDirectSnsUrl(cleanKeyword);
    if (directResult) {
      return [directResult];
    }
  }

  const isVideoCategory = cleanKeyword.includes('MP4') || cleanKeyword.includes('직캠') || cleanKeyword.includes('영상') || cleanKeyword.includes('음방') || cleanKeyword.includes('현장') || cleanKeyword.includes('핫클립') || cleanKeyword.includes('M2') || cleanKeyword.includes('CHOOM') || cleanKeyword.includes('video') || cleanKeyword.includes('움짤');
  const isForeign = cleanKeyword.includes('barbara') || cleanKeyword.includes('sydney') || cleanKeyword.includes('aesthetic') || cleanKeyword.includes('서양') || cleanKeyword.includes('해외');
  const isIdolCategory = cleanKeyword.includes('직캠') || cleanKeyword.includes('여돌') || cleanKeyword.includes('아이돌') || cleanKeyword.includes('움짤') || cleanKeyword.includes('에스파') || cleanKeyword.includes('아이브') || cleanKeyword.includes('뉴진스') || cleanKeyword.includes('블랙핑크') || cleanKeyword.includes('트와이스') || cleanKeyword.includes('르세라핌') || cleanKeyword.includes('카리나') || cleanKeyword.includes('장원영');

  // 1. [NEW] YouTube Data API v3 - 최근 24시간 영상 (영상 카테고리 & 아이돌 카테고리에서만 실행)
  if ((isVideoCategory || isIdolCategory) && !isForeign && page === 1) {
    const { getConfig } = require('./config');
    const ytApiKey = getConfig().youtubeApiKey;
    if (ytApiKey) {
      const ytResults = await fetchYouTubeVideos(cleanKeyword, ytApiKey);
      for (const item of ytResults) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          mediaList.push(item);
        }
      }
    }
  }

  // 2. [NEW] 더쿠 핫게시판 크롤링 → DCInside 폴백 (아이돌 카테고리 & page 1 한정)
  if (isIdolCategory && !isForeign && page === 1) {
    const communityResults = await fetchCommunityMedia(cleanKeyword);
    for (const item of communityResults) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        mediaList.push(item);
      }
    }
  }


  // 3. Tenor Direct Video/GIF Archive (For pure MP4 videos and high-motion moving GIFs)
  if (isVideoCategory || isForeign) {
    try {
      let searchTarget = cleanKeyword.replace('MP4', '').replace('영상', '').replace('직캠', '').replace('4k', '').replace('4K', '').trim();
      
      // Strict clean English mapping for Tenor to prevent random meme/sticker pollution
      if (cleanKeyword.includes('CHOOM') || cleanKeyword.includes('M2')) {
        searchTarget = 'studio choom';
      } else if (cleanKeyword.includes('음방') || cleanKeyword.includes('Kpop') || cleanKeyword.includes('현장')) {
        searchTarget = 'kpop idol stage dance';
      } else if (!searchTarget || searchTarget === '여돌' || searchTarget === '아이돌') {
        searchTarget = 'kpop girl group fancam';
      } else if (searchTarget.includes('에스파') || searchTarget.includes('카리나')) {
        searchTarget = 'aespa karina fancam';
      } else if (searchTarget.includes('아이브') || searchTarget.includes('장원영')) {
        searchTarget = 'ive wonyoung fancam';
      } else if (searchTarget.includes('뉴진스')) {
        searchTarget = 'newjeans fancam';
      } else if (searchTarget.includes('트와이스')) {
        searchTarget = 'twice fancam';
      } else if (searchTarget.includes('블랙핑크')) {
        searchTarget = 'blackpink fancam';
      } else if (searchTarget.includes('르세라핌')) {
        searchTarget = 'le sserafim fancam';
      }

      const tenorUrl = `https://tenor.com/search/${encodeURIComponent(searchTarget)}-gifs`;
      const res = await axios.get(tenorUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': isForeign ? 'en-US,en;q=0.9' : 'ko-KR,ko;q=0.9,en-US;q=0.8'
        },
        timeout: 5000
      });

      const html = String(res.data);
      const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const s of scripts) {
        if (s[1].includes('"media_formats"')) {
          try {
            const data = JSON.parse(s[1]);
            const searchObj = data.universal?.search || {};
            const firstKey = Object.keys(searchObj)[0];
            const items = searchObj[firstKey]?.results || [];

            for (const item of items) {
              const mp4Url = item.media_formats?.mp4?.url || item.media_formats?.tinymp4?.url;
              const gifUrl = item.media_formats?.gif?.url || item.media_formats?.mediumgif?.url;
              const thumbUrl = item.media_formats?.nanomp4?.url || item.media_formats?.gif?.url || item.media_formats?.tinymp4?.url;
              const titleText = item.content_description || item.title || searchTarget;
              
              const chosenUrl = isVideoCategory ? (mp4Url || gifUrl) : (gifUrl || mp4Url);

              let dateStr = '최신';
              if (item.created) {
                const d = new Date(item.created * 1000);
                if (!isNaN(d.getTime())) {
                  dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
                }
              }

              if (chosenUrl && !seen.has(chosenUrl)) {
                seen.add(chosenUrl);
                mediaList.push({
                  id: 'media_v_' + Math.random().toString(36).substring(2, 9),
                  title: isVideoCategory ? `[MP4 직캠] ${titleText.substring(0, 45)}` : `[움짤] ${titleText.substring(0, 45)}`,
                  url: chosenUrl,
                  mediaType: isVideoCategory ? 'video' : 'gif',
                  thumbnail: thumbUrl || chosenUrl,
                  date: dateStr,
                  source: 'Tenor Video'
                });
              }
            }
          } catch (jsonErr) {}
        }
      }
    } catch (tErr) {
      // fallback to Bing
    }

    if (mediaList.length > 0) {
      // Sort Tenor items by descending timestamp / date (newest first)
      mediaList.sort((a, b) => {
        const parseDateWeight = (dateStr) => {
          if (!dateStr || dateStr === '연도미상') return 0;
          if (dateStr.includes('시간 전') || dateStr.includes('분 전') || dateStr.includes('방금') || dateStr === '최신') return 999999;
          if (dateStr.includes('일 전')) {
            const days = parseInt(dateStr, 10) || 1;
            return 999000 - days * 10;
          }
          const match = dateStr.match(/\b(201\d|202\d)(?:\.(\d{1,2}))?\b/);
          if (match) {
            const y = parseInt(match[1], 10);
            const m = parseInt(match[2] || '1', 10);
            return y * 100 + m;
          }
          return 1;
        };
        return parseDateWeight(b.date) - parseDateWeight(a.date);
      });
      return mediaList.slice(0, 30);
    }
  }

  // Map keywords to optimized high-precision search queries
  let searchQuery = cleanKeyword;

  // 2. Bing Image & GIF HD Search (Primary HD source - 0% 403 blocks)
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(searchQuery)}&form=HDRSC2&first=${(page - 1) * 30 + 1}`;
    const res = await axios.get(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': isForeign ? 'en-US,en;q=0.9' : 'ko-KR,ko;q=0.9,en-US;q=0.8'
      },
      timeout: 4500
    });

    const murlMatches = [
      ...String(res.data).matchAll(/class="iusc"[^>]*m="([^"]+)"/gi),
      ...String(res.data).matchAll(/m="(\{[^"]+\})"/gi)
    ];

    for (const m of murlMatches) {
      try {
        const rawJson = m[1].replace(/&quot;/g, '"');
        const data = JSON.parse(rawJson);
        const url = data.murl ? data.murl.replace(/\\/g, '') : '';
        const titleText = (data.t || data.desc || '').replace(/|/g, '').replace(/\|.*$/, '').trim();

        // Extract exact upload year and month from URL path, page link, or description using 5-tier regex
        let dateStr = '연도미상';
        const textToSearch = `${url} ${data.purl || ''} ${data.desc || ''} ${data.t || ''}`;
        
        const match1 = textToSearch.match(/\b(201\d|202\d)[\/\.\-_](\d{1,2})\b/);
        const match2 = textToSearch.match(/\b(201\d|202\d)(\d{2})(\d{2})\b/);
        const match3 = textToSearch.match(/\b(201\d|202\d)년\s*(\d{1,2})?월?/);
        const match4 = textToSearch.match(/\b(201[5-9]|202[0-6])\b/);

        if (match1) {
          dateStr = `${match1[1]}.${match1[2].padStart(2, '0')}`;
        } else if (match2 && parseInt(match2[2]) >= 1 && parseInt(match2[2]) <= 12) {
          dateStr = `${match2[1]}.${match2[2]}`;
        } else if (match3) {
          dateStr = match3[2] ? `${match3[1]}.${match3[2].padStart(2, '0')}` : `${match3[1]}`;
        } else if (match4) {
          dateStr = `${match4[1]}`;
        }

        if (url && !seen.has(url) && !url.includes('logo') && !url.includes('icon') && !url.includes('favicon')) {
          seen.add(url);
          const isGif = url.toLowerCase().includes('.gif');
          const finalTitle = titleText && titleText.length > 2 ? titleText : cleanKeyword;
          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            title: `[${cleanKeyword}] ${finalTitle}`,
            url: url,
            mediaType: isGif ? 'gif' : 'image',
            thumbnail: url,
            date: dateStr,
            source: 'Bing'
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    // silently fallback to Naver / Daum
  }

  // 3. Naver Image Search (Secondary HD source - only for domestic queries)
  if (!isForeign && mediaList.length < 25) {
    try {
      const naverUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(cleanKeyword)}&start=${(page - 1) * 30 + 1}`;
      const res = await axios.get(naverUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
          'Referer': 'https://www.naver.com/'
        },
        timeout: 4500
      });

      const html = String(res.data);
      const matches = [
        ...html.matchAll(/"originalUrl":"(https?:\/\/[^"]+)"/gi),
        ...html.matchAll(/"thumbnail":"(https?:\/\/[^"]+)"/gi)
      ];

      for (const m of matches) {
        let url = m[1].replace(/\\/g, '').replace(/&amp;/g, '&');
        if (
          url &&
          !seen.has(url) &&
          !url.includes('logo') &&
          !url.includes('icon') &&
          !url.includes('favicon') &&
          !url.includes('ssl.pstatic.net/sstatic') &&
          !url.includes('static.naver')
        ) {
          seen.add(url);
          const isGif = url.toLowerCase().includes('.gif');

          let dateStr = '연도미상';
          const match1 = url.match(/\b(201\d|202\d)[\/\.\-_](\d{1,2})\b/);
          const match2 = url.match(/\b(201\d|202\d)(\d{2})(\d{2})\b/);
          const match3 = url.match(/\b(201[5-9]|202[0-6])\b/);
          if (match1) {
            dateStr = `${match1[1]}.${match1[2].padStart(2, '0')}`;
          } else if (match2 && parseInt(match2[2]) >= 1 && parseInt(match2[2]) <= 12) {
            dateStr = `${match2[1]}.${match2[2]}`;
          } else if (match3) {
            dateStr = `${match3[1]}`;
          }

          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            title: `[${cleanKeyword}] ${cleanKeyword} ${isGif ? '🎬 움짤' : '📷 화보'}`,
            url: url,
            mediaType: isGif ? 'gif' : 'image',
            thumbnail: url,
            date: dateStr,
            source: 'Naver'
          });
        }
      }
    } catch (e) {
      // ignore 403
    }
  }

  // 4. Daum Image Search (Supplement / Tertiary source - domestic only)
  if (!isForeign && mediaList.length < 25) {
    try {
      const daumUrl = `https://search.daum.net/search?w=img&q=${encodeURIComponent(cleanKeyword)}`;
      const res = await axios.get(daumUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://www.daum.net/'
        },
        timeout: 4500
      });

      const dHtml = String(res.data);
      const dMatches = [...dHtml.matchAll(/"(https?:\/\/[^"]+?\.(?:jpg|jpeg|png|webp|gif)[^"]*?)"/gi)];

      for (const m of dMatches) {
        let url = m[1].replace(/&amp;/g, '&');
        if (
          url &&
          !seen.has(url) &&
          !url.includes('logo') &&
          !url.includes('icon') &&
          !url.includes('favicon') &&
          !url.includes('daumcdn.net/daumtop') &&
          !url.includes('daum_og.png')
        ) {
          seen.add(url);
          const isGif = url.toLowerCase().includes('.gif');
          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            mediaType: isGif ? 'gif' : 'image',
            thumbnail: url,
            source: 'Daum'
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Sort results by date descending (Newest/Latest items FIRST, older items towards the back)
  mediaList.sort((a, b) => {
    const parseDateWeight = (dateStr) => {
      if (!dateStr || dateStr === '연도미상') return 0;
      if (dateStr.includes('시간 전') || dateStr.includes('분 전') || dateStr.includes('방금') || dateStr === '최신') return 999999;
      if (dateStr.includes('일 전')) {
        const days = parseInt(dateStr, 10) || 1;
        return 999000 - days * 10;
      }
      const match = dateStr.match(/\b(201\d|202\d)(?:\.(\d{1,2}))?\b/);
      if (match) {
        const y = parseInt(match[1], 10);
        const m = parseInt(match[2] || '1', 10);
        return y * 100 + m;
      }
      return 1;
    };

    return parseDateWeight(b.date) - parseDateWeight(a.date);
  });

  return mediaList.slice(0, 30);
}

/**
 * Generate Attention-Grabbing Viral X Tweets for Visual Photos & Videos
 */
async function generateVisualTweet(titleOrTopic = '코스프레 화보', style = 'shock', imageUrl = '', mediaDate = '연도미상') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  const currentYear = new Date().getFullYear(); // 2026
  let isPastMedia = false;
  let yearNum = null;
  if (mediaDate && mediaDate !== '연도미상') {
    const yMatch = mediaDate.match(/\b(201\d|202\d)\b/);
    if (yMatch) {
      yearNum = parseInt(yMatch[1], 10);
      if (yearNum <= currentYear - 1) {
        isPastMedia = true;
      }
    }
  }

  // Time-aware context instruction for AI
  let timeContextPrompt = '';
  if (isPastMedia && yearNum) {
    timeContextPrompt = `
⏰ [미디어 등록 시점 - 과거 레전드 짤 인식 필수]:
- 이 사진/움짤은 **${mediaDate} (약 ${currentYear - yearNum}년 전)** 과거 자료입니다.
- 🛑 절대 금지: "이번", "최근", "신상", "요즘 나온", "방금 올라온" 처럼 최근 일인 척 사기 치지 마세요!
- ⭕ 사람 같은 리액션: "다시 봐도", "언제 봐도 레전드", "이 시절 폼", "${yearNum}년도 이때 분위기 진짜 미쳤었는데", "주기적으로 봐줘야 하는 레전드 짤", "시간 지나도 여전히 압도적" 등 명작 회상/레전드 재조명 톤으로 작성하세요!
`;
  } else {
    timeContextPrompt = `
⏰ [미디어 등록 시점]:
- ${mediaDate === '연도미상' ? '등록 시점 미상이므로 "이번", "최근"이라는 말은 남발하지 말고 사진/영상의 비주얼 분위기 자체에 집중하세요.' : `최근(${mediaDate}) 미디어입니다. 최신 트렌드/폼에 맞는 자연스러운 리액션으로 작성하세요.`}
`;
  }

  // Style Prompt Definitions (Ultra-Realistic X Native Tones - No weird jargon)
  // Style Prompt Definitions (Ultra-Realistic X Native Tones - Diverse Openings & Patterns)
  let styleInstruction = '';
  if (style === 'admire') {
    // 🌸 2030 남성 시점 쿨한 감탄
    styleInstruction = `
- 톤앤매너: 2030 남초 커뮤니티/트위터에서 비주얼에 감탄해 무심한 듯 툭 던진 리얼 감탄.
- 말투 변주 (다양하게 활용):
  * "와 이건 분위기가 다 했다 진짜.."
  * "실물 포스 장난 아니네 눈빛 보소"
  * "착장이랑 컨셉 매칭 폼 미쳤음 ㄷㄷ"
  * "솔직히 비주얼로 그냥 압도하네"
- 핵심: 고정된 문장 시작 금지. 시각적 분위기와 아우라에 집중하는 1~2줄 구어체.`;
  } else if (style === 'question') {
    // 💬 질문/반응 유도 (댓글 54배)
    styleInstruction = `
- 톤앤매너: 유저들이 자기도 모르게 답글이나 인용을 달고 싶어지는 직관적인 질문/토론.
- 말투 변주 (다양하게 활용):
  * "솔직히 이 컨셉 흑발 vs 갈발 뭐가 더 취향임?"
  * "이거 보고 다들 무슨 생각 듦? 나만 홀린 거 아니지 ㅋㅋ"
  * "이 착장 분위기 진짜 독보적인데 몇 점짜리냐"
  * "이 표정 연출은 솔직히 반칙 아니냐고 ㅋㅋㅋ"
- 핵심: 틀에 박힌 말투 없이 자연스러운 소통형 질문.`;
  } else if (style === 'spicy') {
    // 🌶️ 도파민 매운맛
    styleInstruction = `
- 톤앤매너: 도파민 터지는 찰진 드립과 유쾌한 찐 리액션.
- 말투 변주 (다양하게 활용):
  * "사람이 어떻게 이렇게 생김? 혼자 필터 씌우고 사네 ㅋㅋㅋ"
  * "이 정도면 그냥 화면 찢고 나오는 수준 아니냐 ㄷㄷ"
  * "심장에 무리 오는 비주얼 실화냐 진짜 ㅋㅋㅋ"
  * "이 짤은 무조건 북마크 박고 시작해야 됨 🔥"
- 핵심: 살아있는 인터넷 유행어와 ㅋㅋㅋ를 적절히 섞어 유쾌하게 작성.`;
  } else if (style === 'bridge') {
    // ⚡ 융합 브릿지
    styleInstruction = `
- 톤앤매너: 비주얼 사진을 계기로 요즘 트렌드나 숏폼/화보 감성에 대해 짤막하게 한 마디 얹는 인플루언서 멘트.
- 말투 변주: "요즘 트렌드 확실히 이쪽 무드로 넘어온 듯", "비주얼도 비주얼인데 기획력이 진짜 미쳤네"`;
  } else {
    // 🔥 기본: 심쿵/알고리즘 훅
    styleInstruction = `
- 톤앤매너: 시선 강탈당해 뇌정지 온 순간을 생생하게 담은 강렬한 리액션.
- 말투 변주 (절대 매번 똑같이 쓰지 말고 다양하게 변형):
  * "보자마자 1초 만에 멍때리고 쳐다봄.."
  * "아니 이 분위기는 대체 어떻게 내는 거임? ㄷㄷ"
  * "첫 컷부터 시선 뺏겨서 헤어나오질 못하겠네 ✨"
  * "이목구비 자기주장 살벌한 거 보소 😮"
  * "알고리즘 열일하네 이런 갓벽한 짤을 다 띄워주고"
- 핵심: 감탄사, 리얼한 여운, 간결하고 강렬한 1~2줄.`;
  }

  if (apiKey) {
    // Try to fetch image buffer for Gemini Vision Multimodal analysis
    let imageInlinePart = null;
    if (imageUrl && imageUrl.startsWith('http')) {
      try {
        const imgFetchRes = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          },
          timeout: 4000
        });
        const rawMime = imgFetchRes.headers['content-type'] || 'image/jpeg';
        const mimeType = rawMime.split(';')[0].trim();
        // Gemini supports image/png, image/jpeg, image/webp, image/heic, image/heif
        if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
          const base64Data = Buffer.from(imgFetchRes.data).toString('base64');
          imageInlinePart = {
            inlineData: {
              mimeType: mimeType === 'image/gif' ? 'image/jpeg' : mimeType,
              data: base64Data
            }
          };
        }
      } catch (imgErr) {
        // Fallback to text-only prompt
      }
    }

    const hasVision = !!imageInlinePart;
    const promptText = `
당신은 X(트위터)에서 트렌드를 이끄는 리얼 한국인 유저입니다. (현재 연도: ${currentYear}년)
${hasVision ? '첨부된 사진/미디어를 직접 시각적으로 살펴보고,' : ''} 아래 주제, 시점 지침, 스타일 지침에 맞춰 **실제 사람이 폰으로 작성한 것 같은 100% 자연스럽고 참신한 한글 트윗**을 딱 1~2줄로 작성하세요.

[미디어 주제/분위기]: ${titleOrTopic}
[미디어 날짜 정보]: ${mediaDate}
${timeContextPrompt}

[스타일 지침]:
${styleInstruction}

🚨 [필수 작성 원칙 - 인물명 자연스러운 언급 & 다채로운 문장 구조]:
1. 👤 **인물 이름 언급 규칙**:
   - [미디어 주제/분위기]나 제목에 연예인/모델/인플루언서 이름(예: '바바라 팔빈', '시드니 스위니', '카리나', '장원영', '안유진', '정호연', '설현', '윈터' 등)이 포함되어 있다면, **트윗 멘트에 그 사람 이름을 자연스럽게 넣어서 작성하세요!** (예: "바바라 팔빈 이 시절 미모는 진짜 전설이다..", "시드니 스위니 눈빛 보소 분위기 미쳤네", "카리나 착장 소화력 실화냐 ㄷㄷ")
   - 단, 제목에 이름이 없는 경우에는 엉뚱한 가상의 이름을 지어내지 말고 분위기/비주얼/착장 자체에 대한 감탄으로 작성하세요.
2. 🛑 **절대 금지: '스크롤 내리다' 같은 뻔한 시작 금지 & 표현 중복 금지**:
   - "스크롤 내리다 멈칫함", "스크롤 내리다가" 등 똑같은 문장으로 시작하지 마세요!
   - 매번 같은 단어("미쳤다", "레전드")만 앵무새처럼 반복하지 말고, "독보적", "갓벽", "탈인간급", "아우라", "홀렸다", "눈부시다", "존재감", "반칙", "취향저격" 등 **단어와 문장 구조를 매번 신선하고 다채롭게 변주**하세요.
3. 🛑 **'탐라' 은어, 안내원 말투 금지**:
   - '탐라'라는 단어는 절대로 쓰지 마세요!
   - "~에 대해 알아보겠습니다", "~를 추천합니다", "~골라주세요", "~어떠신가요?" 같은 안내원 말투 100% 금지!
4. 🛑 **해시태그(#) 본문 직접 삽입 금지**:
   - 본문 텍스트 안에 해시태그(#)를 직접 붙이지 마세요! 오직 멘트 문장만 작성하세요.
5. ⭕ **리얼 트위터/커뮤니티 구어체 사용**:
   - "ㄷㄷ", "ㅋㅋㅋ", "..", "진짜", "실화냐", "폼 미침", "살벌하네", "반칙", "장난 없네" 등 진짜 사람들이 쓰는 짧고 찰진 어미를 활용하세요.
6. 📏 **길이**: 가독성 좋은 1~2줄 (공백 포함 40~80자 내외).
7. ✍️ 오직 완성된 트윗 본문만 출력하세요 (따옴표, 해시태그, 부연 설명 일체 금지).
`;

    const parts = [{ text: promptText }];
    if (imageInlinePart) {
      parts.push(imageInlinePart);
    }

    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash'
    ];

    for (const modelName of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await axios.post(
          url,
          { contents: [{ parts }], generationConfig: { temperature: 1.0 } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
        );

        let text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text.length > 5) {
          text = text.replace(/^["']|["']$/g, '').replace(/#[^\s#]+/g, '').trim();
          addLog('SUCCESS', `📸 비주얼 바이럴 트윗 ${hasVision ? '(Gemini 시각 분석)' : '(텍스트 분석)'} AI 생성 완료 (${text.length}자)`);
          return { text, isAiGenerated: true, style, suggestedTags: getSuggestedTags(titleOrTopic, isPastMedia, yearNum) };
        }
      } catch (e) {
        // try next model
      }
    }
  }

  // High-Quality Diverse Human Fallback Templates
  const fallbacks = {
    admire: isPastMedia ? [
      `다시 봐도 이때 컨셉이랑 착장은 진짜 레전드였음.. 분위기 살벌하네 ㄷㄷ ✨`,
      `언제 봐도 이 시절 폼은 탈인간급임.. 실물 포스 미쳤다 🌸`,
      `주기적으로 봐줘야 하는 레전드 짤 보소.. 이건 영구 소장각 🔥`,
      `이때 분위기는 진짜 세월이 지나도 독보적이네.. 아우라 미쳤음 ✨`
    ] : [
      `와 분위기 진짜 무슨 일임? 사진 한 장으로 존재감 다 압도하네 ㄷㄷ ✨`,
      `볼 때마다 느끼는 건데 폼이 그냥 탈인간급임.. 실물 포스 살벌하네 🌸`,
      `화면 뚫고 나오는 아우라 보소.. 이건 저장 안 할 수가 없다 🔥`,
      `착장이랑 비주얼 싱크로율 진짜 완벽하다.. 감탄만 나옴 😮`
    ],
    question: [
      `솔직히 이 착장 1번 vs 2번 중에 뭐가 더 레전드임? 다들 뭐 고름? 👀`,
      `이거 보고 다들 무슨 생각 듦? 나만 순간 멍때린 거 아니지 💬`,
      `이 컨셉 소화력 실화냐.. 10점 만점에 다들 몇 점 줌? 🔥`
    ],
    spicy: [
      `사람이 어떻게 이렇게 생김? 혼자 다른 세상 살고 있네 폼 미쳤음 ㅋㅋㅋ 🔥`,
      `이 정도면 그냥 화면 찢고 나오는 수준 아니냐 ㄷㄷ 심장에 무리 옴`,
      `아직도 이거 안 본 사람 없제? ㅋㅋㅋ 성지순례 와라 🚀`
    ],
    bridge: [
      `비주얼 트렌드 보면 확실히 무드가 독보적인 듯.. 기획력이 진짜 다했다 🔥`,
      `요즘 왜 이런 컨셉이 계속 화제 되는지 바로 이해됨.. 매력 미쳤네 ✨`
    ],
    shock: isPastMedia ? [
      `시간 지나서 다시 보는데도 감탄만 나오네.. 명작은 영원하다 ✨`,
      `이때 이목구비 자기주장 살벌했던 거 보소.. 다시 봐도 갓벽하네 ㄷㄷ 🌸`,
      `알고리즘이 왜 이 과거 영상을 다시 띄우는지 딱 1초 만에 납득함 😮`
    ] : [
      `첫 컷 보자마자 손가락 굳어버림.. 비주얼 진짜 독보적이네 ✨`,
      `아니 이 분위기는 대체 어떻게 내는 거임? 눈빛 살벌하다 진짜 ㄷㄷ 🌸`,
      `한 번 보면 끝까지 넋 놓고 보게 되네.. 실시간 반응 터질 만함 😮`,
      `보자마자 1초 만에 납득함.. 폼 미쳤다는 말밖에 안 나오네 🔥`
    ]
  };

  const list = fallbacks[style] || fallbacks.shock;
  let text = list[Math.floor(Math.random() * list.length)];
  text = text.replace(/#[^\s#]+/g, '').trim();

  return { text, isAiGenerated: false, style, suggestedTags: getSuggestedTags(titleOrTopic, isPastMedia, yearNum) };
}

function getSuggestedTags(topic = '', isPast = false, year = null) {
  const baseTags = [];
  const t = topic.toLowerCase();
  const today = new Date();
  const yymmdd = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;

  // ✅ 구체적 아이돌명/그룹명 태그 우선 (포괄적 태그 최소화)
  const idolTagMap = [
    { keys: ['에스파', 'aespa'], tags: ['#에스파', '#aespa', '#직캠'] },
    { keys: ['카리나'], tags: ['#카리나', '#에스파', '#직캠'] },
    { keys: ['윈터'], tags: ['#윈터', '#에스파', '#직캠'] },
    { keys: ['아이브', 'ive'], tags: ['#아이브', '#IVE', '#직캠'] },
    { keys: ['장원영'], tags: ['#장원영', '#아이브', '#직캠'] },
    { keys: ['안유진'], tags: ['#안유진', '#아이브', '#직캠'] },
    { keys: ['뉴진스', 'newjeans'], tags: ['#뉴진스', '#NewJeans', '#직캠'] },
    { keys: ['블랙핑크', 'blackpink'], tags: ['#블랙핑크', '#BLACKPINK', '#직캠'] },
    { keys: ['지수'], tags: ['#지수', '#블랙핑크', '#직캠'] },
    { keys: ['리사'], tags: ['#LISA', '#블랙핑크', '#직캠'] },
    { keys: ['트와이스', 'twice'], tags: ['#트와이스', '#TWICE', '#직캠'] },
    { keys: ['르세라핌', 'lesserafim'], tags: ['#르세라핌', '#LESSERAFIM', '#직캠'] },
    { keys: ['여자아이들', 'gidle'], tags: ['#여자아이들', '#GIDLE', '#직캠'] },
    { keys: ['레드벨벳'], tags: ['#레드벨벳', '#RedVelvet', '#직캠'] },
    { keys: ['아이유', 'iu'], tags: ['#아이유', '#IU', '#직캠'] },
  ];

  let idolMatched = false;
  for (const { keys, tags } of idolTagMap) {
    if (keys.some(k => t.includes(k))) {
      baseTags.push(...tags);
      idolMatched = true;
      break;
    }
  }

  if (!idolMatched) {
    if (t.includes('코스프레')) {
      baseTags.push('#코스프레', '#cosplay');
    } else if (t.includes('직캠') || t.includes('여돌') || t.includes('움짤')) {
      // 포괄적이지만 아이돌 이름이 없을 때만 사용
      baseTags.push('#여돌직캠', '#kpop직캠');
    } else if (t.includes('수영복') || t.includes('비키니')) {
      baseTags.push('#수영복화보', '#비키니');
    } else if (t.includes('레이싱') || t.includes('치어리더')) {
      baseTags.push('#레이싱모델', '#치어리더');
    } else if (t.includes('그라비아') || t.includes('룩북')) {
      baseTags.push('#룩북', '#그라비아');
    } else if (t.includes('서양') || t.includes('외국') || t.includes('photoshoot')) {
      baseTags.push('#서양모델', '#photoshoot');
    } else if (t.includes('할리우드') || t.includes('셀럽')) {
      baseTags.push('#할리우드', '#해외셀럽');
    } else {
      baseTags.push('#비주얼', '#모델');
    }
  }

  // 날짜/레전드 태그
  if (isPast && year) {
    baseTags.push(`#${year}년레전드`, '#추억소환');
  } else {
    // ✅ YYMMDD 형태 날짜 태그 (팬덤 트위터 형식)
    baseTags.push(`#${yymmdd}_직캠`, '#핫클립');
  }

  return [...new Set(baseTags)].slice(0, 5);
}

module.exports = {
  VISUAL_PRESETS,
  searchVisualMedia,
  generateVisualTweet,
  fetchYouTubeVideos,
  fetchCommunityMedia,
  testYouTubeApiConnection,
  getLatestYouTubeStatus
};



