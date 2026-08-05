let currentArticles = [];
let selectedArticle = null;
let selectedCategory = 'all'; // 'all', 'heisenberg', 'it', 'coin', 'stock', 'economy'
let is6HourFilterActive = false;
let currentComposerMode = 'block'; // 'block' (버전 1) vs 'story' (버전 2)
let currentArticlesPage = 1;
const ARTICLES_PER_PAGE = 30;

function getLocalReadMap() {
  try {
    return JSON.parse(localStorage.getItem('x_read_map') || '{}');
  } catch (e) {
    return {};
  }
}

function saveLocalReadId(id) {
  const map = getLocalReadMap();
  map[id] = true;
  localStorage.setItem('x_read_map', JSON.stringify(map));
}

function saveLocalAllRead(ids) {
  const map = getLocalReadMap();
  ids.forEach(id => { map[id] = true; });
  localStorage.setItem('x_read_map', JSON.stringify(map));
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initTabs();
  initCategoryFilters();
  loadArticles();
  loadLogs();
  loadStatus();

  document.getElementById('btn-quick-sync').addEventListener('click', () => loadArticles(true));
  const btnMarkAll = document.getElementById('btn-mark-all-read');
  if (btnMarkAll) {
    btnMarkAll.addEventListener('click', markAllArticlesAsRead);
  }
  document.getElementById('btn-generate-summary').addEventListener('click', generateSummaryForSelected);
  document.getElementById('btn-copy-tweet').addEventListener('click', copyTweetToClipboard);
  document.getElementById('btn-post-webintent').addEventListener('click', postViaWebIntent);
  document.getElementById('btn-post-article').addEventListener('click', openXArticlesComposer);
  document.getElementById('btn-toggle-6h').addEventListener('click', toggle6HourFilter);

  const saveKeyBtn = document.getElementById('btn-save-key');
  if (saveKeyBtn) {
    saveKeyBtn.addEventListener('click', saveGeminiApiKey);
  }

  loadConfig();

  const textInput = document.getElementById('tweet-text-input');
  textInput.addEventListener('input', updateCharCount);

  // Poll status every 30s for mobile URL
  setInterval(loadStatus, 30000);
});

// Mode Selection (버전 1~5)
function setComposerMode(mode, silent = false) {
  currentComposerMode = mode;

  const btnBlock = document.getElementById('btn-mode-block');
  const btnStory = document.getElementById('btn-mode-story');
  const btnTalk = document.getElementById('btn-mode-talk');
  const btnMindset = document.getElementById('btn-mode-mindset');
  const btnCapture = document.getElementById('btn-mode-capture');

  if (btnBlock) btnBlock.classList.remove('active');
  if (btnStory) btnStory.classList.remove('active');
  if (btnTalk) btnTalk.classList.remove('active');
  if (btnMindset) btnMindset.classList.remove('active');
  if (btnCapture) btnCapture.classList.remove('active');

  if (mode === 'capture' || mode === 'blind') {
    if (btnCapture) btnCapture.classList.add('active');
    if (!silent) showToast('📸 버전 5: 캡처 이미지 첨부 / 블라인드 썰 공유형 모드로 전환되었습니다.');
  } else if (mode === 'mindset') {
    if (btnMindset) btnMindset.classList.add('active');
    if (!silent) showToast('🧠 버전 4: 멘탈/공감 꿀팁형 모드로 전환되었습니다.');
  } else if (mode === 'talk') {
    if (btnTalk) btnTalk.classList.add('active');
    if (!silent) showToast('🗣️ 버전 3: 생생한 썰/소통형 모드로 전환되었습니다.');
  } else if (mode === 'story') {
    if (btnStory) btnStory.classList.add('active');
    if (!silent) showToast('🔥 버전 2: 1인칭 후킹 리포트형 모드로 전환되었습니다.');
  } else {
    if (btnBlock) btnBlock.classList.add('active');
    if (!silent) showToast('⚡ 버전 1: 이모지 블록 요약형 모드로 전환되었습니다.');
  }

  if (selectedArticle && !silent) {
    generateSummaryForSelected();
  }
}

// Mobile Sidebar Drawer Toggle
function initMobileMenu() {
  const toggleBtn = document.getElementById('btn-toggle-mobile-menu');
  const closeBtn = document.getElementById('btn-close-mobile-menu');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const sidebar = document.getElementById('app-sidebar');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('show');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMobileMenu);
  }

  if (overlay) {
    overlay.addEventListener('click', closeMobileMenu);
  }
}

function closeMobileMenu() {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success && data.status) {
      const url = data.status.localWifiUrl;
      const linkEl = document.getElementById('mobile-url-link');
      const textEl = document.getElementById('stat-mobile-url-text');

      if (url) {
        if (linkEl) {
          linkEl.innerText = url;
        }
        if (textEl) {
          textEl.innerText = url;
        }
      }
    }
  } catch (e) {}
}

// Helper: Format Date cleanly in relative Korean time (KST Asia/Seoul)
function formatRelativeTime(dateStr) {
  if (!dateStr) return '최신 소식';
  const pubDate = new Date(dateStr);
  const now = new Date();
  const diffMs = now - pubDate;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHour = Math.floor(diffMs / (1000 * 60 * 60));

  let relativeText = '방금 전';
  if (diffMin < 1) {
    relativeText = '방금 전';
  } else if (diffMin < 60) {
    relativeText = `${diffMin}분 전`;
  } else if (diffHour < 24) {
    relativeText = `${diffHour}시간 전`;
  } else {
    const diffDays = Math.floor(diffHour / 24);
    relativeText = `${diffDays}일 전`;
  }

  const kstTime = pubDate.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `${relativeText} (${kstTime})`;
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Sidebar & Tab Navigation
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      const category = item.getAttribute('data-cat') || 'all';
      const hours = parseInt(item.getAttribute('data-hours') || '0');

      selectedCategory = category;

      if (hours === 6) {
        is6HourFilterActive = true;
        update6HourToggleUI(true);
      } else {
        is6HourFilterActive = false;
        update6HourToggleUI(false);
      }

      updateCategoryFilterUI(category);
      switchTab(tabId);
      renderFilteredArticles(true);
      closeMobileMenu(); // Auto close sidebar on mobile tap
    });
  });
}

function selectCategoryNav(cat) {
  selectedCategory = cat;
  is6HourFilterActive = false;
  update6HourToggleUI(false);
  updateCategoryFilterUI(cat);
  switchTab('articles');
  renderFilteredArticles(true);
  closeMobileMenu();
}

function selectSidebar6Hours() {
  selectedCategory = 'all';
  is6HourFilterActive = true;
  update6HourToggleUI(true);
  updateCategoryFilterUI('all');
  switchTab('articles');
  renderFilteredArticles(true);
  closeMobileMenu();
}

async function markAllArticlesAsRead() {
  const btn = document.getElementById('btn-mark-all-read');
  if (btn) btn.disabled = true;
  const allIds = currentArticles.map(a => a.id);
  saveLocalAllRead(allIds);
  currentArticles.forEach(a => { a.isRead = true; });
  try {
    const res = await fetch('/api/mark-all-read', { method: 'POST' });
    const data = await res.json();
    loadArticles(false);
  } catch (e) {
    loadArticles(false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

  let activeNavItem = document.querySelector(`.nav-item[data-tab="${tabId}"][data-cat="${selectedCategory}"]`);
  if (!activeNavItem) {
    activeNavItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  }

  const tabContent = document.getElementById(`tab-${tabId}`);

  if (activeNavItem) activeNavItem.classList.add('active');
  if (tabContent) {
    tabContent.classList.add('active');

    const titleMap = {
      dashboard: '대시보드',
      articles: is6HourFilterActive ? '⚡ 최근 6시간 이내 수집 속보' : getCategoryTitle(selectedCategory),
      composer: '트윗 작성 & 복사'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '대시보드';
  }
}

function getCategoryTitle(cat) {
  switch(cat) {
    case 'heisenberg': return '💡 하이젠버그 리포트';
    case 'it': return '💻 IT/테크 최신 뉴스';
    case 'coin': return '🪙 코인/가상자산 최신 뉴스';
    case 'stock': return '📈 주식/증시 최신 뉴스';
    case 'economy': return '💵 경제/금리/환율 최신 뉴스';
    case 'global': return '🌐 해외뉴스 (글로벌 외신 속보)';
    case 'mindset': return '🧠 멘탈 / 심리 / 대인관계 꿀팁';
    default: return '📰 전체 카테고리 최신 뉴스';
  }
}

// Category Filters in Articles Tab
function initCategoryFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-filter-cat');
      selectedCategory = cat;
      is6HourFilterActive = false;
      update6HourToggleUI(false);
      updateCategoryFilterUI(cat);
      renderFilteredArticles(true);
    });
  });
}

function updateCategoryFilterUI(cat) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter-cat') === cat) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const titleEl = document.getElementById('page-title');
  if (document.getElementById('tab-articles').classList.contains('active')) {
    titleEl.innerText = is6HourFilterActive ? '⚡ 최근 6시간 이내 수집 속보' : getCategoryTitle(cat);
  }
}

// 6-Hour Time Filter Toggle
function toggle6HourFilter() {
  is6HourFilterActive = !is6HourFilterActive;
  update6HourToggleUI(is6HourFilterActive);

  if (is6HourFilterActive) {
    showToast('⚡ 최근 6시간 이내 수집된 소식만 필터링합니다.');
  } else {
    showToast('전체 수집 소식을 표시합니다.');
  }

  renderFilteredArticles(true);
}

function update6HourToggleUI(active) {
  const toggleBtn = document.getElementById('btn-toggle-6h');
  if (active) {
    toggleBtn.classList.add('btn-active');
    toggleBtn.innerHTML = '<span>⚡</span> 최근 6시간 이내 뉴스만 보기 [ON]';
  } else {
    toggleBtn.classList.remove('btn-active');
    toggleBtn.innerHTML = '<span>⚡</span> 최근 6시간 이내 뉴스만 보기 [OFF]';
  }
}

function isCommunityCategory(cat) {
  const c = String(cat).toLowerCase();
  return c === 'blind' || c === 'gossip' || c === 'mindset';
}

function selectCategoryNav(cat, unreadOnly = false) {
  selectedCategory = cat;
  isUnreadFilterActive = unreadOnly;
  is6HourFilterActive = false;
  updateCategoryFilterUI(cat);
  switchTab('articles');
  renderFilteredArticles(true);
  closeMobileMenu();
}

// Load Articles (forceRefresh=true일 때 1초 실시간 강제 수집)
async function loadArticles(forceRefresh = false) {
  const gridEl = document.getElementById('articles-grid');
  if (gridEl) gridEl.innerHTML = '<div class="skeleton-loader">최신 뉴스를 실시간 수집 중입니다...</div>';

  try {
    const url = forceRefresh ? '/api/articles?refresh=true&limit=300' : '/api/articles?limit=300';
    const res = await fetch(url);
    const data = await res.json();

    if (data.success) {
      const localReadMap = getLocalReadMap();
      currentArticles = data.articles.map(art => {
        if (localReadMap[art.id]) {
          return { ...art, isRead: true };
        }
        return art;
      }).sort((a, b) => new Date(b.date) - new Date(a.date));

      updateUnreadStats();

      const techArticles = currentArticles.filter(a => !isCommunityCategory(a.category));
      const commArticles = currentArticles.filter(a => isCommunityCategory(a.category));

      renderArticlesDashboardTech(techArticles.slice(0, 5));
      renderArticlesDashboardComm(commArticles.slice(0, 5));
      renderFilteredArticles();
      showToast(forceRefresh ? '⚡ 1초 실시간 최신 뉴스 수집을 완료했습니다!' : '최신 소식 목록 로딩 완료!');
    } else {
      if (gridEl) gridEl.innerHTML = `<p class="placeholder-text">오류: ${data.message}</p>`;
    }
  } catch (err) {
    if (gridEl) gridEl.innerHTML = `<p class="placeholder-text">뉴스를 가져오지 못했습니다 (${err.message})</p>`;
  }
}

let isUnreadFilterActive = false;

function toggleUnreadArticlesFilter() {
  isUnreadFilterActive = !isUnreadFilterActive;
  is6HourFilterActive = false;
  renderFilteredArticles(true);
}

async function markArticleAsRead(articleId) {
  if (!articleId) return;
  const article = currentArticles.find(a => String(a.id) === String(articleId));
  if (article && !article.isRead) {
    article.isRead = true;
    try {
      await fetch('/api/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId })
      });
    } catch (e) {}
    updateUnreadStats();
    renderFilteredArticles();
  }
}

function updateUnreadStats() {
  const techArticles = currentArticles.filter(a => !isCommunityCategory(a.category));
  const commArticles = currentArticles.filter(a => isCommunityCategory(a.category));

  const techUnread = techArticles.filter(a => !a.isRead).length;
  const commUnread = commArticles.filter(a => !a.isRead).length;

  const techCountEl = document.getElementById('stat-tech-count');
  const techUnreadEl = document.getElementById('stat-tech-unread');
  const commCountEl = document.getElementById('stat-comm-count');
  const commUnreadEl = document.getElementById('stat-comm-unread');

  if (techCountEl) techCountEl.innerText = `${techArticles.length}건`;
  if (techUnreadEl) techUnreadEl.innerText = `${techUnread}건 (클릭)`;
  if (commCountEl) commCountEl.innerText = `${commArticles.length}건`;
  if (commUnreadEl) commUnreadEl.innerText = `${commUnread}건 (클릭)`;
}

function renderFilteredArticles(resetPage = false) {
  if (resetPage) {
    currentArticlesPage = 1;
  }

  let filtered = currentArticles;

  if (selectedCategory === 'all') {
    filtered = currentArticles;
  } else if (selectedCategory === 'tech_all') {
    filtered = currentArticles.filter(a => !isCommunityCategory(a.category));
  } else if (selectedCategory === 'comm_all') {
    filtered = currentArticles.filter(a => isCommunityCategory(a.category));
  } else {
    filtered = currentArticles.filter(a => String(a.category).toLowerCase() === String(selectedCategory).toLowerCase());
  }

  if (is6HourFilterActive) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    filtered = filtered.filter(art => new Date(art.date) >= sixHoursAgo);
  }

  if (isUnreadFilterActive) {
    filtered = filtered.filter(art => !art.isRead);
  }

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ARTICLES_PER_PAGE));

  if (currentArticlesPage > totalPages) currentArticlesPage = totalPages;
  if (currentArticlesPage < 1) currentArticlesPage = 1;

  const startIndex = (currentArticlesPage - 1) * ARTICLES_PER_PAGE;
  const pageArticles = filtered.slice(startIndex, startIndex + ARTICLES_PER_PAGE);

  renderArticlesGrid(pageArticles);
  renderPaginationControls(totalPages, totalItems);
}

function renderPaginationControls(totalPages, totalItems) {
  const paginationEl = document.getElementById('articles-pagination');
  if (!paginationEl) return;

  if (totalItems === 0) {
    paginationEl.innerHTML = '';
    return;
  }

  const startNum = (currentArticlesPage - 1) * ARTICLES_PER_PAGE + 1;
  const endNum = Math.min(currentArticlesPage * ARTICLES_PER_PAGE, totalItems);

  let buttonsHtml = '';

  // Prev Button
  buttonsHtml += `<button class="page-btn" ${currentArticlesPage <= 1 ? 'disabled' : ''} onclick="goToArticlesPage(${currentArticlesPage - 1})">&laquo; 이전</button>`;

  // Page Numbers logic
  let startPage = Math.max(1, currentArticlesPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  if (startPage > 1) {
    buttonsHtml += `<button class="page-btn" onclick="goToArticlesPage(1)">1</button>`;
    if (startPage > 2) {
      buttonsHtml += `<span style="color:var(--text-muted); padding:0 4px;">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    buttonsHtml += `<button class="page-btn ${i === currentArticlesPage ? 'active' : ''}" onclick="goToArticlesPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      buttonsHtml += `<span style="color:var(--text-muted); padding:0 4px;">...</span>`;
    }
    buttonsHtml += `<button class="page-btn" onclick="goToArticlesPage(${totalPages})">${totalPages}</button>`;
  }

  // Next Button
  buttonsHtml += `<button class="page-btn" ${currentArticlesPage >= totalPages ? 'disabled' : ''} onclick="goToArticlesPage(${currentArticlesPage + 1})">다음 &raquo;</button>`;

  paginationEl.innerHTML = `
    <div class="pagination-info">
      전체 <strong style="color:var(--accent-cyan);">${totalItems}</strong>건 중 <strong>${startNum}-${endNum}</strong>건 표시 (페이지 <strong>${currentArticlesPage}</strong> / ${totalPages})
    </div>
    <div class="pagination-buttons">
      ${buttonsHtml}
    </div>
  `;
}

function goToArticlesPage(page) {
  currentArticlesPage = page;
  renderFilteredArticles(false);
  const cardEl = document.getElementById('tab-articles');
  if (cardEl) {
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderArticlesGrid(articles) {
  const gridEl = document.getElementById('articles-grid');
  if (!articles || articles.length === 0) {
    gridEl.innerHTML = '<p class="placeholder-text">선택한 카테고리/확인 조건에 해당하는 소식이 없습니다.</p>';
    return;
  }

  gridEl.innerHTML = articles.map(art => {
    let badgesHtml = `<span class="badge badge-info">${art.categoryTag || art.category}</span>`;

    if (!art.isRead) {
      badgesHtml += ` <span class="badge" style="background:#facc15; color:#000; font-size:10px; font-weight:900; padding:2px 6px; border-radius:8px;">NEW 미확인</span>`;
    }
    if (art.postedTweet) {
      badgesHtml += ` <span class="badge" style="background:#10b981; color:#fff; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;">✅ X 일반글</span>`;
    }
    if (art.postedArticle) {
      badgesHtml += ` <span class="badge" style="background:#8b5cf6; color:#fff; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;">📰 X 아티클</span>`;
    }

    return `
    <div class="article-card" style="${(art.postedTweet || art.postedArticle) ? 'border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.04);' : (!art.isRead ? 'border-color: rgba(250, 204, 21, 0.5);' : '')}">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:4px;">
          <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
            ${badgesHtml}
          </div>
          <span class="article-date" style="color:var(--accent-gold); font-weight:700; font-size:12px;">
            ⏱️ ${formatRelativeTime(art.date)}
            <span style="font-size:11px; color:var(--text-dim); margin-left:6px; font-weight:normal;">(📥 수집: ${formatTimeOnly(art.fetchedAt || art.date)})</span>
          </span>
        </div>
        <h4 class="article-title">${art.title}</h4>
      </div>
      <div class="article-footer">
        ${art.link ? `<a href="${art.link}" target="_blank" onclick="markArticleAsRead('${art.id}')" class="btn-link">원문보기 &nearr;</a>` : '<span></span>'}
        <button class="btn btn-primary btn-sm" onclick="selectArticleForComposer('${art.id}')">
          ✨ 트윗 생성
        </button>
      </div>
    </div>
  `;
  }).join('');
}

function renderArticlesDashboardTech(articles) {
  const miniListEl = document.getElementById('dashboard-tech-mini');
  if (!miniListEl) return;
  if (!articles || articles.length === 0) {
    miniListEl.innerHTML = '<p class="placeholder-text">수집된 테크/금융 소식이 없습니다.</p>';
    return;
  }

  miniListEl.innerHTML = articles.map(art => `
    <div style="padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:2px;">
          <span class="badge badge-info" style="font-size:9px;">${art.categoryTag || art.category}</span>
          <span style="font-size: 10px; color: var(--accent-cyan); font-weight:700;">⏱️ ${formatRelativeTime(art.date)}</span>
        </div>
        <h5 style="font-size: 13px; font-weight:700; margin-bottom: 2px;">${art.title}</h5>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="selectArticleForComposer('${art.id}')">생성</button>
    </div>
  `).join('');
}

function renderArticlesDashboardComm(articles) {
  const miniListEl = document.getElementById('dashboard-comm-mini');
  if (!miniListEl) return;
  if (!articles || articles.length === 0) {
    miniListEl.innerHTML = '<p class="placeholder-text">수집된 커뮤니티/썰 소식이 없습니다.</p>';
    return;
  }

  miniListEl.innerHTML = articles.map(art => `
    <div style="padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:2px;">
          <span class="badge badge-info" style="font-size:9px; background:rgba(250, 204, 21, 0.2); color:#facc15;">${art.categoryTag || art.category}</span>
          <span style="font-size: 10px; color: var(--accent-gold); font-weight:700;">⏱️ ${formatRelativeTime(art.date)}</span>
        </div>
        <h5 style="font-size: 13px; font-weight:700; margin-bottom: 2px;">${art.title}</h5>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="selectArticleForComposer('${art.id}')">생성</button>
    </div>
  `).join('');
}

// Select Article & Switch to Composer
function selectArticleForComposer(articleId) {
  const article = currentArticles.find(a => String(a.id) === String(articleId));
  if (!article) return;

  saveLocalReadId(articleId);
  article.isRead = true;

  markArticleAsRead(articleId);

  selectedArticle = article;

  // Default mode selection: Version 4 for Mindset, Version 3 for Gossip, Version 1 for Analytical articles
  const cat = String(article.category).toLowerCase();
  if (cat === 'blind') {
    setComposerMode('capture', true);
  } else if (cat === 'mindset') {
    setComposerMode('mindset', true);
  } else if (cat === 'gossip') {
    setComposerMode('talk', true);
  } else {
    setComposerMode('block', true);
  }

  renderSelectedArticle(article);
  switchTab('composer');
  generateSummaryForSelected();
  closeMobileMenu();
}

function selectLatestArticleForComposer() {
  if (currentArticles.length > 0) {
    selectArticleForComposer(currentArticles[0].id);
  } else {
    loadArticles().then(() => {
      if (currentArticles.length > 0) selectArticleForComposer(currentArticles[0].id);
    });
  }
}

function renderSelectedArticle(article) {
  const boxEl = document.getElementById('composer-selected-article');
  boxEl.innerHTML = `
    <div style="width:100%; text-align:left;">
      <span class="badge badge-info" style="margin-bottom:8px;">${article.categoryTag || article.category} (${formatRelativeTime(article.date)})</span>
      <h3 style="font-size:16px; font-weight:800; margin-bottom:10px;">${article.title}</h3>
      ${article.link ? `<a href="${article.link}" target="_blank" class="btn-link">원문링크 &nearr;</a>` : ''}
    </div>
  `;
  updateThumbnailSectionUI(article);
}

// Generate AI Summary with chosen mode ('block' vs 'story' vs 'talk')
async function generateSummaryForSelected() {
  if (!selectedArticle) {
    showToast('요약할 뉴스를 먼저 선택해 주세요.');
    return;
  }

  const textInput = document.getElementById('tweet-text-input');
  let modeLabel = '⚡ 버전 1: 이모지 블록 요약형 트윗 생성 중...';
  if (currentComposerMode === 'story') modeLabel = '🔥 버전 2: 1인칭 후킹 리포트형 트윗 생성 중...';
  if (currentComposerMode === 'talk') modeLabel = '🗣️ 버전 3: 생생한 썰/소통형 트윗 생성 중...';
  if (currentComposerMode === 'mindset') modeLabel = '🧠 버전 4: 멘탈/공감 꿀팁형 트윗 생성 중...';

  textInput.value = modeLabel;
  textInput.disabled = true;

  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...selectedArticle, mode: currentComposerMode })
    });
    const data = await res.json();

    if (data.success) {
      textInput.value = data.summary;
      const badgeEl = document.getElementById('ai-badge');
      if (badgeEl) {
        if (currentComposerMode === 'mindset') badgeEl.innerText = '🧠 멘탈/공감 꿀팁형';
        else if (currentComposerMode === 'talk') badgeEl.innerText = '🗣️ 생생한 썰/소통형';
        else if (currentComposerMode === 'story') badgeEl.innerText = '🔥 1인칭 후킹 리포트형';
        else badgeEl.innerText = '⚡ 이모지 블록 요약형';
      }
      const modeToastName = currentComposerMode === 'mindset' ? '🧠 버전 4 (멘탈/공감 꿀팁형)' : currentComposerMode === 'talk' ? '🗣️ 버전 3 (생생한 썰/소통형)' : currentComposerMode === 'story' ? '🔥 버전 2 (1인칭 후킹 스토리)' : '⚡ 버전 1 (이모지 블록)';
      showToast(`${modeToastName} 트윗 생성 완료!`);
    } else {
      textInput.value = `요약 오류: ${data.message}`;
    }
  } catch (err) {
    textInput.value = `요약 요청 실패 (${err.message})`;
  } finally {
    textInput.disabled = false;
    updateCharCount();
  }
}

function updateCharCount() {
  const textInput = document.getElementById('tweet-text-input');
  const counterEl = document.getElementById('char-counter');
  const count = textInput.value.length;

  counterEl.innerText = `${count} / 280자`;
  counterEl.className = 'char-counter';

  if (count > 280) counterEl.classList.add('danger');
  else if (count > 250) counterEl.classList.add('warning');
}

// Copy Tweet
function copyTweetToClipboard() {
  const text = document.getElementById('tweet-text-input').value.trim();
  if (!text) {
    showToast('복사할 트윗 문구가 없습니다.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 트윗 문구가 클립보드에 복사되었습니다! X(트위터)에 붙여넣으세요.');
  }).catch(err => {
    showToast('복사 실패: ' + err.message);
  });
}

// Copy Thread Reply Link Text for boosting X reach
function copyThreadReplyLink() {
  if (!selectedArticle || !selectedArticle.link) {
    showToast('선택된 기사 원본 링크가 없습니다.');
    return;
  }
  const threadText = `👇 본문 원본 및 3분 심층 리포트 풀버전 보기:\n${selectedArticle.link}`;
  navigator.clipboard.writeText(threadText).then(() => {
    showToast('💬 댓글(타래)용 원본 링크가 복사되었습니다! 본문 작성 후 첫 댓글에 붙여넣으세요.');
  }).catch(err => {
    showToast('복사 실패: ' + err.message);
  });
}

function updateThumbnailSectionUI(article) {
  const origBox = document.getElementById('original-image-preview');
  const aiBox = document.getElementById('ai-image-preview');

  if (origBox) {
    origBox.innerHTML = `<p style="font-size:11px; color:var(--text-muted); margin:15px 0;">[🖼️ 원본 이미지 가져오기] 버튼을 누르면 기사 원본 사진이 여기에 표시됩니다.</p>`;
  }
  if (aiBox) {
    aiBox.innerHTML = `<p style="font-size:11px; color:var(--text-muted); margin:15px 0;">[✨ AI 썸네일 1초 생성] 버튼을 누르면 고화질 인포그래픽이 여기에 표시됩니다.</p>`;
  }
}

async function fetchOriginalImageForSelected() {
  if (!selectedArticle || !selectedArticle.link) {
    showToast('선택된 기사 링크가 없습니다.');
    return;
  }
  const boxEl = document.getElementById('original-image-preview');
  const btnEl = document.getElementById('btn-fetch-original-image');

  if (boxEl) boxEl.innerHTML = `<p style="font-size:11px; color:#ff2a74; margin:15px 0;">🖼️ 기사의 원본 대표 이미지를 찾는 중입니다...</p>`;
  if (btnEl) btnEl.disabled = true;

  try {
    const res = await fetch('/api/extract-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: selectedArticle.title, url: selectedArticle.link })
    });
    const data = await res.json();

    if (data.success && data.imageUrl) {
      boxEl.innerHTML = `
        <div style="margin-top:5px;">
          <img src="${data.imageUrl}" style="max-width:100%; max-height:220px; object-fit:contain; border-radius:10px; border:1px solid rgba(255,255,255,0.2); box-shadow:0 6px 18px rgba(0,0,0,0.4);" />
          <div style="margin-top:8px; display:flex; justify-content:center;">
            <a href="${data.imageUrl}" target="_blank" download="news-photo.jpg" class="btn btn-outline btn-sm" style="font-size:11px; color:var(--text-main); border-color:#ff2a74;">
              📥 원본 사진 다운로드
            </a>
          </div>
        </div>
      `;
      showToast('🖼️ 원본 뉴스 이미지를 성공적으로 가져왔습니다!');
    } else {
      boxEl.innerHTML = `
        <div style="padding:10px; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; text-align:center;">
          <p style="font-size:12px; color:#f87171; font-weight:bold; margin-bottom:4px;">⚠️ 대표 사진을 찾을 수 없습니다.</p>
          <p style="font-size:11px; color:var(--text-dim); margin:0;">우측의 [✨ AI 썸네일 1초 생성] 버튼을 이용해 보세요.</p>
        </div>
      `;
      showToast('⚠️ 원문 기사에서 대표 이미지를 찾지 못했습니다.');
    }
  } catch (e) {
    boxEl.innerHTML = `
      <div style="padding:10px; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; text-align:center;">
        <p style="font-size:12px; color:#f87171; font-weight:bold; margin:0;">⚠️ 추출 오류: ${e.message}</p>
      </div>
    `;
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// Generate 16:9 Infographic Thumbnail for Article
async function generateThumbnailForSelected() {
  if (!selectedArticle) {
    showToast('선택된 기사가 없습니다.');
    return;
  }
  const boxEl = document.getElementById('ai-image-preview');
  const btnEl = document.getElementById('btn-generate-image');

  if (boxEl) boxEl.innerHTML = `<p style="font-size:11px; color:var(--accent-glow); margin:15px 0;">🎨 시선집중 16:9 AI 인포그래픽 썸네일을 생성하고 있습니다...</p>`;
  if (btnEl) btnEl.disabled = true;

  try {
    const res = await fetch('/api/generate-thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: selectedArticle.title,
        category: selectedArticle.category,
        categoryTag: selectedArticle.categoryTag || ''
      })
    });
    const data = await res.json();
    if (data.success && data.imageUrl) {
      boxEl.innerHTML = `
        <div style="margin-top:5px;">
          <img src="${data.imageUrl}" style="max-width:100%; max-height:220px; object-fit:contain; border-radius:10px; border:1px solid rgba(255,255,255,0.2); box-shadow:0 6px 18px rgba(0,0,0,0.4);" />
          <div style="margin-top:8px; display:flex; justify-content:center;">
            <a href="${data.imageUrl}" target="_blank" download="tweet-thumbnail.svg" class="btn btn-outline btn-sm" style="font-size:11px; color:var(--text-main); border-color:var(--accent-glow);">
              📥 AI 썸네일 다운로드
            </a>
          </div>
        </div>
      `;
      showToast('🎨 고화질 AI 대표 썸네일 이미지가 성공적으로 생성되었습니다!');
    } else {
      if (boxEl) boxEl.innerHTML = `<p style="font-size:11px; color:red; margin:0;">생성 실패: ${data.message}</p>`;
    }
  } catch (e) {
    if (boxEl) boxEl.innerHTML = `<p style="font-size:11px; color:red; margin:0;">생성 오류: ${e.message}</p>`;
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// Generate News Headline Card Image using HTML5 Canvas
function generateHeadlineCardForSelected() {
  if (!selectedArticle) {
    showToast('선택된 기사가 없습니다.');
    return;
  }

  const previewEl = document.getElementById('card-image-preview');
  if (previewEl) {
    previewEl.innerHTML = `<p style="font-size:11px; color:#facc15; margin:15px 0;">📰 기사 헤드라인 캡처 카드를 생성 중입니다...</p>`;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext('2d');

  // Background Gradient (Sleek Dark Modern News Style)
  const grad = ctx.createLinearGradient(0, 0, 1200, 675);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e1b4b');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 675);

  // Decorative Accent Bar Top
  const barGrad = ctx.createLinearGradient(0, 0, 1200, 0);
  barGrad.addColorStop(0, '#38bdf8');
  barGrad.addColorStop(0.5, '#818cf8');
  barGrad.addColorStop(1, '#c084fc');
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, 1200, 12);

  // Card Inner Container
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  drawRoundRect(ctx, 60, 60, 1080, 555, 24, true, true);

  // Category Badge Pill
  const categoryTag = selectedArticle.categoryTag || selectedArticle.category || '속보';
  ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  drawRoundRect(ctx, 100, 100, 260, 48, 12, true, true);

  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'center';
  ctx.fillText(categoryTag, 230, 132);

  // Quote / News Watermark Icon Right
  ctx.font = '80px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.textAlign = 'right';
  ctx.fillText('📰', 1100, 160);

  // Article Title (Multi-line wrap)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px sans-serif';

  const titleText = selectedArticle.title;
  const maxWidth = 940;
  const words = titleText.split(' ');
  let line = '';
  let lines = [];

  for (let n = 0; n < words.length; n++) {
    let testLine = line + words[n] + ' ';
    let metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Render Title Lines (Max 2 lines)
  let titleLines = lines.slice(0, 2);
  let startY = 215;
  titleLines.forEach((l, i) => {
    ctx.fillText(l.trim(), 100, startY + i * 52);
  });

  // Short Article Content Snippet Summary Box (Fills empty space)
  const snippetRaw = selectedArticle.contentSnippet || selectedArticle.excerpt || selectedArticle.title || '';
  let cleanSnippet = snippetRaw
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^Global News Source \([^)]+\):/gi, '')
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/기자|무단전재|재배포 금지|Copyright.*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanSnippet || cleanSnippet.length < 15 || cleanSnippet.toLowerCase().startsWith('http') || cleanSnippet.startsWith('<')) {
    cleanSnippet = `[주요 소식 리포트] ${selectedArticle.title} 관련 수집된 이슈 및 핵심 요약 정보입니다.`;
  }

  if (cleanSnippet.length > 0) {
    const snippetY = startY + titleLines.length * 52 + 15;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    drawRoundRect(ctx, 100, snippetY, 980, 160, 16, true, true);

    // Label Header inside box
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('💡 핵심 기사 내용 요약', 130, snippetY + 38);

    // Text Wrap Snippet Lines
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '22px sans-serif';
    
    const snipWords = cleanSnippet.split(' ');
    let sLine = '';
    let sLines = [];
    const snipMaxWidth = 920;

    for (let n = 0; n < snipWords.length; n++) {
      let testLine = sLine + snipWords[n] + ' ';
      let metrics = ctx.measureText(testLine);
      if (metrics.width > snipMaxWidth && n > 0) {
        sLines.push(sLine);
        sLine = snipWords[n] + ' ';
      } else {
        sLine = testLine;
      }
    }
    sLines.push(sLine);

    sLines.slice(0, 2).forEach((sl, idx) => {
      ctx.fillText(sl.trim(), 130, snippetY + 80 + idx * 36);
    });
  }

  // Divider Line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, 520);
  ctx.lineTo(1100, 520);
  ctx.stroke();

  // Footer: Date & Source Badge
  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#94a3b8';
  const formattedDate = new Date(selectedArticle.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`📅 수집일시: ${formattedDate}  |  🔗 원본 뉴스 리포트 요약 카드`, 100, 565);

  // Brand Watermark
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#facc15';
  ctx.textAlign = 'right';
  ctx.fillText('⚡ NEWS CARD', 1100, 565);

  const dataUrl = canvas.toDataURL('image/png');

  if (previewEl) {
    previewEl.innerHTML = `
      <div style="margin-top:5px;">
        <img src="${dataUrl}" style="max-width:100%; max-height:220px; object-fit:contain; border-radius:10px; border:1px solid rgba(168, 85, 247, 0.4); box-shadow:0 6px 18px rgba(0,0,0,0.5);" />
        <div style="margin-top:8px; display:flex; justify-content:center; gap:8px;">
          <a href="${dataUrl}" download="news-card-${Date.now()}.png" class="btn btn-outline btn-sm" style="font-size:11px; color:var(--accent-purple); border-color:var(--accent-purple);">
            📥 뉴스 카드 이미지 다운로드
          </a>
        </div>
      </div>
    `;
  }

  showToast('📰 기사 헤드라인 캡처 카드 이미지가 생성되었습니다!');
}

function drawRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
  if (typeof radius === 'number') {
    radius = {tl: radius, tr: radius, br: radius, bl: radius};
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// Post via X Web Intent
function postViaWebIntent() {
  const text = document.getElementById('tweet-text-input').value.trim();
  if (!text) {
    showToast('트윗할 내용을 입력해 주세요.');
    return;
  }

  navigator.clipboard.writeText(text).catch(() => {});

  if (selectedArticle) {
    selectedArticle.postedTweet = true;
    fetch('/api/mark-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: selectedArticle.id, type: 'tweet', title: selectedArticle.title, link: selectedArticle.link })
    }).then(() => renderFilteredArticles()).catch(() => {});
  }

  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');

  showToast('🌐 X.com 작성 창에 문구가 자동으로 채워졌습니다! [✅ X 일반글] 표시가 반영되었습니다.');
}

// Open X Articles Editor (Long-form post)
function openXArticlesComposer() {
  const text = document.getElementById('tweet-text-input').value.trim();
  if (!text) {
    showToast('복사할 내용을 먼저 입력해 주세요.');
    return;
  }

  if (selectedArticle) {
    selectedArticle.postedArticle = true;
    fetch('/api/mark-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: selectedArticle.id, type: 'article', title: selectedArticle.title, link: selectedArticle.link })
    }).then(() => renderFilteredArticles()).catch(() => {});
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 글 전문이 복사되었습니다! X 아티클 에디터(Ctrl+V) 하세요. [📰 X 아티클] 표시가 반영되었습니다.');
  }).catch(() => {});

  window.open('https://x.com/compose/articles', '_blank');
}

async function loadLogs() {
  const container = document.getElementById('logs-container');
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();

    if (data.success && data.logs.length > 0) {
      container.innerHTML = data.logs.map(log => `
        <div class="log-entry ${log.level}">
          [${new Date(log.timestamp).toLocaleTimeString()}] [${log.level}] ${log.message}
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="log-entry INFO">수동 포스팅 모드로 작동 중입니다. 최신 글을 선택하여 트윗을 생성하세요.</div>';
    }
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      const keyInput = document.getElementById('gemini-key-input');
      if (keyInput && data.config.geminiApiKey) {
        keyInput.value = data.config.geminiApiKey;
      }
      const passInput = document.getElementById('auth-password-input');
      if (passInput && data.config.authPassword) {
        passInput.value = data.config.authPassword;
      }
    }
  } catch (e) {}
}

async function saveAuthPassword() {
  const passInput = document.getElementById('auth-password-input');
  const newPass = passInput ? passInput.value.trim() : '';
  if (!newPass) {
    showToast('새 비밀번호를 입력해 주세요.');
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authPassword: newPass })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🔒 외부 접속 비밀번호가 성공적으로 변경되었습니다!');
    } else {
      showToast('저장 실패: ' + data.message);
    }
  } catch (err) {
    showToast('저장 실패: ' + err.message);
  }
}

async function saveGeminiApiKey() {
  const keyInput = document.getElementById('gemini-key-input');
  const apiKey = keyInput ? keyInput.value.trim() : '';

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiApiKey: apiKey })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🔑 Gemini API 키가 성공적으로 저장되었습니다!');
    } else {
      showToast('저장 실패: ' + data.message);
    }
  } catch (err) {
    showToast('저장 실패: ' + err.message);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}
