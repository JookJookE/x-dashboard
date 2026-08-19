const axios = require('axios');
const { getConfig } = require('./config');
const { addLog } = require('./history');

// ✅ 공통 금지어 Negative Prompt Block - 모든 트윗 생성 시 주입
const NEGATIVE_PROMPT_BLOCK = `

🚫 [절대 사용 금지 - 위반 시 즉시 재생성]:
- 금지 단어/표현: "요약하자면", "결론적으로", "놀랍게도", "과연", "안녕하세요", "정리하자면", "살펴보겠습니다", "알아보겠습니다"
- 기사 제목 단순 복붙 금지 (반드시 내 말로 재해석)
- 기계적인 봇 말투 금지 (~합니다, ~로 보입니다, ~예정입니다 등 뉴스 앵커 어투)
- 이모지를 모든 문장 끝에 강제로 붙이지 말 것 (자연스럽게 0~2개, 또는 아예 없어도 됨)
- 외부 링크(URL) 본문 삽입 절대 금지
`;

async function generateSummary(article, mode = 'block') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  if (!apiKey) {
    addLog('INFO', `스마트 아티클 제목 분리 트윗 생성 (모드: ${mode}): [${article.categoryTag || article.category}] "${article.title}"`);
    return deepExpertSummary(article, mode);
  }

  try {
    addLog('INFO', `Gemini AI 트윗 생성 중 (모드: ${mode}): [${article.categoryTag || article.category}] "${article.title}"`);

    let promptText = '';
    if (mode === 'spicy') {
      promptText = `
당신은 X(트위터)에서 날카로운 팩트폭행과 거침없는 사이다 입담으로 수만 팔로워를 거느린 인플루언서입니다.
아래 기사/사연을 보고, 사람들이 통쾌해서 인용(Quote)하고 리트윗할 수밖에 없는 '매운맛 팩폭 도파민 트윗'을 한글로 작성하세요.

[뉴스/사연 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [매운맛 팩폭 트윗 작성 규칙]:
1. 🚨[교과서 말투/설명 금지]🚨: "~합니다", "~로 보입니다" 같은 점잖은 설명은 1도 쓰지 마세요. 
2. 뻔뻔하고 자신감 넘치는 톤으로 기사 속 대상을 시원하게 팩트로 긁어주세요.
   - 예시 1: "아직도 이거 보고 행복회로 돌리는 애들 진짜 레전드네 ㅋㅋㅋ 판 다 짜여져 있는데 혼자만 딴 세상 삼 ㅉㅉ"
   - 예시 2: "다들 헛소리하는데 팩트 하나 박아줌. 걍 이건 망할 수밖에 없는 구조임. 나중에 성지순례나 와라 🔥"
3. [분량]: 2~3줄로 굵고 짧게 끝내세요.
4. 오직 완성된 트윗 문구만 출력하세요.
`;
    } else if (mode === 'reaction') {
      promptText = `
당신은 트위터를 매일 5시간 이상 하는 트위터 헤비유저입니다.
아래 기사/사연을 접하고, 방금 폰으로 보다가 충격/감탄을 받고 툭 던지는 듯한 '날것의 1~2줄 리얼 트윗'을 작성하세요.

[뉴스/사연 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [리얼 리액션 작성 규칙]:
1. 🚨[분량 절대 준수]🚨: 무조건 1~2줄! 절대 3줄 이상 길게 쓰지 마세요.
2. AI 로봇 같은 느낌이 0.1%도 안 나게, 진짜 사람이 방금 폰으로 쓴 것처럼 자연스러운 한마디를 던지세요.
   - 예시 1: "와 이건 좀 소름 돋는다 ㅋㅋㅋ 설마 했는데 진짜 이렇게 나온다고? 판도 완전히 뒤집힐 듯.."
   - 예시 2: "이거 실시간으로 보는데 뇌정지 옴.. 생각보다 스케일 훨씬 심각한데? 말이 안 나온다 진짜"
3. "실화냐", "ㄷㄷ" 같은 뻔한 단어는 피하고, 다채로운 자연스러운 반응(소름, 대박, 뇌정지, 헛웃음 등)을 쓰세요.
4. 오직 완성된 1~2줄 트윗 문구만 출력하세요.
`;
    } else if (mode === 'story') {
      promptText = `
당신은 X(트위터)에서 통찰력 있는 긴 글(Long-form)로 수천 개의 북마크와 리트윗을 터뜨리는 실전 오피니언 리더입니다.
아래 기사를 바탕으로, 피드를 내리던 사람의 뇌를 때리고 끝까지 정독하게 만드는 '1인칭 심층 통찰 트윗'을 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [1인칭 심층 통찰 트윗 작성 지침]:
1. [첫 줄 - 호기심 훅]: 독자의 스크롤을 멈추게 하는 도발적인 1줄 훅 (예: "사람들이 지금 [키워드] 보고 겉핥기만 하고 있는데, 실상을 까보면 전혀 다른 얘기임.")
2. [빈 줄 한 칸]
3. [본문 - 1인칭 관점 2~3줄]: 기사 내용은 1줄로만 가볍게 치고, 즉시 "제가 시장을 지켜보며 내린 결론은..." 식의 날카로운 구조적 통찰을 풀어내세요.
4. [마지막 줄 - 확신과 경고]: "결국 돈과 자본의 흐름은 이쪽으로 쏠릴 수밖에 없음. 1년 뒤에 이 트윗 반드시 성지순례 됩니다 🧵"
5. 외부 링크나 설명 없이 완성된 트윗만 출력하세요.
`;
    } else if (mode === 'hybrid') {
      promptText = `
당신은 X(트위터)에서 명확하고 날카로운 통찰로 수많은 투자자/전문가들의 찬사를 받는 1타 시장 분석가입니다.
아래 기사를 바탕으로, 읽자마자 스크롤을 멈추고 북마크를 누르게 만드는 '전문가 하이브리드 인사이트 트윗'을 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [하이브리드 전문가 트윗 작성 지침]:
1. [첫 줄 - 다채롭고 강력한 1줄 훅 (🚨 "결론부터 박고 시작함" 절대 금지 🚨)]:
   - 매번 똑같은 문구로 시작하지 말고, 기사 내용과 상황에 맞춰 아래와 같은 다양한 스타일 중 하나로 강렬하게 시작하세요:
     • "핵심만 짚어드림: [본질적 팩트나 수치]"
     • "다들 [표면 이슈]만 보는데, 진짜 핵심 판도는 [이면의 본질]임."
     • "이 이슈의 본질은 딱 하나로 귀결됨: [핵심]"
     • "시장이 완전히 오판하고 있는 부분:"
     • "지금 벌어지는 판에서 진짜 수혜를 볼 쪽은..."
     • "복잡하게 생각할 것 없음. 결국 [결론]으로 갈 수밖에 없는 구조임."
     • "이 뉴스에서 모두가 놓치고 있는 가장 중요한 시그널:"
2. [빈 줄 한 칸]
3. [본문 - 날카로운 논리 전개 & 핵심 근거 (2~3줄)]:
   - 대중이 놓치고 있는 구조적 맹점을 찌르고, 왜 이런 분석/결론이 도출되는지 명확한 팩트와 논리로 증명하세요.
4. [마지막 줄 - 여운과 토론을 남기는 자연스러운 마무리 (1줄)]:
   - 뻔한 복붙 멘트 대신, 질문/전망/경고 등 상황에 맞는 다채로운 마무리 (예: "결국 이번 분기 실적이 분수령이 될 듯", "다들 이 흐름 어떻게 보고 계신가요?", "이건 장기적으로 판 전체를 바꿀 변수임")
5. [절대 규칙]:
   - "결론부터 박고 시작함", "요약하자면" 같은 천편일률적 봇 말투 절대 사용 금지!
   - 오직 완성된 트윗 문구만 출력하세요.
`;
} else if (mode === 'mindset') {
      promptText = `
당신은 X(트위터)에서 뼈를 때리는 현실적 위로와 멘탈 관리 글로 수많은 북마크를 모으는 멘토입니다.
아래 기사/사연을 계기로, 현대인들의 머리를 맑게 해주는 단단한 '멘탈 통찰 트윗'을 작성하세요.

[사연/뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [멘탈 통찰 작성 지침]:
1. 기사 이야기는 1줄로만 스치듯 언급하고, 인생과 멘탈에 바로 적용할 수 있는 묵직한 한마디를 전하세요.
   - 예시: "남들이 뭐라 떠들든 신경 끄고 내 페이스 유지하는 것도 엄청난 실력임. 결국 끝까지 흔들리지 않고 자리 지키는 놈이 다 먹는 판이다 🌿"
2. 무조건 저장해두고 힘들 때 꺼내보고 싶게 만드세요.
3. 오직 완성된 트윗 문구만 출력하세요.
`;
    } else if (mode === 'idol') {
      promptText = `
당신은 X(트위터)를 하는 2030 남성 유저입니다.
아래 연예인/아이돌 포토나 소식을 보고, 피드에서 시선을 강탈당해 쿨하게 감탄하는 '1줄 리얼 트윗'을 작성하세요.

[포토/뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

⚠️ [여돌/비주얼 칭찬 작성 지침]:
1. 🚨[절대 1줄 작성 & 금지어 준수]🚨: "독보적", "인정", "실화냐", "ㄷㄷ" 절대 금지!
2. 상황(화보, 착장, 분위기, 실물 포스)에 맞춰 진짜 남자가 감탄하듯 1줄로 굵직하게 쓰세요.
   - 예시 1: "와 이번 화보 뜬 거 보는데 비주얼이 그냥 화면을 찢어버림.. 컨셉 소화력 미쳤다 ✨"
   - 예시 2: "사진 한 장으로 분위기 다 압도하네.. 이건 실물 포스 장난 아닐 듯 🔥"
3. 문장 끝에는 이모지 1개와 해시태그 1~2개만 붙이세요.
4. 오직 완성된 1줄 트윗만 출력하세요.
`;
    } else {
      // ✅ 1. 이모지 요약 (심층 팩트 & 구조적 시장 분석형)
      promptText = `
당신은 X(트위터)에서 날카로운 통찰과 신뢰도 높은 팩트로 수많은 투자자 및 오피니언 리더들의 필독 계정으로 꼽히는 1인 시장 분석가입니다.
아래 뉴스를 정밀하게 분석하여, 핵심 팩트와 구조적 맥락, 그리고 향후 시장에 미칠 영향을 깊이 있게 정리한 '이모지 팩트 & 심층 분석 트윗'을 작성하세요.

[뉴스 제목]: ${article.title}
[본문 내용]: ${article.contentSnippet || article.excerpt}

📌 [이모지 심층 분석 트윗 작성 가이드]:
1. [헤드라인 훅 1줄]: 기사의 핵심 본질과 중요도를 꿰뚫는 강렬한 1줄 분석 헤드라인 (단순 제목 복붙 금지)
2. [빈 줄 한 칸]
3. [이모지 핵심 팩트 요약 (3줄)]:
   - 📌 [핵심 수치나 핵심 사실 관계를 명확하게 압축]
   - ⚡ [이면에 숨겨진 구조적 원인이나 주요 쟁점]
   - 💡 [관련 기업, 산업, 정책에 미치는 직접적 영향]
4. [빈 줄 한 칸]
5. [심층 분석 및 시사점 1~2줄]:
   - 이 사안이 향후 시장 판도/경제에 왜 중요한지, 투자자/독자가 반드시 주목해야 할 결론과 시사점을 전문가 시선으로 명확히 제시하세요.
   - 필요 시 관련 티커/캐시태그($NVDA, $BTC, $TSLA 등) 자연스럽게 포함.
6. [작성 규칙]:
   - 기자 말투(~하였습니다)나 봇 말투(~을 요약하자면) 절대 금지.
   - 단호하고 명쾌한 전문 분석가 톤앤매너(~임, ~할 수밖에 없는 구조, ~에 주목해야 함) 유지.
   - 유치한 감정 표출이나 가벼운 잡담 대신, 깊이 있는 분석과 팩트에 집중하세요.
   - 오직 완성된 트윗 본문만 깔끔하게 출력하세요.
`;
    }

    const modelsToTry = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
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
            contents: [{ parts: [{ text: promptText + NEGATIVE_PROMPT_BLOCK }] }],
            generationConfig: { temperature: 0.75 + Math.random() * 0.1 } // 0.75~0.85 랜덤 (다양성 강제)
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

  if (mode === 'spicy') {
    const spicyEndings = [
      '아직도 이거 보고 행복회로 돌리는 애들 레전드네 ㅋㅋㅋ 판 다 짜여져 있는데 혼자만 딴 세상 삼 ㅉㅉ',
      '다들 헛소리하는데 팩트 하나 박아줌. 걍 이건 망할 수밖에 없는 구조임. 나중에 성지순례나 와라 🔥',
      '이런 건 내 뇌피셜로 이미 옛날에 다 예상했던 거임 ㅋ 훈수 두기도 입 아프다',
      '진짜 눈 가리고 아웅 하는 것도 정도가 있지 ㅋㅋㅋ 털리고 나서 울지나 마라'
    ];
    const randomEnding = spicyEndings[Math.floor(Math.random() * spicyEndings.length)];
    text = `[팩폭 브리핑]\n\n${koreanTitle}\n\n${randomEnding}`;
  } else if (mode === 'reaction') {
    const reactionEndings = [
      '와 이건 좀 소름 돋는다 ㅋㅋㅋ 설마 했는데 진짜 이렇게 나온다고? 판도 완전히 뒤집힐 듯..',
      '이거 실시간으로 보는데 뇌정지 옴.. 생각보다 스케일 훨씬 심각한데? 말이 안 나온다 진짜',
      '와.. 생각지도 못했네 진짜 놀랍다 ㅋㅋㅋ',
      '이건 진짜 충격인데.. 다들 어떻게 보시나요? 👀'
    ];
    const randomEnding = reactionEndings[Math.floor(Math.random() * reactionEndings.length)];
    text = `${koreanTitle}\n\n${randomEnding}`;
  } else if (mode === 'idol') {
    const idolEmojis = ['🌸', '✨', '💖', '🔥', '👍', '😮', '🫡', '💯', '🤍', '🩷'];
    const emoji = idolEmojis[Math.floor(Math.random() * idolEmojis.length)];
    const idolEndings = [
      `이번 화보 뜬 거 보는데 비주얼이 그냥 화면을 찢어버림.. 컨셉 소화력 미쳤다 ${emoji}`,
      `사진 볼 때마다 느끼는 건데 이목구비 자기주장 살벌하다 진짜.. ${emoji}`,
      `사진 한 장으로 분위기 다 압도하네.. 이건 실물 포스 장난 아닐 듯 ${emoji}`,
      `보정할 것도 없겠네.. 실물 보면 진짜 뇌정지 올 듯 ${emoji}`
    ];
    text = `${koreanTitle}\n\n${idolEndings[Math.floor(Math.random() * idolEndings.length)]}`;
  } else if (mode === 'hybrid') {
    text = `결론부터 박고 시작함. ${koreanTitle} 이슈는 앞으로 시장의 판도를 바꿀 수밖에 없음.\n\n대중들이 착각하고 있는 맹점은 단순 발표로 치부하는 것이지만, 실제 돈과 인프라의 흐름은 완전히 다른 쪽을 가리키고 있습니다.\n\n여기에 다른 시각 있으신 분? 댓글로 반박 환영 💬`;
  } else if (mode === 'mindset') {
    text = `${koreanTitle}\n\n남들이 뭐라 떠들든 신경 끄고 내 페이스 유지하는 것도 엄청난 실력임. 결국 끝까지 흔들리지 않고 자리 지키는 놈이 다 먹는 판이다 🌿\n\n📌 힘들 때 보려고 북마크`;
  } else if (mode === 'story') {
    text = `지금 시장에서 다들 겉핥기만 하고 있는데, 실상을 까보면 전혀 다른 얘기임.\n\n${koreanTitle} 관련해서 제가 지난 흐름을 지켜보며 내린 결론은, 결국 자본과 시장의 주도권이 이쪽으로 쏠릴 수밖에 없다는 점입니다.\n\n1년 뒤에 이 트윗 반드시 성지순례 됩니다 🧵`;
  } else {
    text = `지금 다들 표면적 이슈에만 정신 팔려 있는데, 진짜 무서운 변화는 뒤에 있음 🚨\n\n${koreanTitle}\n\n1️⃣ 겉보기 팩트: ${analysis.summary}\n2️⃣ 뒤에서 벌어지는 현실: ${analysis.analysis}\n3️⃣ 향후 터질 결론: ${analysis.insight}\n\n📌 나중에 확인하려고 타래 북마크`;
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

// 2. Generate Refined X Tweet from Raw User Thoughts/Memos
async function generateThoughtTweet(rawThought, mode = 'block') {
  const config = getConfig();
  const apiKey = config.geminiApiKey;

  if (!apiKey) {
    return {
      text: `${rawThought}\n\n#생각정리 #Jook_Insight`,
      isAiGenerated: false
    };
  }

  try {
    addLog('INFO', `🎙️ 내 생각/메모 기반 AI 트윗 정제 중 (모드: ${mode}): "${rawThought.substring(0, 30)}..."`);

    let stylePrompt = '';
    if (mode === 'reaction') {
      stylePrompt = `진짜 사람이 폰으로 방금 보고 툭 던지는 듯한 1~2줄짜리 날것의 리얼 트윗으로 쓰세요. 가식적인 설명이나 번호 매기기는 절대 금지합니다.`;
    } else if (mode === 'story') {
      stylePrompt = `1인칭 심층 에세이 형식으로 작성하세요. 첫 줄에 호기심을 끄는 한마디를 던지고, 줄바꿈 후 "제가 요즘 보면서 느끼는 건데..." 식으로 자연스럽게 이어지는 사람 냄새 나는 글(3~4줄)로 작성하세요.`;
    } else if (mode === 'hybrid') {
      stylePrompt = `확신에 찬 전문가의 시각으로 작성하세요. 첫 줄에 결론을 쿨하게 박고, 줄바꿈 후 그 이유와 통찰을 자연스러운 인간의 구어체로 2~3줄 풀어내세요.`;
    } else if (mode === 'spicy') {
      stylePrompt = `사이다 팩트폭행과 도파민 터지는 솔직한 입담으로 2~3줄 작성하세요. 뼈 때리는 유머와 거침없는 화법을 쓰세요.`;
    } else if (mode === 'idol') {
      stylePrompt = `2030 남성 시점에서 피드 보다가 비주얼에 숨 멎어서 툭 남기는 1줄 감탄 트윗으로 쓰세요.`;
    } else if (mode === 'mindset') {
      stylePrompt = `따뜻하면서도 뼈를 때리는 인생/멘탈 조언으로 작성하세요. 교과서 같은 훈계가 아니라, 친한 형이나 멘토가 옆에서 툭 조언해 주듯 자연스러운 사람의 문장(2~3줄)으로 쓰세요.`;
    } else {
      // mode === 'block' (일반/인사이트)
      stylePrompt = `첫 줄에 스크롤을 멈추게 하는 흡입력 있는 문장을 던지고, 엔터로 줄바꿈 후 핵심 생각과 통찰을 자연스러운 문단(2~3줄)으로 풀어내세요.`;
    }

    const promptText = `
당신은 X(트위터)에서 수많은 공감과 리트윗을 받는 인기 크리에이터입니다.
아래 사용자가 자유롭게 적은 [내 생각/메모]를 바탕으로, **절대 AI가 요약한 것처럼 보이지 않고, 진짜 사람이 깊은 생각 끝에 쓴 것처럼 자연스러운 완성형 트윗**으로 다듬어주세요.

[사용자의 원래 생각/메모]:
${rawThought}

[스타일 지침]:
${stylePrompt}

🚨 [절대 금지 규칙 - 위반 시 무효]:
1. ❌ "🔹", "🧠", "💡", "1️⃣", "2️⃣", "3️⃣", "핵심 팩트:", "인사이트:" 같은 **AI 요약봇/기계식 번호 매기기 및 머리말 기호는 100% 절대 쓰지 마세요.**
2. ❌ 보고서나 교과서 같은 딱딱한 문어체("~로 사료됩니다", "~라 할 수 있습니다") 절대 금지.
3. ⭕ 오직 **사람이 생각의 흐름대로 엔터(줄바꿈)를 섞어가며 쓴 자연스럽고 매끄러운 트위터 글**로만 작성하세요.
4. 완성된 트윗 본문만 출력하세요. (설명이나 따옴표 금지)
`;

    const modelsToTry = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash',
      'gemini-2.5-flash'
    ];
    let summaryText = null;

    for (const modelName of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await axios.post(
          url,
          { contents: [{ parts: [{ text: promptText }] }], generationConfig: { temperature: 0.75 } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 6000 }
        );

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text.length > 5) {
          summaryText = text;
          break;
        }
      } catch (e) {
        // try next model
      }
    }

    if (!summaryText) throw new Error('AI 응답이 비어있습니다.');

    summaryText = summaryText.replace(/(?:^|\n)\s*[#$][\w가-힣\s#$]+/g, '').replace(/#[^\s#]+/g, '').trim();

    addLog('SUCCESS', `🎙️ 내 생각 기반 인간미 트윗 정제 완료 (${summaryText.length}자)`);
    return {
      text: summaryText,
      isAiGenerated: true,
      mode
    };
  } catch (err) {
    addLog('WARN', `내 생각 AI 호출 지연 (${err.message}), 자연스러운 문장으로 정제합니다.`);

    let fallbackText = '';
    const cleanThought = rawThought.trim();

    if (mode === 'reaction') {
      const reactions = ['와 이건 좀 소름이다 ㅋㅋㅋ', '이건 진짜 상상도 못했네..', '보고 있는데 뇌정지 옴 진짜'];
      const r = reactions[Math.floor(Math.random() * reactions.length)];
      fallbackText = `${cleanThought}\n\n${r}`;
    } else if (mode === 'story') {
      fallbackText = `요즘 계속 곱씹어보게 되는 생각 하나.\n\n${cleanThought}\n\n겉으로 드러난 것만 보면 놓치기 쉬운데, 결국 본질을 꿰뚫어 보는 사람이 끝까지 살아남는 것 같음.`;
    } else if (mode === 'hybrid') {
      fallbackText = `결론부터 말하자면 이건 방향이 이미 정해졌음.\n\n${cleanThought}\n\n대다수가 놓치고 있는 핵심은 결국 구조적인 변화에 있음. 다들 어떻게 생각하시나요?`;
    } else if (mode === 'spicy') {
      fallbackText = `아직도 이걸 모르는 사람이 있다는 게 레전드네 ㅋㅋㅋ\n\n${cleanThought}\n\n판 다 짜여져 있는데 혼자만 딴 소리 하지 말고 현실을 보자 🔥`;
    } else if (mode === 'mindset') {
      fallbackText = `${cleanThought}\n\n남들 시선이나 말에 휘둘리지 말고 내 페이스 지키는 게 가장 중요함. 결국 끝까지 내 자리를 지키는 사람이 이기는 거니까 🌿`;
    } else if (mode === 'idol') {
      fallbackText = `${cleanThought}.. 분위기 진짜 미쳤네 ✨`;
    } else {
      fallbackText = `${cleanThought}\n\n막연하게 고민만 하기보다는, 지금 내 흐름을 온전히 내가 선택하고 실행하는 게 진짜 핵심인 듯.`;
    }

    return {
      text: fallbackText,
      isAiGenerated: false,
      mode
    };
  }
}

module.exports = {
  generateSummary,
  generateThoughtTweet
};