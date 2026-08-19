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
 * Generate exact Dashboard Replica News Capture Card
 * - 📝 Pure [Title Only] Clean White Portal Capture Format
 */
async function generateCardNewsImage(article) {
  const title = article.title || '최신 뉴스 리포트';
  const source = article.source || article.author || '디지털뉴스룸';
  const author = article.author || article.source || '디지털뉴스룸 기자';
  const dateStr = new Date(article.date || Date.now()).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const mode = 'title'; // Pure [Title Only] capture card format
  const timestamp = Date.now();
  const filename = `news-capture-title-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;

  // Pure Title Card height matching app.js generateArticleCaptureCard ('title')
  const canvasHeight = 200 + (lineCount * 46);

  // 1. Build SVG Lines
  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <!-- 1. Pure Clean White Background -->
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>

  <!-- 2. Top Header Bar -->
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>

  <!-- 3. Title (32px Bold) -->
  ${titleSvg}

  <!-- 4. Reporter & Date -->
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>

  <!-- 5. Divider Line -->
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>
</svg>`;

  // 2. Render and Save
  if (sharp) {
    const svgBuffer = Buffer.from(svgContent, 'utf8');
    await sharp(svgBuffer)
      .png({ quality: 95 })
      .toFile(outputPath);

    return {
      mode,
      hasPhoto: false,
      filename,
      filepath: outputPath,
      url: `/thumbnails/${filename}`
    };
  } else {
    const svgFilename = `news-capture-title-${timestamp}.svg`;
    const svgPath = path.join(THUMBNAIL_DIR, svgFilename);
    fs.writeFileSync(svgPath, svgContent, 'utf8');

    return {
      mode,
      hasPhoto: false,
      filename: svgFilename,
      filepath: svgPath,
      url: `/thumbnails/${svgFilename}`
    };
  }
}

module.exports = {
  generateCardNewsImage
};
