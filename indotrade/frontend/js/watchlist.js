// Unified Watchlist — Crypto + Equity in one dashboard
let WATCHLIST_DATA = { crypto: [], equity: [] };
let WATCHLIST_FILTER = 'ALL';
let WATCHLIST_SORT = { key: 'changePct', dir: 'desc' };
let WATCHLIST_REFRESH_INTERVAL = null;

function initWatchlist() {
  // Search
  document.getElementById('watchlist-search')?.addEventListener('input', (e) => {
    renderWatchlistTable(e.target.value.toLowerCase());
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      WATCHLIST_FILTER = btn.dataset.filter;
      const searchVal = document.getElementById('watchlist-search')?.value?.toLowerCase() || '';
      renderWatchlistTable(searchVal);
    });
  });

  // Sort headers
  document.querySelectorAll('#watchlist-global-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (WATCHLIST_SORT.key === key) {
        WATCHLIST_SORT.dir = WATCHLIST_SORT.dir === 'asc' ? 'desc' : 'asc';
      } else {
        WATCHLIST_SORT.key = key;
        WATCHLIST_SORT.dir = key === 'name' || key === 'type' ? 'asc' : 'desc';
      }
      const searchVal = document.getElementById('watchlist-search')?.value?.toLowerCase() || '';
      renderWatchlistTable(searchVal);
      updateSortIndicators();
    });
  });

  // Load data
  loadWatchlistData();

  // Auto-refresh every 5 seconds
  WATCHLIST_REFRESH_INTERVAL = setInterval(loadWatchlistData, 5000);
}

async function loadWatchlistData() {
  try {
    const data = await api.watchlist.unified();
    WATCHLIST_DATA = data;
    updateWatchlistStats(data);
    const searchVal = document.getElementById('watchlist-search')?.value?.toLowerCase() || '';
    renderWatchlistTable(searchVal);

    const el = document.getElementById('watchlist-global-updated');
    if (el) {
      const time = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      el.textContent = `(Updated: ${time} IST)`;
    }
  } catch (e) {
    console.error('Watchlist load failed:', e);
  }
}

function updateWatchlistStats(data) {
  const container = document.getElementById('watchlist-stats');
  if (!container) return;
  const all = [...(data.crypto || []), ...(data.equity || [])];
  const buyCount = all.filter(a => a.recommendation === 'BUY').length;
  const sellCount = all.filter(a => a.recommendation === 'SELL').length;
  const holdCount = all.filter(a => a.recommendation === 'HOLD').length;
  const topGainer = all.filter(a => a.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0];
  const topLoser = all.filter(a => a.changePct < 0).sort((a, b) => a.changePct - b.changePct)[0];

  container.innerHTML = `
    <div class="stat-item"><span class="stat-label">Total Assets</span><span class="stat-value">${all.length}</span></div>
    <div class="stat-item"><span class="stat-label">Crypto</span><span class="stat-value">${(data.crypto || []).length}</span></div>
    <div class="stat-item"><span class="stat-label">Equity</span><span class="stat-value">${(data.equity || []).length}</span></div>
    <div class="stat-item"><span class="stat-label bull-text">Buy</span><span class="stat-value bull-text">${buyCount}</span></div>
    <div class="stat-item"><span class="stat-label bear-text">Sell</span><span class="stat-value bear-text">${sellCount}</span></div>
    <div class="stat-item"><span class="stat-label">Hold</span><span class="stat-value">${holdCount}</span></div>
    ${topGainer ? `<div class="stat-item"><span class="stat-label bull-text">Top Gainer</span><span class="stat-value bull-text">${topGainer.name} +${topGainer.changePct.toFixed(1)}%</span></div>` : ''}
    ${topLoser ? `<div class="stat-item"><span class="stat-label bear-text">Top Loser</span><span class="stat-value bear-text">${topLoser.name} ${topLoser.changePct.toFixed(1)}%</span></div>` : ''}
  `;
}

function renderWatchlistTable(searchTerm = '') {
  const tbody = document.querySelector('#watchlist-global-table tbody');
  if (!tbody) return;

  let all = [...(WATCHLIST_DATA.crypto || []), ...(WATCHLIST_DATA.equity || [])];

  // Filter
  if (WATCHLIST_FILTER === 'CRYPTO') all = all.filter(a => a.type === 'CRYPTO');
  else if (WATCHLIST_FILTER === 'EQUITY') all = all.filter(a => a.type === 'EQUITY');
  else if (WATCHLIST_FILTER === 'BUY') all = all.filter(a => a.recommendation === 'BUY');
  else if (WATCHLIST_FILTER === 'SELL') all = all.filter(a => a.recommendation === 'SELL');

  // Search
  if (searchTerm) {
    all = all.filter(a =>
      a.name.toLowerCase().includes(searchTerm) ||
      a.symbol.toLowerCase().includes(searchTerm)
    );
  }

  // Sort
  all.sort((a, b) => {
    let va = a[WATCHLIST_SORT.key];
    let vb = b[WATCHLIST_SORT.key];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (WATCHLIST_SORT.dir === 'asc') return va > vb ? 1 : va < vb ? -1 : 0;
    return va < vb ? 1 : va > vb ? -1 : 0;
  });

  tbody.innerHTML = all.map(a => {
    const pct = a.changePct;
    const pctClass = pct >= 0 ? 'bull-text' : 'bear-text';
    const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    const recClass = a.recommendation;
    const priceStr = a.price > 1000
      ? `₹${a.price.toLocaleString('en-IN')}`
      : a.price > 1
        ? `₹${a.price.toFixed(2)}`
        : `₹${a.price.toFixed(6)}`;
    const volStr = a.volume > 10000000
      ? `${(a.volume / 10000000).toFixed(1)}Cr`
      : a.volume > 100000
        ? `${(a.volume / 100000).toFixed(1)}L`
        : a.volume > 1000
          ? `${(a.volume / 1000).toFixed(0)}K`
          : a.volume || '—';
    const typeLabel = a.type === 'CRYPTO' ? 'CRYPTO' : 'EQ';
    const coin = a.type === 'CRYPTO' ? a.symbol.split('-')[0].toLowerCase() : a.symbol;
    const analyzeFn = a.type === 'CRYPTO'
      ? `analyzeWatchlistCrypto('${coin}')`
      : `analyzeWatchlistEquity('${a.symbol}')`;

    return `<tr class="watchlist-row ${recClass}">
      <td><span class="type-badge ${a.type}">${typeLabel}</span></td>
      <td><strong>${a.name}</strong></td>
      <td>${priceStr}</td>
      <td class="${pctClass}">${pctStr}</td>
      <td class="muted">${volStr}</td>
      <td><span class="signal-mini ${recClass}">${a.recommendation}</span></td>
      <td><button class="btn-action" onclick="${analyzeFn}">Analyze</button></td>
    </tr>`;
  }).join('');

  if (all.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px;">No assets match your filters</td></tr>';
  }
}

function updateSortIndicators() {
  document.querySelectorAll('#watchlist-global-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === WATCHLIST_SORT.key) {
      th.classList.add(WATCHLIST_SORT.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

let WATCHLIST_ANALYZING = false;

async function analyzeWatchlistCrypto(coin) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Analyzing crypto...</p>';
  try {
    const analysis = await api.crypto.analyze(coin);
    container.innerHTML = renderCryptoAnalysisCard(analysis);
  } catch (e) {
    container.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
  WATCHLIST_ANALYZING = false;
}

async function analyzeWatchlistEquity(symbol) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Analyzing equity...</p>';
  try {
    const analysis = await api.equity.analyze(symbol);
    container.innerHTML = renderEquityAnalysisCard(analysis);
  } catch (e) {
    container.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
  WATCHLIST_ANALYZING = false;
}

function renderCryptoAnalysisCard(a) {
  return `<div class="signal-card" style="margin-top:16px;">
    <div class="signal-header">
      <div class="signal-badge ${a.recommendation}">${a.recommendation} — ${a.name || a.symbol}</div>
      <div class="sig-v">Conf: ${a.confidence}/10</div>
    </div>
    <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width:${a.confidence * 10}%"></div></div>
    <div class="signal-grid" style="margin-top:16px;">
      <div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹${a.currentPrice?.toLocaleString('en-IN')}</span></div>
      <div class="sig-kv"><span class="sig-k">24h Change</span><span class="sig-v ${a.change24h >= 0 ? 'bull-text' : 'bear-text'}">${a.change24h >= 0 ? '+' : ''}${a.change24h}%</span></div>
      <div class="sig-kv"><span class="sig-k">Volatility</span><span class="sig-v">${a.volatility}%</span></div>
      <div class="sig-kv"><span class="sig-k">Liquidity</span><span class="sig-v">${a.liquidityScore}</span></div>
      <div class="sig-kv"><span class="sig-k">BTC Dominance</span><span class="sig-v">${a.btcDominance}%</span></div>
      <div class="sig-kv"><span class="sig-k">Fear & Greed</span><span class="sig-v">${a.fearGreed?.current} (${a.fearGreed?.label})</span></div>
    </div>
    ${a.indicators ? `<div style="margin-top:16px;">
      <div class="sig-k">Technical Indicators</div>
      <div class="signal-grid">
        <div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">${a.indicators.rsi} (${a.indicators.rsiSignal})</span></div>
        <div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">${a.indicators.trend}</span></div>
        <div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">${a.indicators.macdCross}</span></div>
      </div>
    </div>` : ''}
    <div class="confluences-list" style="margin-top:16px;">
      <div class="sig-k">Analysis Reasons</div>
      <ul>${(a.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  </div>`;
}

function renderEquityAnalysisCard(a) {
  return `<div class="signal-card" style="margin-top:16px;">
    <div class="signal-header">
      <div class="signal-badge ${a.recommendation}">${a.recommendation} — ${a.symbol}</div>
      <div class="sig-v">Conf: ${a.confidence}/10</div>
    </div>
    <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width:${a.confidence * 10}%"></div></div>
    <div class="signal-grid" style="margin-top:16px;">
      <div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹${a.currentPrice?.toLocaleString('en-IN')}</span></div>
      <div class="sig-kv"><span class="sig-k">Day Change</span><span class="sig-v ${a.changePct >= 0 ? 'bull-text' : 'bear-text'}">${a.changePct >= 0 ? '+' : ''}${a.changePct}%</span></div>
      <div class="sig-kv"><span class="sig-k">YTD Return</span><span class="sig-v">${a.performance?.ytd}%</span></div>
      <div class="sig-kv"><span class="sig-k">1M Return</span><span class="sig-v">${a.performance?.month}%</span></div>
      <div class="sig-kv"><span class="sig-k">Volatility (ATR%)</span><span class="sig-v">${a.volatility?.pct}%</span></div>
      <div class="sig-kv"><span class="sig-k">Volume Ratio</span><span class="sig-v">${a.volumeAnalysis?.ratio}x</span></div>
      <div class="sig-kv"><span class="sig-k">Support</span><span class="sig-v">₹${a.levels?.support?.toLocaleString('en-IN')}</span></div>
      <div class="sig-kv"><span class="sig-k">Resistance</span><span class="sig-v">₹${a.levels?.resistance?.toLocaleString('en-IN')}</span></div>
    </div>
    ${a.indicators ? `<div style="margin-top:16px;">
      <div class="sig-k">Technical Indicators</div>
      <div class="signal-grid">
        <div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">${a.indicators.rsi} (${a.indicators.rsiSignal})</span></div>
        <div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">${a.indicators.trend}</span></div>
        <div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">${a.indicators.macdCross}</span></div>
        <div class="sig-kv"><span class="sig-k">BB Position</span><span class="sig-v">${a.indicators.bbPosition}</span></div>
      </div>
    </div>` : ''}
    <div class="confluences-list" style="margin-top:16px;">
      <div class="sig-k">Analysis Reasons</div>
      <ul>${(a.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  </div>`;
}
