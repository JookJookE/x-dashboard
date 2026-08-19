const fs = require('fs');
const path = require('path');
const axios = require('axios');
const iconv = require('iconv-lite');

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
 * Actively extract real image URL from article links (Google News redirects, Nate Pann, Blind, Naver, Hankyung, etc.)
 */
async function resolveArticleImageUrl(article) {
  if (article.imageUrl && article.imageUrl.startsWith('http')) {
    const lower = article.imageUrl.toLowerCase();
    if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('avatar') && !lower.includes('banner')) {
      return article.imageUrl;
    }
  }

  let targetUrl = article.link || article.url || '';
  if (!targetUrl) return null;

  try {
    // 1. Resolve Google redirect link if needed
    if (targetUrl.includes('news.google.com')) {
      try {
        const gRes = await axios.get(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 4000,
          maxRedirects: 5
        });
        if (gRes.request?.res?.responseUrl && !gRes.request.res.responseUrl.includes('news.google.com')) {
          targetUrl = gRes.request.res.responseUrl;
        }
      } catch (e) {}
    }

    // 2. Fetch direct webpage
    if (targetUrl && !targetUrl.includes('news.google.com')) {
      const directRes = await axios.get(targetUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8'
        },
        timeout: 6000,
        responseType: 'arraybuffer'
      });

      let dHtml = directRes.data.toString('utf-8');
      if (dHtml.toLowerCase().includes('charset=euc-kr')) {
        dHtml = iconv.decode(directRes.data, 'EUC-KR');
      }

      // Meta og:image & twitter:image
      const ogMatches = [
        ...dHtml.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi),
        ...dHtml.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/gi),
        ...dHtml.matchAll(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi),
        ...dHtml.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/gi)
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

      // Body <img> tags
      const imgMatches = [...dHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
      for (const im of imgMatches) {
        let photo = im[1].replace(/&amp;/g, '&').trim();
        if (photo.startsWith('//')) photo = 'https:' + photo;
        if (photo.startsWith('http')) {
          const pLower = photo.toLowerCase();
          if (pLower.includes('.jpg') || pLower.includes('.jpeg') || pLower.includes('.png') || pLower.includes('.webp')) {
            if (!pLower.includes('logo') && !pLower.includes('icon') && !pLower.includes('avatar') && !pLower.includes('banner') && !pLower.includes('btn') && !pLower.includes('ad_')) {
              return photo;
            }
          }
        }
      }
    }
  } catch (err) {
    // Silent on network error, fallback to title mode
  }

  return null;
}

/**
 * Download an image and get its Base64 data and dimensions
 */
async function fetchImageData(imageUrl) {
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

    const buffer = Buffer.from(response.data);
    let width = 880;
    let height = 480;

    if (sharp) {
      try {
        const meta = await sharp(buffer).metadata();
        if (meta.width && meta.height) {
          width = meta.width;
          height = meta.height;
        }
      } catch (e) {}
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const base64 = buffer.toString('base64');
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      width,
      height
    };
  } catch (err) {
    console.error('Failed to fetch article image:', err.message);
    return null;
  }
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
 * - 📸 'photo' mode: 기사 캡처 (제목 + 사진)
 * - 📝 'title' mode: 기사 캡처 (제목만)
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

  // 1. Actively resolve article image URL from metadata or source webpage
  const finalImageUrl = await resolveArticleImageUrl(article);
  let imgData = null;
  if (finalImageUrl) {
    imgData = await fetchImageData(finalImageUrl);
    if (imgData) {
      article.imageUrl = finalImageUrl; // Cache resolved image URL
    }
  }

  const hasPhoto = Boolean(imgData);
  const mode = 'photo'; // Always generate [Photo + Title] capture card format
  const timestamp = Date.now();
  const filename = `news-capture-photo-${timestamp}.png`;
  const outputPath = path.join(THUMBNAIL_DIR, filename);

  const canvasWidth = 1000;
  const titleLines = wrapTitleLines(title, 22, 3);
  const lineCount = titleLines.length;

  let currentY = 125;
  currentY += (lineCount * 46); // Title lines (32px font, 46px line-height)
  currentY += 10; // Reporter gap
  currentY += 22; // Divider gap
  currentY += 30; // Padding before photo

  let photoHeight = 460;
  if (hasPhoto && imgData) {
    photoHeight = Math.round((imgData.height / imgData.width) * 880);
    if (photoHeight > 2500) photoHeight = 2500;
    if (photoHeight < 320) photoHeight = 320;
  }
  const canvasHeight = currentY + photoHeight + 40;

  // 2. Build SVG Lines matching app.js generateArticleCaptureCard
  const titleSvg = titleLines.map((line, idx) => {
    const yPos = 125 + (idx * 46);
    return `<text x="60" y="${yPos}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="32" font-weight="bold" fill="#0f172a">${escapeXml(line.trim())}</text>`;
  }).join('\n');

  const reporterY = 125 + (lineCount * 46) + 10;
  const dividerY = reporterY + 22;
  const photoY = dividerY + 30;

  let photoSvg = '';
  if (hasPhoto && imgData) {
    photoSvg = `
  <defs>
    <clipPath id="photoClip">
      <rect x="60" y="${photoY}" width="880" height="${photoHeight}" rx="10" ry="10"/>
    </clipPath>
  </defs>
  <image href="${imgData.dataUrl}" x="60" y="${photoY}" width="880" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)"/>
  <rect x="60" y="${photoY}" width="880" height="${photoHeight}" rx="10" ry="10" fill="none" stroke="#cbd5e1" stroke-width="1"/>
    `;
  } else {
    // Default Clean Premium Graphic Placeholder when article has no photo
    photoSvg = `
  <defs>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <clipPath id="photoClip">
      <rect x="60" y="${photoY}" width="880" height="${photoHeight}" rx="10" ry="10"/>
    </clipPath>
  </defs>
  <rect x="60" y="${photoY}" width="880" height="${photoHeight}" rx="10" ry="10" fill="url(#cardGrad)"/>
  <circle cx="850" cy="${photoY + 80}" r="120" fill="rgba(56,189,248,0.1)"/>
  <circle cx="150" cy="${photoY + photoHeight - 60}" r="90" fill="rgba(14,165,233,0.15)"/>
  
  <!-- Icon & Badge in Center -->
  <text x="500" y="${photoY + (photoHeight / 2) - 25}" font-family="'Pretendard', 'Malgun Gothic', sans-serif" font-size="52" text-anchor="middle" fill="#38bdf8">⚡</text>
  <text x="500" y="${photoY + (photoHeight / 2) + 30}" font-family="'Pretendard', 'Malgun Gothic', sans-serif" font-size="28" font-weight="bold" text-anchor="middle" fill="#ffffff">${escapeXml(source)} SPECIAL REPORT</text>
  <text x="500" y="${photoY + (photoHeight / 2) + 70}" font-family="'Pretendard', 'Malgun Gothic', sans-serif" font-size="18" text-anchor="middle" fill="#94a3b8">실시간 핵심 뉴스 &amp; 트렌드 브리핑</text>
  <rect x="60" y="${photoY}" width="880" height="${photoHeight}" rx="10" ry="10" fill="none" stroke="#334155" stroke-width="1.5"/>
    `;
  }


  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <!-- 1. Pure Clean White Background -->
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>

  <!-- 2. Top Header Bar -->
  <text x="60" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="22" font-weight="bold" fill="#2563eb">[ ${escapeXml(source)} ]</text>
  <text x="940" y="65" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="20" fill="#64748b" text-anchor="end">💬 8   🔊   🖨️   공유</text>

  <!-- 3. Title -->
  ${titleSvg}

  <!-- 4. Reporter & Date -->
  <text x="60" y="${reporterY}" font-family="'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="17" fill="#64748b">${escapeXml(author)} · ${escapeXml(dateStr)}</text>

  <!-- 5. Divider Line -->
  <line x1="60" y1="${dividerY}" x2="940" y2="${dividerY}" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- 6. Photo Content (Only in Photo Mode) -->
  ${photoSvg}
</svg>`;

  // 3. Render and Save
  if (sharp) {
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
    const svgFilename = `news-capture-${mode}-${timestamp}.svg`;
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
  fetchImageData,
  resolveArticleImageUrl
};
