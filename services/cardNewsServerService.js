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
 * Split text into wrapped lines (Pretendard 32px, max-width 880px)
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
 * Split body text into wrapped lines (Pretendard 22px, max-width 880px)
 */
function wrapBodyLines(text, maxCharsPerLine = 34, maxLines = 10) {
  if (!text) return [''];
  const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
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
 * Resolve real image URL from article or web scraping
 */
async function resolveArticleImageUrl(article) {
  if (article.imageUrl && article.imageUrl.startsWith('http')) {
    return article.imageUrl;
  }

  let targetUrl = article.link || '';
  if (!targetUrl) return null;

  try {
    const directRes = await axios.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 4000,
      responseType: 'arraybuffer'
    });

    const dHtml = directRes.data.toString('utf-8');
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
        if (!pLower.includes('logo') && !pLower.includes('icon') && !pLower.includes('avatar') && !pLower.includes('banner')) {
          return photo;
        }
      }
    }
  } catch (e) {}

  return null;
}

/**
 * 1. 📄 Generate [기사 캡처: 제목만] Card
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
 * 2. 📝 Generate [기사 캡처: 제목+본문] Card
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

  const snippet = article.contentSnippet || article.excerpt || article.title || '';
  const bodyLines = wrapBodyLines(snippet, 34, 8);

  const timestamp = Date.now() + Math.floor(Math.random() * 1000);
  const filename = `news-capture-body-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;
  const canvasHeight = 240 + (lineCount * 46) + (bodyLines.length * 36);

  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;

  const bodySvg = bodyLines.map((line, idx) => {
    const yPos = dividerY + 42 + (idx * 36);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="21" fill="#334155">${escapeXml(line.trim())}</text>`;
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
 * 3. 📸 Generate [기사 캡처: 제목+사진] Card
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

  if (imageUrl) {
    try {
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 5000 });
      if (sharp) {
        photoBuffer = await sharp(imgRes.data)
          .resize(880, 520, { fit: 'cover', position: 'center' })
          .png()
          .toBuffer();
      }
    } catch (e) {
      photoBuffer = null;
    }
  }

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;
  const photoY = dividerY + 30;
  const canvasHeight = photoY + 520 + 40;

  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const baseSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>
  ${titleSvg}
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>
  ${!photoBuffer ? `
  <rect x="60" y="${photoY}" width="880" height="520" rx="12" fill="#0f172a"/>
  <text x="500" y="${photoY + 240}" font-family="'Pretendard', sans-serif" font-size="28" font-weight="bold" fill="#38bdf8" text-anchor="middle">📡 실시간 이슈 브리핑</text>
  <text x="500" y="${photoY + 290}" font-family="'Pretendard', sans-serif" font-size="18" fill="#94a3b8" text-anchor="middle">헤드라인 및 세부 분석 리포트</text>
  ` : ''}
</svg>`;

  if (sharp) {
    if (photoBuffer) {
      // Composite actual photo onto white news canvas
      const baseBuffer = await sharp(Buffer.from(baseSvg, 'utf8')).png().toBuffer();
      await sharp(baseBuffer)
        .composite([{ input: photoBuffer, top: photoY, left: 60 }])
        .png({ quality: 95 })
        .toFile(outputPath);
    } else {
      await sharp(Buffer.from(baseSvg, 'utf8')).png({ quality: 95 }).toFile(outputPath);
    }
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
      generateCardNewsPhoto(article).catch(() => generateCardNewsTitleOnly(article)),
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
  generateCardNewsImage
};
