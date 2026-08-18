const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

// Preset Visual Keyword Categories
const VISUAL_PRESETS = [
  { id: 'cosplay', name: '👙 코스프레 / 화보', query: '코스프레 화보' },
  { id: 'idol_fancam', name: '💃 여돌 직캠 / 댄스', query: '여돌 직캠 레전드 움짤' },
  { id: 'influencer', name: '✨ 모델 / 인플루언서', query: '인스타 모델 비주얼 화보' },
  { id: 'swimwear', name: '🌊 수영복 / 비키니', query: '수영복 모델 화보' },
  { id: 'racing_cheer', name: '🏎️ 레이싱모델 / 치어리더', query: '레이싱모델 치어리더 화보' },
  { id: 'gravure', name: '🌸 그라비아 / 룩북', query: '일본 모델 화보' }
];

/**
 * Fetch high-resolution photos and animated GIFs/videos from search engines
 * 3-Tier Robust Hybrid Pipeline:
 *  1. Bing Image HD Search (Primary, 0% IP block, direct original high-res murl)
 *  2. Naver Image Search (Secondary HD with updated anti-block headers)
 *  3. Daum Image Search (Tertiary fallback)
 */
async function searchVisualMedia(keyword = '코스프레 화보', page = 1) {
  const mediaList = [];
  const seen = new Set();
  const cleanKeyword = keyword.trim();

  // 1. Bing Image Search (Primary HD source - 0% 403 blocks)
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
            mediaType: isGif ? 'video' : 'image',
            thumbnail: url,
            source: 'Bing'
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    // silently fallback to Naver / Daum
  }

  // 2. Naver Image Search (Secondary HD source)
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
            mediaType: isGif ? 'video' : 'image',
            thumbnail: url,
            source: 'Naver'
          });
        }
      }
    } catch (e) {
      // ignore 403
    }
  }

  // 3. Daum Image Search (Supplement / Tertiary source)
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
            mediaType: isGif ? 'video' : 'image',
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
당신은 X(트위터)에서 수많은 리트윗과 북마크를 이끌어내는 탑티어 인플루언서이자 사진 시각 분석 전문가입니다.
${hasVision ? '첨부된 사진 이미지를 직접 시각 분석하고,' : ''} 아래 미디어 정보/제목을 바탕으로 타임라인에서 시선을 강탈하는 **진짜 사람이 쓴 것 같은 매력적인 한글 바이럴 트윗**을 작성하세요.

[미디어 정보/제목]: ${titleOrTopic}

[스타일 지침]:
${styleInstruction}

🚨 [필수 시각 분석 및 작성 규칙]:
1. 👁️ **사진 속 실제 인물 정밀 시각 식별**:
   ${hasVision ? '- 첨부된 사진 속 인물의 얼굴, 이목구비, 분위기를 면밀히 살펴보세요.\n   - 만약 K-POP 아이돌(예: 에스파, 아이브, 뉴진스, 르세라핌, 트와이스 등), 유명 배우, 유명 치어리더, 방송인 등 대중에게 잘 알려진 유명인으로 확실하게 식별된다면 해당 인물의 정확한 이름(예: 장원영, 카리나, 안유진, 김채원, 이주은 등)을 본문이나 해시태그에 자연스럽게 밝히세요.\n   - 만약 일반 모델, 코스플레이어, AI 생성 이미지이거나 인물을 100% 특정할 수 없는 경우: 절대로 엉뚱한 연예인 이름을 함부로 지어내지 말고, 피지컬, 의상 핏, 분위기, 컨셉에 대해서만 솔직하고 매력적으로 감탄하세요.' : '- 미디어 제목/정보에 특정 인물명이 명확히 적혀 있는 경우에만 이름을 기재하고, 이름이 불분명할 때는 엉뚱한 이름을 지어내지 말고 분위기/컨셉 위주로 작성하세요.'}
2. ❌ "🔹", "🧠", "💡", "1️⃣", "2️⃣" 같은 기계적인 AI 요약 기호나 딱딱한 설명문은 100% 절대 금지합니다.
3. ⭕ 진짜 트위터 유저가 폰으로 방금 보고 홀려서 쓴 것처럼 자연스러운 줄바꿈과 찰진 구어체로 1~3줄 작성하세요.
4. 끝에 어울리는 이모지 1~2개와 해시태그 1~2개를 자연스럽게 붙이세요.
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
