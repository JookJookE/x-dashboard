const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

async function generateSummary(article, mode = 'block') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  if (!apiKey) {
    addLog('INFO', `스마트 아티클 제목 분리 트윗 생성 (모드: ${mode}): [${article.categoryTag || article.category}] "${article.title}"`);
    return deepExpertSummary(article, mode);
  }

  try {
    addLog('INFO', `Gemini AI 아티클 최고품질 1인칭 후킹 트윗 생성 중 (모드: ${mode}): [${article.categoryTag || article.category}] "${article.title}"`);

    let promptText = '';
    if (mode === 'talk' || mode === 'gossip') {
      promptText = `
당신은 X(트위터)에서 수십만 팔로워를 보유한 트위터 장인이자 인기 계정입니다.
아래 기사 제목과 내용을 바탕으로, 트위터 피드에서 공감을 얻는 '알차고 생생한 트위터 감성 단문 트윗'을 한글로 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 3 - 트위터 감성 썰 작성 규칙]:
1. 지나치게 감상 1줄로만 끝내지 말고, [기사의 핵심 사건/소식 내용 1~2줄] + [자연스러운 감상/반응 1줄]로 총 2~3문장 이내로 알차게 작성하세요.
2. 🚨가장 중요한 서식 규칙🚨: 모든 문장(줄)이 끝날 때마다 반드시 **엔터(줄바꿈)를 두 번** 쳐서 문장과 문장 사이에 항상 '빈 줄(공백 줄)'이 들어가게 하세요. 커뮤니티 썰처럼 띄엄띄엄 여백이 많고 읽기 편하게 작성해야 합니다.
3. '📌', '📝', '🗣️', '💬', '댓글(타래)용 링크' 같은 어색한 라벨, 기사 링크, 서식은 절대로 붙이지 마세요.
4. 말투는 트위터 피드 특유의 자연스럽고 생생한 썰/소통 톤을 그대로 유지하세요.
5. 문장 끝 어조와 이모지는 기사 내용의 분위기(놀라움 😳, 유쾌함 ㅋㅋㅋ, 경악 😱, 기대감 ✨, 호기심 👀, 불꽃 🔥 등)에 맞게 그때그때 다채롭게 연출하세요. (절대 매번 'ㅠ'로 끝나지 않도록 주의!)
6. 마지막 줄에는 카테고리에 맞는 핵심 한글 해시태그 2개만 자연스럽게 넣으세요.
7. 오직 완성된 한글 트윗 문구만 출력하세요. (설명, 큰따옴표 금지)
`;
    } else if (mode === 'mindset') {
      promptText = `
당신은 X(트위터)에서 유저들의 마음을 울리고 수천 번 리트윗(RT)과 북마크되는 심리학·멘탈·인간관계 전문 카운슬러이자 트위터 장인입니다.
아래 기사 제목과 내용을 바탕으로, 트위터 피드에서 깊은 공감을 일으키는 '담백하고 따뜻한 멘탈/공감 꿀팁 트윗'을 한글로 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 4 - 멘탈/공감 꿀팁 작성 규칙]:
1. [기사 속 인물/상황 언급 1줄] + [마음을 다잡아주는 깊은 공감/멘탈 꿀팁 1~2줄]로 총 2~3문장 이내로 작성하세요.
2. '📌', '📝', '🗣️', '💬', '댓글(타래)용 링크' 같은 서식이나 어색한 헤더, 기사 링크는 절대로 붙이지 마세요.
3. 말투는 공감 가고 깊이 있으면서도 자연스럽게 전하는 트위터 멘탈 꿀팁 톤으로 작성하세요.
   (예시 1: 박지윤도 서울살이 끝나가면서 멘탈 고갈된다고 털어놨는데.. 결국 내 마음부터 돌보는 게 가장 중요함.. 남 시선 신경 쓰지 말고 나부터 챙기자 😳)
   (예시 2: 인간관계에서 유독 피곤함을 느낀다면 거리를 조금 둬보세요. 모든 사람에게 좋은 사람이 될 필요는 없음.. 내 마음의 여유가 먼저임✨)
4. 이모지는 1개 정도만(😳, 🌿, ✨ 등) 깔끔하게 사용하세요.
5. 마지막 줄에는 #멘탈 #생각정리 해시태그 2개를 자연스럽게 넣으세요.
6. 오직 완성된 한글 트윗 문구만 출력하세요. (설명, 큰따옴표 금지)
`;
    } else if (mode === 'capture' || mode === 'blind') {
      promptText = `
당신은 X(트위터)에서 수십만 회의 조회수와 클릭수를 이끌어내는 블라인드·커뮤니티 핫이슈 전문 큐레이터입니다.
유저가 전체 사연 글을 캡처 이미지로 첨부하여 트윗을 올릴 예정입니다. 
따라서 본문 요약은 전혀 필요 없고, 유저가 트윗 피드를 내리다가 '소름 돋아서 캡처 이미지를 안 클릭하고는 못 배기게 만드는 1줄짜리 강렬한 도파민 훅 캡션(제목)'을 한글로 작성하세요.

[뉴스/사연 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 5 - 📸 이미지 캡처 전용 1줄 훅 작성 규칙]:
1. 🚨[분량 절대 엄수]🚨: 본문 요약이나 긴 설명은 절대로 붙이지 마세요! 오직 캡처 이미지를 열어보게 만드는 **강렬한 1~2문장 (딱 한 줄~두 줄)**의 캡션 문구만 작성하세요.
2. 💬 [말투 예시]:
   - "아니, 경찰들이 더 반대하고 있었다고...? 진짜 최대 수혜자가 따로 있었네 소름 돋음;"
   - "블라인드에 올라온 신입 사원 퇴사 사유... 읽다가 내 눈을 의심함 😳"
   - "회사에서 레깅스 입었다고 정색당한 직장인 썰... 댓글 반응 실시간으로 갈리는 중 😱"
3. 마지막 줄에는 #블라인드 #직장인썰 해시태그 2개를 자연스럽게 넣으세요.
4. 오직 완성된 최종 문구만 출력하세요. (생각 과정, 큰따옴표, 설명 금지)
`;
    } else if (mode === 'pann') {
      promptText = `
당신은 X(트위터)에서 연애, 결혼, 직장, 인간관계 사연으로 엄청난 리트윗(RT)과 갑론을박을 이끌어내는 트위터 장인이자 인기 계정입니다.
제공된 사연 제목과 내용을 바탕으로, 트위터 유저들이 무조건 스크롤을 멈추고 편을 갈라 싸우게 만드는 '찰진 사연 요약 트윗'을 한글로 작성하세요.

[사연 제목]: ${article.title}
[사연 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 6 - ⚖️ 네이트판 / 사연 작성 규칙]:
1. 🚨[팩트 엄수]🚨: 본문에 없는 등장인물(남편, 아내, 시댁 등)이나 안 나온 사실을 절대 지어내지 마세요! 오직 본문에 실제 나오는 내용만 팩트 기반으로 요약하세요.
2. [첫 줄 - 구체적 키워드 훅]: 사연에서 가장 논란이 되는 **구체적인 키워드**(예: 레깅스, 축의금 3만 원, 상견례, 시어머니 등)를 대놓고 제목에 박아서 1초 만에 눈에 꽂히게 작성하세요. 뭉뚱그려 "복장 논란", "갈등 사연" 같은 추상적인 표현은 절대 금지입니다. 이모지 1개를 자연스럽게 붙이세요.
3. [둘째~셋째 줄 - VS 대립 구도]: 사연의 핵심 갈등을 **"A vs B"** 대립 구도로 만들어서 유저들이 편을 갈라 댓글/인용 RT를 하게 유도하세요. 예시: "편하고 실용적인 운동복 출근룩 VS 주변에 피해를 주는 민폐룩"
4. [마지막 줄 - 소통 유도]: "다들 어떻게 생각하시나요 👀" 처럼 짧고 자연스러운 소통 유도 한 줄을 넣으세요.
5. 💬 [말투]: 뉴스 기자나 리포터가 격식 차려 물어보는 톤은 절대 금지! 트위터 썰 계정이 던지는 찰진 캐주얼 톤으로 작성하세요. 이모지는 분위기에 맞게(😳, ㅋㅋㅋ, 😱, 👀, 🔥 등) 다채롭게 연출하세요.
6. 🚨[서식]🚨: 모든 문장(줄)이 끝날 때마다 반드시 **엔터(줄바꿈)를 두 번** 쳐서 문장과 문장 사이에 항상 '빈 줄(공백 줄)'이 들어가게 하세요.
7. '📌', '📝', '🗣️', '💬', '댓글(타래)용 링크', 'TPO에 대한 솔직한 생각' 같은 어색한 헤더, 서식, 격식체 표현은 절대 붙이지 마세요.
8. 마지막 줄에는 #네이트판 #네티즌갑론을박 해시태그 2개를 자연스럽게 넣으세요.
9. 오직 완성된 한글 트윗 문구만 출력하세요. (설명, 큰따옴표 금지)
`;
    } else if (mode === 'story') {
      promptText = `
당신은 X(트위터)에서 조회수 100만 회 이상을 기록하는 최고 도파민·호기심 자극형 IT·금융 인플루언서입니다.
아래 기사를 바탕으로 X 유저들이 타임라인을 내리다 무조건 클릭하게 만드는 '1인칭 도파민 후킹 리포트'를 한글로 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 2 작성 지침 - 🔥 1인칭 후킹 리포트형]:
1. [첫 줄 - 도파민 훅 제목 1줄]: 독자가 손을 멈출 강렬한 호기심/도파민 자극형 제목 1줄만 작성하세요.
2. [빈 줄 한 칸(엔터 두 번)]
3. [본문 - 1인칭 분석 리포트 2~3문장]: [기사 팩트 1문장]. 아직 사람들은 [표면적 수치]만 보지만, 저는 진짜 핵심은 [실물 유동성/구조적 변화]에 있다고 생각합니다. [수혜 동력]이 [자산 시장]의 하방을 지지하는 결정적 동력이기 때문입니다. 이 거대한 파이프라인은 당신의 포트폴리오에 어떤 파급력으로 돌아올까요?
4. [마지막 줄 - 원본 링크]: 👇 본문 원본 및 3분 심층 리포트 풀버전 보기: ${article.link || ''}

⚠️ [출력 양식 예시]:
지갑 열기 전에 이것부터 봐라! 테트라곤이 5천만 달러를 무의결권 주식에 올인한 진짜 이유... 스마트머니는 이미 움직이기 시작했다!

테트라곤이 5천만 달러 규모의 무의결권 주식 공개 매수에 전격 돌입했습니다. 아직 사람들은...

👇 본문 원본 및 3분 심층 리포트 풀버전 보기: ${article.link || ''}

오직 위 예시 형태의 완성된 한글 트윗 문구만 출력하세요. (생각 과정, 설명 금지)
`;
    } else {
      promptText = `
당신은 X(트위터)에서 신뢰도가 가장 높은 IT·금융 테크 인플루언서이자 인기 계정입니다.
다음 기사를 분석하여 타임라인 스크롤을 시선집중시키는 강력한 1줄 뉴스 타이틀 훅과 3단계 '이모지 인사이트 블록' 트윗을 한글로 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [버전 1 작성 지침 - ⚡ 이모지 블록형]:
1. [첫 줄 - 이목을 끌 강렬한 1줄 뉴스 타이틀 훅]: 독자가 피드를 내리다 무조건 멈출 강렬한 1줄 뉴스 제목 훅을 작성하세요.
2. [빈 줄 한 칸(엔터 두 번)]
3. 🔹 [기사 속 구체적 사건 및 핵심 수치 팩트 1문장]
4. 🧠 [산업 패러다임과 비하인드 심층 분석 1문장]
5. 💡 [향후 시장 변수 및 핵심 투자 시사점 1문장]

⚠️ [출력 양식 예시]:
연준 독립성 붕괴 시작되나... 트럼프-워시 '비밀 통화' 파문!

🔹 트럼프 당선인이 케빈 워시 연준 의장 후보와 수시로 통화하며 통화정책 방향을 논의해 연준의 독립성 훼손 논란이 불거졌습니다.

🧠 행정부와 중앙은행 간의 소통 강화는 단기적으로 정책 불확실성을 낮추지만, 장기적으로는 통화정책 신뢰도를 떨어뜨려 금리 변동성을 극대화합니다.

💡 파월 의장의 거취와 연준 금리 결정에 정치적 압력이 가중될 경우 성장주에 큰 부담으로 작용할 수 있어 리스크 관리가 필수적입니다.

오직 위 예시 양식의 완성된 한글 트윗 결과만 출력하세요. (생각 과정, 설명 금지)
`;
    }

    const modelsToTry = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.5-flash',
      'gemini-3.6-flash'
    ];
    let generatedText = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.7 }
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
        );

        generatedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText && generatedText.trim().length > 30) {
          break;
        }
      } catch (e) {
        lastError = e;
        const msg = e.response?.data?.error?.message || e.message;
        console.log(`[API Error] Model ${modelName} 실패. 다음 모델로 전환 시도. 사유: ${msg.split('\n')[0]}`);
        continue; // 에러 종류(Quota 등)와 무관하게 무조건 다음 모델로 순차적 넘어가도록 처리
      }
    }

    if (!generatedText) {
      throw lastError || new Error('Gemini API 응답 결과가 비어 있습니다.');
    }

    let summaryText = generatedText.trim();
    // Strip trailing hashtag lines and #/$ hashtags from main text
    summaryText = summaryText.replace(/(?:^|\n)\s*[#$][\w가-힣\s#$]+/g, '').replace(/#[^\s#]+/g, '').trim();
    
    addLog('SUCCESS', `[${article.categoryTag || article.category}] Gemini AI 한글 트윗 생성 완료 (${summaryText.length}자)`);
    const extra = generateHooksAndTags(article, summaryText);
    return { text: summaryText, hooks: extra.hooks, tags: extra.tags, isAiGenerated: true, mode };
  } catch (err) {
    const errorDetails = err.response?.data?.error?.message || err.message;
    addLog('ERROR', `Gemini AI 요약 실패 (${errorDetails}), 스마트 파서 사용`);
    const fallback = deepExpertSummary(article, mode);
    let cleanFallback = fallback.text.replace(/(?:^|\n)\s*[#$][\w가-힣\s#$]+/g, '').replace(/#[^\s#]+/g, '').trim();
    const extra = generateHooksAndTags(article, cleanFallback);
    return { text: cleanFallback, hooks: extra.hooks, tags: extra.tags, isAiGenerated: false, mode };
  }
}

function generateHooksAndTags(article, text) {
  const title = article.title || '';
  const cleanTitle = title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  const firstLine = text ? text.split('\n')[0] : cleanTitle;

  const hookA = `${firstLine}`;
  const hookB = `${cleanTitle} 다들 어떻게 생각하시나요? 👀`;
  const hookC = `충격) ${cleanTitle.substring(0, 40)}... 😱`;

  const smartTags = extractSmartArticleHashtags(article, text);

  return {
    hooks: [hookA, hookB, hookC],
    tags: smartTags
  };
}

function extractSmartArticleHashtags(article, text) {
  const fullContent = `${article.title || ''} ${article.contentSnippet || ''} ${text || ''}`;
  const title = article.title || '';
  const cleanTitle = title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();

  const foundTags = [];

  // 1. Detect major domain entities & tickers
  if (/트럼프|바이든|해리스|미국 대선/i.test(fullContent)) foundTags.push('#트럼프');
  if (/연준|파월|기준금리|금리|통화정책|워시/i.test(fullContent)) foundTags.push('#연준', '#기준금리');
  if (/엔비디아|Nvidia/i.test(fullContent)) foundTags.push('$NVDA', '#엔비디아');
  if (/비트코인|BTC|Bitcoin/i.test(fullContent)) foundTags.push('$BTC', '#비트코인');
  if (/이더리움|ETH/i.test(fullContent)) foundTags.push('$ETH', '#이더리움');
  if (/테슬라|Tesla|머스크/i.test(fullContent)) foundTags.push('$TSLA', '#테슬라');
  if (/삼성전자/i.test(fullContent)) foundTags.push('#삼성전자');
  if (/SK하이닉스|하이닉스/i.test(fullContent)) foundTags.push('#SK하이닉스');
  if (/부동산|아파트|집값|분양/i.test(fullContent)) foundTags.push('#부동산', '#아파트');
  if (/블라인드|이직|퇴사|회사/i.test(fullContent)) foundTags.push('#블라인드', '#직장인썰');
  if (/네이트판|시댁|남편|아내|결혼/i.test(fullContent)) foundTags.push('#네이트판', '#사연');
  if (/말복|삼계탕|전복/i.test(fullContent)) foundTags.push('#말복', '#삼계탕');
  if (/연예|배우|가수|아이돌|김혜수|이승철|정준원/i.test(fullContent)) foundTags.push('#연예이슈', '#핫이슈');

  // 2. Extract key nouns from clean title
  const words = cleanTitle
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/속보|단독|특징주|이슈|무단전재|재배포|클릭|포토|영상/i.test(w));

  words.forEach(w => {
    if (foundTags.length < 5) {
      const tag = `#${w}`;
      if (!foundTags.includes(tag) && !foundTags.includes(`$${w}`)) {
        foundTags.push(tag);
      }
    }
  });

  const category = (article.category || '').toLowerCase();
  if (foundTags.length === 0) {
    if (category.includes('coin')) foundTags.push('$BTC', '#가상자산');
    else if (category.includes('stock')) foundTags.push('#미국주식', '#증시');
    else if (category.includes('blind')) foundTags.push('#블라인드', '#직장인썰');
    else if (category.includes('pann')) foundTags.push('#네이트판', '#사연');
    else foundTags.push('#뉴스속보', '#핫이슈');
  }

  // Deduplicate and return top 3-4 hashtags
  const uniqueTags = [...new Set(foundTags)];
  return uniqueTags.slice(0, 4);
}

function translateTitleToKorean(title) {
  if (!title) return '';
  let t = title.replace(/\[외신\s*.*?\]/g, '').trim();

  // Common Financial/Tech Terms Translation Table
  t = t
    .replace(/BTC/g, '비트코인')
    .replace(/ETH/g, '이더리움')
    .replace(/XRP/g, '리플')
    .replace(/Crypto Today/gi, '가상자산 동향')
    .replace(/correct as ETF flows diverge/gi, 'ETF 자금 유입 유출 격차 속 시세 조정')
    .replace(/corrects?|correction/gi, '가격 조정')
    .replace(/ETF flows diverge/gi, 'ETF 자금 흐름 엇갈림')
    .replace(/Fed holds interest rates steady/gi, '미 연준 기준금리 동결')
    .replace(/inflation hits/gi, '인플레이션 지표 상승')
    .replace(/Market Size, Trends and Forecast/gi, '시장 규모 및 산업 전망')
    .replace(/AI Safety Evaluation/gi, 'AI 안전성 평가 기술')
    .replace(/Nvidia/gi, '엔비디아')
    .replace(/Apple/gi, '애플')
    .replace(/Tesla/gi, '테슬라')
    .replace(/Bitcoin/gi, '비트코인')
    .replace(/Ethereum/gi, '이더리움')
    .replace(/Interest Rate/gi, '기준금리')
    .replace(/Inflation/gi, '물가 상승률')
    .trim();

  return t;
}

function deepExpertSummary(article, mode = 'block') {
  const rawTitle = article.title || '';
  const isGlobal = article.isGlobal || rawTitle.includes('[외신');

  let sourceTag = '외신';
  const sourceMatch = rawTitle.match(/\[외신\s*(.*?)\]/);
  if (sourceMatch && sourceMatch[1]) {
    sourceTag = sourceMatch[1];
  }

  let cleanTitle = rawTitle.replace(/[\"']/g, '').replace(/\[오피니언\]/g, '').replace(/\(.*?\)/g, '').trim();

  let koreanTitle = isGlobal ? translateTitleToKorean(cleanTitle) : cleanTitle;
  if (isGlobal && !koreanTitle.includes('[외신')) {
    koreanTitle = `[외신 ${sourceTag}] ${koreanTitle}`;
  }

  let rawSnippet = article.contentSnippet || article.excerpt || article.title;

  rawSnippet = rawSnippet
    .replace(/&#\d+;/g, '')
    .replace(/로그인|회원 가입|회원가입|연구자 정보|프로필 보기|출신대학|전공|연구분야|카테고리|Newsletter|1분 요약|스탠다드 등급|멤버십 구독/gi, '')
    .replace(/Semiconductor|Biotechnology|Robotics|Opinion|Membership|Newsletter|Energy|Future/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = rawSnippet
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 15 && s !== cleanTitle && !s.includes('http') && !s.includes('Copyright'));

  const analysis = buildDeepArticleAnalysis(koreanTitle, article.category, sentences, isGlobal);

  let categoryHeader = isGlobal ? '🌐' : '💡';
  let hashtags = '#뉴스 #이슈';

  const cat = String(article.category).toLowerCase();
  if (cat.includes('it')) {
    categoryHeader = '💻';
    hashtags = '#IT #테크';
  } else if (cat.includes('coin')) {
    categoryHeader = '🪙';
    hashtags = '#코인 #비트코인';
  } else if (cat.includes('stock')) {
    categoryHeader = '📈';
    hashtags = '#주식 #증시';
  } else if (cat.includes('economy')) {
    categoryHeader = '💵';
    hashtags = '#경제 #금리';
  } else if (cat.includes('mindset') || cat.includes('psychology')) {
    categoryHeader = '🧠';
    hashtags = '#멘탈 #생각정리';
  }

  let text = '';

  if (mode === 'talk' || mode === 'gossip') {
    const talkEndings = [
      '솔직히 이건 반응 핫할 만한 이슈인 듯😳',
      '과연 앞으로 어떻게 진행될지 진짜 궁금하네요👀',
      '이거 상황 판이 생각보다 더 커지는 분위기임🔥',
      '다들 이 소식 어떻게 생각하시나요?💭',
      '예상치 못한 방향으로 흐르는데 과연 결과는?😱',
      '이번 건은 진짜 시선 집중될 수밖에 없는 소식인 듯✨'
    ];
    const randomEnding = talkEndings[Math.floor(Math.random() * talkEndings.length)];
    text = `${koreanTitle}\n\n💬 핵심: ${analysis.summary}\n\n${randomEnding}\n\n${hashtags}`;
  } else if (mode === 'mindset') {
    text = `${koreanTitle}\n\n🔹 핵심: ${analysis.summary}\n\n결국 내 마음부터 돌보는 게 가장 중요함.. 남 시선 신경 쓰지 말고 나부터 챙기자 😳\n\n${hashtags}`;
  } else if (mode === 'capture' || mode === 'blind') {
    text = `아니, 블라인드에 올라온 이 사건 소름 돋네... 진짜 최대 수혜자가 따로 있었음 😱\n\n#블라인드 #직장인썰`;
  } else if (mode === 'story') {
    const threadLink = article.link ? `\n\n👇 본문 원본 및 3분 심층 리포트 풀버전 보기:\n${article.link}` : '';
    text = `${analysis.storyHook}\n\n${analysis.storyBody}${threadLink}`;
  } else {
    text = `${koreanTitle}\n\n🔹 ${analysis.summary}\n\n🧠 ${analysis.analysis}\n\n💡 ${analysis.insight}`;
  }

  return {
    text,
    isAiGenerated: false,
    mode
  };
}

function buildDeepArticleAnalysis(title, category, sentences, isGlobal) {
  const cat = String(category).toLowerCase();
  const t = title.toLowerCase();

  let summaryText = sentences.length > 0 ? sentences.slice(0, 2).join(' ') : '';
  if (summaryText.length > 110) summaryText = summaryText.substring(0, 107) + '...';

  // Specific Foreign Crypto News
  if (t.includes('btc') || t.includes('eth') || t.includes('xrp') || t.includes('crypto today') || t.includes('비트코인') || t.includes('이더리움')) {
    return {
      summary: '비트코인, 이더리움, 리플 등 주요 암호화폐 시세가 단기 조정을 받는 가운데 기관용 현물 ETF 자금 유입·유출 동향이 엇갈리고 있습니다.',
      analysis: '단기 차익 실현 물량과 자금 유출로 변동성이 확대되고 있으나, 거시경제 금리 정책 및 미 연준 유동성 기조에 따라 재반등 모멘텀이 결정되는 국면입니다.',
      insight: '미국 현물 ETF로의 유동성 재유입 시점이 핵심 변수이며 비트코인 및 관련주의 자금 회복세를 주목할 시점입니다.',
      stockTag: '비트코인',
      storyHook: '지금 가상자산 시장에서 비트코인·이더리움 시세 조정과 ETF 자금 동향에 주목해야 하는 이유',
      storyBody: '비트코인, 이더리움, 리플 시세가 조정을 받으며 현물 ETF 자금 유입 유출 격차가 확대되었습니다. 아직 사람들은 단기 시세 하락만 우려하지만, 저는 진짜 핵심은 기관 자금의 재편에 있다고 생각합니다. 현물 ETF 유휴 자금이 다시 유입되는 타이밍이 가상자산 반등의 신호탄이기 때문입니다. 이 유동성 파이프라인은 코인 시장에 어떤 큰 상승 동력으로 연결되게 될까요?'
    };
  }

  // Specific Foreign Fed / Inflation News
  if (t.includes('fed') || t.includes('연준') || t.includes('rates') || t.includes('inflation')) {
    return {
      summary: '미 연준(Fed)이 인플레이션 및 고용 지표를 주시하며 기준금리 기조와 통화 정책 가이드라인을 발표했습니다.',
      analysis: '고금리 장기화 우려와 금리 인하 기대감이 상존하는 가운데 환율 및 글로벌 증시의 유동성 향방을 결정짓는 핵심 국면입니다.',
      insight: '미 연준의 금리 인하 시점과 국채 금리 안정 여부가 국내외 주식 및 자산 시장의 이익률을 좌우하게 될 전망입니다.',
      stockTag: '미연준',
      storyHook: '미 연준(Fed) 금리 정책과 글로벌 경제 향방을 깊이 있게 봐야 하는 이유',
      storyBody: '미 연준(Fed)의 기준금리 및 인플레이션 지표 관련 공식 발표가 공개되었습니다. 아직 사람들은 수치 변화만 보지만, 저는 진짜 핵심은 실물 유동성 회복에 있다고 생각합니다. 통화 정책 안정 시점이 주식과 코인 시장의 하방을 지지하는 결정적 동력이기 때문입니다. 이 경제 정책 국면은 자산 시장에 어떤 파급력으로 돌아올까요?'
    };
  }

  // Specific Foreign Tech / AI Safety News
  if (t.includes('ai') || t.includes('nvidia') || t.includes('apple') || t.includes('safety')) {
    return {
      summary: '글로벌 빅테크 기업들이 차세대 AI 인프라 구축 및 AI 안전성 평가 기술(AI Safety) 표준화 프로젝트를 대대적으로 확장하고 있습니다.',
      analysis: '단순 모델 개발을 넘어 안전성 검증 및 기업용 보안 온디바이스 생태계 구축이 빅테크 경쟁력의 핵심 지표로 부각되었습니다.',
      insight: '엔비디아·애플 등 글로벌 대장주의 AI 투자 집행액과 관련 반도체 장비주들의 실적 반영 추이를 주시해야 합니다.',
      stockTag: '빅테크',
      storyHook: '지금 글로벌 테크 시장에서 AI 인프라 및 신기술 동향에 투자하고 싶은 이유',
      storyBody: '글로벌 빅테크 기업들의 차세대 AI 기술 발표 및 시장 전망 리포트가 발표되었습니다. 아직 시장은 초기 수치만 보지만, 저는 진짜 무서움은 글로벌 온디바이스 및 AI 생태계 주도권에 있다고 생각합니다. AI 솔루션과 인프라를 지배하는 기업이 시장 전체의 밸류에이션을 이끌기 때문입니다. 이 신기술 파이프라인은 글로벌 증시에 어떤 실질적 수혜로 연결될까요?'
    };
  }

  // 1. Heisenberg Tech Reports
  if (t.includes('애플') || t.includes('메모리')) {
    return {
      summary: '애플이 온디바이스 AI 20B 전체 모델을 NAND Flash에 보관하고 필요한 1~4B 가중치만 DRAM으로 불러오는 스왑 신기술을 선보였습니다.',
      analysis: '메모리를 없앤 게 아니라 NAND-DRAM 고효율 재편일 뿐입니다. 결과적으로 삼성전자와 SK하이닉스의 메모리 공급 입지는 변함없이 견고합니다.',
      insight: 'iPhone 온디바이스 AI 메모리 용량이 핵심 변수이며, 한국 반도체 기업들의 HBM 및 공정 장비 생태계 전반의 우상향 기반은 흔들리지 않는다는 결론입니다.',
      stockTag: '삼성전자',
      storyHook: '지금 반도체 시장에서 한국 메모리에 주목해야 하는 이유',
      storyBody: '애플은 온디바이스 AI 20B 모델 전체를 NAND에 저장하고 1~4B 가중치만 DRAM으로 불러오는 신기술을 공개했습니다. 아직 사람들은 비싼 DRAM을 덜 쓰는 애플의 기술만 보지만, 저는 진짜 핵심은 여전히 삼성전자와 SK하이닉스에 있다고 생각합니다. TPU와 AI를 돌리기 위해 NAND-DRAM을 고효율로 재편했을 뿐 메모리 수급 자체를 없앤 건 아니기 때문입니다. 애플의 이 거대한 메모리 파이프라인은 한국 반도체 공급망에 어떤 실질적인 수혜로 돌아오게 될까요?'
    };
  }

  // Default General News Fallback
  return {
    summary: isGlobal
      ? `${title}: 글로벌 시장에서 주요 기업 실적 및 거시 경제 정책 지표가 공식 집계되었습니다.`
      : `${title} 관련 핵심 팩트 및 발표 정보 내용입니다.`,
    analysis: isGlobal
      ? '글로벌 유동성과 거시 경제 기조 변화가 국내외 자산 시장과 주요 기술 섹터의 펀더멘털에 직접적 파급력을 줄 수 있는 국면입니다.'
      : '기술적 차별성과 향후 관련 기업들의 실적 반영 추이가 가치 재평가의 핵심 관전 지점입니다.',
    insight: isGlobal
      ? '글로벌 외신 속보 분석을 통해 주요 대장주 및 관련 수혜 기업군의 수급 흐름을 점검할 필요가 있습니다.'
      : '산업 패러다임 변화에 맞춰 핵심 기업들의 수급 변화를 주시할 시점입니다.',
    stockTag: isGlobal ? '글로벌외신' : '투자인사이트',
    storyHook: `지금 글로벌/국내 시장에서 ${title} 소식에 주시해야 하는 이유`,
    storyBody: `${title} 소식이 공개되었습니다. 아직 사람들은 단순 발표로만 보지만, 저는 진짜 핵심은 글로벌 유동성과 산업 생태계의 구조적 변화에 있다고 생각합니다. 신기술 도입과 정책 변동이 결합하여 기업 가치를 재평가하는 국면이기 때문입니다. 이 거대한 변화는 어디까지가 기대이고 어디서부터 실적 반영의 시작일까요?`
  };
}

module.exports = {
  generateSummary
};