const axios = require('axios');
const { getConfig } = require('./config');
const { isPosted, addLog, getOrCreateFetchedAt, saveStoredArticles } = require('./history');

function cleanHtml(html) {
  if (!html) return '';
  let cleaned = html
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&#8211;/gi, '-')
    .replace(/&#8212;/gi, '--')
    .replace(/&#8216;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"');

  return cleaned
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(str) {
  if (!str) return new Set();
  const cleaned = str
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const stopWords = new Set(['등', '및', '관한', '위해', '하는', '있다', '했다', '속', '까지', '으로', '에서', '에게', '과', '와', '은', '는', '이', '가', '을', '를', '사연', '논란', '기사', '뉴스', '진짜']);
  const words = cleaned.split(' ').filter(w => w.length >= 2 && !stopWords.has(w));
  return new Set(words);
}

function isSimilarArticleTitle(title1, title2) {
  if (!title1 || !title2) return false;
  
  const clean1 = title1.replace(/\s+/g, '').toLowerCase();
  const clean2 = title2.replace(/\s+/g, '').toLowerCase();
  if (clean1 === clean2) return true;
  if (clean1.length > 10 && clean2.length > 10) {
    if (clean1.includes(clean2) || clean2.includes(clean1)) return true;
  }

  const set1 = extractKeywords(title1);
  const set2 = extractKeywords(title2);
  if (set1.size === 0 || set2.size === 0) return false;

  let intersectionCount = 0;
  set1.forEach(w => {
    if (set2.has(w)) intersectionCount++;
  });

  const minSize = Math.min(set1.size, set2.size);
  if (minSize === 0) return false;

  const overlapRatio = intersectionCount / minSize;
  
  if (intersectionCount >= 3 || (intersectionCount >= 2 && overlapRatio >= 0.45)) {
    return true;
  }
  return false;
}

async function fetchArticlePageText(link) {
  if (!link) return '';
  try {
    const res = await axios.get(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 6000,
      maxRedirects: 5
    });
    let cleaned = cleanHtml(res.data);
    cleaned = cleaned.replace(/^[\s\S]*?(1분 요약|분 요약)/i, '');
    cleaned = cleaned.replace(/Semiconductor|Biotechnology|Robotics|Opinion|Membership|Newsletter|Energy|Future/gi, '');
    cleaned = cleaned.replace(/프로필 보기[\s\S]*?1분 요약/gi, '');
    cleaned = cleaned.replace(/출신대학 :[\s\S]*?연구분야 :/gi, '');
    cleaned = cleaned.replace(/전공 :[\s\S]*?읽을 시간 :/gi, '');
    cleaned = cleaned.replace(/기자|구독|무단전재|재배포 금지|Copyright[\s\S]*/gi, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned.substring(0, 1500);
  } catch (err) {
    return '';
  }
}

// 1. Heisenberg Tech Articles
async function fetchHeisenbergArticles(limit = 5, scanBatchTime = null) {
  const config = getConfig();
  const url = `${config.targetUrl}?per_page=${limit}`;

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const posts = response.data;
    if (!Array.isArray(posts)) return [];

    const cleaned = [];
    for (const post of posts) {
      const cleanTitle = cleanHtml(post.title?.rendered || '');
      let cleanContent = cleanHtml(post.content?.rendered || '');

      if (cleanContent.length < 50 && post.link) {
        cleanContent = await fetchArticlePageText(post.link);
      }

      const id = `heisenberg-${post.id}`;
      cleaned.push({
        id,
        category: 'heisenberg',
        categoryTag: '💡 하이젠버그',
        date: new Date(post.date).toISOString(),
        fetchedAt: getOrCreateFetchedAt(id, scanBatchTime || new Date().toISOString()),
        link: post.link,
        title: cleanTitle,
        contentSnippet: cleanContent.substring(0, 1500),
        isPosted: isPosted(id)
      });
    }
    return cleaned;
  } catch (err) {
    console.error('Error fetching Heisenberg articles:', err.message);
    return [];
  }
}

// 2. Korean Google News RSS Feeds
async function fetchNewsRssArticles(categoryKey, queryStr, categoryName, tag, limit = 5, scanBatchTime = null, timeframe = '2h') {
  const freshQuery = `${queryStr} when:${timeframe}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(freshQuery)}&hl=ko&gl=KR&ceid=KR:ko`;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const xml = res.data;
    const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)];
    const articles = [];

    for (let i = 0; i < items.length && articles.length < limit; i++) {
      const itemXml = items[i][0];
      const titleMatch = itemXml.match(/<title>(.*?)<\/title>/i);
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
      const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
      const descMatch = itemXml.match(/<description>(.*?)<\/description>/i);

      if (titleMatch) {
        let title = cleanHtml(titleMatch[1]);
        const sourceIndex = title.lastIndexOf(' - ');
        if (sourceIndex > 0) title = title.substring(0, sourceIndex);

        const isDuplicateTopic = articles.some(a => isSimilarArticleTitle(a.title, title));
        if (isDuplicateTopic) continue;

        const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
        const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
        let rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';

        if (rawSnippet.length < 30 && link) {
          rawSnippet = await fetchArticlePageText(link);
        }
        if (!rawSnippet || rawSnippet.length < 15) {
          rawSnippet = title;
        }

        const id = `${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}`;

        articles.push({
          id,
          category: categoryKey,
          categoryTag: tag,
          date: isoDate,
          fetchedAt: getOrCreateFetchedAt(id, scanBatchTime || new Date().toISOString()),
          link,
          title,
          contentSnippet: rawSnippet.substring(0, 1500),
          isPosted: isPosted(id)
        });
      }
    }
    return articles;
  } catch (err) {
    console.error(`Error fetching ${categoryName} RSS:`, err.message);
    return [];
  }
}

// 3. Global Foreign English News RSS Feeds (월스트리트저널, 로이터, 코인데스크 외신 뉴스)
async function fetchGlobalNewsRssArticles(categoryKey, queryStr, categoryName, tag, limit = 3, scanBatchTime = null, timeframe = '2h') {
  const freshQuery = `${queryStr} when:${timeframe}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(freshQuery)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const xml = res.data;
    const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)];
    const articles = [];

    for (let i = 0; i < items.length && articles.length < limit; i++) {
      const itemXml = items[i][0];
      const titleMatch = itemXml.match(/<title>(.*?)<\/title>/i);
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
      const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
      const descMatch = itemXml.match(/<description>(.*?)<\/description>/i);

      if (titleMatch) {
        let title = cleanHtml(titleMatch[1]);
        const sourceIndex = title.lastIndexOf(' - ');
        let sourceName = '';
        if (sourceIndex > 0) {
          sourceName = title.substring(sourceIndex + 3);
          title = title.substring(0, sourceIndex);
        }

        const isDuplicateTopic = articles.some(a => isSimilarArticleTitle(a.title, title));
        if (isDuplicateTopic) continue;

        const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
        const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
        let rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';

        if (!rawSnippet || rawSnippet.length < 15) {
          rawSnippet = title;
        }

        const id = `global-${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}`;

        articles.push({
          id,
          category: 'global',
          categoryTag: `🌐 해외뉴스 (${tag.replace('🌐 외신 ', '')})`,
          date: isoDate,
          fetchedAt: getOrCreateFetchedAt(id, scanBatchTime || new Date().toISOString()),
          link,
          title: `[외신 ${sourceName ? sourceName : '속보'}] ${title}`,
          contentSnippet: `Global News Source (${sourceName}): ${rawSnippet.substring(0, 1500)}`,
          isGlobal: true,
          isPosted: isPosted(id)
        });
      }
    }
    return articles;
  } catch (err) {
    console.error(`Error fetching Global ${categoryName} RSS:`, err.message);
    return [];
  }
}

async function fetchLatestArticles(limit = 35, scanBatchTime = null) {
  const scanBatchTimeVal = scanBatchTime || new Date().toISOString();
  addLog('INFO', '국내외 최신 소식 수집 시작 (하이젠버그, IT, 코인, 주식, 경제 + 글로벌 외신)');

  try {
    const [
      heisenberg,
      itNews,
      coinNews,
      stockNews,
      economyNews,
      globalIt,
      globalCoin,
      globalStock,
      globalEconomy,
      blindNews,
      pannNews,
      gossipNews,
      mindsetNews
    ] = await Promise.all([
      fetchHeisenbergArticles(5, scanBatchTimeVal),
      fetchNewsRssArticles('it', '(IT OR 테크 OR 반도체 OR AI OR 엔비디아 OR 애플 OR 빅테크)', 'IT뉴스', '💻 IT뉴스', 4, scanBatchTimeVal),
      fetchNewsRssArticles('coin', '(비트코인 OR 가상자산 OR 코인 OR 이더리움 OR 암호화폐 OR 리플)', '코인', '🪙 코인', 4, scanBatchTimeVal),
      fetchNewsRssArticles('stock', '(주식 OR 증시 OR 코스피 OR 미국주식 OR 나스닥 OR 엔비디아 OR 테슬라)', '주식', '📈 주식', 4, scanBatchTimeVal),
      fetchNewsRssArticles('economy', '(경제 OR 금리 OR 환율 OR 인플레이션 OR 연준 OR 물가)', '경제뉴스', '💵 경제', 4, scanBatchTimeVal),
      fetchGlobalNewsRssArticles('it', '(Nvidia OR Apple OR OpenAI OR "Artificial Intelligence" OR Tech)', '글로벌 IT', '💻 IT', 3, scanBatchTimeVal),
      fetchGlobalNewsRssArticles('coin', '(Bitcoin OR Crypto OR Ethereum OR Binance OR Ripple)', '글로벌 코인', '🪙 코인', 3, scanBatchTimeVal),
      fetchGlobalNewsRssArticles('stock', '(Nasdaq OR "S&P500" OR "Stock Market" OR NVDA OR TSLA)', '글로벌 주식', '📈 주식', 3, scanBatchTimeVal),
      fetchGlobalNewsRssArticles('economy', '(Fed OR "Federal Reserve" OR "Interest Rate" OR Inflation)', '글로벌 경제', '💵 경제', 3, scanBatchTimeVal),
      fetchNewsRssArticles('blind', '("블라인드 글" OR "블라인드 폭로" OR "블라인드 올라온" OR "블라인드 캡처" OR "블라인드 논란") (삼성 OR 쿠팡 OR 하이닉스 OR 이직 OR 연봉 OR 직장인 OR 폭로)', '블라인드', '🏢 블라인드 / 직장썰', 8, scanBatchTimeVal, '5d'),
      fetchNewsRssArticles('pann', '("네이트판" OR "사연") (파혼 OR 상견례 OR 축의금 OR "어떻게 생각" OR 이혼 OR 갈등 OR 시어머니 OR 며느리) -연예 -방송 -배우 -아이돌 -예능 -드라마 -영화 -가수', '네이트판', '⚖️ 네이트판 / 사연', 8, scanBatchTimeVal, '5d'),
      fetchNewsRssArticles('gossip', '(연예 OR 예능 OR 인플루언서 OR 셀럽 OR KPOP OR 드라마 OR 배우 OR 가수 OR 아이돌) (논란 OR 파문 OR 폭로 OR 근황 OR 화제)', '가십', '🗣️ 가십 / 연예 / 화제 이슈', 8, scanBatchTimeVal, '5d'),
      fetchNewsRssArticles('mindset', '(심리학 OR 멘탈 OR 대인관계 OR 생각정리 OR 번아웃 OR 자존감)', '멘탈/심리', '🧠 멘탈 / 심리 / 대인관계', 8, scanBatchTimeVal, '5d')
    ]);

    let allArticles = [
      ...heisenberg,
      ...itNews,
      ...globalIt,
      ...coinNews,
      ...globalCoin,
      ...stockNews,
      ...globalStock,
      ...economyNews,
      ...globalEconomy,
      ...blindNews,
      ...pannNews,
      ...gossipNews,
      ...mindsetNews
    ];

    // Cross-category semantic deduplication
    const uniqueArticles = [];
    allArticles.forEach(art => {
      const isDuplicate = uniqueArticles.some(existing => 
        existing.category === art.category && isSimilarArticleTitle(existing.title, art.title)
      );
      if (!isDuplicate) {
        uniqueArticles.push(art);
      }
    });
    allArticles = uniqueArticles;

    allArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
    const persistentArticles = saveStoredArticles(allArticles);

    addLog('SUCCESS', `국내외 총 ${allArticles.length}건의 최신 소식을 성공적으로 수집했습니다. (DB 보관: ${persistentArticles.length}건)`);
    return persistentArticles;
  } catch (err) {
    addLog('ERROR', `뉴스 수집 실패: ${err.message}`);
    return [];
  }
}

module.exports = {
  fetchLatestArticles,
  cleanHtml,
  isSimilarArticleTitle
};
