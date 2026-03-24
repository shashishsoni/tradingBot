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
  equity: 15000,
  crypto: 5000,
  tabs: 45000
};

const refreshInFlight = {
  equity: false,
  crypto: false,
  tabs: false
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
        </div>`
      : `<div class="signal-card" style="margin-top:16px;"><p>No strong positive momentum right now. Prefer HOLD / wait-for-setup.</p></div>`;

    container.innerHTML = `<h2>Equity Analysis</h2>${renderBasicTable(['Asset', 'Price', 'Change'], rows)}${detail}`;
  } catch (e) {
    container.innerHTML = '<h2>Equity Analysis</h2><p class="bear-text">Unable to load equity data.</p>';
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
    container.innerHTML = renderBasicTable(['Metric', 'Value'], rows) + guidance;
  } catch (e) {
    if (title) title.innerText = 'F&O Options Analysis';
    container.innerHTML = '<p class="bear-text">Unable to load F&O data.</p>';
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
        </div>`
      : '';
    container.innerHTML =
      `<h3>Global Market</h3>${renderBasicTable(['Metric', 'Value'], summaryRows)}
       <h3 style="margin-top:16px;">Top INR Pairs</h3>${renderBasicTable(['Pair', 'Price'], topPairs)}${bestBlock}`;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load crypto data.</p>';
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
        </div>`
      : '<p class="bear-text" style="margin-top:10px;">MF API data delayed/unavailable. Retrying automatically.</p>';
    container.innerHTML = renderBasicTable(['Fund', 'NAV', 'Date', 'Change'], rows) + note;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load mutual fund data.</p>';
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
      </div>`;
    container.innerHTML = renderBasicTable(['IPO', 'Status', 'Price Band', 'Close/Listed', 'Exchange'], rows) + report;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load IPO data.</p>';
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
  `;
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

  // Watchlist & Global setup
  await renderWatchlist();
  fetchGlobals();
  renderHistory();
  renderAllTabData();

  // Event Listeners
  document.getElementById('btn-generate-signal')?.addEventListener('click', generateSignal);
  document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    document.getElementById('signal-history-panel').classList.toggle('hidden');
  });

  // Auto Refresh Logic
  setInterval(() => {
    if (window.MARKET_OPEN) {
      runLocked('equity', async () => {
        await updateEquityPrices();
        await fetchGlobals();
      });
    }
  }, REFRESH_INTERVAL_MS.equity);
  
  setInterval(() => {
    runLocked('crypto', updateCryptoPrices);
  }, REFRESH_INTERVAL_MS.crypto);

  // Refresh secondary tab data
  setInterval(() => {
    runLocked('tabs', renderAllTabData);
  }, REFRESH_INTERVAL_MS.tabs);
}

document.addEventListener('DOMContentLoaded', initApp);
