// Utility functions
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// Refresh only APIs (not full page re-render) with stable intervals
const REFRESH_INTERVAL_MS = {
  clock: 1000,
  equity: 1500,
  crypto: 1500,
  tabs: 10000
};

const refreshInFlight = {
  equity: false,
  crypto: false,
  tabs: false
};

const pollControl = {
  cooldownUntil: 0
};

async function runLocked(key, task) {
  if (refreshInFlight[key]) return;
  refreshInFlight[key] = true;
  try {
    await task();
  } finally {
    refreshInFlight[key] = false;
  }
}

function isPollPaused() {
  return Date.now() < pollControl.cooldownUntil;
}

function onRateLimit() {
  pollControl.cooldownUntil = Date.now() + 15000;
}

// Time & Market Status
function updateClock() {
  const now = new Date();
  const timeOpts = { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const str = now.toLocaleTimeString('en-IN', timeOpts);
  const el = document.getElementById('ist-clock');
  if (el) el.innerText = `${str} IST`;

  // Market hours check
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hour = istNow.getHours();
  const min = istNow.getMinutes();
  const day = istNow.getDay(); // 0 = Sun, 6 = Sat

  const isMarketOpen = day >= 1 && day <= 5 && (hour > 9 || (hour === 9 && min >= 15)) && (hour < 15 || (hour === 15 && min <= 30));
  
  window.MARKET_OPEN = isMarketOpen;
  const nseStatus = document.getElementById('nse-market-status');
  const nseDot = document.querySelector('.nse-status .dot');
  
  if (nseStatus && nseDot) {
    if (isMarketOpen) {
      nseStatus.innerText = 'Open';
      nseDot.className = 'dot active';
    } else {
      nseStatus.innerText = 'Closed';
      nseDot.className = 'dot inactive';
    }
  }
}

// Tabs Logic
function initTabs() {
  const tabs = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const targetItem = e.target.closest('.nav-item') || tab;
      const targetId = targetItem.getAttribute('data-tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      targetItem.classList.add('active');
      
      panes.forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById(`tab-${targetId}`);
      if (targetPane) {
        targetPane.classList.remove('active');
        void targetPane.offsetWidth;
        targetPane.classList.add('active');
      }
    });
  });
}

// Global Dashboard Data
async function fetchGlobals() {
  try {
    const [nifty, bse, cryptoG] = await Promise.all([
      api.equity.quote('^NSEI').catch(()=>({error:true})),
      api.equity.quote('^BSESN').catch(()=>({error:true})),
      api.crypto.global().catch(()=>({error:true}))
    ]);

    if (!nifty.error) updateMetricCard('card-nifty', nifty.price, nifty.changePct);
    if (!bse.error) updateMetricCard('card-sensex', bse.price, bse.changePct);
    
    if (!cryptoG.error) {
      // BTC is hardcoded in watchlist, could also fetch live here, we'll populate the card manually
      // Use crypto global data for FNG
      const fngCard = document.getElementById('card-fng');
      if (fngCard) {
        fngCard.querySelector('.m-value').innerText = cryptoG.fearGreed;
        fngCard.querySelector('.m-value').classList.remove('skeleton-text');
        fngCard.querySelector('.m-change').innerHTML = `<span class="${cryptoG.fearGreed > 50 ? 'bull-text' : 'bear-text'}">${cryptoG.fearGreedLabel}</span>`;
      }
    }
  } catch(e) { /* silent fail for dashboard globals */ }
}

function updateMetricCard(id, value, changePct) {
  const c = document.getElementById(id);
  if (!c) return;
  c.querySelector('.m-value').innerText = `${value.toLocaleString('en-IN')}`;
  c.querySelector('.m-value').classList.remove('skeleton-text');
  c.querySelector('.m-change').innerHTML = `<span class="${changePct >= 0 ? 'bull-text' : 'bear-text'}">${changePct >= 0 ? '+' : ''}${changePct}%</span>`;
}

function renderBasicTable(headers, rows) {
  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="table-container"><table>${thead}${tbody}</table></div>`;
}

function fmtPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

async function renderEquityTabData() {
  const detailContainer = document.getElementById('equity-detail-container');
  const contextContainer = document.getElementById('equity-market-context');
  const equityContainer = document.getElementById('tab-equity');
  if (!equityContainer) return;

  try {
    const symbols = (typeof EQUITY_WATCHLIST !== 'undefined' ? EQUITY_WATCHLIST : ['^NSEI', '^BSESN']);
    const eqData = await api.equity.batch(symbols);
    const valid = eqData.filter(d => !d.error && Number.isFinite(Number(d.price)));
    const indices = valid.filter(d => d.symbol.startsWith('^'));
    const stocks = valid.filter(d => !d.symbol.startsWith('^'));

    // Market context cards with modern styling
    if (contextContainer) {
      contextContainer.innerHTML = '<div class="market-cards-grid">' + indices.map(idx => {
        const pct = Number(idx.changePct);
        const isPositive = pct >= 0;
        return `<div class="market-card-modern ${isPositive ? 'bull' : 'bear'}">
          <div class="mc-icon">${isPositive ? '📈' : '📉'}</div>
          <div class="mc-label">${idx.symbol.replace('^', '')}</div>
          <div class="mc-value">₹${Number(idx.price).toLocaleString('en-IN')}</div>
          <div class="mc-change ${isPositive ? 'bull-text' : 'bear-text'}">
            <span class="mc-arrow">${isPositive ? '▲' : '▼'}</span>
            ${isPositive ? '+' : ''}${pct || 0}%
          </div>
        </div>`;
      }).join('') + '</div>';
    }

    // Populate dropdown with modern styling
    const sel = document.getElementById('equity-symbol-select');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Select Stock...</option>' +
        stocks.map(s => `<option value="${s.symbol}">${s.symbol.replace('.NS', '')}</option>`).join('');
    }

    // Best performer
    const sorted = stocks.filter(s => Number.isFinite(Number(s.changePct))).sort((a, b) => Number(b.changePct) - Number(a.changePct));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const positiveCount = stocks.filter(s => Number(s.changePct) > 0).length;
    const negativeCount = stocks.filter(s => Number(s.changePct) < 0).length;

    // Quick stats with modern card design
    if (detailContainer && !detailContainer.innerHTML.includes('analysis-card')) {
      detailContainer.innerHTML = `
        <div class="analysis-card modern">
          <div class="ac-header">
            <span class="ac-icon">📊</span>
            <span class="ac-title">Market Snapshot</span>
          </div>
          <div class="stats-grid">
            <div class="stat-card gainer">
              <div class="stat-icon">🚀</div>
              <div class="stat-label">Top Gainer</div>
              <div class="stat-value bull-text">${best ? best.symbol.replace('.NS', '') + ' ' + fmtPct(best.changePct) : '-'}</div>
            </div>
            <div class="stat-card loser">
              <div class="stat-icon">📉</div>
              <div class="stat-label">Top Loser</div>
              <div class="stat-value bear-text">${worst ? worst.symbol.replace('.NS', '') + ' ' + fmtPct(worst.changePct) : '-'}</div>
            </div>
            <div class="stat-card total">
              <div class="stat-icon">📋</div>
              <div class="stat-label">Stocks Tracked</div>
              <div class="stat-value">${stocks.length}</div>
            </div>
            <div class="stat-card positive">
              <div class="stat-icon">✅</div>
              <div class="stat-label">Positive</div>
              <div class="stat-value bull-text">${positiveCount}</div>
            </div>
            <div class="stat-card negative">
              <div class="stat-icon">❌</div>
              <div class="stat-label">Negative</div>
              <div class="stat-value bear-text">${negativeCount}</div>
            </div>
          </div>
          <div class="hint-box">
            <span class="hint-icon">💡</span>
            <span>Select a stock from the dropdown above for detailed AI analysis with entry, stop loss, targets, and policy impact.</span>
          </div>
        </div>`;
    }
  } catch (e) {
    if (contextContainer) contextContainer.innerHTML = '<div class="error-card"><span class="error-icon">⚠️</span><span>Unable to load equity data.</span></div>';
  }
}

async function analyzeEquityDetail(symbol) {
  const detailContainer = document.getElementById('equity-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Analyzing ${symbol.replace('.NS','')} + AI Trade Plan loading...</span></div>`;
  try {
    const analysis = await api.equity.analyze(symbol);
    const rec = analysis.recommendation || 'HOLD';
    const conf = analysis.confidence || 0;
    const recClass = rec === 'BUY' ? 'bull' : rec === 'SELL' ? 'bear' : 'neutral';

    let html = `
      <div class="analysis-card modern">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">📈</span>
            <span class="ac-title">${(analysis.symbol || symbol).replace('.NS','')} — Technical Analysis</span>
          </div>
          <span class="ac-badge modern ${recClass}">${rec} | Conf: ${conf}/10</span>
        </div>

        <!-- Price & Performance -->
        <div class="section-header modern">
          <span class="section-icon">💰</span>
          <span>Price & Performance</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Price</span>
            <span class="di-value">₹${(analysis.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Day Change</span>
            <span class="di-value ${(analysis.changePct || 0) >= 0 ? 'bull-text' : 'bear-text'}">
              ${(analysis.changePct || 0) >= 0 ? '▲' : '▼'} ${(analysis.changePct || 0) >= 0 ? '+' : ''}${analysis.changePct || 0}%
            </span>
          </div>
          <div class="data-item modern">
            <span class="di-label">YTD Return</span>
            <span class="di-value ${(analysis.performance?.ytd || 0) >= 0 ? 'bull-text' : 'bear-text'}">
              ${(analysis.performance?.ytd || 0) >= 0 ? '▲' : '▼'} ${analysis.performance?.ytd || '-'}%
            </span>
          </div>
          <div class="data-item modern">
            <span class="di-label">1M Return</span>
            <span class="di-value ${(analysis.performance?.month || 0) >= 0 ? 'bull-text' : 'bear-text'}">
              ${(analysis.performance?.month || 0) >= 0 ? '▲' : '▼'} ${analysis.performance?.month || '-'}%
            </span>
          </div>
        </div>

        <!-- Risk Metrics -->
        <div class="section-header modern">
          <span class="section-icon">⚡</span>
          <span>Risk Metrics</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Volatility (ATR%)</span>
            <span class="di-value">${analysis.volatility?.pct || '-'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Volume Ratio</span>
            <span class="di-value">${analysis.volumeAnalysis?.ratio || '-'}x</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Support</span>
            <span class="di-value bull-text">₹${(analysis.levels?.support || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Resistance</span>
            <span class="di-value bear-text">₹${(analysis.levels?.resistance || 0).toLocaleString('en-IN')}</span>
          </div>
        </div>`;

    // Technical Indicators
    if (analysis.indicators) {
      html += `
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>Technical Indicators</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">RSI</span>
            <span class="di-value">${analysis.indicators.rsi?.toFixed(1) || '-'} (${analysis.indicators.rsiSignal || '-'})</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Trend</span>
            <span class="di-value">${analysis.indicators.trend || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">MACD</span>
            <span class="di-value">${analysis.indicators.macdCross || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Bollinger</span>
            <span class="di-value">${analysis.indicators.bbPosition || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">EMA 20</span>
            <span class="di-value">₹${analysis.indicators.ema20?.toFixed(2) || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">EMA 50</span>
            <span class="di-value">₹${analysis.indicators.ema50?.toFixed(2) || '-'}</span>
          </div>
        </div>`;
    }

    // Analysis Reasons
    if (analysis.reasons && analysis.reasons.length > 0) {
      html += `
        <div class="section-header modern">
          <span class="section-icon">🔍</span>
          <span>Analysis Reasons</span>
        </div>
        <ul class="reason-list modern">
          ${analysis.reasons.map(r => `<li><span class="reason-bullet">•</span>${r}</li>`).join('')}
        </ul>`;
    }

    html += `<div id="equity-ai-plan-loading" class="loading-card" style="margin-top:16px;"><div class="loading-spinner"></div><span>Generating AI Trade Plan...</span></div></div>`;

    detailContainer.innerHTML = html;

    // AI Trade Plan
    try {
      const ohlcv = analysis.ohlcv || [];
      const { signal } = await api.ai.analyze({ symbol, price: analysis.currentPrice || 0, ohlcv }, 'EQUITY', 100000);
      const planEl = document.getElementById('equity-ai-plan-loading');
      if (planEl) planEl.outerHTML = renderAITradePlanInline(signal);
    } catch (e) {
      const planEl = document.getElementById('equity-ai-plan-loading');
      if (planEl) planEl.outerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>AI Trade Plan unavailable: ${e.message}</span></div>`;
    }
  } catch (e) {
    detailContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Analysis failed: ${e.message}</span></div>`;
  }
}

async function renderFoTabData() {
  const warningContainer = document.getElementById('fo-expiry-warning');
  const container = document.getElementById('fo-info-container');
  if (!container) return;

  try {
    const info = await api.fo.info();

    // Expiry warning card with modern styling
    if (warningContainer) {
      const daysLeft = Number(info.daysToExpiry) || 0;
      const riskLevel = daysLeft <= 2 ? 'high' : daysLeft <= 5 ? 'medium' : 'low';
      const riskLabel = daysLeft <= 2 ? 'HIGH RISK' : daysLeft <= 5 ? 'ELEVATED' : 'NORMAL';
      const riskIcon = daysLeft <= 2 ? '🔴' : daysLeft <= 5 ? '🟡' : '🟢';
      
      warningContainer.innerHTML = `
        <div class="market-cards-grid">
          <div class="market-card-modern">
            <div class="mc-icon">📅</div>
            <div class="mc-label">Expiry Date</div>
            <div class="mc-value">${info.expiryDate || '-'}</div>
          </div>
          <div class="market-card-modern ${riskLevel}">
            <div class="mc-icon">⏰</div>
            <div class="mc-label">Days to Expiry</div>
            <div class="mc-value">${Number.isFinite(daysLeft) ? daysLeft : '-'}</div>
          </div>
          <div class="market-card-modern">
            <div class="mc-icon">📈</div>
            <div class="mc-label">NIFTY 50</div>
            <div class="mc-value">₹${Number(info.nifty) ? Number(info.nifty).toLocaleString('en-IN') : '-'}</div>
          </div>
          <div class="market-card-modern">
            <div class="mc-icon">📊</div>
            <div class="mc-label">BANKNIFTY</div>
            <div class="mc-value">₹${Number(info.banknifty) ? Number(info.banknifty).toLocaleString('en-IN') : '-'}</div>
          </div>
          <div class="market-card-modern ${riskLevel}">
            <div class="mc-icon">${riskIcon}</div>
            <div class="mc-label">Volatility Risk</div>
            <div class="mc-value ${riskLevel === 'high' ? 'bear-text' : riskLevel === 'medium' ? 'bear-text' : 'bull-text'}">${riskLabel}</div>
          </div>
        </div>`;
    }

    const guidance = info.isExpiryWeek
      ? `<div class="action-box modern warning">
          <div class="action-icon">⚠️</div>
          <div class="action-content">
            <strong>F&O Expiry Week:</strong> Reduce position size by 40-50%. Avoid revenge trades. Keep strict stop loss. Elevated gamma risk near expiry.
          </div>
        </div>`
      : `<div class="action-box modern success">
          <div class="action-icon">✅</div>
          <div class="action-content">
            Non-expiry week: Normal volatility profile. Use strict risk/reward >= 1:1.5. Monitor OI buildup at key strikes.
          </div>
        </div>`;

    container.innerHTML = `
      ${guidance}
      <div class="button-group" style="margin-top:16px;">
        <button class="btn-action modern" onclick="analyzeFoDetail('NIFTY')">
          <span class="btn-icon">📊</span>
          <span>Analyze NIFTY Options</span>
        </button>
        <button class="btn-action modern" onclick="analyzeFoDetail('BANKNIFTY')">
          <span class="btn-icon">📈</span>
          <span>Analyze BANKNIFTY Options</span>
        </button>
      </div>
      <div id="fo-detail-container" style="margin-top:16px;"></div>`;
  } catch (e) {
    container.innerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>Unable to load F&O data.</span></div>`;
  }
}

async function analyzeFoDetail(symbol) {
  const detailContainer = document.getElementById('fo-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Analyzing ${symbol} options chain...</span></div>`;
  try {
    const analysis = await api.fo.analyze(symbol);

    let optionsChainHtml = '';
    if (analysis.optionsChain && analysis.optionsChain.length > 0) {
      optionsChainHtml = `
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>Options Chain (ATM ± 5 strikes)</span>
        </div>
        <div class="table-container modern">
          <table class="options-table">
            <thead>
              <tr>
                <th>Call OI</th>
                <th>Call Price</th>
                <th>Call Δ</th>
                <th>Strike</th>
                <th>Put Δ</th>
                <th>Put Price</th>
                <th>Put OI</th>
              </tr>
            </thead>
            <tbody>
              ${analysis.optionsChain.map(function(o) {
                var isMaxPain = o.strike === analysis.maxPain;
                return `<tr class="${isMaxPain ? 'max-pain-row' : ''}">
                  <td>${(o.call.oi / 1000).toFixed(0)}K</td>
                  <td>₹${o.call.price}</td>
                  <td>${o.call.greeks.delta}</td>
                  <td><strong>${o.strike}</strong>${isMaxPain ? ' ⭐' : ''}</td>
                  <td>${o.put.greeks.delta}</td>
                  <td>₹${o.put.price}</td>
                  <td>${(o.put.oi / 1000).toFixed(0)}K</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <p class="table-note">⭐ = Max Pain strike</p>
        </div>`;
    }

    var strategyType = analysis.strategy?.type || 'NEUTRAL';
    var badgeClass = strategyType === 'BULLISH' ? 'bull' : strategyType === 'BEARISH' ? 'bear' : 'neutral';
    var strategyIcon = strategyType === 'BULLISH' ? '📈' : strategyType === 'BEARISH' ? '📉' : '➡️';

    detailContainer.innerHTML = `
      <div class="analysis-card modern">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">📊</span>
            <span class="ac-title">${analysis.symbol || symbol} — Options Analysis</span>
          </div>
          <span class="ac-badge modern ${badgeClass}">${strategyIcon} ${strategyType}</span>
        </div>

        <div class="section-header modern">
          <span class="section-icon">🎯</span>
          <span>Key Metrics</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Spot Price</span>
            <span class="di-value">₹${(analysis.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Expiry</span>
            <span class="di-value">${analysis.expiryDate || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Days to Expiry</span>
            <span class="di-value">${analysis.daysToExpiry || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">PCR (Put-Call Ratio)</span>
            <span class="di-value">${analysis.pcr || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Max Pain</span>
            <span class="di-value">₹${analysis.maxPain || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Implied Volatility</span>
            <span class="di-value">${analysis.iv || '-'}%</span>
          </div>
        </div>

        <div class="section-header modern">
          <span class="section-icon">💡</span>
          <span>Strategy Recommendation</span>
        </div>
        <div class="action-box modern ${strategyType === 'BEARISH' ? 'warning' : 'success'}">
          <div class="action-icon">${strategyType === 'BULLISH' ? '📈' : strategyType === 'BEARISH' ? '📉' : '➡️'}</div>
          <div class="action-content">
            <strong>${strategyType}:</strong> ${analysis.strategy?.reason || 'No strategy available'}
          </div>
        </div>

        ${analysis.riskWarning ? `<div class="action-box modern warning" style="margin-top:8px;">
          <div class="action-icon">⚠️</div>
          <div class="action-content"><strong>Warning:</strong> ${analysis.riskWarning}</div>
        </div>` : ''}

        ${optionsChainHtml}
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Analysis failed: ${e.message}</span></div>`;
  }
}

async function renderCryptoTabData() {
  const globalContainer = document.getElementById('crypto-global-container');
  const moversContainer = document.getElementById('crypto-top-movers');
  const detailContainer = document.getElementById('crypto-detail-container');
  if (!globalContainer) return;

  try {
    const [global, all] = await Promise.allSettled([api.crypto.global(), api.crypto.all()]);
    const globalData = global.status === 'fulfilled' ? global.value : {};
    const allData = all.status === 'fulfilled' ? (all.value || []) : [];

    // Global market cards with modern styling
    globalContainer.innerHTML = `
      <div class="market-cards-grid">
        <div class="market-card-modern">
          <div class="mc-icon">💰</div>
          <div class="mc-label">Market Cap</div>
          <div class="mc-value">$${globalData.marketCap ? (Number(globalData.marketCap) / 1e12).toFixed(2) + 'T' : '-'}</div>
        </div>
        <div class="market-card-modern">
          <div class="mc-icon">📊</div>
          <div class="mc-label">24h Volume</div>
          <div class="mc-value">$${globalData.totalVolume ? (Number(globalData.totalVolume) / 1e9).toFixed(1) + 'B' : '-'}</div>
        </div>
        <div class="market-card-modern">
          <div class="mc-icon">₿</div>
          <div class="mc-label">BTC Dominance</div>
          <div class="mc-value">${globalData.btcDominance || '-'}%</div>
        </div>
        <div class="market-card-modern">
          <div class="mc-icon">😱</div>
          <div class="mc-label">Fear & Greed</div>
          <div class="mc-value">${globalData.fearGreed || '-'}</div>
          <div class="mc-sub">${globalData.fearGreedLabel || ''}</div>
        </div>
      </div>`;

    // Top movers with modern styling
    const valid = allData.filter(x => !x.error);
    const topByVolume = valid.sort((a, b) => Number.parseFloat(b.volumeQt || 0) - Number.parseFloat(a.volumeQt || 0)).slice(0, 8);
    const topGainers = valid.filter(x => Number.parseFloat(x.pricechange) > 0).sort((a, b) => Number.parseFloat(b.pricechange) - Number.parseFloat(a.pricechange)).slice(0, 4);
    const topLosers = valid.filter(x => Number.parseFloat(x.pricechange) < 0).sort((a, b) => Number.parseFloat(a.pricechange) - Number.parseFloat(b.pricechange)).slice(0, 4);

    if (moversContainer) {
      let moversHtml = '<div class="movers-grid">';
      
      if (topGainers.length > 0) {
        moversHtml += '<div class="movers-section"><div class="movers-header"><span class="movers-icon">🚀</span><span>Top Gainers</span></div><div class="movers-list">';
        topGainers.forEach(g => {
          moversHtml += `<div class="mover-item gain">
            <span class="mover-name">${g.pair.split('-')[0]}</span>
            <span class="mover-change bull-text">▲ +${Number.parseFloat(g.pricechange).toFixed(2)}%</span>
          </div>`;
        });
        moversHtml += '</div></div>';
      }
      
      if (topLosers.length > 0) {
        moversHtml += '<div class="movers-section"><div class="movers-header"><span class="movers-icon">📉</span><span>Top Losers</span></div><div class="movers-list">';
        topLosers.forEach(l => {
          moversHtml += `<div class="mover-item loss">
            <span class="mover-name">${l.pair.split('-')[0]}</span>
            <span class="mover-change bear-text">▼ ${Number.parseFloat(l.pricechange).toFixed(2)}%</span>
          </div>`;
        });
        moversHtml += '</div></div>';
      }
      
      moversHtml += '</div>';
      moversContainer.innerHTML = `
        <div class="analysis-card modern">
          <div class="ac-header">
            <span class="ac-icon">🔥</span>
            <span class="ac-title">Top Movers</span>
          </div>
          ${moversHtml}
        </div>`;
    }

    // Populate dropdown with modern styling
    const sel = document.getElementById('crypto-symbol-select');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Select Coin...</option>' +
        topByVolume.map(c => `<option value="${c.pair.split('-')[0].toLowerCase()}">${c.pair.split('-')[0]}</option>`).join('');
    }

    if (detailContainer && !detailContainer.innerHTML.includes('analysis-card')) {
      detailContainer.innerHTML = `
        <div class="analysis-card modern">
          <div class="hint-box">
            <span class="hint-icon">💡</span>
            <span>Select a coin from the dropdown above for detailed AI analysis with entry, stop loss, targets, sentiment, and regulatory risk.</span>
          </div>
        </div>`;
    }
  } catch (e) {
    if (globalContainer) globalContainer.innerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>Unable to load crypto data.</span></div>`;
  }
}

async function analyzeCryptoDetail(coin) {
  const detailContainer = document.getElementById('crypto-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Analyzing ${coin.toUpperCase()} + AI Trade Plan loading...</span></div>`;
  try {
    const analysis = await api.crypto.analyze(coin);
    const rec = analysis.recommendation || 'HOLD';
    const conf = analysis.confidence || 0;
    const recClass = rec === 'BUY' ? 'bull' : rec === 'SELL' ? 'bear' : 'neutral';

    let html = `
      <div class="analysis-card modern">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">🪙</span>
            <span class="ac-title">${analysis.name || coin.toUpperCase()} — Technical Analysis</span>
          </div>
          <span class="ac-badge modern ${recClass}">${rec} | Conf: ${conf}/10</span>
        </div>

        <!-- Price & Sentiment -->
        <div class="section-header modern">
          <span class="section-icon">💰</span>
          <span>Price & Sentiment</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Price</span>
            <span class="di-value">₹${(analysis.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">24h Change</span>
            <span class="di-value ${(analysis.change24h || 0) >= 0 ? 'bull-text' : 'bear-text'}">
              ${(analysis.change24h || 0) >= 0 ? '▲' : '▼'} ${(analysis.change24h || 0) >= 0 ? '+' : ''}${analysis.change24h || 0}%
            </span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Volatility</span>
            <span class="di-value">${analysis.volatility || '-'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Liquidity</span>
            <span class="di-value">${analysis.liquidityScore || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Fear & Greed</span>
            <span class="di-value">${analysis.fearGreed?.current || '-'} (${analysis.fearGreed?.label || '-'})</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">BTC Dominance</span>
            <span class="di-value">${analysis.btcDominance || '-'}%</span>
          </div>
        </div>`;

    // Technical Indicators
    if (analysis.indicators) {
      html += `
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>Technical Indicators</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">RSI</span>
            <span class="di-value">${analysis.indicators.rsi?.toFixed(1) || '-'} (${analysis.indicators.rsiSignal || '-'})</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Trend</span>
            <span class="di-value">${analysis.indicators.trend || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">MACD</span>
            <span class="di-value">${analysis.indicators.macdCross || '-'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Bollinger</span>
            <span class="di-value">${analysis.indicators.bbPosition || '-'}</span>
          </div>
        </div>`;
    }

    // Analysis Reasons
    if (analysis.reasons && analysis.reasons.length > 0) {
      html += `
        <div class="section-header modern">
          <span class="section-icon">🔍</span>
          <span>Analysis Reasons</span>
        </div>
        <ul class="reason-list modern">
          ${analysis.reasons.map(r => `<li><span class="reason-bullet">•</span>${r}</li>`).join('')}
        </ul>`;
    }

    html += `<div id="crypto-ai-plan-loading" class="loading-card" style="margin-top:16px;"><div class="loading-spinner"></div><span>Generating AI Trade Plan...</span></div></div>`;

    detailContainer.innerHTML = html;

    // AI Trade Plan
    try {
      const pairKey = coin.toUpperCase() + '-INR';
      const price = analysis.currentPrice || 0;
      const ohlcv = analysis.ohlcv || [];
      if (price > 0) {
        const { signal } = await api.ai.analyze({ symbol: pairKey, price, ohlcv, globalStats: analysis.globalStats || {} }, 'CRYPTO', 100000);
        const planEl = document.getElementById('crypto-ai-plan-loading');
        if (planEl) planEl.outerHTML = renderAITradePlanInline(signal);
      }
    } catch (e) {
      const planEl = document.getElementById('crypto-ai-plan-loading');
      if (planEl) planEl.outerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>AI Trade Plan unavailable: ${e.message}</span></div>`;
    }
  } catch (e) {
    detailContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Analysis failed: ${e.message}</span></div>`;
  }
}

async function renderMfTabData() {
  const container = document.getElementById('mf-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Loading...</span></div>`;
    container.dataset.loaded = '1';
  }
  try {
    const data = await api.mf.watchlist();
    const ranked = data.filter(f => !f.error && Number.isFinite(Number(f.change))).sort((a, b) => Number(b.change) - Number(a.change));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    // Fund cards with modern styling
    container.innerHTML = `
      <div class="funds-grid">
        ${data.filter(f => !f.error).map(function(f) {
          var nav = Number.parseFloat(f.nav);
          var chg = Number.parseFloat(f.change);
          const isPositive = chg >= 0;
          return `<div class="fund-card modern" onclick="analyzeMfDetail('${f.code}')">
            <div class="fund-icon">📈</div>
            <div class="fund-name">${f.name.split(' ').slice(0, 2).join(' ')}</div>
            <div class="fund-nav">₹${Number.isFinite(nav) ? nav.toFixed(4) : '-'}</div>
            <div class="fund-change ${isPositive ? 'bull-text' : 'bear-text'}">
              ${isPositive ? '▲' : '▼'} ${isPositive ? '+' : ''}${chg || 0}%
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="button-group" style="margin-top:16px;">
        ${data.filter(f => !f.error).map(function(f) {
          return `<button class="btn-action modern" onclick="analyzeMfDetail('${f.code}')">
            <span class="btn-icon">📊</span>
            <span>${f.name.split(' ')[0]}</span>
          </button>`;
        }).join('')}
      </div>
      <div id="mf-detail-container" style="margin-top:16px;"></div>`;
  } catch (e) {
    container.innerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>Unable to load mutual fund data.</span></div>`;
  }
}

async function analyzeMfDetail(code) {
  const detailContainer = document.getElementById('mf-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Analyzing fund + AI Trade Plan loading...</span></div>`;
  try {
    const analysis = await api.mf.analyze(code);
    const rec = analysis.recommendation || 'HOLD';
    const conf = analysis.confidence || 0;
    const recClass = rec === 'BUY' || rec === 'START_SIP' ? 'bull' : rec === 'AVOID' || rec === 'DUMP' ? 'bear' : 'neutral';
    
    let html = `
      <div class="analysis-card modern" style="margin-top:16px;">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">📈</span>
            <span class="ac-title">${analysis.name}</span>
          </div>
          <span class="ac-badge modern ${recClass}">${rec} | Conf: ${conf}/10</span>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill ${recClass}" style="width: ${conf * 10}%"></div></div>
        
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>Fund Details</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Category</span>
            <span class="di-value">${analysis.category}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Risk Level</span>
            <span class="di-value">${analysis.riskLevel}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">NAV</span>
            <span class="di-value">₹${analysis.currentNAV}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Volatility</span>
            <span class="di-value">${analysis.volatility}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Sharpe Ratio</span>
            <span class="di-value">${analysis.sharpeRatio || 'N/A'}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Max Drawdown</span>
            <span class="di-value bear-text">${analysis.maxDrawdown}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Consistency</span>
            <span class="di-value">${analysis.consistency || 'N/A'}%</span>
          </div>
        </div>
        
        <div class="section-header modern">
          <span class="section-icon">📈</span>
          <span>Returns</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">1W</span>
            <span class="di-value ${(analysis.returns?.['1w'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1w'] ?? 'N/A'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">1M</span>
            <span class="di-value ${(analysis.returns?.['1m'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1m'] ?? 'N/A'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">3M</span>
            <span class="di-value ${(analysis.returns?.['3m'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['3m'] ?? 'N/A'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">1Y</span>
            <span class="di-value ${(analysis.returns?.['1y'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1y'] ?? 'N/A'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">3Y</span>
            <span class="di-value ${(analysis.returns?.['3y'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['3y'] ?? 'N/A'}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">5Y</span>
            <span class="di-value ${(analysis.returns?.['5y'] || 0) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['5y'] ?? 'N/A'}%</span>
          </div>
        </div>
        
        ${analysis.suitability ? `
        <div class="section-header modern">
          <span class="section-icon">🎯</span>
          <span>Suitability</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Short Term</span>
            <span class="di-value">${analysis.suitability.shortTerm}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Long Term</span>
            <span class="di-value">${analysis.suitability.longTerm}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">SIP</span>
            <span class="di-value">${analysis.suitability.sip}</span>
          </div>
        </div>` : ''}
        
        <div class="section-header modern">
          <span class="section-icon">🔍</span>
          <span>Analysis Reasons</span>
        </div>
        <ul class="reason-list modern">
          ${(analysis.reasons || []).map(r => `<li><span class="reason-bullet">•</span>${r}</li>`).join('')}
        </ul>
        
        <div id="mf-ai-plan-loading" class="loading-card" style="margin-top:12px;"><div class="loading-spinner"></div><span>Generating AI Trade Plan...</span></div>
      </div>`;
    detailContainer.innerHTML = html;

    // AI Trade Plan
    try {
      const { analysis: aiPlan } = await api.ai.analyzeMf(analysis);
      const planEl = document.getElementById('mf-ai-plan-loading');
      if (planEl) planEl.outerHTML = renderAIPlanGeneric(aiPlan, 'MF');
    } catch (e) {
      const planEl = document.getElementById('mf-ai-plan-loading');
      if (planEl) planEl.outerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>AI Trade Plan unavailable: ${e.message}</span></div>`;
    }
  } catch (e) {
    detailContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Analysis failed: ${e.message}</span></div>`;
  }
}

async function renderIpoTabData() {
  const container = document.getElementById('ipo-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Loading...</span></div>`;
    container.dataset.loaded = '1';
  }
  try {
    const list = await api.ipo.list();
    const rows = list.map(i => [i.name, i.status, i.price, i.close || i.listedAt || '—', i.exchange || '—']);
    const listed = list.filter(i => i.status === 'Listed' && typeof i.gain === 'string')
      .map(i => ({ ...i, gainNum: Number.parseFloat(i.gain) }))
      .filter(i => Number.isFinite(i.gainNum))
      .sort((a, b) => b.gainNum - a.gainNum);
    const open = list.filter(i => i.status === 'Open');
    const bestListed = listed[0];
    const bestOpen = open[0];
    
    const report = `
      <div class="analysis-card modern" style="margin-top:16px;">
        <div class="ac-header">
          <span class="ac-icon">📋</span>
          <span class="ac-title">AI-style IPO Report (Past + Present Snapshot)</span>
        </div>
        <div class="report-content">
          <div class="report-item">
            <span class="report-label">Past listing strength:</span>
            <span class="report-value">${bestListed ? `${bestListed.name} (${bestListed.gain})` : 'insufficient listed history'}</span>
          </div>
          <div class="report-item">
            <span class="report-label">Current opportunity:</span>
            <span class="report-value">${bestOpen ? `${bestOpen.name} (${bestOpen.price})` : 'No open IPO in list right now'}</span>
          </div>
          <div class="report-item">
            <span class="report-label">Decision framework:</span>
            <span class="report-value">prioritize profitability visibility, valuation comfort, and sector momentum; avoid overhyped subscription without fundamentals.</span>
          </div>
        </div>
        ${bestOpen ? `<button class="btn-action modern" onclick="analyzeIpoDetail('${bestOpen.name}')" style="margin-top:12px;">
          <span class="btn-icon">🔍</span>
          <span>Detailed Analysis</span>
        </button>` : ''}
      </div>`;
    
    const analyzeButtons = list.map(i =>
      `<button class="btn-action modern" onclick="analyzeIpoDetail('${i.name}')" style="margin:2px;">
        <span class="btn-icon">📊</span>
        <span>${i.name.split(' ')[0]}</span>
      </button>`
    ).join('');
    
    container.innerHTML = `
      <div class="table-container modern">
        ${renderBasicTable(['IPO', 'Status', 'Price Band', 'Close/Listed', 'Exchange'], rows)}
      </div>
      ${report}
      <div class="button-group" style="margin-top:12px;">${analyzeButtons}</div>
      <div id="ipo-detail-container"></div>`;
  } catch (e) {
    container.innerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>Unable to load IPO data.</span></div>`;
  }
}

async function analyzeIpoDetail(name) {
  const detailContainer = document.getElementById('ipo-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Analyzing IPO + AI Trade Plan loading...</span></div>`;
  try {
    const analysis = await api.ipo.analyze(name);
    const rec = analysis.recommendation || 'HOLD';
    const conf = analysis.confidence || 0;
    const recClass = rec === 'BUY' || rec === 'APPLY_LISTING_GAINS' || rec === 'APPLY_LONG_TERM' ? 'bull' : rec === 'AVOID' ? 'bear' : 'neutral';
    
    let html = `
      <div class="analysis-card modern" style="margin-top:16px;">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">📋</span>
            <span class="ac-title">${analysis.name}</span>
          </div>
          <span class="ac-badge modern ${recClass}">${rec} | Conf: ${conf}/10</span>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill ${recClass}" style="width: ${conf * 10}%"></div></div>
        
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>IPO Details</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Status</span>
            <span class="di-value">${analysis.status}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Sector</span>
            <span class="di-value">${analysis.sector}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Price Band</span>
            <span class="di-value">${analysis.price}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Issue Size</span>
            <span class="di-value">${analysis.issueSize}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Lot Size</span>
            <span class="di-value">${analysis.lotSize}</span>
          </div>
          ${analysis.gmp ? `<div class="data-item modern">
            <span class="di-label">GMP</span>
            <span class="di-value bull-text">₹${analysis.gmp}</span>
          </div>` : ''}
          ${analysis.gain ? `<div class="data-item modern">
            <span class="di-label">Listing Gain</span>
            <span class="di-value ${parseFloat(analysis.gain) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.gain}</span>
          </div>` : ''}
        </div>
        
        ${analysis.subscription ? `
        <div class="section-header modern">
          <span class="section-icon">📈</span>
          <span>Subscription</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">QIB</span>
            <span class="di-value">${analysis.subscription.qib}x</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">NII</span>
            <span class="di-value">${analysis.subscription.nii}x</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Retail</span>
            <span class="di-value">${analysis.subscription.retail}x</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Total</span>
            <span class="di-value">${analysis.subscription.total}x</span>
          </div>
        </div>` : ''}
        
        <div class="section-header modern">
          <span class="section-icon">🔍</span>
          <span>Analysis Reasons</span>
        </div>
        <ul class="reason-list modern">
          ${(analysis.reasons || []).map(r => `<li><span class="reason-bullet">•</span>${r}</li>`).join('')}
        </ul>
        
        <div id="ipo-ai-plan-loading" class="loading-card" style="margin-top:12px;"><div class="loading-spinner"></div><span>Generating AI Forensic Report...</span></div>
      </div>`;
    detailContainer.innerHTML = html;

    // AI Forensic Analysis
    try {
      const { analysis: aiPlan } = await api.ai.analyzeIpo(analysis);
      const planEl = document.getElementById('ipo-ai-plan-loading');
      if (planEl) planEl.outerHTML = renderAIPlanGeneric(aiPlan, 'IPO');
    } catch (e) {
      const planEl = document.getElementById('ipo-ai-plan-loading');
      if (planEl) planEl.outerHTML = `<div class="error-card"><span class="error-icon">⚠️</span><span>AI Forensic Report unavailable: ${e.message}</span></div>`;
    }
  } catch (e) {
    detailContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Analysis failed: ${e.message}</span></div>`;
  }
}


function renderRiskTabData() {
  const container = document.getElementById('tab-risk');
  if (!container) return;
  const capital = Number.parseFloat(document.getElementById('ai-capital-input')?.value || '100000');
  const maxRisk = Number.isFinite(capital) ? (capital * 0.02) : 2000;
  const sl05 = Number.isFinite(capital) ? Math.floor(maxRisk / (capital * 0.005 || 1)) : 0;
  const sl10 = Number.isFinite(capital) ? Math.floor(maxRisk / (capital * 0.01 || 1)) : 0;
  
  container.innerHTML = `
    <div class="analysis-card modern">
      <div class="ac-header">
        <span class="ac-icon">🛡️</span>
        <span class="ac-title">Risk Engine</span>
      </div>
      
      <div class="section-header modern">
        <span class="section-icon">📊</span>
        <span>Risk Parameters</span>
      </div>
      <div class="data-grid modern">
        <div class="data-item modern">
          <span class="di-label">Max Risk Per Trade (2%)</span>
          <span class="di-value">₹${maxRisk.toLocaleString('en-IN')}</span>
        </div>
        <div class="data-item modern">
          <span class="di-label">Daily Max Drawdown</span>
          <span class="di-value bear-text">₹${(maxRisk * 2).toLocaleString('en-IN')} (stop trading after hit)</span>
        </div>
        <div class="data-item modern">
          <span class="di-label">Consecutive Loss Cutoff</span>
          <span class="di-value">3 trades</span>
        </div>
        <div class="data-item modern">
          <span class="di-label">Position Sizing Formula</span>
          <span class="di-value">Qty = Risk / (Entry - StopLoss)</span>
        </div>
        <div class="data-item modern">
          <span class="di-label">Example Qty (0.5% SL)</span>
          <span class="di-value">${sl05} units (approx)</span>
        </div>
        <div class="data-item modern">
          <span class="di-label">Example Qty (1.0% SL)</span>
          <span class="di-value">${sl10} units (approx)</span>
        </div>
      </div>
      
      <div class="hint-box" style="margin-top:12px;">
        <span class="hint-icon">💡</span>
        <span>Best possibility improves when trend + volume + risk-reward align. If one is weak, reduce size or skip trade.</span>
      </div>
    </div>
    
    <div class="analysis-card modern" style="margin-top:20px;">
      <div class="ac-header">
        <span class="ac-icon">📈</span>
        <span class="ac-title">Portfolio Risk Assessment</span>
      </div>
      
      <div class="hint-box">
        <span class="hint-icon">💡</span>
        <span>Add positions to your portfolio to see risk assessment.</span>
      </div>
      
      <div id="portfolio-risk-form" style="margin-top:16px;">
        <div class="form-grid">
          <div class="input-group modern">
            <label>Position Symbol</label>
            <input type="text" id="risk-symbol" placeholder="e.g., RELIANCE.NS">
          </div>
          <div class="input-group modern">
            <label>Value (₹)</label>
            <input type="number" id="risk-value" placeholder="e.g., 50000">
          </div>
          <div class="input-group modern">
            <label>Sector</label>
            <select id="risk-sector">
              <option value="IT">IT</option>
              <option value="Banking">Banking</option>
              <option value="Energy">Energy</option>
              <option value="Auto">Auto</option>
              <option value="Pharma">Pharma</option>
              <option value="FMCG">FMCG</option>
              <option value="Metals">Metals</option>
              <option value="Crypto">Crypto</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="input-group modern">
            <label>Asset Class</label>
            <select id="risk-asset-class">
              <option value="EQUITY">Equity</option>
              <option value="CRYPTO">Crypto</option>
              <option value="MF">Mutual Fund</option>
            </select>
          </div>
        </div>
        <button class="btn-primary modern" onclick="addPortfolioPosition()" style="margin-top:12px;">
          <span class="btn-icon">➕</span>
          <span>Add Position</span>
        </button>
      </div>
      
      <div id="portfolio-list" style="margin-top:16px;"></div>
      <div id="portfolio-risk-result" style="margin-top:16px;"></div>
    </div>
  `;
  loadPortfolioFromStorage();
}

let portfolio = [];

function loadPortfolioFromStorage() {
  const saved = localStorage.getItem('indotrade_portfolio');
  if (saved) {
    try {
      portfolio = JSON.parse(saved);
      renderPortfolioList();
    } catch (e) { portfolio = []; }
  }
}

function savePortfolioToStorage() {
  localStorage.setItem('indotrade_portfolio', JSON.stringify(portfolio));
}

function addPortfolioPosition() {
  const symbol = document.getElementById('risk-symbol')?.value?.trim();
  const value = parseFloat(document.getElementById('risk-value')?.value);
  const sector = document.getElementById('risk-sector')?.value;
  const assetClass = document.getElementById('risk-asset-class')?.value;
  
  if (!symbol || !Number.isFinite(value) || value <= 0) {
    showToast('Please enter valid symbol and value', 'error');
    return;
  }
  
  portfolio.push({ symbol, value, sector, assetClass, volatility: 15 });
  savePortfolioToStorage();
  renderPortfolioList();
  
  // Clear inputs
  document.getElementById('risk-symbol').value = '';
  document.getElementById('risk-value').value = '';
}

function removePortfolioPosition(index) {
  portfolio.splice(index, 1);
  savePortfolioToStorage();
  renderPortfolioList();
}

function renderPortfolioList() {
  const listContainer = document.getElementById('portfolio-list');
  if (!listContainer) return;
  
  if (portfolio.length === 0) {
    listContainer.innerHTML = `<div class="hint-box"><span class="hint-icon">📭</span><span>No positions added yet.</span></div>`;
    return;
  }
  
  listContainer.innerHTML = `
    <div class="table-container modern">
      <table class="portfolio-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Value</th>
            <th>Sector</th>
            <th>Class</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${portfolio.map((p, i) => `
            <tr>
              <td><span class="symbol-badge">${p.symbol}</span></td>
              <td>₹${p.value.toLocaleString('en-IN')}</td>
              <td>${p.sector}</td>
              <td>${p.assetClass}</td>
              <td><button class="btn-action modern danger" onclick="removePortfolioPosition(${i})" style="padding:4px 10px; font-size:11px;">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn-primary modern" onclick="assessPortfolioRisk()" style="margin-top:12px;">
      <span class="btn-icon">📊</span>
      <span>Assess Portfolio Risk</span>
    </button>
  `;
}

async function assessPortfolioRisk() {
  const resultContainer = document.getElementById('portfolio-risk-result');
  if (!resultContainer) return;
  resultContainer.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><span>Assessing risk...</span></div>`;
  
  try {
    const capital = parseFloat(document.getElementById('ai-capital-input')?.value || '100000');
    const assessment = await api.risk.portfolio(portfolio, capital);
    
    const riskColor = assessment.riskLevel === 'HIGH' ? 'bear' : assessment.riskLevel === 'LOW' ? 'bull' : 'neutral';
    const riskIcon = assessment.riskLevel === 'HIGH' ? '🔴' : assessment.riskLevel === 'LOW' ? '🟢' : '🟡';
    
    resultContainer.innerHTML = `
      <div class="analysis-card modern">
        <div class="ac-header">
          <div class="ac-title-row">
            <span class="ac-icon">${riskIcon}</span>
            <span class="ac-title">Risk Assessment</span>
          </div>
          <span class="ac-badge modern ${riskColor}">Risk Level: ${assessment.riskLevel}</span>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill ${riskColor}" style="width: ${assessment.riskScore}%"></div></div>
        
        <div class="section-header modern">
          <span class="section-icon">📊</span>
          <span>Portfolio Metrics</span>
        </div>
        <div class="data-grid modern">
          <div class="data-item modern">
            <span class="di-label">Total Value</span>
            <span class="di-value">₹${assessment.totalValue?.toLocaleString('en-IN')}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Positions</span>
            <span class="di-value">${assessment.positions}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Max Position</span>
            <span class="di-value">${assessment.concentration?.maxWeight}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Concentration Risk</span>
            <span class="di-value ${assessment.concentration?.risk === 'HIGH' ? 'bear-text' : ''}">${assessment.concentration?.risk}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Sectors</span>
            <span class="di-value">${assessment.diversification?.sectors}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Sector Risk</span>
            <span class="di-value">${assessment.diversification?.sectorRisk}</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Avg Volatility</span>
            <span class="di-value">${assessment.volatility?.average}%</span>
          </div>
          <div class="data-item modern">
            <span class="di-label">Diversification Score</span>
            <span class="di-value">${assessment.diversification?.score}/100</span>
          </div>
        </div>
        
        ${assessment.stressTests?.length ? `
        <div class="section-header modern">
          <span class="section-icon">⚡</span>
          <span>Stress Test Scenarios</span>
        </div>
        <div class="data-grid modern">
          ${assessment.stressTests.map(s => `
            <div class="data-item modern">
              <span class="di-label">${s.scenario}</span>
              <span class="di-value bear-text">₹${Number(s.impact).toLocaleString('en-IN')}</span>
            </div>
          `).join('')}
        </div>` : ''}
        
        ${assessment.recommendations?.length ? `
        <div class="section-header modern">
          <span class="section-icon">💡</span>
          <span>Recommendations</span>
        </div>
        <ul class="reason-list modern">
          ${assessment.recommendations.map(r => `<li><span class="reason-bullet">•</span>${r}</li>`).join('')}
        </ul>` : ''}
      </div>`;
  } catch (e) {
    resultContainer.innerHTML = `<div class="error-card"><span class="error-icon">❌</span><span>Risk assessment failed: ${e.message}</span></div>`;
  }
}

async function renderAllTabData() {
  await Promise.all([
    renderEquityTabData(),
    renderFoTabData(),
    renderCryptoTabData(),
    renderMfTabData(),
    renderIpoTabData()
  ]);
  renderRiskTabData();
}

// App Initialization
async function initApp() {
  updateClock();
  setInterval(updateClock, REFRESH_INTERVAL_MS.clock);
  initTabs();

  // Watchlist & Global setup — each wrapped in try/catch so one failure doesn't break everything
  try { await renderWatchlist(); } catch (e) { console.error('renderWatchlist failed:', e); }
  try { fetchGlobals(); } catch (e) { console.error('fetchGlobals failed:', e); }
  try { renderHistory(); } catch (e) {}
  try { renderAllTabData(); } catch (e) { console.error('renderAllTabData failed:', e); }
  try { initWatchlist(); } catch (e) { console.error('initWatchlist failed:', e); }

  // Event Listeners
  document.getElementById('btn-generate-signal')?.addEventListener('click', generateSignal);
  document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    document.getElementById('signal-history-panel').classList.toggle('hidden');
  });
  window.addEventListener('indotrade:rate-limit', onRateLimit);

  // Auto Refresh Logic
  setInterval(() => {
    if (isPollPaused()) return;
    runLocked('equity', async () => {
      await updateEquityPrices();
      await fetchGlobals();
    });
  }, REFRESH_INTERVAL_MS.equity);
  
  setInterval(() => {
    if (isPollPaused()) return;
    runLocked('crypto', updateCryptoPrices);
  }, REFRESH_INTERVAL_MS.crypto);

  // Refresh secondary tab data
  setInterval(() => {
    if (isPollPaused()) return;
    runLocked('tabs', renderAllTabData);
  }, REFRESH_INTERVAL_MS.tabs);

  // Populate tab dropdowns
  populateEquitySelect();
  populateCryptoSelect();
}

// --- Tab-specific functions ---

function populateEquitySelect() {
  const sel = document.getElementById('equity-symbol-select');
  if (!sel) return;
  const symbols = (typeof EQUITY_WATCHLIST !== 'undefined' ? EQUITY_WATCHLIST : []).filter(s => !s.startsWith('^'));
  sel.innerHTML = '<option value="">Select Stock...</option>' +
    symbols.map(s => `<option value="${s}">${s.replace('.NS', '')}</option>`).join('');
}

function populateCryptoSelect() {
  const sel = document.getElementById('crypto-symbol-select');
  if (!sel) return;
  // Use crypto pairs from API or defaults
  const pairs = (typeof ALL_CRYPTO_PAIRS !== 'undefined' && ALL_CRYPTO_PAIRS.length > 0) ? ALL_CRYPTO_PAIRS :
    (typeof CRYPTO_WATCHLIST !== 'undefined' ? CRYPTO_WATCHLIST : ['BTC-INR', 'ETH-INR', 'SOL-INR']);
  sel.innerHTML = '<option value="">Select Coin...</option>' +
    pairs.map(s => `<option value="${s.split('-')[0].toLowerCase()}">${s.split('-')[0]}</option>`).join('');
}

async function analyzeEquityFromTab(symbol) {
  const container = document.getElementById('equity-detail-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Analyzing ' + symbol.replace('.NS', '') + ' + AI Trade Plan loading...</p>';
  try {
    // 1. Technical analysis
    const analysis = await api.equity.analyze(symbol);
    let html = '<div class="signal-card" style="margin-top:16px;">' +
      '<div class="signal-header"><div class="signal-badge ' + (analysis.recommendation || 'HOLD') + '">' + (analysis.recommendation || 'HOLD') + ' — ' + symbol.replace('.NS', '') + '</div>' +
      '<div class="sig-v">Conf: ' + (analysis.confidence || 0) + '/10</div></div>' +
      '<div class="signal-grid" style="margin-top:16px;">' +
      '<div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹' + (analysis.currentPrice || 0).toLocaleString('en-IN') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Day Change</span><span class="sig-v ' + (analysis.changePct >= 0 ? 'bull-text' : 'bear-text') + '">' + (analysis.changePct >= 0 ? '+' : '') + (analysis.changePct || 0) + '%</span></div>' +
      '<div class="sig-kv"><span class="sig-k">YTD</span><span class="sig-v">' + (analysis.performance?.ytd || '-') + '%</span></div>' +
      '<div class="sig-kv"><span class="sig-k">1M</span><span class="sig-v">' + (analysis.performance?.month || '-') + '%</span></div>' +
      '<div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">' + (analysis.indicators?.rsi?.toFixed(1) || '-') + ' (' + (analysis.indicators?.rsiSignal || '-') + ')</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">' + (analysis.indicators?.trend || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">' + (analysis.indicators?.macdCross || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Volume</span><span class="sig-v">' + (analysis.volumeAnalysis?.ratio || '-') + 'x</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Support</span><span class="sig-v">₹' + (analysis.levels?.support || 0).toLocaleString('en-IN') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Resistance</span><span class="sig-v">₹' + (analysis.levels?.resistance || 0).toLocaleString('en-IN') + '</span></div>' +
      '</div>';
    if (analysis.reasons && analysis.reasons.length > 0) {
      html += '<div style="margin-top:12px;"><div class="sig-k">Reasons</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
        analysis.reasons.map(r => '<li>' + r + '</li>').join('') + '</ul></div>';
    }
    html += '<div id="equity-ai-plan-loading" class="placeholder-text" style="margin-top:12px;">Generating AI Trade Plan...</div></div>';
    container.innerHTML = html;

    // 2. AI Trade Plan
    try {
      const ohlcv = analysis.ohlcv || [];
      const { signal } = await api.ai.analyze({ symbol, price: analysis.currentPrice || 0, ohlcv }, 'EQUITY', 100000);
      const planEl = document.getElementById('equity-ai-plan-loading');
      if (planEl) planEl.outerHTML = renderAITradePlanInline(signal);
    } catch (e) {
      const planEl = document.getElementById('equity-ai-plan-loading');
      if (planEl) planEl.outerHTML = '<p class="muted" style="margin-top:12px;">AI Trade Plan unavailable: ' + e.message + '</p>';
    }
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
  }
}

async function analyzeCryptoFromTab(coin) {
  const container = document.getElementById('crypto-detail-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Analyzing ' + coin.toUpperCase() + ' + AI Trade Plan loading...</p>';
  try {
    const analysis = await api.crypto.analyze(coin);
    let html = '<div class="signal-card" style="margin-top:16px;">' +
      '<div class="signal-header"><div class="signal-badge ' + (analysis.recommendation || 'HOLD') + '">' + (analysis.recommendation || 'HOLD') + ' — ' + (analysis.name || coin.toUpperCase()) + '</div>' +
      '<div class="sig-v">Conf: ' + (analysis.confidence || 0) + '/10</div></div>' +
      '<div class="signal-grid" style="margin-top:16px;">' +
      '<div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹' + (analysis.currentPrice || 0).toLocaleString('en-IN') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">24h Change</span><span class="sig-v ' + (analysis.change24h >= 0 ? 'bull-text' : 'bear-text') + '">' + (analysis.change24h >= 0 ? '+' : '') + (analysis.change24h || 0) + '%</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Volatility</span><span class="sig-v">' + (analysis.volatility || '-') + '%</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Liquidity</span><span class="sig-v">' + (analysis.liquidityScore || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">' + (analysis.indicators?.rsi?.toFixed(1) || '-') + ' (' + (analysis.indicators?.rsiSignal || '-') + ')</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">' + (analysis.indicators?.trend || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">' + (analysis.indicators?.macdCross || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Fear & Greed</span><span class="sig-v">' + (analysis.fearGreed?.current || '-') + ' (' + (analysis.fearGreed?.label || '-') + ')</span></div>' +
      '<div class="sig-kv"><span class="sig-k">BTC Dominance</span><span class="sig-v">' + (analysis.btcDominance || '-') + '%</span></div>' +
      '</div>';
    if (analysis.reasons && analysis.reasons.length > 0) {
      html += '<div style="margin-top:12px;"><div class="sig-k">Reasons</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
        analysis.reasons.map(r => '<li>' + r + '</li>').join('') + '</ul></div>';
    }
    html += '<div id="crypto-ai-plan-loading" class="placeholder-text" style="margin-top:12px;">Generating AI Trade Plan...</div></div>';
    container.innerHTML = html;

    try {
      const pairKey = coin.toUpperCase() + '-INR';
      const price = analysis.currentPrice || 0;
      const ohlcv = analysis.ohlcv || [];
      if (price > 0) {
        const { signal } = await api.ai.analyze({ symbol: pairKey, price, ohlcv, globalStats: analysis.globalStats || {} }, 'CRYPTO', 100000);
        const planEl = document.getElementById('crypto-ai-plan-loading');
        if (planEl) planEl.outerHTML = renderAITradePlanInline(signal);
      }
    } catch (e) {
      const planEl = document.getElementById('crypto-ai-plan-loading');
      if (planEl) planEl.outerHTML = '<p class="muted" style="margin-top:12px;">AI Trade Plan unavailable: ' + e.message + '</p>';
    }
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Analysis failed: ' + e.message + '</p>';
  }
}

async function loadRiskEngine() {
  const btn = document.getElementById('btn-risk-assess');
  const dataContainer = document.getElementById('risk-market-data');
  const assessContainer = document.getElementById('risk-assessment-container');
  if (!assessContainer) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Assessing... (15-30s)'; }

  try {
    const result = await api.ai.riskEngine();
    const md = result.marketData || {};
    const a = result.assessment || {};

    // Market data cards
    if (dataContainer) {
      dataContainer.innerHTML =
        '<div class="market-card"><div class="mc-label">NIFTY 50</div><div class="mc-value">' + (md.nifty || '-') + '</div></div>' +
        '<div class="market-card"><div class="mc-label">BANKNIFTY</div><div class="mc-value">' + (md.banknifty || '-') + '</div></div>' +
        '<div class="market-card"><div class="mc-label">India VIX</div><div class="mc-value">' + (md.indiaVIX || '-') + '</div></div>' +
        '<div class="market-card"><div class="mc-label">Crude Oil</div><div class="mc-value">' + (md.crudeOil || '-') + '</div></div>' +
        '<div class="market-card"><div class="mc-label">USD/INR</div><div class="mc-value">' + (md.usdInr || '-') + '</div></div>' +
        '<div class="market-card"><div class="mc-label">F&O Expiry</div><div class="mc-value">' + (md.fnoExpiry || '-') + '</div></div>';
    }

    // Risk assessment
    const riskScore = a.marketRiskScore || 5;
    const riskClass = riskScore > 7 ? 'SELL' : riskScore > 4 ? 'HOLD' : 'BUY';
    const recClass = a.recommendation === 'HOLD_CASH' || a.recommendation === 'HEDGE' ? 'SELL' : a.recommendation === 'AGGRESSIVE_BUY' ? 'BUY' : 'HOLD';

    assessContainer.innerHTML = '<div class="signal-card ' + riskClass + '">' +
      '<div class="signal-header">' +
      '<div class="signal-badge ' + recClass + '">' + (a.signal || 'NEUTRAL') + ' — ' + (a.recommendation || 'HOLD') + '</div>' +
      '<div class="sig-v">Risk Score: ' + riskScore + '/10</div>' +
      '</div>' +
      '<div class="signal-grid" style="margin-top:16px;">' +
      '<div class="sig-kv"><span class="sig-k">FII Flow</span><span class="sig-v">' + (a.fiiFlow || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">DII Flow</span><span class="sig-v">' + (a.diiFlow || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">RBI Stance</span><span class="sig-v">' + (a.rbiStance || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Fed Stance</span><span class="sig-v">' + (a.fedStance || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">VIX Signal</span><span class="sig-v">' + (a.vixAssessment || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">Crude Impact</span><span class="sig-v">' + (a.crudeOilImpact || '-') + '</span></div>' +
      '<div class="sig-kv"><span class="sig-k">NIFTY Outlook</span><span class="sig-v">' + (a.niftyOutlook || '-') + '</span></div>' +
      '</div>' +
      (a.expiryWarning ? '<div style="margin-top:12px;padding:8px 12px;background:rgba(255,68,102,0.1);border-radius:6px;"><span class="bear-text">' + a.expiryWarning + '</span></div>' : '') +
      (a.sectorRotation ? '<div style="margin-top:12px;"><div class="sig-k">Sector Rotation</div><div class="sig-v">Leading: ' + (a.sectorRotation[0] || '-') + ' | Lagging: ' + (a.sectorRotation[1] || '-') + '</div></div>' : '') +
      (a.riskFactors && a.riskFactors.length > 0 ? '<div style="margin-top:12px;"><div class="sig-k">Risk Factors</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' + a.riskFactors.map(r => '<li class="bear-text">' + r + '</li>').join('') + '</ul></div>' : '') +
      (a.historicalPrecedent && a.historicalPrecedent.length > 0 ? '<div style="margin-top:12px;"><div class="sig-k">Historical Precedent</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' + a.historicalPrecedent.map(h => '<li>' + h + '</li>').join('') + '</ul></div>' : '') +
      (a.actionableAdvice ? '<div style="margin-top:12px;padding:8px 12px;background:rgba(0,212,170,0.1);border-radius:6px;"><strong>Action:</strong> ' + a.actionableAdvice + '</div>' : '') +
      '</div>';
  } catch (e) {
    assessContainer.innerHTML = '<p class="bear-text">Risk assessment failed: ' + e.message + '</p>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Assess Market Risk'; }
}

function renderAITradePlanInline(s) {
  if (!s || s.signal === 'NO_SIGNAL') {
    return '<div class="analysis-card" style="margin-top:16px;border-left:3px solid var(--warn);">' +
      '<div class="ac-header"><span class="ac-title">AI Trade Plan (Llama)</span>' +
      '<span class="ac-badge HOLD">NO SIGNAL</span></div>' +
      '<p class="muted">No signal — insufficient confluences, neutral RSI zone, or risk/reward below 1:1.5.</p></div>';
  }
  var cls = s.signal === 'BUY' ? 'BUY' : s.signal === 'SELL' ? 'SELL' : 'HOLD';
  var ps = s.positionSizing || {};
  
  var html = '<div class="analysis-card" style="margin-top:16px;border-left:3px solid ' + (cls === 'BUY' ? 'var(--bull)' : cls === 'SELL' ? 'var(--bear)' : 'var(--warn)') + ';">' +
    '<div class="ac-header"><span class="ac-title">AI Trade Plan (Llama 3.3)</span>' +
    '<span class="ac-badge ' + cls + '">' + s.signal + ' | Conf: ' + (s.confidence || 0) + '/10</span></div>';

  // Trade Setup
  html += '<div class="section-header">Trade Setup</div>' +
    '<div class="data-grid">' +
    '<div class="data-item"><span class="di-label">Timeframe</span><span class="di-value">' + (s.timeframe || '-') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Best Window</span><span class="di-value">' + (s.bestWindow || '-') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Entry Zone</span><span class="di-value">₹' + (s.entryZone?.low || 0).toLocaleString('en-IN') + ' - ₹' + (s.entryZone?.high || 0).toLocaleString('en-IN') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Stop Loss</span><span class="di-value bear-text">₹' + (s.stopLoss || 0).toLocaleString('en-IN') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Target 1</span><span class="di-value bull-text">₹' + (s.target1 || 0).toLocaleString('en-IN') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Target 2</span><span class="di-value bull-text">₹' + (s.target2 || 0).toLocaleString('en-IN') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Risk/Reward</span><span class="di-value">' + (s.riskReward || '-') + '</span></div>' +
    '<div class="data-item"><span class="di-label">Invalidation</span><span class="di-value">₹' + (s.invalidation || 0).toLocaleString('en-IN') + '</span></div>' +
    '</div>';

  // Position Sizing
  if (ps && (ps.units || ps.totalCost)) {
    html += '<div class="section-header">Position Sizing (Capital: ₹' + (ps.totalCost ? Math.round(ps.totalCost / (ps.units || 1)).toLocaleString('en-IN') : '1,00,000') + ' risked)</div>' +
      '<div class="data-grid">' +
      '<div class="data-item"><span class="di-label">Units to Buy</span><span class="di-value bull-text">' + (ps.units || '-') + ' shares</span></div>' +
      '<div class="data-item"><span class="di-label">Entry Price</span><span class="di-value">₹' + (ps.entryPrice || '-').toLocaleString('en-IN') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Total Cost</span><span class="di-value">₹' + (ps.totalCost || '-').toLocaleString('en-IN') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Risk Amount</span><span class="di-value bear-text">₹' + (ps.riskAmount || '-').toLocaleString('en-IN') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Risk/Share</span><span class="di-value">₹' + (ps.riskPerShare || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Brokerage</span><span class="di-value muted">₹' + (ps.brokerage || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">STT + GST</span><span class="di-value muted">₹' + (ps.totalCharges || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Break Even</span><span class="di-value">₹' + (ps.breakEven || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">T1 Profit</span><span class="di-value bull-text">₹' + (ps.t1Profit || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">T2 Profit</span><span class="di-value bull-text">₹' + (ps.t2Profit || '-') + '</span></div>' +
      '<div class="data-item"><span class="di-label">Max Loss</span><span class="di-value bear-text">₹' + (ps.maxLoss || '-') + '</span></div>' +
      '</div>' +
      '<div class="action-box">Set <strong>' + (ps.units || 1) + ' units</strong> at entry <strong>₹' + (s.entryZone?.low || 0) + '-₹' + (s.entryZone?.high || 0) + '</strong>. Stop loss at <strong>₹' + (s.stopLoss || 0) + '</strong>. Take profit at <strong>₹' + (s.target1 || 0) + '</strong> (T1) and <strong>₹' + (s.target2 || 0) + '</strong> (T2).</div>';
  }

  // Confluences
  if (s.confluences && s.confluences.length > 0) {
    html += '<div class="section-header">Confluences (' + s.confluences.length + ')</div>' +
      '<ul class="reason-list">' + s.confluences.map(function(c) { return '<li>' + c + '</li>'; }).join('') + '</ul>';
  }

  // Bullish/Bearish Factors
  if (s.bullishFactors && s.bullishFactors.length > 0) {
    html += '<div class="section-header">Bullish Factors</div>' +
      '<ul class="reason-list">' + s.bullishFactors.map(function(b) { return '<li class="bull">' + b + '</li>'; }).join('') + '</ul>';
  }
  if (s.bearishFactors && s.bearishFactors.length > 0) {
    html += '<div class="section-header">Bearish Factors</div>' +
      '<ul class="reason-list">' + s.bearishFactors.map(function(b) { return '<li class="bear">' + b + '</li>'; }).join('') + '</ul>';
  }

  // Warnings
  if (s.riskWarnings && s.riskWarnings.length > 0) {
    html += '<div class="section-header">Warnings</div>' +
      '<ul class="reason-list">' + s.riskWarnings.map(function(w) { return '<li class="bear">' + w + '</li>'; }).join('') + '</ul>';
  }

  html += '</div>';
  return html;
}

function renderAIPlanGeneric(plan, type) {
  if (!plan || plan.error) {
    return '<div class="signal-card HOLD" style="margin-top:16px;"><div class="signal-badge HOLD">AI ' + type + ' Analysis</div><p class="muted" style="padding:8px 0;">No analysis available.</p></div>';
  }
  var decision = plan.decision || plan.signal || 'HOLD';
  var cls = decision === 'BUY' || decision === 'START_SIP' || decision === 'APPLY_LISTING_GAINS' || decision === 'APPLY_LONG_TERM' || decision === 'ACCUMULATE' ? 'BUY' :
            decision === 'AVOID' || decision === 'DUMP' ? 'SELL' : 'HOLD';
  
  var html = '<div class="signal-card ' + cls + '" style="margin-top:16px;">' +
    '<div class="signal-header"><div class="signal-badge ' + cls + '">AI ' + type + ': ' + decision + '</div><div class="sig-v">Conf: ' + (plan.confidence || 0) + '/10</div></div>';

  // Show key fields based on what's available
  html += '<div class="signal-grid" style="margin-top:12px;">';
  if (plan.conviction) html += '<div class="sig-kv"><span class="sig-k">Conviction</span><span class="sig-v">' + plan.conviction + '</span></div>';
  if (plan.idealHorizon) html += '<div class="sig-kv"><span class="sig-k">Ideal Horizon</span><span class="sig-v">' + plan.idealHorizon + '</span></div>';
  if (plan.sipVsLumpSum) html += '<div class="sig-kv"><span class="sig-k">SIP vs Lump</span><span class="sig-v">' + plan.sipVsLumpSum + '</span></div>';
  if (plan.listingPremiumEstimate) html += '<div class="sig-kv"><span class="sig-k">Listing Est.</span><span class="sig-v">' + plan.listingPremiumEstimate + '</span></div>';
  if (plan.fairValue) html += '<div class="sig-kv"><span class="sig-k">Fair Value</span><span class="sig-v">' + plan.fairValue + '</span></div>';
  if (plan.regulatoryRisk) html += '<div class="sig-kv"><span class="sig-k">Reg. Risk</span><span class="sig-v">' + plan.regulatoryRisk + '/10</span></div>';
  if (plan.probabilityOfSuccess) html += '<div class="sig-kv"><span class="sig-k">Success Prob</span><span class="sig-v">' + plan.probabilityOfSuccess + '</span></div>';
  html += '</div>';

  if (plan.strengths && plan.strengths.length > 0) {
    html += '<div style="margin-top:12px;"><div class="sig-k">Strengths</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
      plan.strengths.map(function(s) { return '<li class="bull-text">' + s + '</li>'; }).join('') + '</ul></div>';
  }
  if (plan.weaknesses && plan.weaknesses.length > 0) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Weaknesses</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
      plan.weaknesses.map(function(w) { return '<li class="bear-text">' + w + '</li>'; }).join('') + '</ul></div>';
  }
  if (plan.redFlags && plan.redFlags.length > 0) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Red Flags</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' +
      plan.redFlags.map(function(r) { return '<li class="bear-text">' + r + '</li>'; }).join('') + '</ul></div>';
  }
  if (plan.benchmarkComparison) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Benchmark</div><p style="font-size:12px;margin:4px 0;">' + plan.benchmarkComparison + '</p></div>';
  }
  if (plan.peerComparison) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Peer Comparison</div><p style="font-size:12px;margin:4px 0;">' + plan.peerComparison + '</p></div>';
  }
  if (plan.sectorOutlook) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Sector Outlook</div><p style="font-size:12px;margin:4px 0;">' + plan.sectorOutlook + '</p></div>';
  }
  if (plan.gmpAnalysis) {
    html += '<div style="margin-top:8px;"><div class="sig-k">GMP Analysis</div><p style="font-size:12px;margin:4px 0;">' + plan.gmpAnalysis + '</p></div>';
  }
  if (plan.marketCrashPerformance) {
    html += '<div style="margin-top:8px;"><div class="sig-k">Crash Performance</div><p style="font-size:12px;margin:4px 0;">' + plan.marketCrashPerformance + '</p></div>';
  }
  if (plan.actionableAdvice) {
    html += '<div style="margin-top:12px;padding:8px 12px;background:rgba(0,212,170,0.1);border-radius:6px;font-size:12px;"><strong>Action:</strong> ' + plan.actionableAdvice + '</div>';
  }
  html += '</div>';
  return html;
}

document.addEventListener('DOMContentLoaded', initApp);
