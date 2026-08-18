const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

// Preset Visual Keyword Categories
const VISUAL_PRESETS = [
  { id: 'cosplay', name: '👙 코스프레 / 화보', query: '코스프레 화보' },
  { id: 'idol_fancam', name: '💃 여돌 직캠 / 움짤', query: '여돌 직캠 레전드 움짤' },
  { id: 'video_archive', name: '🎬 직캠/핫클립 MP4 영상', query: '여돌 직캠 MP4' },
  { id: 'influencer', name: '✨ 모델 / 인플루언서', query: '인스타 모델 비주얼 화보' },
  { id: 'swimwear', name: '🌊 수영복 / 비키니', query: '수영복 모델 화보' },
  { id: 'racing_cheer', name: '🏎️ 레이싱모델 / 치어리더', query: '레이싱모델 치어리더 화보' },
  { id: 'gravure', name: '🌸 그라비아 / 룩북', query: '일본 모델 화보' }
];

/**
 * Fetch direct high-resolution photos, animated GIFs, and pure MP4 videos
 * Multi-Tier Pipeline:
 *  1. Tenor MP4 Direct Video Archive (Dedicated for pure .mp4 videos)
 *  2. Bing Image & GIF HD Search (Primary, 0% IP block, direct original high-res murl)
 *  3. Naver Image Search (Secondary HD with anti-block headers)
 *  4. Daum Image Search (Tertiary fallback)
 */
async function searchVisualMedia(keyword = '코스프레 화보', page = 1) {
  const mediaList = [];
  const seen = new Set();
  const cleanKeyword = keyword.trim();
  const isVideoCategory = cleanKeyword.includes('MP4') || cleanKeyword.includes('영상') || cleanKeyword.includes('video');

  // 1. Tenor MP4 Direct Video Search (For pure MP4 video streaming and direct file download)
  if (isVideoCategory) {
    try {
      const searchTarget = cleanKeyword.replace('MP4', '').replace('영상', '').trim() || '여돌 직캠';
      const tenorUrl = `https://tenor.com/search/${encodeURIComponent(searchTarget)}-gifs`;
      const res = await axios.get(tenorUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
        },
        timeout: 5000
      });

      const html = String(res.data);
      const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const s of scripts) {
        if (s[1].includes('"media_formats"') && s[1].includes('"mp4"')) {
          try {
            const data = JSON.parse(s[1]);
            const searchObj = data.universal?.search || {};
            const firstKey = Object.keys(searchObj)[0];
            const items = searchObj[firstKey]?.results || [];

            for (const item of items) {
              const mp4Url = item.media_formats?.mp4?.url || item.media_formats?.tinymp4?.url;
              const thumbUrl = item.media_formats?.nanomp4?.url || item.media_formats?.gif?.url || item.media_formats?.tinymp4?.url;
              const titleText = item.content_description || item.title || searchTarget;
              
              // Created date or relative tag
              let dateStr = '최신';
              if (item.created) {
                const d = new Date(item.created * 1000);
                if (!isNaN(d.getTime())) {
                  dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
                }
              }

              if (mp4Url && !seen.has(mp4Url)) {
                seen.add(mp4Url);
                mediaList.push({
                  id: 'media_v_' + Math.random().toString(36).substring(2, 9),
                  title: `[MP4 영상] ${titleText.substring(0, 45)}`,
                  url: mp4Url,
                  mediaType: 'video',
                  thumbnail: thumbUrl || mp4Url,
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
      return mediaList.slice(0, 30);
    }
  }

  // 2. Bing Image & GIF HD Search (Primary HD source - 0% 403 blocks)
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(cleanKeyword)}&form=HDRSC2&first=${(page - 1) * 30 + 1}`;
    const res = await axios.get(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
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
            source: 'Bing'
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    // silently fallback to Naver / Daum
  }

  // 3. Naver Image Search (Secondary HD source)
  if (mediaList.length < 25) {
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
          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            title: `[${cleanKeyword}] ${cleanKeyword} ${isGif ? '🎬 움짤' : '📷 화보'}`,
            url: url,
            mediaType: isGif ? 'gif' : 'image',
            thumbnail: url,
            date: '최신',
            source: 'Naver'
          });
        }
      }
    } catch (e) {
      // ignore 403
    }
  }

  // 4. Daum Image Search (Supplement / Tertiary source)
  if (mediaList.length < 25) {
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
            title: `[${cleanKeyword}] ${cleanKeyword} ${isGif ? '🎬 움짤' : '📷 화보'}`,
            url: url,
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

  return mediaList.slice(0, 30);
}

/**
 * Generate Attention-Grabbing Viral X Tweets for Visual Photos & Videos
 */
async function generateVisualTweet(titleOrTopic = '코스프레 화보', style = 'shock', imageUrl = '') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  // Style Prompt Definitions (Ultra-Realistic X Native Tones - No weird jargon)
  let styleInstruction = '';
  if (style === 'admire') {
    // 🌸 2030 남성 시점 쿨한 감탄
    styleInstruction = `
- 톤앤매너: 진짜 2030 남초 커뮤니티 유저가 피드에서 사진 보고 감탄해서 툭 뱉은 혼잣말 느낌.
- 말투: "~함", "~인 듯", "~보소", "~진짜 미쳤네", "~미쳤다 ㄷㄷ", "~실물 느낌 살벌하네"
- 핵심: 너무 진지하거나 홍보성 멘트 금지. 무심한 듯 감탄하는 1~2줄 구어체.`;
  } else if (style === 'question') {
    // 💬 질문/반응 유도 (댓글 54배)
    styleInstruction = `
- 톤앤매너: 유저들끼리 취향 갈릴 만한 포인트를 콕 집어 가볍게 던지는 투표/토론형 멘트.
- 말투: "~아님?", "~어떤 게 더 취향임?", "~vs~ 다들 뭐 고름?", "~이거 나만 그렇게 느낌?", "솔직히 ~는 반칙 아니냐 ㅋㅋ"
- 핵심: 로봇 같은 '투표해주세요' 말투 절대 금지. 유저들이 자기도 모르게 답글 달고 싶게 툭 던지는 질문.`;
  } else if (style === 'spicy') {
    // 🌶️ 도파민 매운맛
    styleInstruction = `
- 톤앤매너: 도파민 폭발하는 찰진 드립과 웃긴 리액션.
- 말투: "~실화냐 ㅋㅋㅋ", "~혼자 다른 세상 사네", "~폼 미쳤다 진짜", "~알고리즘이 날 살렸네", "~이러면 반칙이지 ㄷㄷ"
- 핵심: 친근한 ㅋㅋㅋ와 살아있는 인터넷 유행어를 섞어 유쾌하게 작성.`;
  } else if (style === 'bridge') {
    // ⚡ 융합 브릿지
    styleInstruction = `
- 톤앤매너: 비주얼 사진을 계기로 요즘 트렌드나 숏폼/화보 감성에 대해 짤막하게 한 마디 얹는 인플루언서 멘트.
- 말투: "~보면 진짜 트렌드가 확실히 바뀐 듯", "~이런 무드가 요즘 왜 뜨는지 알겠다"`;
  } else {
    // 🔥 기본: 심쿵/알고리즘 훅
    styleInstruction = `
- 톤앤매너: 스크롤 내리다 시선 강탈당해 손가락 멈추고 쓴 찐 리액션.
- 말투: "알고리즘이 왜 이 영상을 계속 띄우는지 바로 납득함..", "방금 스크롤 내리다 멈칫함 ㄷㄷ", "와 이건 저장 안 할 수가 없네"
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
당신은 X(트위터)에서 트렌드를 이끄는 리얼 한국인 유저입니다.
${hasVision ? '첨부된 사진/미디어를 직접 시각적으로 살펴보고,' : ''} 아래 주제와 스타일 지침에 맞춰 **실제 사람이 폰으로 작성한 것 같은 100% 자연스러운 한글 트윗**을 딱 1~2줄로 작성하세요.

[미디어 주제/분위기]: ${titleOrTopic}

[스타일 지침]:
${styleInstruction}

🚨 [필수 작성 원칙 - AI 느낌 및 어색한 은어 완전 박멸]:
1. 🛑 **절대 금지: '탐라' 같은 낯선 은어 & 딱딱한 설명문 금지**:
   - '탐라'라는 단어는 절대로 쓰지 마세요! (대신 "피드", "스크롤 내리다가", "알고리즘" 같은 자연스러운 표현 사용)
   - "~에 대해 알아보겠습니다", "~를 추천합니다", "~골라주세요", "~어떠신가요?" 같은 안내원 말투 100% 금지!
   - 엉뚱한 사람 이름을 지어내지 말고, 사진 속 비주얼/분위기/착장/포즈 자체에 대한 리액션으로 작성하세요.
2. ⭕ **리얼 트위터/커뮤니티 구어체 사용**:
   - "ㄷㄷ", "ㅋㅋㅋ", "..", "진짜", "실화냐", "폼 미침", "살벌하네", "반칙" 등 진짜 사람들이 쓰는 짧고 찰진 어미를 활용하세요.
3. 📏 **길이**: 가독성 좋은 1~2줄 (공백 포함 50~100자 내외).
4. 🏷️ **해시태그**: 끝에 자연스러운 해시태그 1~2개만 가볍게 첨부 (예: #비주얼 #직캠 #핫클립 등).
5. ✍️ 오직 완성된 트윗 본문만 출력하세요 (따옴표나 부연 설명 일체 금지).
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
          { contents: [{ parts }], generationConfig: { temperature: 0.95 } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
        );

        let text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text.length > 5) {
          text = text.replace(/^["']|["']$/g, '').trim();
          addLog('SUCCESS', `📸 비주얼 바이럴 트윗 ${hasVision ? '(Gemini 시각 분석)' : '(텍스트 분석)'} AI 생성 완료 (${text.length}자)`);
          return { text, isAiGenerated: true, style };
        }
      } catch (e) {
        // try next model
      }
    }
  }

  // High-Quality Human Fallback Templates
  const fallbacks = {
    admire: [
      `와 이번 착장이랑 컨셉 진짜 미쳤다.. 사진 한 장으로 분위기 다 압도하네 ㄷㄷ ✨ #비주얼 #화보`,
      `볼 때마다 느끼는 건데 폼이 그냥 탈인간급임.. 실물 포스 살벌하네 🌸 #레전드 #화보`,
      `화면 뚫고 나오는 비주얼 보소.. 이건 저장 안 할 수가 없다 🔥 #스타일`
    ],
    question: [
      `솔직히 이 착장 1번 vs 2번 중에 뭐가 더 레전드임? 다들 뭐 고름? 👀 #투표 #비주얼`,
      `이 영상 보고 뇌정지 왔는데.. 다들 어떻게 생각함? 실시간으로 피드 씹어먹는 중 💬 #핫클립 #직캠`
    ],
    spicy: [
      `이 정도면 그냥 화면 찢고 나오는 수준 아니냐 ㅋㅋㅋ 혼자 다른 세상 사네 폼 미쳤음 🔥`,
      `아직도 이거 안 본 사람 없제? ㅋㅋㅋ 실시간으로 피드 다 터지는 중 성지순례 와라 🚀`
    ],
    bridge: [
      `요즘 비주얼 트렌드 보면 확실히 무드가 바뀐 듯.. 결국 시선을 사로잡는 기획력이 전부다 🔥 #트렌드 #인사이트`
    ],
    shock: [
      `알고리즘이 왜 이 영상을 계속 띄우는지 딱 1초 만에 납득함.. 분위기 진짜 독보적이네 ✨ #핫클립 #레전드`,
      `방금 스크롤 내리다가 폰 떨어뜨릴 뻔함;; 이목구비 자기주장 살벌하다 진짜 ㄷㄷ 🌸 #비주얼`,
      `이건 알고리즘도 무조건 멈추게 만드네.. 실시간으로 반응 터진 이유가 있었음 😮 #화보`
    ]
  };

  const list = fallbacks[style] || fallbacks.shock;
  const text = list[Math.floor(Math.random() * list.length)];

  return { text, isAiGenerated: false, style };
}

module.exports = {
  VISUAL_PRESETS,
  searchVisualMedia,
  generateVisualTweet
};
