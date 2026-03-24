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
      const targetId = tab.getAttribute('data-tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      panes.forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById(`tab-${targetId}`);
      if (targetPane) targetPane.classList.add('active');
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
  const container = document.getElementById('tab-equity');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = '<h2>Equity Analysis</h2><p class="placeholder-text">Loading...</p>';
    container.dataset.loaded = '1';
  }
  try {
    const symbols = (typeof EQUITY_WATCHLIST !== 'undefined' ? EQUITY_WATCHLIST : ['^NSEI', '^BSESN']);
    const eqData = await api.equity.batch(symbols);
    const valid = eqData.filter(d => !d.error && Number.isFinite(Number(d.price)));
    const top = valid.slice(0, 12);
    const rows = top.map(d => {
      const pct = Number(d.changePct);
      const pctCell = Number.isFinite(pct)
        ? `<span class="${pct >= 0 ? 'bull-text' : 'bear-text'}">${pct >= 0 ? '+' : ''}${pct}%</span>`
        : '—';
      return [d.symbol.replace('.NS', ''), `₹${Number(d.price).toLocaleString('en-IN')}`, pctCell];
    });
    const buyable = valid.filter(d => Number(d.changePct) > 0).sort((a, b) => Number(b.changePct) - Number(a.changePct));
    const best = buyable[0];
    const detail = best
      ? `<div class="signal-card" style="margin-top:16px;">
          <div class="sig-k"><strong>Best possibility (momentum-based)</strong></div>
          <p><strong>${best.symbol.replace('.NS','')}</strong> at <strong>₹${Number(best.price).toLocaleString('en-IN')}</strong> with change <strong>${fmtPct(best.changePct)}</strong>.</p>
          <p>Reason: strongest positive session momentum among tracked equities. Wait for pullback near support before entry; keep stop-loss strict.</p>
          <button class="btn-action" onclick="analyzeEquityDetail('${best.symbol}')" style="margin-top:8px;">Detailed Analysis</button>
        </div>`
      : `<div class="signal-card" style="margin-top:16px;"><p>No strong positive momentum right now. Prefer HOLD / wait-for-setup.</p></div>`;

    container.innerHTML = `<h2>Equity Analysis</h2>${renderBasicTable(['Asset', 'Price', 'Change'], rows)}${detail}<div id="equity-detail-container"></div>`;
  } catch (e) {
    container.innerHTML = '<h2>Equity Analysis</h2><p class="bear-text">Unable to load equity data.</p>';
  }
}

async function analyzeEquityDetail(symbol) {
  const detailContainer = document.getElementById('equity-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = '<p class="placeholder-text">Analyzing...</p>';
  try {
    const analysis = await api.equity.analyze(symbol);
    const recClass = analysis.recommendation === 'BUY' ? 'bull-text' : analysis.recommendation === 'SELL' ? 'bear-text' : '';
    detailContainer.innerHTML = `
      <div class="signal-card" style="margin-top:16px;">
        <div class="signal-header">
          <div class="signal-badge ${analysis.recommendation}">${analysis.recommendation} — ${analysis.symbol}</div>
          <div class="sig-v">Conf: ${analysis.confidence}/10</div>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${analysis.confidence * 10}%"></div></div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Current Price</span><span class="sig-v">₹${analysis.currentPrice?.toLocaleString('en-IN')}</span></div>
          <div class="sig-kv"><span class="sig-k">Day Change</span><span class="sig-v ${analysis.changePct >= 0 ? 'bull-text' : 'bear-text'}">${analysis.changePct >= 0 ? '+' : ''}${analysis.changePct}%</span></div>
          <div class="sig-kv"><span class="sig-k">YTD Return</span><span class="sig-v">${analysis.performance?.ytd}%</span></div>
          <div class="sig-kv"><span class="sig-k">1M Return</span><span class="sig-v">${analysis.performance?.month}%</span></div>
          <div class="sig-kv"><span class="sig-k">Volatility (ATR%)</span><span class="sig-v">${analysis.volatility?.pct}%</span></div>
          <div class="sig-kv"><span class="sig-k">Volume Ratio</span><span class="sig-v">${analysis.volumeAnalysis?.ratio}x</span></div>
          <div class="sig-kv"><span class="sig-k">Support</span><span class="sig-v">₹${analysis.levels?.support?.toLocaleString('en-IN')}</span></div>
          <div class="sig-kv"><span class="sig-k">Resistance</span><span class="sig-v">₹${analysis.levels?.resistance?.toLocaleString('en-IN')}</span></div>
        </div>
        ${analysis.indicators ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Technical Indicators</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">${analysis.indicators.rsi} (${analysis.indicators.rsiSignal})</span></div>
            <div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">${analysis.indicators.trend}</span></div>
            <div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">${analysis.indicators.macdCross}</span></div>
            <div class="sig-kv"><span class="sig-k">BB Position</span><span class="sig-v">${analysis.indicators.bbPosition}</span></div>
          </div>
        </div>` : ''}
        <div class="confluences-list" style="margin-top:16px;">
          <div class="sig-k">Analysis Reasons</div>
          <ul>${(analysis.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
}

async function renderFoTabData() {
  const title = document.getElementById('fo-expiry-warning');
  const container = document.getElementById('fo-info-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = '<p class="placeholder-text">Loading...</p>';
    container.dataset.loaded = '1';
  }
  try {
    const info = await api.fo.info();
    if (title) title.innerText = info.expiryWarning || 'F&O Options Analysis';
    const rows = [
      ['Expiry Date', info.expiryDate || '—'],
      ['Days To Expiry', Number.isFinite(Number(info.daysToExpiry)) ? info.daysToExpiry : '—'],
      ['NIFTY', Number.isFinite(Number(info.nifty)) ? `₹${Number(info.nifty).toLocaleString('en-IN')}` : '—'],
      ['BANKNIFTY', Number.isFinite(Number(info.banknifty)) ? `₹${Number(info.banknifty).toLocaleString('en-IN')}` : '—']
    ];
    const guidance = info.isExpiryWeek
      ? '<p class="bear-text" style="margin-top:10px;">Expiry week risk is high. Reduce position size by 40-50%, avoid revenge trades.</p>'
      : '<p style="margin-top:10px;">Non-expiry week: normal volatility profile. Use strict RR >= 1:1.5.</p>';
    
    const analyzeButtons = `
      <div style="margin-top:16px;">
        <button class="btn-action" onclick="analyzeFoDetail('NIFTY')" style="margin-right:8px;">Analyze NIFTY Options</button>
        <button class="btn-action" onclick="analyzeFoDetail('BANKNIFTY')">Analyze BANKNIFTY Options</button>
      </div>
    `;
    
    container.innerHTML = renderBasicTable(['Metric', 'Value'], rows) + guidance + analyzeButtons + '<div id="fo-detail-container"></div>';
  } catch (e) {
    if (title) title.innerText = 'F&O Options Analysis';
    container.innerHTML = '<p class="bear-text">Unable to load F&O data.</p>';
  }
}

async function analyzeFoDetail(symbol) {
  const detailContainer = document.getElementById('fo-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = '<p class="placeholder-text">Analyzing options chain...</p>';
  try {
    const analysis = await api.fo.analyze(symbol);
    const strategyClass = analysis.strategy?.type === 'BULLISH' ? 'bull-text' : analysis.strategy?.type === 'BEARISH' ? 'bear-text' : '';
    
    let optionsChainHtml = '';
    if (analysis.optionsChain && analysis.optionsChain.length > 0) {
      optionsChainHtml = `
        <div style="margin-top:16px; overflow-x:auto;">
          <div class="sig-k">Options Chain (ATM ± 5 strikes)</div>
          <table style="width:100%; font-size:12px; margin-top:8px;">
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
              ${analysis.optionsChain.map(o => `
                <tr style="${o.strike === analysis.maxPain ? 'background:rgba(255,200,0,0.1);' : ''}">
                  <td>${(o.call.oi/1000).toFixed(0)}K</td>
                  <td>₹${o.call.price}</td>
                  <td>${o.call.greeks.delta}</td>
                  <td><strong>${o.strike}</strong>${o.strike === analysis.maxPain ? ' ⭐' : ''}</td>
                  <td>${o.put.greeks.delta}</td>
                  <td>₹${o.put.price}</td>
                  <td>${(o.put.oi/1000).toFixed(0)}K</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="font-size:11px; margin-top:4px;">⭐ = Max Pain strike</p>
        </div>
      `;
    }
    
    detailContainer.innerHTML = `
      <div class="signal-card" style="margin-top:16px;">
        <div class="signal-header">
          <div class="signal-badge ${analysis.strategy?.type}">${analysis.strategy?.type} — ${analysis.symbol}</div>
          <div class="sig-v">IV: ${analysis.iv}%</div>
        </div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Spot Price</span><span class="sig-v">₹${analysis.currentPrice?.toLocaleString('en-IN')}</span></div>
          <div class="sig-kv"><span class="sig-k">Expiry</span><span class="sig-v">${analysis.expiryDate}</span></div>
          <div class="sig-kv"><span class="sig-k">Days to Expiry</span><span class="sig-v">${analysis.daysToExpiry}</span></div>
          <div class="sig-kv"><span class="sig-k">PCR</span><span class="sig-v">${analysis.pcr}</span></div>
          <div class="sig-kv"><span class="sig-k">Max Pain</span><span class="sig-v">₹${analysis.maxPain}</span></div>
          <div class="sig-kv"><span class="sig-k">IV</span><span class="sig-v">${analysis.iv}%</span></div>
        </div>
        <div style="margin-top:16px;">
          <div class="sig-k">Strategy: <span class="${strategyClass}">${analysis.strategy?.type}</span></div>
          <p>${analysis.strategy?.reason}</p>
        </div>
        ${analysis.riskWarning ? `<p class="bear-text" style="margin-top:8px;">⚠️ ${analysis.riskWarning}</p>` : ''}
        ${optionsChainHtml}
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
}

async function renderCryptoTabData() {
  const container = document.getElementById('crypto-global-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = '<p class="placeholder-text">Loading...</p>';
    container.dataset.loaded = '1';
  }
  try {
    const [global, all] = await Promise.all([api.crypto.global(), api.crypto.all()]);
    const topPairs = (all || []).filter(x => !x.error).slice(0, 8).map(x => {
      const p = Number.parseFloat(x.market || x.buy);
      return [x.pair, Number.isFinite(p) ? `₹${p.toLocaleString('en-IN')}` : '—'];
    });
    const summaryRows = [
      ['Market Cap (USD)', global.marketCap ? Number(global.marketCap).toLocaleString('en-US') : '—'],
      ['24h Volume (USD)', global.totalVolume ? Number(global.totalVolume).toLocaleString('en-US') : '—'],
      ['BTC Dominance', Number.isFinite(Number(global.btcDominance)) ? `${global.btcDominance}%` : '—'],
      ['Fear & Greed', `${global.fearGreed ?? '—'} ${global.fearGreedLabel ? `(${global.fearGreedLabel})` : ''}`]
    ];
    const best = (all || [])
      .filter(x => !x.error && Number.isFinite(Number.parseFloat(x.pricechange)))
      .sort((a, b) => Number.parseFloat(b.pricechange) - Number.parseFloat(a.pricechange))[0];
    const bestBlock = best
      ? `<div class="signal-card" style="margin-top:16px;">
          <div class="sig-k"><strong>Best crypto possibility (trend snapshot)</strong></div>
          <p><strong>${best.pair}</strong> is showing <strong>${fmtPct(best.pricechange)}</strong> move.</p>
          <p>If BTC dominance is high, prefer BTC/ETH over high-beta alts. Use staggered entries and strict stop-loss.</p>
          <button class="btn-action" onclick="analyzeCryptoDetail('${best.pair.split('-')[0].toLowerCase()}')" style="margin-top:8px;">Detailed Analysis</button>
        </div>`
      : '';
    
    const topCoins = (all || []).filter(x => !x.error)
      .sort((a, b) => Number.parseFloat(b.volumeQt || 0) - Number.parseFloat(a.volumeQt || 0))
      .slice(0, 6);
    const analyzeButtons = topCoins.length > 0
      ? `<div style="margin-top:16px;">${topCoins.map(c =>
          `<button class="btn-action" onclick="analyzeCryptoDetail('${c.pair.split('-')[0].toLowerCase()}')" style="margin-right:4px;">${c.pair.split('-')[0]}</button>`
        ).join('')}</div>`
      : '';
    
    container.innerHTML =
      `<h3>Global Market</h3>${renderBasicTable(['Metric', 'Value'], summaryRows)}
       <h3 style="margin-top:16px;">Top INR Pairs</h3>${renderBasicTable(['Pair', 'Price'], topPairs)}${bestBlock}
       ${analyzeButtons}<div id="crypto-detail-container"></div>`;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load crypto data.</p>';
  }
}

async function analyzeCryptoDetail(coin) {
  const detailContainer = document.getElementById('crypto-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = '<p class="placeholder-text">Analyzing crypto...</p>';
  try {
    const analysis = await api.crypto.analyze(coin);
    const recClass = analysis.recommendation === 'BUY' ? 'bull-text' : analysis.recommendation === 'SELL' ? 'bear-text' : '';
    
    detailContainer.innerHTML = `
      <div class="signal-card" style="margin-top:16px;">
        <div class="signal-header">
          <div class="signal-badge ${analysis.recommendation}">${analysis.recommendation} — ${analysis.name || analysis.symbol}</div>
          <div class="sig-v">Conf: ${analysis.confidence}/10</div>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${analysis.confidence * 10}%"></div></div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Price</span><span class="sig-v">₹${analysis.currentPrice?.toLocaleString('en-IN')}</span></div>
          <div class="sig-kv"><span class="sig-k">24h Change</span><span class="sig-v ${analysis.change24h >= 0 ? 'bull-text' : 'bear-text'}">${analysis.change24h >= 0 ? '+' : ''}${analysis.change24h}%</span></div>
          <div class="sig-kv"><span class="sig-k">Volatility</span><span class="sig-v">${analysis.volatility}%</span></div>
          <div class="sig-kv"><span class="sig-k">Liquidity</span><span class="sig-v">${analysis.liquidityScore}</span></div>
          <div class="sig-kv"><span class="sig-k">BTC Dominance</span><span class="sig-v">${analysis.btcDominance}%</span></div>
          <div class="sig-kv"><span class="sig-k">Fear & Greed</span><span class="sig-v">${analysis.fearGreed?.current} (${analysis.fearGreed?.label})</span></div>
        </div>
        ${analysis.onChain ? `
        <div style="margin-top:16px;">
          <div class="sig-k">On-Chain Metrics</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">Market Cap Rank</span><span class="sig-v">#${analysis.onChain.marketCapRank}</span></div>
            <div class="sig-kv"><span class="sig-k">Supply Ratio</span><span class="sig-v">${analysis.onChain.supplyRatio || 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">ATH</span><span class="sig-v">₹${analysis.onChain.ath?.toLocaleString('en-IN')}</span></div>
            <div class="sig-kv"><span class="sig-k">ATH Change</span><span class="sig-v">${analysis.onChain.athChange?.toFixed(1)}%</span></div>
          </div>
        </div>` : ''}
        ${analysis.indicators ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Technical Indicators</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">RSI</span><span class="sig-v">${analysis.indicators.rsi} (${analysis.indicators.rsiSignal})</span></div>
            <div class="sig-kv"><span class="sig-k">Trend</span><span class="sig-v">${analysis.indicators.trend}</span></div>
            <div class="sig-kv"><span class="sig-k">MACD</span><span class="sig-v">${analysis.indicators.macdCross}</span></div>
          </div>
        </div>` : ''}
        <div class="confluences-list" style="margin-top:16px;">
          <div class="sig-k">Analysis Reasons</div>
          <ul>${(analysis.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
}

async function renderMfTabData() {
  const container = document.getElementById('mf-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = '<p class="placeholder-text">Loading...</p>';
    container.dataset.loaded = '1';
  }
  try {
    const data = await api.mf.watchlist();
    const rows = data.map(f => {
      if (f.error) return [f.name || f.code, '—', '—', '—'];
      const nav = Number.parseFloat(f.nav);
      const chg = Number.parseFloat(f.change);
      const chgCell = Number.isFinite(chg)
        ? `<span class="${chg >= 0 ? 'bull-text' : 'bear-text'}">${chg >= 0 ? '+' : ''}${chg.toFixed(4)}</span>`
        : '—';
      return [f.name, Number.isFinite(nav) ? nav.toFixed(4) : '—', f.date || '—', chgCell];
    });
    const ranked = data
      .filter(f => !f.error && Number.isFinite(Number(f.change)))
      .sort((a, b) => Number(b.change) - Number(a.change));
    const best = ranked[0];
    const note = best
      ? `<div class="signal-card" style="margin-top:16px;">
          <div class="sig-k"><strong>Best MF possibility (watchlist momentum)</strong></div>
          <p><strong>${best.name}</strong> has strongest latest NAV delta (<strong>${Number(best.change).toFixed(4)}</strong>).</p>
          <p>MF is long-horizon. Prefer SIP/STP style entries over lump-sum chasing one-day moves.</p>
          <button class="btn-action" onclick="analyzeMfDetail('${best.code}')" style="margin-top:8px;">Detailed Analysis</button>
        </div>`
      : '<p class="bear-text" style="margin-top:10px;">MF API data delayed/unavailable. Retrying automatically.</p>';
    
    const analyzeButtons = data.filter(f => !f.error).map(f => 
      `<button class="btn-action" onclick="analyzeMfDetail('${f.code}')" style="margin:2px;">${f.name.split(' ')[0]}</button>`
    ).join('');
    
    container.innerHTML = renderBasicTable(['Fund', 'NAV', 'Date', 'Change'], rows) + note + 
      `<div style="margin-top:12px;">${analyzeButtons}</div><div id="mf-detail-container"></div>`;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load mutual fund data.</p>';
  }
}

async function analyzeMfDetail(code) {
  const detailContainer = document.getElementById('mf-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = '<p class="placeholder-text">Analyzing fund...</p>';
  try {
    const analysis = await api.mf.analyze(code);
    const recClass = analysis.recommendation === 'BUY' ? 'bull-text' : analysis.recommendation === 'AVOID' ? 'bear-text' : '';
    
    detailContainer.innerHTML = `
      <div class="signal-card" style="margin-top:16px;">
        <div class="signal-header">
          <div class="signal-badge ${analysis.recommendation}">${analysis.recommendation} — ${analysis.name}</div>
          <div class="sig-v">Conf: ${analysis.confidence}/10</div>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${analysis.confidence * 10}%"></div></div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Category</span><span class="sig-v">${analysis.category}</span></div>
          <div class="sig-kv"><span class="sig-k">Risk Level</span><span class="sig-v">${analysis.riskLevel}</span></div>
          <div class="sig-kv"><span class="sig-k">NAV</span><span class="sig-v">${analysis.currentNAV}</span></div>
          <div class="sig-kv"><span class="sig-k">Volatility</span><span class="sig-v">${analysis.volatility}%</span></div>
          <div class="sig-kv"><span class="sig-k">Sharpe Ratio</span><span class="sig-v">${analysis.sharpeRatio || 'N/A'}</span></div>
          <div class="sig-kv"><span class="sig-k">Max Drawdown</span><span class="sig-v">${analysis.maxDrawdown}%</span></div>
          <div class="sig-kv"><span class="sig-k">Consistency</span><span class="sig-v">${analysis.consistency || 'N/A'}%</span></div>
        </div>
        <div style="margin-top:16px;">
          <div class="sig-k">Returns</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">1 Week</span><span class="sig-v ${analysis.returns?.['1w'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1w'] ?? 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">1 Month</span><span class="sig-v ${analysis.returns?.['1m'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1m'] ?? 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">3 Months</span><span class="sig-v ${analysis.returns?.['3m'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['3m'] ?? 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">1 Year</span><span class="sig-v ${analysis.returns?.['1y'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['1y'] ?? 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">3 Years</span><span class="sig-v ${analysis.returns?.['3y'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['3y'] ?? 'N/A'}%</span></div>
            <div class="sig-kv"><span class="sig-k">5 Years</span><span class="sig-v ${analysis.returns?.['5y'] >= 0 ? 'bull-text' : 'bear-text'}">${analysis.returns?.['5y'] ?? 'N/A'}%</span></div>
          </div>
        </div>
        ${analysis.suitability ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Suitability</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">Short Term</span><span class="sig-v">${analysis.suitability.shortTerm}</span></div>
            <div class="sig-kv"><span class="sig-k">Long Term</span><span class="sig-v">${analysis.suitability.longTerm}</span></div>
            <div class="sig-kv"><span class="sig-k">SIP</span><span class="sig-v">${analysis.suitability.sip}</span></div>
          </div>
        </div>` : ''}
        <div class="confluences-list" style="margin-top:16px;">
          <div class="sig-k">Analysis Reasons</div>
          <ul>${(analysis.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
  }
}

async function renderIpoTabData() {
  const container = document.getElementById('ipo-container');
  if (!container) return;
  if (!container.dataset.loaded) {
    container.innerHTML = '<p class="placeholder-text">Loading...</p>';
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
      <div class="signal-card" style="margin-top:16px;">
        <div class="sig-k"><strong>AI-style IPO report (past + present snapshot)</strong></div>
        <p><strong>Past listing strength:</strong> ${bestListed ? `${bestListed.name} (${bestListed.gain})` : 'insufficient listed history'}.</p>
        <p><strong>Current opportunity:</strong> ${bestOpen ? `${bestOpen.name} (${bestOpen.price})` : 'No open IPO in list right now'}.</p>
        <p><strong>Decision framework:</strong> prioritize profitability visibility, valuation comfort, and sector momentum; avoid overhyped subscription without fundamentals.</p>
        ${bestOpen ? `<button class="btn-action" onclick="analyzeIpoDetail('${bestOpen.name}')" style="margin-top:8px;">Detailed Analysis</button>` : ''}
      </div>`;
    
    const analyzeButtons = list.map(i => 
      `<button class="btn-action" onclick="analyzeIpoDetail('${i.name}')" style="margin:2px;">${i.name.split(' ')[0]}</button>`
    ).join('');
    
    container.innerHTML = renderBasicTable(['IPO', 'Status', 'Price Band', 'Close/Listed', 'Exchange'], rows) + report + 
      `<div style="margin-top:12px;">${analyzeButtons}</div><div id="ipo-detail-container"></div>`;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load IPO data.</p>';
  }
}

async function analyzeIpoDetail(name) {
  const detailContainer = document.getElementById('ipo-detail-container');
  if (!detailContainer) return;
  detailContainer.innerHTML = '<p class="placeholder-text">Analyzing IPO...</p>';
  try {
    const analysis = await api.ipo.analyze(name);
    const recClass = analysis.recommendation === 'SUBSCRIBE' || analysis.recommendation === 'BUY' ? 'bull-text' : 
                     analysis.recommendation === 'AVOID' ? 'bear-text' : '';
    
    detailContainer.innerHTML = `
      <div class="signal-card" style="margin-top:16px;">
        <div class="signal-header">
          <div class="signal-badge ${analysis.recommendation}">${analysis.recommendation} — ${analysis.name}</div>
          <div class="sig-v">Conf: ${analysis.confidence}/10</div>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${analysis.confidence * 10}%"></div></div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Status</span><span class="sig-v">${analysis.status}</span></div>
          <div class="sig-kv"><span class="sig-k">Sector</span><span class="sig-v">${analysis.sector}</span></div>
          <div class="sig-kv"><span class="sig-k">Price Band</span><span class="sig-v">${analysis.price}</span></div>
          <div class="sig-kv"><span class="sig-k">Issue Size</span><span class="sig-v">${analysis.issueSize}</span></div>
          <div class="sig-kv"><span class="sig-k">Lot Size</span><span class="sig-v">${analysis.lotSize}</span></div>
          ${analysis.gmp ? `<div class="sig-kv"><span class="sig-k">GMP</span><span class="sig-v bull-text">₹${analysis.gmp}</span></div>` : ''}
          ${analysis.gain ? `<div class="sig-kv"><span class="sig-k">Listing Gain</span><span class="sig-v ${parseFloat(analysis.gain) >= 0 ? 'bull-text' : 'bear-text'}">${analysis.gain}</span></div>` : ''}
        </div>
        ${analysis.subscription ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Subscription Status</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">QIB</span><span class="sig-v">${analysis.subscription.qib}x</span></div>
            <div class="sig-kv"><span class="sig-k">NII</span><span class="sig-v">${analysis.subscription.nii}x</span></div>
            <div class="sig-kv"><span class="sig-k">Retail</span><span class="sig-v">${analysis.subscription.retail}x</span></div>
            <div class="sig-kv"><span class="sig-k">Total</span><span class="sig-v">${analysis.subscription.total}x</span></div>
          </div>
        </div>` : ''}
        ${analysis.financials ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Financials</div>
          <div class="signal-grid">
            <div class="sig-kv"><span class="sig-k">Revenue</span><span class="sig-v">${analysis.financials.revenue}</span></div>
            <div class="sig-kv"><span class="sig-k">Profit</span><span class="sig-v">${analysis.financials.profit}</span></div>
            <div class="sig-kv"><span class="sig-k">P/E</span><span class="sig-v">${analysis.financials.pe || 'N/A'}</span></div>
            <div class="sig-kv"><span class="sig-k">ROE</span><span class="sig-v">${analysis.financials.roe}%</span></div>
          </div>
        </div>` : ''}
        ${analysis.strengths?.length ? `
        <div style="margin-top:16px;">
          <div class="sig-k bull-text">Strengths</div>
          <ul>${analysis.strengths.map(s => `<li class="bull-text">${s}</li>`).join('')}</ul>
        </div>` : ''}
        ${analysis.risks?.length ? `
        <div style="margin-top:16px;">
          <div class="sig-k bear-text">Risks</div>
          <ul>${analysis.risks.map(r => `<li class="bear-text">${r}</li>`).join('')}</ul>
        </div>` : ''}
        <div class="confluences-list" style="margin-top:16px;">
          <div class="sig-k">Analysis Reasons</div>
          <ul>${(analysis.reasons || []).map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>`;
  } catch (e) {
    detailContainer.innerHTML = `<p class="bear-text">Analysis failed: ${e.message}</p>`;
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
    <h2>Risk Engine</h2>
    <div class="signal-card">
      <div class="sig-kv"><span class="sig-k">Max Risk Per Trade (2%)</span><span class="sig-v">₹${maxRisk.toLocaleString('en-IN')}</span></div>
      <div class="sig-kv"><span class="sig-k">Daily Max Drawdown</span><span class="sig-v">₹${(maxRisk * 2).toLocaleString('en-IN')} (stop trading after hit)</span></div>
      <div class="sig-kv"><span class="sig-k">Consecutive Loss Cutoff</span><span class="sig-v">3 trades</span></div>
      <div class="sig-kv"><span class="sig-k">Position Sizing Formula</span><span class="sig-v">Qty = Risk / (Entry - StopLoss)</span></div>
      <div class="sig-kv"><span class="sig-k">Example Qty (0.5% SL)</span><span class="sig-v">${sl05} units (approx)</span></div>
      <div class="sig-kv"><span class="sig-k">Example Qty (1.0% SL)</span><span class="sig-v">${sl10} units (approx)</span></div>
      <p style="margin-top:10px;">Best possibility improves when trend + volume + risk-reward align. If one is weak, reduce size or skip trade.</p>
    </div>
    <div style="margin-top:20px;">
      <h3>Portfolio Risk Assessment</h3>
      <p class="placeholder-text">Add positions to your portfolio to see risk assessment.</p>
      <div id="portfolio-risk-form" style="margin-top:12px;">
        <div class="input-group">
          <label>Position Symbol</label>
          <input type="text" id="risk-symbol" placeholder="e.g., RELIANCE.NS">
        </div>
        <div class="input-group">
          <label>Value (₹)</label>
          <input type="number" id="risk-value" placeholder="e.g., 50000">
        </div>
        <div class="input-group">
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
        <div class="input-group">
          <label>Asset Class</label>
          <select id="risk-asset-class">
            <option value="EQUITY">Equity</option>
            <option value="CRYPTO">Crypto</option>
            <option value="MF">Mutual Fund</option>
          </select>
        </div>
        <button class="btn-primary" onclick="addPortfolioPosition()" style="margin-top:8px;">Add Position</button>
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
    listContainer.innerHTML = '<p class="muted">No positions added yet.</p>';
    return;
  }
  
  listContainer.innerHTML = `
    <table style="width:100%; font-size:13px;">
      <thead><tr><th>Symbol</th><th>Value</th><th>Sector</th><th>Class</th><th></th></tr></thead>
      <tbody>
        ${portfolio.map((p, i) => `
          <tr>
            <td>${p.symbol}</td>
            <td>₹${p.value.toLocaleString('en-IN')}</td>
            <td>${p.sector}</td>
            <td>${p.assetClass}</td>
            <td><button class="btn-action" onclick="removePortfolioPosition(${i})" style="padding:2px 8px; font-size:11px;">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="btn-primary" onclick="assessPortfolioRisk()" style="margin-top:12px;">Assess Portfolio Risk</button>
  `;
}

async function assessPortfolioRisk() {
  const resultContainer = document.getElementById('portfolio-risk-result');
  if (!resultContainer) return;
  resultContainer.innerHTML = '<p class="placeholder-text">Assessing risk...</p>';
  
  try {
    const capital = parseFloat(document.getElementById('ai-capital-input')?.value || '100000');
    const assessment = await api.risk.portfolio(portfolio, capital);
    
    const riskColor = assessment.riskLevel === 'HIGH' ? 'bear-text' : assessment.riskLevel === 'LOW' ? 'bull-text' : '';
    
    resultContainer.innerHTML = `
      <div class="signal-card">
        <div class="signal-header">
          <div class="signal-badge ${assessment.riskLevel}">Risk Level: ${assessment.riskLevel}</div>
          <div class="sig-v">Score: ${assessment.riskScore}/100</div>
        </div>
        <div class="confidence-bar-bg"><div class="confidence-bar-fill ${riskColor}" style="width: ${assessment.riskScore}%"></div></div>
        <div class="signal-grid" style="margin-top:16px;">
          <div class="sig-kv"><span class="sig-k">Total Value</span><span class="sig-v">₹${assessment.totalValue?.toLocaleString('en-IN')}</span></div>
          <div class="sig-kv"><span class="sig-k">Positions</span><span class="sig-v">${assessment.positions}</span></div>
          <div class="sig-kv"><span class="sig-k">Max Position</span><span class="sig-v">${assessment.concentration?.maxWeight}%</span></div>
          <div class="sig-kv"><span class="sig-k">Concentration Risk</span><span class="sig-v ${assessment.concentration?.risk === 'HIGH' ? 'bear-text' : ''}">${assessment.concentration?.risk}</span></div>
          <div class="sig-kv"><span class="sig-k">Sectors</span><span class="sig-v">${assessment.diversification?.sectors}</span></div>
          <div class="sig-kv"><span class="sig-k">Sector Risk</span><span class="sig-v">${assessment.diversification?.sectorRisk}</span></div>
          <div class="sig-kv"><span class="sig-k">Avg Volatility</span><span class="sig-v">${assessment.volatility?.average}%</span></div>
          <div class="sig-kv"><span class="sig-k">Diversification Score</span><span class="sig-v">${assessment.diversification?.score}/100</span></div>
        </div>
        ${assessment.stressTests?.length ? `
        <div style="margin-top:16px;">
          <div class="sig-k">Stress Test Scenarios</div>
          <div class="signal-grid">
            ${assessment.stressTests.map(s => `
              <div class="sig-kv"><span class="sig-k">${s.scenario}</span><span class="sig-v bear-text">₹${Number(s.impact).toLocaleString('en-IN')}</span></div>
            `).join('')}
          </div>
        </div>` : ''}
        ${assessment.recommendations?.length ? `
        <div class="confluences-list" style="margin-top:16px;">
          <div class="sig-k">Recommendations</div>
          <ul>${assessment.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>` : ''}
      </div>`;
  } catch (e) {
    resultContainer.innerHTML = `<p class="bear-text">Risk assessment failed: ${e.message}</p>`;
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
      dataContainer.innerHTML = '<div class="signal-grid">' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">NIFTY 50</div><div class="sig-v" style="font-size:1.2em;">' + (md.nifty || '-') + '</div></div>' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">BANKNIFTY</div><div class="sig-v" style="font-size:1.2em;">' + (md.banknifty || '-') + '</div></div>' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">India VIX</div><div class="sig-v" style="font-size:1.2em;">' + (md.indiaVIX || '-') + '</div></div>' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">Crude Oil</div><div class="sig-v" style="font-size:1.2em;">' + (md.crudeOil || '-') + '</div></div>' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">USD/INR</div><div class="sig-v" style="font-size:1.2em;">' + (md.usdInr || '-') + '</div></div>' +
        '<div class="signal-card HOLD" style="flex:1;"><div class="sig-k">F&O Expiry</div><div class="sig-v" style="font-size:1.2em;">' + (md.fnoExpiry || '-') + '</div></div>' +
        '</div>';
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
    return '<div class="signal-card HOLD" style="margin-top:16px;"><div class="signal-badge HOLD">AI Trade Plan (Llama)</div><p class="muted" style="padding:8px 0;">No signal — insufficient confluences or neutral RSI zone.</p></div>';
  }
  var cls = s.signal === 'BUY' ? 'BUY' : s.signal === 'SELL' ? 'SELL' : 'HOLD';
  return '<div class="signal-card ' + cls + '" style="margin-top:16px;">' +
    '<div class="signal-header"><div class="signal-badge ' + cls + '">AI Trade Plan: ' + s.signal + '</div><div class="sig-v">Conf: ' + (s.confidence || 0) + '/10</div></div>' +
    '<div class="signal-grid" style="margin-top:12px;">' +
    '<div class="sig-kv"><span class="sig-k">Timeframe</span><span class="sig-v">' + (s.timeframe || '-') + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Best Window</span><span class="sig-v">' + (s.bestWindow || '-') + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Entry Zone</span><span class="sig-v">₹' + (s.entryZone?.low || 0) + ' - ₹' + (s.entryZone?.high || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Stop Loss</span><span class="sig-v">₹' + (s.stopLoss || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Target 1</span><span class="sig-v">₹' + (s.target1 || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Target 2</span><span class="sig-v">₹' + (s.target2 || 0) + '</span></div>' +
    '<div class="sig-kv"><span class="sig-k">Risk/Reward</span><span class="sig-v">' + (s.riskReward || '-') + '</span></div>' +
    '</div>' +
    (s.confluences && s.confluences.length > 0 ? '<div style="margin-top:8px;"><div class="sig-k">Confluences</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' + s.confluences.map(c => '<li>' + c + '</li>').join('') + '</ul></div>' : '') +
    (s.riskWarnings && s.riskWarnings.length > 0 ? '<div style="margin-top:8px;"><div class="sig-k">Warnings</div><ul style="margin:4px 0;padding-left:16px;font-size:12px;">' + s.riskWarnings.map(w => '<li class="bear-text">' + w + '</li>').join('') + '</ul></div>' : '') +
    '</div>';
}

document.addEventListener('DOMContentLoaded', initApp);
