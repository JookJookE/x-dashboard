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
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
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

function extractNames(str) {
  if (!str) return [];
  const nonNameWords = new Set([
    '논란', '근황', '파문', '폭로', '화제', '기사', '뉴스', '연예', '방송', '배우', '가수', '아이돌',
    '드라마', '영화', '예능', '사연', '이혼', '파혼', '상견례', '축의금', '시댁', '며느리', '남친', '여친',
    '캐나다', '미국', '한국', '일본', '중국', '오토바이', '수영복', '한달살기', '라이딩', '행복', '고백',
    '입었다고', '민폐', '팀장님', '운동복', '출근룩', '사진', '공개', '재조명', '발언', '과거', '충격'
  ]);

  const words = str
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => /^[가-힣]{2,4}$/.test(w) && !nonNameWords.has(w));

  return Array.from(new Set(words));
}

function isSimilarArticleTitle(title1, title2) {
  if (!title1 || !title2) return false;

  const clean1 = title1.replace(/\s+/g, '').toLowerCase();
  const clean2 = title2.replace(/\s+/g, '').toLowerCase();
  if (clean1 === clean2) return true;

  // Person Name Exception Check:
  // If both titles contain distinct 2-4 syllable person names and have NO shared names, they are NEVER duplicates!
  const names1 = extractNames(title1);
  const names2 = extractNames(title2);

  if (names1.length > 0 && names2.length > 0) {
    const hasSharedName = names1.some(n1 => names2.includes(n1));
    if (!hasSharedName) {
      return false; // Different people -> NOT a duplicate!
    }
  }

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
    const iconv = require('iconv-lite');
    const res = await axios.get(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 6000,
      maxRedirects: 5,
      responseType: 'arraybuffer'
    });

    let html = '';
    const contentType = res.headers['content-type'] || '';
    if (contentType.toLowerCase().includes('euc-kr')) {
      html = iconv.decode(res.data, 'EUC-KR');
    } else {
      html = res.data.toString('utf-8');
      if (html.toLowerCase().includes('charset=euc-kr')) {
        html = iconv.decode(res.data, 'EUC-KR');
      }
    }

    // Strip common non-article areas before stripping tags
    html = html.replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, '');

    let cleaned = cleanHtml(html);

    // Custom cleanup for Nate Pann menus that slip through
    if (link.includes('pann.nate.com')) {
      cleaned = cleaned.replace(/^[\s\S]*?이전글\s*다음글\s*/i, '');
      cleaned = cleaned.replace(/(추천\s*추천수|추천\s*\d+\s*반대|URL복사|목록\s*\|\s*인쇄|댓글달기)[\s\S]*$/i, '');
    }

    // Remove specific boilerplate words but DO NOT use [\s\S]* which destroys the whole article
    cleaned = cleaned.replace(/Semiconductor|Biotechnology|Robotics|Opinion|Membership|Newsletter|Energy|Future/gi, '');
    cleaned = cleaned.replace(/(무단 전재|무단전재|재배포 금지|Copyright|ⓒ|기자|구독)/gi, '');
    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

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

// 2. Nate Pann Talkers' Choice
async function fetchNatePannArticles(limit = 8, scanBatchTime = null) {
  const iconv = require('iconv-lite');
  const url = 'https://pann.nate.com/talk/c20001?page=1'; // 톡커들의 선택
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000,
      responseType: 'arraybuffer'
    });
    const html = res.data.toString('utf-8');

    // Extract links inside the list. They usually look like <a href="/talk/12345678" title="Title">
    const matches = [...html.matchAll(/<a href=["'](\/talk\/[0-9]+)["'][^>]*title=["']([^"']+)["']/gi)];

    const articles = [];
    const seenLinks = new Set();

    for (const match of matches) {
      if (articles.length >= limit) break;
      const link = `https://pann.nate.com${match[1]}`;
      const title = cleanHtml(match[2]);

      if (seenLinks.has(link) || title.length < 5) continue;
      seenLinks.add(link);

      const id = `pann-${match[1].replace('/talk/', '')}`;
      if (isPosted(id)) continue;

      // Attempt to fetch body text for snippet
      const rawSnippet = await fetchArticlePageText(link) || title;

      articles.push({
        id,
        category: 'pann',
        categoryTag: '⚖️ 네이트판 / 사연',
        date: new Date().toISOString(),
        fetchedAt: getOrCreateFetchedAt(id, scanBatchTime || new Date().toISOString()),
        link,
        title,
        source: '네이트판',
        contentSnippet: rawSnippet.substring(0, 1500),
        isPosted: false
      });
    }

    return articles;
  } catch (err) {
    console.error('Error fetching Nate Pann:', err.message);
    return [];
  }
}

// Helper to parse XML from direct Google News RSS
function parseGoogleNewsXml(xml, categoryKey, tag, categoryName, limit, isGlobal = false) {
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
        sourceName = title.substring(sourceIndex + 3).trim();
        title = title.substring(0, sourceIndex).trim();
      }

      const isDuplicateTopic = articles.some(a => isSimilarArticleTitle(a.title, title));
      if (isDuplicateTopic) continue;

      const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
      const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
      let rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';

      if (!rawSnippet || rawSnippet.length < 15) {
        rawSnippet = title;
      }

      const id = isGlobal ? `global-${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}` : `${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}`;

      articles.push({
        id,
        category: isGlobal ? 'global' : categoryKey,
        categoryTag: isGlobal ? `🌐 해외뉴스 (${tag.replace('🌐 외신 ', '')})` : tag,
        title: isGlobal ? `[외신 ${sourceName || '미국뉴스'}] ${title}` : title,
        source: sourceName || (isGlobal ? '해외언론' : '뉴스'),
        link,
        date: isoDate,
        excerpt: rawSnippet.substring(0, 300),
        contentSnippet: isGlobal ? `Global News Source (${sourceName}): ${rawSnippet.substring(0, 1500)}` : `${categoryName} (${sourceName}): ${rawSnippet.substring(0, 1500)}`,
        isGlobal,
        isPosted: isPosted(id)
      });
    }
  }
  return articles;
}

// Helper to parse XML from Bing News RSS
function parseBingNewsXml(xml, categoryKey, tag, categoryName, limit, isGlobal = false) {
  const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)];
  const articles = [];

  for (let i = 0; i < items.length && articles.length < limit; i++) {
    const itemXml = items[i][0];
    const titleMatch = itemXml.match(/<title>(.*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
    const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
    const descMatch = itemXml.match(/<description>(.*?)<\/description>/i);
    const sourceMatch = itemXml.match(/<news:source[^>]*>(.*?)<\/news:source>/i) || itemXml.match(/<source[^>]*>(.*?)<\/source>/i);

    if (titleMatch) {
      let title = cleanHtml(titleMatch[1]);
      let sourceName = sourceMatch ? cleanHtml(sourceMatch[1]) : '';
      if (!sourceName && title.includes(' - ')) {
        const idx = title.lastIndexOf(' - ');
        sourceName = title.substring(idx + 3).trim();
        title = title.substring(0, idx).trim();
      }

      const isDuplicateTopic = articles.some(a => isSimilarArticleTitle(a.title, title));
      if (isDuplicateTopic) continue;

      const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
      const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
      let rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';

      if (!rawSnippet || rawSnippet.length < 15) {
        rawSnippet = title;
      }

      const id = isGlobal ? `global-${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}` : `${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}`;

      articles.push({
        id,
        category: isGlobal ? 'global' : categoryKey,
        categoryTag: isGlobal ? `🌐 해외뉴스 (${tag.replace('🌐 외신 ', '')})` : tag,
        title: isGlobal ? `[외신 ${sourceName || '미국뉴스'}] ${title}` : title,
        source: sourceName || (isGlobal ? '해외언론' : '뉴스'),
        link,
        date: isoDate,
        excerpt: rawSnippet.substring(0, 300),
        contentSnippet: isGlobal ? `Global News Source (${sourceName}): ${rawSnippet.substring(0, 1500)}` : `${categoryName} (${sourceName}): ${rawSnippet.substring(0, 1500)}`,
        isGlobal,
        isPosted: isPosted(id)
      });
    }
  }
  return articles;
}

// Helper for proxy request with 429 retry
async function fetchProxyWithRetry(proxyUrl) {
  try {
    return await axios.get(proxyUrl, { timeout: 8000 });
  } catch (err) {
    if (err.response && err.response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 400));
      return await axios.get(proxyUrl, { timeout: 8000 });
    }
    throw err;
  }
}

// 3. Korean News RSS Feeds (1차 구글 직통 ➔ 2차 CF Worker 구글 원본 ➔ 3차 Bing 백업 ➔ 4차 rss2json 백업)
async function fetchNewsRssArticles(categoryKey, queryStr, categoryName, tag, limit = 5, scanBatchTime = null, timeframe = '2h') {
  const freshQuery = `${queryStr} when:${timeframe}`;
  const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(freshQuery)}&hl=ko&gl=KR&ceid=KR:ko`;

  // 1차 시도: 구글 뉴스 직통 수집 (내 컴퓨터 / 허용 IP)
  try {
    const directRes = await axios.get(googleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 5000
    });

    if (directRes.data && typeof directRes.data === 'string' && directRes.data.includes('<item>')) {
      const articles = parseGoogleNewsXml(directRes.data, categoryKey, tag, categoryName, limit, false);
      if (articles.length > 0) {
        addLog('SUCCESS', `⚡ [구글 직통 성공] ${categoryName} 구글 서버 직접 연결 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (directErr) {
    // 1차 직통 실패 시 2차 Cloudflare Worker 구글 원본 수집 시도
  }

  // 2차 시도: Cloudflare Worker 구글 원본 우회 수집 (Render 클라우드 IP 차단 100% 회피 + 구글 원본 100개 풀 수집)
  try {
    const cfUrl = `${CF_WORKER_URL}${encodeURIComponent(googleUrl)}`;
    const cfRes = await axios.get(cfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 6000
    });

    if (cfRes.data && typeof cfRes.data === 'string' && cfRes.data.includes('<item>')) {
      const articles = parseGoogleNewsXml(cfRes.data, categoryKey, tag, categoryName, limit, false);
      if (articles.length > 0) {
        addLog('SUCCESS', `⚡ [구글 원본 프록시 성공] ${categoryName} Cloudflare 구글 뉴스 원본 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (cfErr) {
    // 2차 프록시 실패 시 3차 rss2json 구글 릴레이 시도
  }

  // 3차 시도: rss2json 구글 뉴스 릴레이 수집
  try {
    const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
    const r2jRes = await axios.get(r2jUrl, { timeout: 5000 });
    if (r2jRes.data && r2jRes.data.status === 'ok' && Array.isArray(r2jRes.data.items) && r2jRes.data.items.length > 0) {
      const articles = parseRss2JsonItems(r2jRes.data.items, categoryKey, tag, categoryName, limit, false);
      if (articles.length > 0) {
        addLog('SUCCESS', `⚡ [구글 릴레이 성공] ${categoryName} rss2json 구글 뉴스 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (r2jErr) {
    addLog('WARN', `🚫 [구글 수집 지연 ➔ Bing 백업 전환] ${categoryName} 구글 연결 지연. Bing 뉴스 엔진으로 자동 전환합니다.`);
  }

  // 3차 시도: Bing News RSS 백업 엔진
  try {
    let bingQuery = queryStr;
    if (categoryKey === 'blind') {
      bingQuery = '블라인드 직장인';
    } else if (categoryKey === 'gossip') {
      bingQuery = '연예인 근황';
    } else if (categoryKey === 'mindset') {
      bingQuery = '심리학 멘탈';
    } else {
      bingQuery = queryStr.replace(/[\(\)"]/g, '').replace(/\bOR\b/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(bingQuery)}&format=rss&setlang=ko-KR`;
    const bingRes = await axios.get(bingUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 6000
    });

    if (bingRes.data && typeof bingRes.data === 'string' && bingRes.data.includes('<item>')) {
      const articles = parseBingNewsXml(bingRes.data, categoryKey, tag, categoryName, limit, false);
      if (articles.length > 0) {
        addLog('SUCCESS', `🔄 [Bing 백업 수집 성공] ${categoryName} Bing News 엔진 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (bingErr) {
    addLog('WARN', `⚠️ [Bing 백업 실패 ➔ rss2json 전환] ${categoryName} Bing 수집 지연 (${bingErr.message}).`);
  }

  // 3차 시도: rss2json 우회 수집 (최종 백업)
  const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
  try {
    const res = await fetchProxyWithRetry(proxyUrl);

    if (res.data.status !== 'ok') {
      addLog('WARN', `⚠️ [우회 수집 실패] ${categoryName} RSS 우회 응답 실패 (Status: ${res.data.status || 'unknown'})`);
      return [];
    }
    const items = res.data.items || [];
    const articles = [];

    for (let i = 0; i < items.length && articles.length < limit; i++) {
      const itemXml = items[i];
      const titleMatch = [null, itemXml.title || ''];
      const linkMatch = [null, itemXml.link || ''];
      const dateMatch = [null, itemXml.pubDate || ''];
      const descMatch = [null, itemXml.description || ''];

      if (titleMatch) {
        let title = cleanHtml(titleMatch[1]);
        const sourceIndex = title.lastIndexOf(' - ');
        let sourceName = '';
        if (sourceIndex > 0) {
          sourceName = title.substring(sourceIndex + 3).trim();
          title = title.substring(0, sourceIndex).trim();
        }

        const isDuplicateTopic = articles.some(a => isSimilarArticleTitle(a.title, title));
        if (isDuplicateTopic) continue;

        const link = linkMatch ? cleanHtml(linkMatch[1]) : '';
        const isoDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
        let rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';

        if (!rawSnippet || rawSnippet.length < 15) {
          rawSnippet = title;
        }

        const id = `${categoryKey}-${Buffer.from(title).toString('hex').substring(0, 12)}`;

        articles.push({
          id,
          category: categoryKey,
          categoryTag: tag,
          title,
          source: sourceName || '뉴스',
          link,
          date: isoDate,
          excerpt: rawSnippet.substring(0, 300),
          contentSnippet: `${categoryName} (${sourceName}): ${rawSnippet.substring(0, 1500)}`,
          isPosted: isPosted(id)
        });
      }
    }
    if (articles.length > 0) {
      addLog('SUCCESS', `🔄 [우회 수집 성공] ${categoryName} RSS 백업 우회 통로로 수집 완료 (${articles.length}건)`);
    }
    return articles;
  } catch (err) {
    addLog('ERROR', `❌ [수집 최종 실패] ${categoryName} RSS 통신 오류: ${err.message}`);
    console.error(`Error fetching ${categoryName} RSS:`, err.message);
    return [];
  }
}

// 4. Global Foreign English News RSS Feeds (1차 구글 직통 ➔ 2차 CF Worker 구글 원본 ➔ 3차 Bing 백업 ➔ 4차 rss2json 백업)
async function fetchGlobalNewsRssArticles(categoryKey, queryStr, categoryName, tag, limit = 3, scanBatchTime = null, timeframe = '2h') {
  // 1차 시도: Bing Global News RSS 초고속 메인 엔진 (0.2초, 0% 차단)
  try {
    const bingQuery = queryStr.replace(/[\(\)"]/g, '').replace(/\bOR\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(bingQuery)}&format=rss&setlang=en-US`;
    const bingRes = await axios.get(bingUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 5000
    });

    if (bingRes.data && typeof bingRes.data === 'string' && bingRes.data.includes('<item>')) {
      const articles = parseBingNewsXml(bingRes.data, categoryKey, tag, categoryName, limit, true);
      if (articles.length > 0) {
        addLog('SUCCESS', `🚀 [1차 메인 수집 성공] Global ${categoryName} 최신 뉴스 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (bingErr) {
    addLog('WARN', `⚠️ [1차 Bing 지연 ➔ 2차 구글 전환] Global ${categoryName} Bing 수집 지연 (${bingErr.message}).`);
  }

  // 2차 시도: 구글 뉴스 직통 백업 수집
  const freshQuery = `${queryStr} when:${timeframe}`;
  const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(freshQuery)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const directRes = await axios.get(googleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 3000
    });

    if (directRes.data && typeof directRes.data === 'string' && directRes.data.includes('<item>')) {
      const articles = parseGoogleNewsXml(directRes.data, categoryKey, tag, categoryName, limit, true);
      if (articles.length > 0) {
        addLog('SUCCESS', `⚡ [2차 구글 백업 성공] Global ${categoryName} 구글 뉴스 백업 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (directErr) {}

  // 3차 시도: rss2json 글로벌 구글 뉴스 릴레이 수집
  try {
    const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
    const r2jRes = await axios.get(r2jUrl, { timeout: 4000 });
    if (r2jRes.data && r2jRes.data.status === 'ok' && Array.isArray(r2jRes.data.items) && r2jRes.data.items.length > 0) {
      const articles = parseRss2JsonItems(r2jRes.data.items, categoryKey, tag, categoryName, limit, true);
      if (articles.length > 0) {

  // 3차 시도: Bing Global News RSS 백업 엔진
  try {
    const bingQuery = queryStr.replace(/[\(\)"]/g, '').replace(/\bOR\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(bingQuery)}&format=rss&setlang=en-US`;
    const bingRes = await axios.get(bingUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 6000
    });

    if (bingRes.data && typeof bingRes.data === 'string' && bingRes.data.includes('<item>')) {
      const articles = parseBingNewsXml(bingRes.data, categoryKey, tag, categoryName, limit, true);
      if (articles.length > 0) {
        addLog('SUCCESS', `🔄 [Bing 백업 수집 성공] Global ${categoryName} Bing News 엔진 수집 완료 (${articles.length}건)`);
        return articles;
      }
    }
  } catch (bingErr) {
    addLog('WARN', `⚠️ [Bing 백업 실패 ➔ rss2json 전환] Global ${categoryName} Bing 수집 지연 (${bingErr.message}).`);
  }

  // 3차 시도: rss2json 우회 수집 (최종 백업)
  const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
  try {
    const res = await fetchProxyWithRetry(proxyUrl);

    if (res.data.status !== 'ok') {
      addLog('WARN', `⚠️ [우회 수집 실패] Global ${categoryName} RSS 우회 응답 실패 (Status: ${res.data.status || 'unknown'})`);
      return [];
    }
    const items = res.data.items || [];
    const articles = [];

    for (let i = 0; i < items.length && articles.length < limit; i++) {
      const itemXml = items[i];
      const titleMatch = [null, itemXml.title || ''];
      const linkMatch = [null, itemXml.link || ''];
      const dateMatch = [null, itemXml.pubDate || ''];
      const descMatch = [null, itemXml.description || ''];

      if (titleMatch) {
        let title = cleanHtml(titleMatch[1]);
        const sourceIndex = title.lastIndexOf(' - ');
        let sourceName = '';
        if (sourceIndex > 0) {
          sourceName = title.substring(sourceIndex + 3).trim();
          title = title.substring(0, sourceIndex).trim();
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
          title: `[외신 ${sourceName || '미국뉴스'}] ${title}`,
          source: sourceName || '해외언론',
          link,
          date: isoDate,
          excerpt: rawSnippet.substring(0, 300),
          contentSnippet: `Global News Source (${sourceName}): ${rawSnippet.substring(0, 1500)}`,
          isGlobal: true,
          isPosted: isPosted(id)
        });
      }
    }
    if (articles.length > 0) {
      addLog('SUCCESS', `🔄 [우회 수집 성공] Global ${categoryName} RSS 백업 우회 통로로 수집 완료 (${articles.length}건)`);
    }
    return articles;
  } catch (err) {
    addLog('ERROR', `❌ [수집 최종 실패] Global ${categoryName} RSS 통신 오류: ${err.message}`);
    console.error(`Error fetching Global ${categoryName} RSS:`, err.message);
    return [];
  }
}

// Main fetcher: 순차 순연 수집으로 Cloudflare 프록시 타임아웃 100% 방지
async function fetchLatestArticles(limit = 35, scanBatchTime = null) {
  const scanBatchTimeVal = scanBatchTime || new Date().toISOString();
  addLog('INFO', '국내외 최신 소식 수집 시작 (하이젠버그, IT, 코인, 주식, 경제 + 글로벌 외신)');

  try {
    const heisenberg = await fetchHeisenbergArticles(5, scanBatchTimeVal);
    const itNews = await fetchNewsRssArticles('it', 'IT OR 테크 OR 반도체 OR AI', 'IT뉴스', '💻 IT뉴스', 4, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const coinNews = await fetchNewsRssArticles('coin', '비트코인 OR 코인 OR 이더리움 OR 암호화폐', '코인', '🪙 코인', 4, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const stockNews = await fetchNewsRssArticles('stock', '주식 OR 증시 OR 코스피 OR 나스닥', '주식', '📈 주식', 4, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const economyNews = await fetchNewsRssArticles('economy', '경제 OR 금리 OR 환율 OR 연준', '경제뉴스', '💵 경제', 4, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const globalIt = await fetchGlobalNewsRssArticles('it', 'Nvidia OR Apple OR OpenAI OR AI', '글로벌 IT', '💻 IT', 6, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const globalCoin = await fetchGlobalNewsRssArticles('coin', 'Bitcoin OR Crypto OR Ethereum OR Binance', '글로벌 코인', '🪙 코인', 6, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const globalStock = await fetchGlobalNewsRssArticles('stock', 'Nasdaq OR SP500 OR Stock Market OR NVDA', '글로벌 주식', '📈 주식', 6, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const globalEconomy = await fetchGlobalNewsRssArticles('economy', 'Fed OR Federal Reserve OR Interest Rate OR Inflation', '글로벌 경제', '💵 경제', 6, scanBatchTimeVal);
    await new Promise(r => setTimeout(r, 120));

    const blindNews = await fetchNewsRssArticles('blind', '블라인드 직장인 이직 연봉', '블라인드', '🏢 블라인드 / 직장썰', 8, scanBatchTimeVal, '5d');
    const pannNews = await fetchNatePannArticles(8, scanBatchTimeVal);
    const gossipNews = await fetchNewsRssArticles('gossip', '연예인 근황', '가십', '🗣️ 가십 / 연예 / 화제 이슈', 8, scanBatchTimeVal, '5d');
    const mindsetNews = await fetchNewsRssArticles('mindset', '심리학 멘탈 대인관계 자존감', '멘탈/심리', '🧠 멘탈 / 심리 / 대인관계', 8, scanBatchTimeVal, '5d');

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
