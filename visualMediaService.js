const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

// Preset Visual Keyword Categories
const VISUAL_PRESETS = [
  { id: 'cosplay', name: '👙 코스프레 / 화보', query: '코스프레 화보' },
  { id: 'idol_fancam', name: '💃 여돌 직캠 / 댄스', query: '여돌 직캠 레전드' },
  { id: 'video_shorts', name: '🎬 인기 핫클립 / 숏폼', query: '인기 핫클립 숏폼 비디오' },
  { id: 'influencer', name: '✨ 모델 / 인플루언서', query: '인스타 모델 비주얼 화보' },
  { id: 'swimwear', name: '🌊 수영복 / 비키니', query: '수영복 모델 화보' },
  { id: 'racing_cheer', name: '🏎️ 레이싱모델 / 치어리더', query: '레이싱모델 치어리더 직캠 화보' },
  { id: 'gravure', name: '🌸 그라비아 / 룩북', query: '일본 모델 화보' }
];

/**
 * Fetch high-resolution photos, animated GIFs, and videos from search engines
 * 4-Tier Robust Hybrid Pipeline:
 *  1. Bing Videos & HD Images (Primary, 0% IP block, direct original high-res murl/video)
 *  2. Naver Image Search (Secondary HD with updated anti-block headers)
 *  3. Daum Image Search (Tertiary fallback)
 */
async function searchVisualMedia(keyword = '코스프레 화보', page = 1) {
  const mediaList = [];
  const seen = new Set();
  const cleanKeyword = keyword.trim();

  // 1. Bing Video Search (If keyword looks like fancam/video or explicit video query)
  const isVideoQuery = cleanKeyword.includes('직캠') || cleanKeyword.includes('영상') || cleanKeyword.includes('댄스') || cleanKeyword.includes('클립') || cleanKeyword.includes('숏폼') || cleanKeyword.includes('video');
  if (isVideoQuery) {
    try {
      const bingVideoUrl = `https://www.bing.com/videos/search?q=${encodeURIComponent(cleanKeyword)}&FORM=HDRSC3`;
      const res = await axios.get(bingVideoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
        },
        timeout: 4500
      });

      const html = String(res.data);
      const vrMatches = [...html.matchAll(/vrhm="([^"]+)"/gi)];
      for (const m of vrMatches.slice(0, 15)) {
        try {
          const rawJson = m[1].replace(/&quot;/g, '"');
          const data = JSON.parse(rawJson);
          const videoTitle = data.vt || data.capt?.de || cleanKeyword;
          const videoUrl = data.murl || data.pgurl || '';
          const thumbUrl = data.smturl || (data.thid ? `https://ts1.mm.bing.net/th?id=${data.thid}&pid=15.1` : '');

          if (videoUrl && !seen.has(videoUrl)) {
            seen.add(videoUrl);
            mediaList.push({
              id: 'media_v_' + Math.random().toString(36).substring(2, 9),
              title: `[영상] ${videoTitle.substring(0, 50)}`,
              url: videoUrl,
              mediaType: 'video',
              thumbnail: thumbUrl || videoUrl,
              duration: data.du || '',
              source: 'Bing Video'
            });
          }
        } catch (e) {}
      }
    } catch (vErr) {
      // fallback to image search
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
          const isMp4 = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('.webm');
          const finalTitle = titleText && titleText.length > 2 ? titleText : cleanKeyword;
          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            title: `[${cleanKeyword}] ${finalTitle}`,
            url: url,
            mediaType: isMp4 ? 'video' : (isGif ? 'gif' : 'image'),
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

  // Style Prompt Definitions
  let styleInstruction = '';
  if (style === 'admire') {
    // 🌸 2030 남성 시점 쿨한 감탄
    styleInstruction = `2030 남성 유저의 쿨하고 담백한 시선으로, 사진/영상을 보고 감탄을 금치 못하는 1~2줄짜리 리얼 트윗을 작성하세요.
- 예시: "와 이번 착장이랑 컨셉 진짜 미쳤다.. 피지컬이랑 분위기 압도적이네 ✨"`;
  } else if (style === 'question') {
    // 💬 질문/반응 유도 (댓글 54배)
    styleInstruction = `팔로워와 타임라인 유저들의 폭발적인 댓글(Reply)과 토론을 이끌어내는 매력적인 질문형 트윗(2줄)으로 작성하세요.
- 예시: "방금 탐라에 떠서 봤는데.. 1번 컨셉 vs 2번 컨셉 다들 어떤 게 더 레전드라고 보시나요? 댓글로 투표 ㄱㄱ 👀"`;
  } else if (style === 'spicy') {
    // 🌶️ 도파민 매운맛
    styleInstruction = `유쾌하고 자신감 넘치는 사이다 화법으로 도파민 터지는 매운맛 썰(2줄)을 작성하세요.
- 예시: "이 정도면 그냥 화면 찢고 나오는 수준 아니냐 ㅋㅋㅋ 혼자만 다른 세상 사네 폼 미쳤음 🔥"`;
  } else if (style === 'bridge') {
    // ⚡ 융합 브릿지
    styleInstruction = `비주얼 화보/영상 소식을 가볍게 칭찬한 뒤, 요즘 트렌드나 숏폼/엔터 패러다임 인사이트로 세련되게 연결하는 2~3줄 트윗으로 작성하세요.`;
  } else {
    // 🔥 기본: 심쿵/어그로 알고리즘 훅
    styleInstruction = `스크롤을 내리던 모든 유저의 엄지손가락을 멀추게 만드는 강력한 호기심/감탄 1줄 훅과 찰진 멘트(2줄)로 작성하세요.
- 예시: "알고리즘이 왜 이 영상을 계속 띄우는지 단 1초 만에 납득함.. 분위기 진짜 독보적이네 홀린 듯이 봤다 ✨"`;
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
당신은 X(트위터)에서 수많은 리트윗과 북마크를 이끌어내는 탑티어 인플루언서입니다.
${hasVision ? '첨부된 사진/미디어를 직접 보고,' : ''} 아래 주제와 스타일 지침을 바탕으로 타임라인에서 시선을 강탈하는 **진짜 사람이 쓴 것 같은 매력적인 한글 바이럴 트윗**을 작성하세요.

[미디어 주제/분위기]: ${titleOrTopic}

[스타일 지침]:
${styleInstruction}

🚨 [필수 작성 규칙]:
1. 🛑 **절대 금지: 인물 이름 지어내기/추측 완전 금지**:
   - 엉뚱한 연예인이나 아이돌, 인플루언서 이름을 절대로 멋대로 지어내서 쓰지 마세요.
   - 특정 인물 이름 대신, 사진 속의 **비주얼, 피지컬, 의상 핏, 헤어/메이크업, 전체적인 무드와 컨셉**에 집중해서 자연스럽고 찰지게 감탄하세요.
2. ❌ "🔹", "🧠", "💡", "1️⃣", "2️⃣" 같은 기계적인 AI 요약 기호나 딱딱한 설명문은 100% 절대 금지합니다.
3. ⭕ 진짜 트위터 유저가 폰으로 방금 보고 홀려서 쓴 것처럼 자연스러운 줄바꿈과 찰진 구어체로 1~3줄 작성하세요.
4. 끝에 어울리는 이모지 1~2개와 트렌드 해시태그 1~2개(예: #비주얼 #화보 #스타일 #핫클립 등)를 자연스럽게 붙이세요.
5. 오직 완성된 트윗 문구만 출력하세요. (따옴표나 부가 설명 금지)
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
          { contents: [{ parts }], generationConfig: { temperature: 0.7 } },
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
      `와 이번 비주얼이랑 분위기 진짜 미쳤다.. 사진 한 장으로 분위기 다 압도하네 ✨ #화보 #비주얼`,
      `볼 때마다 느끼는 건데 컨셉 소화력이랑 피지컬이 그냥 탈인간급임.. 폼 대단하다 🌸 #레전드 #모델`,
      `화면 뚫고 나오는 실물 포스 보소.. 보정할 것도 없겠네 대박이다 🔥 #스타일 #화보`
    ],
    question: [
      `방금 탐라에 떠서 봤는데.. 이 착장 1번 vs 2번 다들 어떤 컨셉이 더 레전드라고 보시나요? 댓글로 투표 ㄱㄱ 👀 #투표 #비주얼`,
      `이 영상 보고 뇌정지 왔는데.. 다들 어떻게 생각하시나요? 반응 실시간으로 폭발하는 중 💬 #직캠 #핫클립`
    ],
    spicy: [
      `이 정도면 그냥 화면 찢고 나오는 수준 아니냐 ㅋㅋㅋ 혼자만 다른 세상 사네 폼 미쳤음 🔥`,
      `아직도 이거 안 본 사람 없제? ㅋㅋㅋ 실시간으로 피드 씹어먹는 중 성지순례 와라 🚀`
    ],
    bridge: [
      `요즘 비주얼 트렌드 보면서 느끼는 건데, 이러다 엔터랑 숏폼 시장도 완전히 재편될 듯. 결국 시선을 사로잡는 기획력이 전부다 🔥 #트렌드 #인사이트`
    ],
    shock: [
      `알고리즘이 왜 이 영상을 계속 띄우는지 단 1초 만에 납득함.. 분위기 진짜 독보적이네 홀린 듯이 봤다 ✨ #핫클립 #레전드`,
      `방금 탐라 내리다가 폰 떨어뜨릴 뻔함;; 이목구비 자기주장 살벌하다 진짜.. 🌸 #비주얼 #화보`,
      `이건 알고리즘도 무조건 멈추게 만드네.. 실시간으로 반응 터진 이유가 있었음 😮 #화보 #스타일`
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
