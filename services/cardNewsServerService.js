const fs = require('fs');
const path = require('path');
const axios = require('axios');

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('⚠️ [주의] sharp 모듈이 설치되지 않아 SVG 직접 모드로 동작합니다. (npm install sharp 필요)');
}

const THUMBNAIL_DIR = path.join(__dirname, '..', 'public', 'thumbnails');
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Split title into wrapped lines (32px Bold, max-width 880px)
 */
function wrapTitleLines(text, maxCharsPerLine = 22, maxLines = 3) {
  if (!text) return [''];
  const words = text.replace(/\[외신\s*.*?\]/g, '').replace(/\[오피니언\]/g, '').trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length === maxLines - 1) break;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines.slice(0, maxLines);
}

/**
 * Clean and split snippet/body text (22px Regular, max-width 880px)
 */
function getSnippetLines(article, maxCharsPerLine = 34, maxLines = 18) {
  let snippet = article.contentSnippet || article.excerpt || article.title || '';
  
  // Clean snippet from ugly RSS artifacts matching app.js getSnippetLines
  let cleaned = snippet
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/v\.daum\.net/gi, '')
    .replace(/n\.news\.naver\.com/gi, '')
    .replace(/boannews\.com/gi, '')
    .replace(/\[단독\]/gi, '')
    .replace(/\[인터뷰\]/gi, '')
    .replace(new RegExp((article.source || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  let titleRemoved = cleaned.replace(new RegExp((article.title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
  if (titleRemoved.length > 10) {
    cleaned = titleRemoved;
  }

  snippet = cleaned;
  if (!snippet || snippet.length < 5) {
    snippet = "본문 요약 내용이 없습니다. 원본 링크를 참고해 주세요.";
  }

  const paragraphs = snippet.split('\n').filter(p => p.trim() !== '');
  const lines = [];

  for (const p of paragraphs) {
    const words = p.split(' ');
    let currentLine = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = currentLine ? `${currentLine} ${words[n]}` : words[n];
      if (testLine.length > maxCharsPerLine && currentLine) {
        lines.push(currentLine);
        currentLine = words[n];
        if (lines.length >= maxLines) break;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine && lines.length < maxLines) {
      lines.push(currentLine);
    }
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

/**
 * Resolve real image URL from article with 4-tier deep resolution (Exact server.js replica)
 */
async function resolveArticleImageUrl(article) {
  if (article.imageUrl && article.imageUrl.startsWith('http') && !article.imageUrl.includes('google') && !article.imageUrl.includes('gstatic') && !article.imageUrl.includes('logo')) {
    return article.imageUrl;
  }

  let targetUrl = article.link || '';

  // 1. Resolve Google redirect link if needed
  if (targetUrl && targetUrl.includes('news.google.com')) {
    try {
      const gRes = await axios.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 4000,
        maxRedirects: 5
      });
      if (gRes.request?.res?.responseUrl && !gRes.request.res.responseUrl.includes('news.google.com')) {
        targetUrl = gRes.request.res.responseUrl;
      }
    } catch (e) {}
  }

  // 2. Fetch direct webpage (AI Times, Naver, Nate Pann, Blind, Chosun, etc.)
  if (targetUrl && !targetUrl.includes('news.google.com')) {
    try {
      const directRes = await axios.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 5000,
        responseType: 'arraybuffer'
      });

      const iconv = require('iconv-lite');
      let dHtml = directRes.data.toString('utf-8');
      if (dHtml.toLowerCase().includes('charset=euc-kr')) {
        dHtml = iconv.decode(directRes.data, 'EUC-KR');
      }

      // 2a. Meta og:image & twitter:image
      const ogMatches = [
        ...dHtml.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi),
        ...dHtml.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/gi),
        ...dHtml.matchAll(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi)
      ];

      for (const og of ogMatches) {
        if (og && og[1]) {
          let photo = og[1].replace(/&amp;/g, '&').trim();
          if (photo.startsWith('//')) photo = 'https:' + photo;
          const pLower = photo.toLowerCase();
          if (!pLower.includes('google') && !pLower.includes('gstatic') && !pLower.includes('logo') && !pLower.includes('icon') && !pLower.includes('avatar') && !pLower.includes('banner')) {
            return photo;
          }
        }
      }

      // 2b. Article body images
      const bodyImgs = [
        ...dHtml.matchAll(/<img[^>]*src=["'](https?:\/\/[^"']+)["']/gi),
        ...dHtml.matchAll(/<img[^>]*src=["'](\/\/[^"']+)["']/gi)
      ];

      for (const m of bodyImgs) {
        let src = m[1].replace(/&amp;/g, '&').trim();
        if (src.startsWith('//')) src = 'https:' + src;
        const sLower = src.toLowerCase();

        const isPhoto = sLower.includes('fimg') || sLower.includes('download.jsp') || sLower.includes('imgnews') ||
          sLower.includes('upload') || sLower.includes('article') || sLower.includes('content') ||
          /\.(jpg|jpeg|png|webp)(\?|$)/i.test(sLower);

        if (isPhoto && !sLower.includes('google') && !sLower.includes('gstatic') && !sLower.includes('logo') && !sLower.includes('icon') && !sLower.includes('btn') && !sLower.includes('stat') && !sLower.includes('emoticon')) {
          return src;
        }
      }
    } catch (e) {}
  }

  // 3. High-precision Naver News Photo Search by Title
  const cleanTitle = (article.title || '').replace(/\[.*?\]/g, '').replace(/ - .*$/, '').trim();
  if (cleanTitle) {
    try {
      const searchUrl = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(cleanTitle)}`;
      const searchRes = await axios.get(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 6000
      });

      const html = searchRes.data;
      const imgMatches = [...html.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)];

      for (const m of imgMatches) {
        let src = m[1].replace(/&amp;/g, '&');
        let checkUrl = src;
        const paramMatch = src.match(/src=([^&]+)/);
        if (paramMatch && paramMatch[1]) {
          checkUrl = decodeURIComponent(paramMatch[1]);
        }
        const lower = checkUrl.toLowerCase();
        if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower) || lower.includes('imgnews') || lower.includes('search.pstatic.net')) {
          if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('profile') && !lower.includes('spg') && !lower.includes('google') && !lower.includes('gstatic')) {
            return checkUrl;
          }
        }
      }
    } catch (e) {}
  }

  // 4. Daum News Photo Search Backup
  if (cleanTitle) {
    try {
      const daumUrl = `https://search.daum.net/search?w=news&q=${encodeURIComponent(cleanTitle)}`;
      const dRes = await axios.get(daumUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 5000
      });
      const dHtml = dRes.data;
      const dImgs = [...dHtml.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)];
      for (const m of dImgs) {
        const src = m[1].replace(/&amp;/g, '&');
        const lower = src.toLowerCase();
        if ((lower.includes('daumcdn.net') || lower.includes('fname=')) && !lower.includes('logo') && !lower.includes('icon') && !lower.includes('static') && !lower.includes('google')) {
          return src;
        }
      }
    } catch (e) {}
  }

  return null;
}

/**
 * 1. 📝 [기사 캡처 (제목만)] Card (Dashboard Replica)
 */
async function generateCardNewsTitleOnly(article) {
  const title = article.title || '최신 뉴스 리포트';
  const source = article.source || article.author || '디지털뉴스룸';
  const author = article.author || article.source || '디지털뉴스룸 기자';
  const dateStr = new Date(article.date || Date.now()).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const timestamp = Date.now() + Math.floor(Math.random() * 1000);
  const filename = `news-capture-title-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;
  const canvasHeight = 200 + (lineCount * 46);

  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>
  ${titleSvg}
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>
</svg>`;

  if (sharp) {
    await sharp(Buffer.from(svgContent, 'utf8')).png({ quality: 95 }).toFile(outputPath);
  } else {
    fs.writeFileSync(outputPath.replace('.png', '.svg'), svgContent, 'utf8');
  }

  return { mode: 'title', filename, filepath: outputPath };
}

/**
 * 2. 📄 [기사 캡처 (제목+본문)] Card (Dashboard Replica)
 */
async function generateCardNewsBody(article) {
  const title = article.title || '최신 뉴스 리포트';
  const source = article.source || article.author || '디지털뉴스룸';
  const author = article.author || article.source || '디지털뉴스룸 기자';
  const dateStr = new Date(article.date || Date.now()).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const bodyLines = getSnippetLines(article, 34, 18);

  const timestamp = Date.now() + Math.floor(Math.random() * 1000);
  const filename = `news-capture-body-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;

  let currentY = 125 + (lineCount * 46) + 10 + 22 + 30;
  const canvasHeight = currentY + (bodyLines.length * 40) + 40;

  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;

  const bodySvg = bodyLines.map((line, idx) => {
    const yPos = currentY + 10 + (idx * 40);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" fill="#334155">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>
  ${titleSvg}
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>
  ${bodySvg}
</svg>`;

  if (sharp) {
    await sharp(Buffer.from(svgContent, 'utf8')).png({ quality: 95 }).toFile(outputPath);
  } else {
    fs.writeFileSync(outputPath.replace('.png', '.svg'), svgContent, 'utf8');
  }

  return { mode: 'body', filename, filepath: outputPath };
}

/**
 * 3. 📸 [기사 캡처 (제목+사진)] Card (Dashboard Replica)
 */
async function generateCardNewsPhoto(article) {
  const title = article.title || '최신 뉴스 리포트';
  const source = article.source || article.author || '디지털뉴스룸';
  const author = article.author || article.source || '디지털뉴스룸 기자';
  const dateStr = new Date(article.date || Date.now()).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const timestamp = Date.now() + Math.floor(Math.random() * 1000);
  const filename = `news-capture-photo-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;

  const imageUrl = await resolveArticleImageUrl(article);
  let photoBuffer = null;
  let photoHeight = 520;

  if (imageUrl) {
    try {
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 6000 });
      if (sharp) {
        const metadata = await sharp(imgRes.data).metadata();
        const photoWidth = 880;
        if (metadata.width && metadata.height) {
          photoHeight = Math.round((metadata.height / metadata.width) * photoWidth);
          if (photoHeight > 1400) photoHeight = 1400; // max height
          if (photoHeight < 300) photoHeight = 300;   // min height
        }
        photoBuffer = await sharp(imgRes.data)
          .resize(photoWidth, photoHeight, { fit: 'cover', position: 'center' })
          .png()
          .toBuffer();
      }
    } catch (e) {
      photoBuffer = null;
    }
  }

  // If no photo found, fallback to rendering body text
  if (!photoBuffer) {
    return generateCardNewsBody(article);
  }

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;
  const photoY = dividerY + 30;
  const canvasHeight = photoY + photoHeight + 40;

  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  // SVG Base Canvas
  const baseSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>
  ${titleSvg}
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>
</svg>`;

  if (sharp) {
    const baseBuffer = await sharp(Buffer.from(baseSvg, 'utf8')).png().toBuffer();
    
    // Create rounded mask for photo
    const roundedMask = Buffer.from(`
      <svg width="880" height="${photoHeight}">
        <rect x="0" y="0" width="880" height="${photoHeight}" rx="10" ry="10" fill="#fff" />
      </svg>
    `);

    const maskedPhoto = await sharp(photoBuffer)
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    await sharp(baseBuffer)
      .composite([{ input: maskedPhoto, top: photoY, left: 60 }])
      .png({ quality: 95 })
      .toFile(outputPath);
  } else {
    fs.writeFileSync(outputPath.replace('.png', '.svg'), baseSvg, 'utf8');
  }

  return { mode: 'photo', filename, filepath: outputPath };
}

/**
 * 🎁 Generate all 3 Capture Cards simultaneously in parallel
 * Returns: { photoCard, bodyCard, titleCard }
 */
async function generateAll3CaptureCards(article) {
  try {
    const [photoCard, bodyCard, titleCard] = await Promise.all([
      generateCardNewsPhoto(article).catch(() => generateCardNewsBody(article)),
      generateCardNewsBody(article).catch(() => generateCardNewsTitleOnly(article)),
      generateCardNewsTitleOnly(article)
    ]);
    return { photoCard, bodyCard, titleCard };
  } catch (err) {
    const fallback = await generateCardNewsTitleOnly(article);
    return { photoCard: fallback, bodyCard: fallback, titleCard: fallback };
  }
}

/**
 * Legacy compatibility
 */
async function generateCardNewsImage(article) {
  return generateCardNewsTitleOnly(article);
}

module.exports = {
  generateCardNewsTitleOnly,
  generateCardNewsBody,
  generateCardNewsPhoto,
  generateAll3CaptureCards,
  generateCardNewsImage,
  resolveArticleImageUrl
};
