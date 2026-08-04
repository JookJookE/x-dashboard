const fs = require('fs');
const path = require('path');

const THUMBNAIL_DIR = path.join(__dirname, 'public', 'thumbnails');
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

function generateNewsInfographicSvg(title, category = 'it', categoryTag = '') {
  let catEmoji = '💻';
  let catTitle = 'AI & SEMICONDUCTOR TECH';
  let tagText = '$NVDA $AAPL #AI #반도체';
  let accentColor = '#00ff87';
  let titleColor = '#ffffff';

  // Category specific artwork styles & SVG elements
  let bgGradientDef = '';
  let categoryArtworkSvg = '';
  let badgeGradDef = '';

  const catLower = String(category).toLowerCase();
  const tagLower = String(categoryTag).toLowerCase();
  const tLower = title.toLowerCase();

  const isCoin = catLower.includes('coin') || tagLower.includes('코인') || tLower.includes('btc') || tLower.includes('eth') || tLower.includes('코인') || tLower.includes('비트코인') || tLower.includes('이더리움') || tLower.includes('crypto') || tLower.includes('etf');
  const isStock = catLower.includes('stock') || tagLower.includes('주식') || tLower.includes('주식') || tLower.includes('증시') || tLower.includes('nvidia') || tLower.includes('tesla') || tLower.includes('stock') || tLower.includes('nasdaq') || tLower.includes('개미') || tLower.includes('국장') || tLower.includes('미장');
  const isEconomy = catLower.includes('economy') || tagLower.includes('경제') || tLower.includes('금리') || tLower.includes('fed') || tLower.includes('연준') || tLower.includes('환율') || tLower.includes('inflation') || tLower.includes('treasury') || tLower.includes('dollar');
  const isGossip = catLower.includes('gossip') || tagLower.includes('가십') || tagLower.includes('연예') || tLower.includes('연예') || tLower.includes('가십') || tLower.includes('아이돌') || tLower.includes('셀럽');

  if (isCoin) {
    // 🪙 1. CRYPTO & BITCOIN THEME (Dark Gold & Binance/Upbit Style)
    catEmoji = '🪙';
    catTitle = 'CRYPTO & BITCOIN REPORT';
    accentColor = '#FFD200';
    tagText = '$BTC $ETH #가상자산 #비트코인';

    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#140c00"/>
        <stop offset="50%" stop-color="#2a1a00"/>
        <stop offset="100%" stop-color="#080400"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#F7931A"/>
        <stop offset="100%" stop-color="#FFD200"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Glowing Gold Ambient Light Orbs -->
      <circle cx="950" cy="220" r="280" fill="#FFD200" opacity="0.18" filter="url(#glow)"/>
      <circle cx="200" cy="500" r="220" fill="#F7931A" opacity="0.15" filter="url(#glow)"/>

      <!-- Rising Bullish Candlestick Chart Layer -->
      <path d="M 80 500 Q 300 460 520 380 T 820 240 T 1120 120" fill="none" stroke="#22c55e" stroke-width="7" opacity="0.85" filter="url(#glow)"/>
      <path d="M 80 500 Q 300 460 520 380 T 820 240 T 1120 120 L 1120 600 L 80 600 Z" fill="url(#chartAreaGreen)" opacity="0.2"/>

      <!-- Green Candlestick Bars -->
      <rect x="380" y="340" width="14" height="80" rx="3" fill="#22c55e" opacity="0.75"/>
      <line x1="387" y1="320" x2="387" y2="440" stroke="#22c55e" stroke-width="2" opacity="0.75"/>
      <rect x="580" y="260" width="14" height="100" rx="3" fill="#22c55e" opacity="0.85"/>
      <line x1="587" y1="240" x2="587" y2="380" stroke="#22c55e" stroke-width="2" opacity="0.85"/>
      <rect x="780" y="190" width="14" height="120" rx="3" fill="#22c55e" opacity="0.95"/>
      <line x1="787" y1="170" x2="787" y2="330" stroke="#22c55e" stroke-width="2" opacity="0.95"/>

      <!-- 3D Glowing Bitcoin Coin Artwork -->
      <g filter="url(#glow)" transform="translate(860, 110)">
        <circle cx="100" cy="100" r="85" fill="url(#badgeGrad)" opacity="0.9"/>
        <circle cx="100" cy="100" r="75" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.6"/>
        <circle cx="100" cy="100" r="65" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 6" opacity="0.8"/>
        <text x="100" y="125" font-family="'Segoe UI', Arial, sans-serif" font-size="80" font-weight="900" fill="#ffffff" text-anchor="middle">₿</text>
      </g>
      <!-- Secondary Floating Ethereum Emblem -->
      <g transform="translate(730, 80) scale(0.65)" opacity="0.85" filter="url(#glow)">
        <polygon points="60,10 110,90 60,120 10,90" fill="#8c8c8c"/>
        <polygon points="60,10 110,90 60,65" fill="#343434"/>
        <polygon points="60,130 110,100 60,170 10,100" fill="#8c8c8c"/>
      </g>
    `;
  } else if (isStock) {
    // 📈 2. STOCK & WALL STREET THEME (Deep Cyan/Blue NYSE & Toss Style)
    catEmoji = '📈';
    catTitle = 'STOCK MARKET INSIGHT';
    accentColor = '#00f2fe';
    tagText = '$NVDA $TSLA #미국주식 #증시전망';
    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#020d1a"/>
        <stop offset="50%" stop-color="#07203d"/>
        <stop offset="100%" stop-color="#010712"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#4facfe"/>
        <stop offset="100%" stop-color="#00f2fe"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Glowing Cyan Ambient Orbs -->
      <circle cx="950" cy="200" r="260" fill="#00f2fe" opacity="0.2" filter="url(#glow)"/>
      <circle cx="250" cy="480" r="200" fill="#0072ff" opacity="0.18" filter="url(#glow)"/>

      <!-- Wall Street Stock Grid -->
      <line x1="80" y1="180" x2="1120" y2="180" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <line x1="80" y1="300" x2="1120" y2="300" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <line x1="80" y1="420" x2="1120" y2="420" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

      <!-- Steep Bullish Neon Stock Line -->
      <path d="M 100 480 C 350 440, 480 340, 680 270 C 820 220, 950 140, 1080 80" fill="none" stroke="#00f2fe" stroke-width="8" stroke-linecap="round" opacity="0.9" filter="url(#glow)"/>
      <polygon points="1080,80 1045,95 1065,120" fill="#00f2fe" filter="url(#glow)"/>

      <!-- Volume Spikes Grid -->
      <rect x="740" y="320" width="18" height="180" rx="4" fill="#38ef7d" opacity="0.4"/>
      <rect x="770" y="280" width="18" height="220" rx="4" fill="#38ef7d" opacity="0.6"/>
      <rect x="800" y="240" width="18" height="260" rx="4" fill="#00f2fe" opacity="0.8"/>
      <rect x="830" y="190" width="18" height="310" rx="4" fill="#00f2fe" opacity="0.95" filter="url(#glow)"/>

      <!-- Floating Bull Market Badge Artwork -->
      <g filter="url(#glow)" transform="translate(900, 120)">
        <rect x="0" y="0" width="140" height="90" rx="16" fill="rgba(0,242,254,0.15)" stroke="#00f2fe" stroke-width="3"/>
        <text x="70" y="45" font-family="'Segoe UI', sans-serif" font-size="28" font-weight="900" fill="#38ef7d" text-anchor="middle">+14.8%</text>
        <text x="70" y="72" font-family="'Segoe UI', sans-serif" font-size="14" font-weight="bold" fill="#00f2fe" text-anchor="middle">BULL RUN</text>
      </g>
    `;
  } else if (isEconomy) {
    // 💵 4. FED & MACRO ECONOMY THEME (Deep Royal Purple Vault Style)
    catEmoji = '💵';
    catTitle = 'FED & MACRO ECONOMY';
    accentColor = '#FF75D8';
    tagText = '$FED #금리 #인플레이션 #통화정책';

    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#12021f"/>
        <stop offset="50%" stop-color="#2d0647"/>
        <stop offset="100%" stop-color="#090112"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8E2DE2"/>
        <stop offset="100%" stop-color="#FF75D8"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Purple Glowing Ambient Orbs -->
      <circle cx="950" cy="220" r="260" fill="#FF75D8" opacity="0.2" filter="url(#glow)"/>
      <circle cx="200" cy="480" r="200" fill="#8E2DE2" opacity="0.18" filter="url(#glow)"/>

      <!-- Fed Interest Rate Pipeline Waves -->
      <path d="M 80 200 Q 320 440 600 280 T 1120 180" fill="none" stroke="#FF75D8" stroke-width="6" stroke-dasharray="12 8" opacity="0.8" filter="url(#glow)"/>
      <circle cx="600" cy="280" r="14" fill="#FF75D8" filter="url(#glow)"/>
      <circle cx="1120" cy="180" r="14" fill="#FF75D8" filter="url(#glow)"/>

      <!-- Giant 3D Glowing Percentage Symbol -->
      <g filter="url(#glow)" transform="translate(860, 110)">
        <text x="100" y="150" font-family="'Segoe UI', Arial, sans-serif" font-size="160" font-weight="900" fill="#FF75D8" opacity="0.35">%</text>
      </g>
    `;
  } else if (isGossip) {
    // 🗣️ 6. GOSSIP & CELEB ISSUE THEME (Hot Pink & Gold Neon Style)
    catEmoji = '🗣️';
    catTitle = 'HOT GOSSIP & ISSUE REPORT';
    accentColor = '#ff2a74';
    tagText = '#가십 #연예이슈 #핫이슈';

    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#260314"/>
        <stop offset="50%" stop-color="#4d0628"/>
        <stop offset="100%" stop-color="#14010a"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#FF007A"/>
        <stop offset="100%" stop-color="#FF75D8"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Hot Pink & Gold Ambient Light Orbs -->
      <circle cx="950" cy="220" r="260" fill="#FF007A" opacity="0.22" filter="url(#glow)"/>
      <circle cx="200" cy="480" r="200" fill="#FF75D8" opacity="0.18" filter="url(#glow)"/>

      <!-- Glowing Megaphone / Chat Bubble Artwork -->
      <g filter="url(#glow)" transform="translate(880, 110)">
        <rect x="0" y="0" width="160" height="110" rx="28" fill="none" stroke="#FF007A" stroke-width="4" opacity="0.8"/>
        <polygon points="40,110 20,140 60,110" fill="#FF007A" opacity="0.8"/>
        <text x="80" y="70" font-family="'Segoe UI', sans-serif" font-size="55" font-weight="900" fill="#ffffff" text-anchor="middle">🗣️</text>
      </g>
    `;
  } else if (catLower.includes('heisenberg')) {
    // 💡 5. HEISENBERG INSIGHT REPORT THEME (Deep Navy & Neon Purple)
    catEmoji = '💡';
    catTitle = 'HEISENBERG INSIGHT REPORT';
    accentColor = '#FF75D8';
    tagText = '#하이젠버그 #반도체 #심층분석';

    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f0526"/>
        <stop offset="50%" stop-color="#1f0b4d"/>
        <stop offset="100%" stop-color="#080214"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#7F00FF"/>
        <stop offset="100%" stop-color="#E100FF"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Purple & Cyan Glowing Ambient Orbs -->
      <circle cx="950" cy="220" r="260" fill="#E100FF" opacity="0.22" filter="url(#glow)"/>
      <circle cx="200" cy="480" r="200" fill="#7F00FF" opacity="0.2" filter="url(#glow)"/>

      <!-- Insight Lightbulb Artwork -->
      <g filter="url(#glow)" transform="translate(880, 110)">
        <circle cx="90" cy="90" r="70" fill="none" stroke="#E100FF" stroke-width="5" opacity="0.8"/>
        <path d="M 60 140 L 120 140 L 110 170 L 70 170 Z" fill="#E100FF" opacity="0.8"/>
        <text x="90" y="115" font-family="'Segoe UI', sans-serif" font-size="70" font-weight="900" fill="#ffffff" text-anchor="middle">💡</text>
      </g>
    `;
  } else {
    // 💻 3. IT & SEMICONDUCTOR AI THEME (Nvidia & Apple Cyberpunk Green Style)
    catEmoji = '💻';
    catTitle = 'AI & SEMICONDUCTOR TECH';
    accentColor = '#00ff87';
    tagText = '$NVDA $AAPL #AI #반도체';

    bgGradientDef = `
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#021814"/>
        <stop offset="50%" stop-color="#052e27"/>
        <stop offset="100%" stop-color="#010d0b"/>
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#00b09b"/>
        <stop offset="100%" stop-color="#96c93d"/>
      </linearGradient>
    `;

    categoryArtworkSvg = `
      <!-- Cyberpunk Green Glowing Ambient Orbs -->
      <circle cx="950" cy="220" r="260" fill="#00ff87" opacity="0.2" filter="url(#glow)"/>
      <circle cx="200" cy="480" r="200" fill="#00b09b" opacity="0.18" filter="url(#glow)"/>

      <!-- High Tech Microchip Circuit Grid Lines -->
      <path d="M 80 180 L 320 180 L 400 260 L 760 260 L 840 180 L 1120 180" fill="none" stroke="#00ff87" stroke-width="3" opacity="0.5"/>
      <path d="M 80 500 L 420 500 L 500 420 L 780 420 L 860 500 L 1120 500" fill="none" stroke="#00ff87" stroke-width="3" opacity="0.5"/>
      <circle cx="400" cy="260" r="6" fill="#00ff87" filter="url(#glow)"/>
      <circle cx="760" cy="260" r="6" fill="#00ff87" filter="url(#glow)"/>
      <circle cx="500" cy="420" r="6" fill="#00ff87" filter="url(#glow)"/>

      <!-- 3D AI Microchip Core Processor Artwork -->
      <g filter="url(#glow)" transform="translate(860, 110)">
        <rect x="0" y="0" width="170" height="170" rx="28" fill="none" stroke="#00ff87" stroke-width="4" opacity="0.8"/>
        <rect x="25" y="25" width="120" height="120" rx="18" fill="rgba(0,255,135,0.15)" stroke="#00ff87" stroke-width="2"/>
        <text x="85" y="90" font-family="'Segoe UI', Arial, sans-serif" font-size="34" font-weight="900" fill="#ffffff" text-anchor="middle">AI</text>
        <text x="85" y="118" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="bold" fill="#00ff87" text-anchor="middle">HBM3e</text>
      </g>
    `;
  }

  // Clean title for display (max 2 lines)
  let cleanTitle = title.replace(/\[외신\s*.*?\]/g, '').replace(/\[오피니언\]/g, '').trim();
  let line1 = cleanTitle;
  let line2 = '';

  if (cleanTitle.length > 20) {
    const spaceIdx = cleanTitle.indexOf(' ', 15);
    if (spaceIdx > 0) {
      line1 = cleanTitle.substring(0, spaceIdx);
      line2 = cleanTitle.substring(spaceIdx + 1);
    } else {
      line1 = cleanTitle.substring(0, 20);
      line2 = cleanTitle.substring(20);
    }
  }

  if (line2.length > 24) line2 = line2.substring(0, 21) + '...';

  const filename = `thumbnail-${Date.now()}.svg`;
  const filepath = path.join(THUMBNAIL_DIR, filename);

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
  <defs>
    ${bgGradientDef}
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.94"/>
    </linearGradient>
    <linearGradient id="chartAreaGreen" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0.0"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="22" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background Base -->
  <rect width="1200" height="675" fill="url(#bgGrad)"/>
  
  <!-- Category Specific Rich Artwork Layer -->
  ${categoryArtworkSvg}

  <!-- Main Card Glass Container -->
  <rect x="65" y="55" width="1070" height="565" rx="36" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>

  <!-- Category Badge Container -->
  <rect x="115" y="110" width="430" height="62" rx="31" fill="url(#badgeGrad)"/>
  <text x="145" y="150" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="23" font-weight="bold" fill="#ffffff">
    ${escapeXml(catEmoji)}  ${escapeXml(catTitle)}
  </text>

  <!-- Main Title Line 1 -->
  <text x="115" y="260" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="44" font-weight="900" fill="${titleColor}">
    ${escapeXml(line1)}
  </text>

  <!-- Main Title Line 2 -->
  ${line2 ? `<text x="115" y="332" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="44" font-weight="900" fill="${accentColor}">
    ${escapeXml(line2)}
  </text>` : ''}

  <!-- Bottom Divider Line -->
  <line x1="115" y1="470" x2="1035" y2="470" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-dasharray="8 8"/>

  <!-- Footer Brand Tag -->
  <text x="115" y="535" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="26" font-weight="bold" fill="${accentColor}">
    ⚡ JookJook Insight Report
  </text>

  <!-- Ticker Tags -->
  <text x="1035" y="535" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="24" font-weight="bold" fill="#94a3b8" text-anchor="end">
    ${escapeXml(tagText)}
  </text>
</svg>`;

  fs.writeFileSync(filepath, svgContent, 'utf8');
  return `/thumbnails/${filename}`;
}

module.exports = {
  generateNewsInfographicSvg
};
