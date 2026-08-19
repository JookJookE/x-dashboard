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
 * Download an image and convert it to a Base64 data URL
 */
async function fetchImageAsBase64(imageUrl) {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error('Failed to fetch image for card news:', err.message);
    return null;
  }
}

/**
 * Split text into wrapped lines for SVG rendering
 */
function wrapText(text, maxCharsPerLine = 22, maxLines = 3) {
  if (!text) return [];
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
  return lines;
}

/**
 * Generate Card News Image based on whether article has an image
 * - mode: 'photo' (제목 + 사진)
 * - mode: 'title' (제목만)
 */
async function generateCardNewsImage(article) {
  const title = article.title || '최신 뉴스 리포트';
  const source = article.source || article.author || 'Jook Insight';
  const author = article.author || article.source || '디지털뉴스룸';
  const dateStr = new Date(article.date || Date.now()).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const category = (article.category || 'tech').toUpperCase();
  let base64Image = null;
  
  if (article.imageUrl && article.imageUrl.startsWith('http')) {
    base64Image = await fetchImageAsBase64(article.imageUrl);
  }

  const hasPhoto = Boolean(base64Image);
  const mode = hasPhoto ? 'photo' : 'title';
  const timestamp = Date.now();
  const filename = `card-${mode}-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const titleLines = wrapText(title, hasPhoto ? 24 : 20, 3);

  let svgContent = '';

  if (hasPhoto) {
    // 📸 1. [제목 + 사진] 카드뉴스 SVG
    const cardWidth = 1200;
    const cardHeight = 1100;
    const titleHeight = 90 + (titleLines.length * 48);

    const titleSvg = titleLines.map((line, idx) => {
      const yPos = 135 + (idx * 50);
      return `<text x="60" y="${yPos}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="34" font-weight="bold" fill="#0f172a">${escapeXml(line)}</text>`;
    }).join('\n');

    svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cardWidth} ${cardHeight}" width="${cardWidth}" height="${cardHeight}">
  <defs>
    <clipPath id="photoClip">
      <rect x="60" y="${titleHeight + 60}" width="1080" height="620" rx="16" ry="16"/>
    </clipPath>
  </defs>

  <!-- Clean White Card Background -->
  <rect width="${cardWidth}" height="${cardHeight}" fill="#ffffff"/>

  <!-- Top Header Bar -->
  <text x="60" y="65" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} | ${escapeXml(category)} ]</text>
  <text x="1140" y="65" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" font-weight="normal" fill="#64748b" text-anchor="end">⚡ Jook Insight</text>

  <!-- Title Lines -->
  ${titleSvg}

  <!-- Reporter & Date -->
  <text x="60" y="${titleHeight + 15}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
  
  <!-- Divider -->
  <line x1="60" y1="${titleHeight + 35}" x2="1140" y2="${titleHeight + 35}" stroke="#e2e8f0" stroke-width="2"/>

  <!-- Article Photo -->
  <image href="${base64Image}" x="60" y="${titleHeight + 60}" width="1080" height="620" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)"/>
  
  <!-- Photo Border Outline -->
  <rect x="60" y="${titleHeight + 60}" width="1080" height="620" rx="16" ry="16" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>

  <!-- Bottom Brand Footer -->
  <text x="60" y="${cardHeight - 35}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#0f172a">𝕏 @Jook_Jook_E</text>
  <text x="1140" y="${cardHeight - 35}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" font-weight="500" fill="#94a3b8" text-anchor="end">실시간 테크 &amp; 금융 인사이트</text>
</svg>`;

  } else {
    // 📝 2. [제목만] 세련된 다크모드/하이엔드 카드뉴스 SVG
    const cardWidth = 1200;
    const cardHeight = 675;

    const titleSvg = titleLines.map((line, idx) => {
      const yPos = 270 + (idx * 56);
      const color = idx === 0 ? '#ffffff' : '#38bdf8';
      return `<text x="100" y="${yPos}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="46" font-weight="900" fill="${color}">${escapeXml(line)}</text>`;
    }).join('\n');

    svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cardWidth} ${cardHeight}" width="${cardWidth}" height="${cardHeight}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="30" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background Base -->
  <rect width="${cardWidth}" height="${cardHeight}" fill="url(#bgGrad)"/>
  
  <!-- Glowing Ambient Lights -->
  <circle cx="1050" cy="180" r="220" fill="#38bdf8" opacity="0.15" filter="url(#glow)"/>
  <circle cx="150" cy="550" r="180" fill="#2563eb" opacity="0.12" filter="url(#glow)"/>

  <!-- Glass Inner Card Frame -->
  <rect x="50" y="45" width="1100" height="585" rx="28" fill="rgba(30, 41, 59, 0.7)" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>

  <!-- Category Badge -->
  <rect x="100" y="100" width="320" height="54" rx="27" fill="url(#badgeGrad)"/>
  <text x="130" y="136" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#ffffff">⚡ ${escapeXml(source)} · ${escapeXml(category)}</text>

  <!-- Main Title -->
  ${titleSvg}

  <!-- Divider Line -->
  <line x1="100" y1="480" x2="1100" y2="480" stroke="rgba(255,255,255,0.12)" stroke-width="2" stroke-dasharray="6 6"/>

  <!-- Footer Info -->
  <text x="100" y="545" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="24" font-weight="bold" fill="#38bdf8">⚡ Jook Insight</text>
  <text x="1100" y="545" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#94a3b8" text-anchor="end">${escapeXml(author)} · ${escapeXml(dateStr)}</text>
</svg>`;
  }

  if (sharp) {
    // Convert SVG to High Quality PNG using Sharp
    const svgBuffer = Buffer.from(svgContent, 'utf8');
    await sharp(svgBuffer)
      .png({ quality: 95 })
      .toFile(outputPath);

    return {
      mode,
      hasPhoto,
      filename,
      filepath: outputPath,
      url: `/thumbnails/${filename}`
    };
  } else {
    // Fallback: Save directly as SVG if sharp is missing
    const svgFilename = `card-${mode}-${timestamp}.svg`;
    const svgPath = path.join(THUMBNAIL_DIR, svgFilename);
    fs.writeFileSync(svgPath, svgContent, 'utf8');

    return {
      mode,
      hasPhoto,
      filename: svgFilename,
      filepath: svgPath,
      url: `/thumbnails/${svgFilename}`
    };
  }
}

module.exports = {
  generateCardNewsImage,
  fetchImageAsBase64
};

