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
  WATCHLIST_REFRESH_INTERVAL = setInterval(loadWatchlistData, 10000);

  // Run initial signal scan
  runSignalScan();
}

async function loadWatchlistData() {
  try {
    const data = await api.watchlist.unified();
    const hasData = (data.crypto?.length > 0) || (data.equity?.length > 0);
    if (hasData) {
      WATCHLIST_DATA = data;
      updateWatchlistStats(data);
      // Only re-render table if detail container is empty (no analysis showing)
      const detailEl = document.getElementById('watchlist-detail-container');
      const hasDetail = detailEl && detailEl.innerHTML.trim().length > 50;
      if (!hasDetail) {
        const searchVal = document.getElementById('watchlist-search')?.value?.toLowerCase() || '';
        renderWatchlistTable(searchVal);
      }
    }

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
      <td><button class="btn-action" onclick="${analyzeFn}">Quick Check</button></td>
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

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(), {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout — server may be waking up. Try again.');
    throw e;
  }
}

async function analyzeWatchlistCrypto(coin) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Analyzing crypto... (may take 15s on first load)</p>';
  try {
    const analysis = await fetchWithTimeout(API + '/crypto/analyze/' + coin, 30000);
    container.innerHTML = renderCryptoAnalysisCard(analysis);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
  }
  WATCHLIST_ANALYZING = false;
}

async function analyzeWatchlistEquity(symbol) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Analyzing equity... (may take 15s on first load)</p>';
  try {
    const analysis = await fetchWithTimeout(API + '/equity/analyze/' + symbol, 30000);
    container.innerHTML = renderEquityAnalysisCard(analysis);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
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

async function runSignalScan() {
  const btn = document.getElementById('btn-scan');
  const status = document.getElementById('scan-status');
  const container = document.getElementById('scan-results-container');
  if (!container) return;

  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Scanning... (may take 15s)';

  try {
    // Add timeout for cold starts
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const result = await fetch(API + '/signals/scan?type=all&limit=10&_t=' + Date.now(), {
      cache: 'no-store',
      signal: controller.signal
    }).then(r => {
      clearTimeout(timeout);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    renderScanResults(result);
    if (status) status.textContent = '(' + (result.totalScanned || 0) + ' assets scanned)';
  } catch (e) {
    if (e.name === 'AbortError') {
      if (status) status.textContent = 'Timeout — server waking up. Click Scan to retry.';
    } else {
      if (status) status.textContent = 'Error: ' + e.message;
    }
    container.innerHTML = '<p class="muted" style="padding:16px;">Server may be waking up (cold start). Click "Scan Market" to retry.</p>';
  }
  if (btn) btn.disabled = false;
}

function renderScanResults(result) {
  const container = document.getElementById('scan-results-container');
  if (!container) return;

  const buys = result.topBuys || [];
  const sells = result.topSells || [];

  let html = '';

  if (buys.length > 0) {
    html += '<div class="signal-card BUY" style="flex:1;min-width:300px;">' +
      '<div class="signal-header"><div class="signal-badge BUY">TOP BUYS</div><div class="sig-v">' + buys.length + ' signals</div></div>' +
      '<div style="margin-top:12px;">' +
      buys.map(function(b) {
        return '<div class="flex-row" style="padding:6px 0;border-bottom:1px solid var(--border);">' +
          '<div><strong>' + b.name + '</strong><span class="type-badge ' + b.type + '" style="margin-left:6px;">' + (b.type === 'CRYPTO' ? 'CRYPTO' : 'EQ') + '</span></div>' +
          '<div class="bull-text">' + b.signal + ' (' + (b.score > 0 ? '+' : '') + b.score + ')</div>' +
          '<div class="sig-k">RSI ' + (b.rsi ? b.rsi.toFixed(0) : '-') + ' | ' + (b.trend || '-') + ' | ' + (b.macd || '-') + '</div>' +
          '</div>';
      }).join('') +
      '</div></div>';
  }

  if (sells.length > 0) {
    html += '<div class="signal-card SELL" style="flex:1;min-width:300px;">' +
      '<div class="signal-header"><div class="signal-badge SELL">TOP SELLS</div><div class="sig-v">' + sells.length + ' signals</div></div>' +
      '<div style="margin-top:12px;">' +
      sells.map(function(s) {
        return '<div class="flex-row" style="padding:6px 0;border-bottom:1px solid var(--border);">' +
          '<div><strong>' + s.name + '</strong><span class="type-badge ' + s.type + '" style="margin-left:6px;">' + (s.type === 'CRYPTO' ? 'CRYPTO' : 'EQ') + '</span></div>' +
          '<div class="bear-text">' + s.signal + ' (' + s.score + ')</div>' +
          '<div class="sig-k">RSI ' + (s.rsi ? s.rsi.toFixed(0) : '-') + ' | ' + (s.trend || '-') + ' | ' + (s.macd || '-') + '</div>' +
          '</div>';
      }).join('') +
      '</div></div>';
  }

  if (buys.length === 0 && sells.length === 0) {
    html = '<p class="muted" style="padding:16px;">No strong signals found — market is neutral. Click "Scan Market" to refresh.</p>';
  }

  container.innerHTML = html;
}

// --- AI Trade Plan Integration ---

async function analyzeWatchlistCrypto(coin) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Quick Analysis + AI Trade Plan loading...</p>';
  try {
    // 1. Quick technical analysis (free, instant)
    const analysis = await fetchWithTimeout(API + '/crypto/analyze/' + coin, 30000);
    let html = renderCryptoAnalysisCard(analysis);
    html += '<div id="ai-plan-loading" class="placeholder-text" style="margin-top:12px;">Generating AI Trade Plan...</div>';
    container.innerHTML = html;
    // 2. AI Trade Plan (uses Groq tokens)
    try {
      const pairKey = coin.toUpperCase() + '-INR';
      const price = analysis.currentPrice || 0;
      const ohlcv = analysis.ohlcv || [];
      if (price > 0) {
        const { signal } = await api.ai.analyze({ symbol: pairKey, price, ohlcv, globalStats: analysis.globalStats || {} }, 'CRYPTO', 100000);
        const planEl = document.getElementById('ai-plan-loading');
        if (planEl) planEl.outerHTML = renderAITradePlanCard(signal);
      }
    } catch (e) {
      const planEl = document.getElementById('ai-plan-loading');
      if (planEl) planEl.outerHTML = '<p class="muted" style="margin-top:12px;">AI Trade Plan unavailable: ' + e.message + '</p>';
    }
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
  }
  WATCHLIST_ANALYZING = false;
}

async function analyzeWatchlistEquity(symbol) {
  if (WATCHLIST_ANALYZING) return;
  WATCHLIST_ANALYZING = true;
  const container = document.getElementById('watchlist-detail-container');
  if (!container) { WATCHLIST_ANALYZING = false; return; }
  container.innerHTML = '<p class="placeholder-text">Quick Analysis + AI Trade Plan loading...</p>';
  try {
    // 1. Quick technical analysis (free, instant)
    const analysis = await fetchWithTimeout(API + '/equity/analyze/' + symbol, 30000);
    let html = renderEquityAnalysisCard(analysis);
    html += '<div id="ai-plan-loading" class="placeholder-text" style="margin-top:12px;">Generating AI Trade Plan...</div>';
    container.innerHTML = html;
    // 2. AI Trade Plan (uses Groq tokens)
    try {
      const price = analysis.currentPrice || 0;
      const ohlcv = analysis.ohlcv || [];
      if (price > 0) {
        const { signal } = await api.ai.analyze({ symbol, price, ohlcv }, 'EQUITY', 100000);
        const planEl = document.getElementById('ai-plan-loading');
        if (planEl) planEl.outerHTML = renderAITradePlanCard(signal);
      }
    } catch (e) {
      const planEl = document.getElementById('ai-plan-loading');
      if (planEl) planEl.outerHTML = '<p class="muted" style="margin-top:12px;">AI Trade Plan unavailable: ' + e.message + '</p>';
    }
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
  }
  WATCHLIST_ANALYZING = false;
}

function renderAITradePlanCard(s) {
  if (!s || s.signal === 'NO_SIGNAL') {
    return '<div class="signal-card HOLD" style="margin-top:16px;"><div class="signal-header"><div class="signal-badge HOLD">AI Trade Plan (Llama)</div></div><p class="muted" style="padding:8px 0;">No signal generated — insufficient confluences or RSI in neutral zone.</p></div>';
  }
  var sigClass = s.signal === 'BUY' ? 'BUY' : s.signal === 'SELL' ? 'SELL' : 'HOLD';
  return '<div class="signal-card ' + sigClass + '" style="margin-top:16px;">' +
    '<div class="signal-header">' +
    '<div class="signal-badge ' + sigClass + '">AI Trade Plan: ' + s.signal + '</div>' +
    '<div class="sig-v">Conf: ' + (s.confidence || 0) + '/10</div>' +
    '</div>' +
    '<div class="signal-grid" style="margin-top:12px;">' +
    '<div class="sig-kv"><span class="sig-k">Timeframe</span><span class="sig-v">' + (s.timeframe || '-') + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Best Window</span><span class="sig-v">' + (s.bestWindow || '-') + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Entry Zone</span><span class="sig-v">₹' + (s.entryZone?.low || 0) + ' - ₹' + (s.entryZone?.high || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Stop Loss</span><span class="sig-v">₹' + (s.stopLoss || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Target 1</span><span class="sig-v">₹' + (s.target1 || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Target 2</span><span class="sig-v">₹' + (s.target2 || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Risk/Reward</span><span class="sig-v">' + (s.riskReward || '-') + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Invalidation</span><span class="sig-v">₹' + (s.invalidation || 0) + '</span></div>' +
    '</div>' +
    (s.confluences && s.confluences.length > 0
      ? '<div style="margin-top:8px;"><div class="sig-k">Confluences (' + s.confluences.length + '/3 req)</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
        s.confluences.map(function(c) { return '<li>' + c + '</li>'; }).join('') + '</ul></div>'
      : '') +
    (s.riskWarnings && s.riskWarnings.length > 0
      ? '<div style="margin-top:8px;"><div class="sig-k">Warnings</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
        s.riskWarnings.map(function(w) { return '<li class="bear-text">' + w + '</li>'; }).join('') + '</ul></div>'
      : '') +
    (s.positionNote ? '<p class="muted" style="margin-top:8px;font-size:12px;">' + s.positionNote + '</p>' : '') +
    '</div>';
}

async function runBatchAI() {
  var btn = document.getElementById('btn-batch-ai');
  var container = document.getElementById('batch-ai-results-container');
  if (!container) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing... (30-60s)'; }
  var assets = [];
  try {
    var scanResult = await api.signals.scan('all', 20);
    assets = [].concat(
      (scanResult.topBuys || []).map(function(a) { return { symbol: a.symbol, type: a.type }; }),
      (scanResult.topSells || []).map(function(a) { return { symbol: a.symbol, type: a.type }; })
    ).slice(0, 10);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Failed to scan assets: ' + e.message + '</p>';
    if (btn) { btn.disabled = false; btn.textContent = 'Full AI Analysis (Top 5)'; }
    return;
  }
  if (assets.length === 0) {
    container.innerHTML = '<p class="muted">No assets to analyze. Run Scan first.</p>';
    if (btn) { btn.disabled = false; btn.textContent = 'Full AI Analysis (Top 5)'; }
    return;
  }
  try {
    var result = await api.ai.batch(assets, 100000, 5);
    renderBatchAIResults(result);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">AI Analysis failed: ' + e.message + '</p>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Full AI Analysis (Top 5)'; }
}

function renderBatchAIResults(result) {
  var container = document.getElementById('batch-ai-results-container');
  if (!container) return;
  var plans = result.detailedPlans || [];
  if (plans.length === 0) {
    container.innerHTML = '<p class="muted">No trade plans generated.</p>';
    return;
  }
  var html = '<h3 style="margin:16px 0 12px;">AI Trade Plans (Top ' + plans.length + ' by Score)</h3>';
  plans.forEach(function(p, i) {
    var tp = p.tradePlan || {};
    var conf = tp.confidence || p.score || 0;
    var sig = tp.signal || p.signal || 'HOLD';
    var sigClass = sig === 'BUY' || sig === 'STRONG BUY' ? 'BUY' : sig === 'SELL' || sig === 'STRONG SELL' ? 'SELL' : 'HOLD';
    html += '<div class="signal-card ' + sigClass + '" style="margin-bottom:12px;">' +
      '<div class="signal-header">' +
      '<div class="signal-badge ' + sigClass + '">' + (i + 1) + '. ' + sig + ' — ' + p.name + ' <span class="type-badge ' + p.type + '">' + p.type + '</span></div>' +
      '<div class="sig-v">Conf: ' + conf + '/10 | Score: ' + (p.score > 0 ? '+' : '') + p.score + '</div>' +
      '</div>' +
      '<div class="signal-grid" style="margin-top:12px;">' +
      '<div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹' + (p.price || 0).toLocaleString('en-IN') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">' + (p.rsi ? p.rsi.toFixed(1) : '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">' + (p.trend || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">' + (p.macd || '-') + '</span></div>';
    if (tp.entryZone) {
      html += '<div class="sig-kv"><span class="sig-k">Entry</span><span class="sig-v">₹' + (tp.entryZone.low || 0) + ' - ₹' + (tp.entryZone.high || 0) + '</span></div>' +
        '<div class="sig-kv"><span class="sig-k">Stop Loss</span><span class="sig-v">₹' + (tp.stopLoss || 0) + '</span></div>' +
        '<div class="sig-kv"><span class="sig-k">Target 1</span><span class="sig-v">₹' + (tp.target1 || 0) + '</span></div>' +
        '<div class="sig-kv"><span class="sig-k">Risk/Reward</span><span class="sig-v">' + (tp.riskReward || '-') + '</span></div>';
    }
    html += '</div>';
    if (tp.confluences && tp.confluences.length > 0) {
      html += '<div style="margin-top:8px;"><div class="sig-k">Confluences</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
        tp.confluences.map(function(c) { return '<li>' + c + '</li>'; }).join('') + '</ul></div>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
}
