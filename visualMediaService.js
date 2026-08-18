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
 */
async function searchVisualMedia(keyword = '코스프레 화보', page = 1) {
  const mediaList = [];
  const seen = new Set();
  const cleanKeyword = keyword.trim();

  // 1. Naver Image Search (Primary HD source)
  try {
    const naverUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(cleanKeyword)}&start=${(page - 1) * 30 + 1}`;
    const res = await axios.get(naverUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
      },
      timeout: 5000
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
          title: `[${cleanKeyword}] ${isGif ? '🎬 모션 움짤/클립' : '📷 고화질 화보 포토'}`,
          url: url,
          mediaType: isGif ? 'video' : 'image',
          thumbnail: url,
          source: 'Naver'
        });
      }
    }
  } catch (e) {
    addLog('WARN', `Naver 미디어 수집 지연 (${e.message})`);
  }

  // 2. Daum Image Search (Supplement / Secondary source)
  if (mediaList.length < 20) {
    try {
      const daumUrl = `https://search.daum.net/search?w=img&q=${encodeURIComponent(cleanKeyword)}`;
      const res = await axios.get(daumUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000
      });

      const dHtml = String(res.data);
      const dMatches = [...dHtml.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/gi)];

      for (const m of dMatches) {
        let url = m[1].replace(/&amp;/g, '&');
        if (
          url &&
          !seen.has(url) &&
          !url.includes('logo') &&
          !url.includes('icon') &&
          !url.includes('favicon') &&
          !url.includes('daumcdn.net/daumtop')
        ) {
          seen.add(url);
          const isGif = url.toLowerCase().includes('.gif');
          mediaList.push({
            id: 'media_' + Math.random().toString(36).substring(2, 9),
            title: `[${cleanKeyword}] ${isGif ? '🎬 모션 움짤/클립' : '📷 고화질 화보 포토'}`,
            url: url,
            mediaType: isGif ? 'video' : 'image',
            thumbnail: url,
            source: 'Daum'
          });
        }
      }
    } catch (e) {
      addLog('WARN', `Daum 미디어 수집 지연 (${e.message})`);
    }
  }

  return mediaList.slice(0, 30);
}

/**
 * Generate Attention-Grabbing Viral X Tweets for Visual Photos & Videos
 */
async function generateVisualTweet(titleOrTopic = '코스프레 화보', style = 'shock') {
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
    styleInstruction = `스크롤을 내리던 모든 유저의 엄지손가락을 멈추게 만드는 강력한 호기심/감탄 1줄 훅과 찰진 멘트(2줄)로 작성하세요.
- 예시: "알고리즘이 왜 이 영상을 계속 띄우는지 단 1초 만에 납득함.. 분위기 진짜 독보적이네 홀린 듯이 봤다 ✨"`;
  }

  if (apiKey) {
    const promptText = `
당신은 X(트위터)에서 수많은 리트윗과 북마크를 이끌어내는 탑티어 인플루언서입니다.
아래 비주얼 포토/영상 테마를 바탕으로, 타임라인에서 시선을 강탈하는 **진짜 사람이 쓴 것 같은 매력적인 한글 바이럴 트윗**을 작성하세요.

[미디어 주제/제목]: ${titleOrTopic}

[스타일 지침]:
${styleInstruction}

🚨 [필수 작성 규칙]:
1. ❌ "🔹", "🧠", "💡", "1️⃣", "2️⃣" 같은 기계적인 AI 요약 기호나 딱딱한 설명문은 100% 절대 금지합니다.
2. ⭕ 진짜 트위터 유저가 폰으로 방금 보고 홀려서 쓴 것처럼 자연스러운 줄바꿈과 찰진 구어체로 1~3줄 작성하세요.
3. 끝에 어울리는 이모지 1~2개와 해시태그 1~2개를 자연스럽게 붙이세요.
4. 오직 완성된 트윗 문구만 출력하세요. (따옴표나 설명 금지)
`;

    const modelsToTry = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash',
      'gemini-2.5-flash'
    ];

    for (const modelName of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await axios.post(
          url,
          { contents: [{ parts: [{ text: promptText }] }], generationConfig: { temperature: 0.8 } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 6000 }
        );

        let text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text.length > 5) {
          text = text.replace(/^["']|["']$/g, '').trim();
          addLog('SUCCESS', `📸 비주얼 바이럴 트윗 AI 생성 완료 (${text.length}자)`);
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
