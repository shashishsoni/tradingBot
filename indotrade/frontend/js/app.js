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

// Ultra-fast polling intervals (as requested)
const REFRESH_INTERVAL_MS = {
  clock: 1000,
  equity: 100,
  crypto: 50,
  tabs: 100
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

async function renderEquityTabData() {
  const container = document.getElementById('tab-equity');
  if (!container) return;
  container.innerHTML = '<h2>Equity Analysis</h2><p class="placeholder-text">Loading...</p>';
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
    container.innerHTML = `<h2>Equity Analysis</h2>${renderBasicTable(['Asset', 'Price', 'Change'], rows)}`;
  } catch (e) {
    container.innerHTML = '<h2>Equity Analysis</h2><p class="bear-text">Unable to load equity data.</p>';
  }
}

async function renderFoTabData() {
  const title = document.getElementById('fo-expiry-warning');
  const container = document.getElementById('fo-info-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading...</p>';
  try {
    const info = await api.fo.info();
    if (title) title.innerText = info.expiryWarning || 'F&O Options Analysis';
    const rows = [
      ['Expiry Date', info.expiryDate || '—'],
      ['Days To Expiry', Number.isFinite(Number(info.daysToExpiry)) ? info.daysToExpiry : '—'],
      ['NIFTY', Number.isFinite(Number(info.nifty)) ? `₹${Number(info.nifty).toLocaleString('en-IN')}` : '—'],
      ['BANKNIFTY', Number.isFinite(Number(info.banknifty)) ? `₹${Number(info.banknifty).toLocaleString('en-IN')}` : '—']
    ];
    container.innerHTML = renderBasicTable(['Metric', 'Value'], rows);
  } catch (e) {
    if (title) title.innerText = 'F&O Options Analysis';
    container.innerHTML = '<p class="bear-text">Unable to load F&O data.</p>';
  }
}

async function renderCryptoTabData() {
  const container = document.getElementById('crypto-global-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading...</p>';
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
    container.innerHTML =
      `<h3>Global Market</h3>${renderBasicTable(['Metric', 'Value'], summaryRows)}
       <h3 style="margin-top:16px;">Top INR Pairs</h3>${renderBasicTable(['Pair', 'Price'], topPairs)}`;
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load crypto data.</p>';
  }
}

async function renderMfTabData() {
  const container = document.getElementById('mf-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading...</p>';
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
    container.innerHTML = renderBasicTable(['Fund', 'NAV', 'Date', 'Change'], rows);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load mutual fund data.</p>';
  }
}

async function renderIpoTabData() {
  const container = document.getElementById('ipo-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading...</p>';
  try {
    const list = await api.ipo.list();
    const rows = list.map(i => [i.name, i.status, i.price, i.close || i.listedAt || '—', i.exchange || '—']);
    container.innerHTML = renderBasicTable(['IPO', 'Status', 'Price Band', 'Close/Listed', 'Exchange'], rows);
  } catch (e) {
    container.innerHTML = '<p class="bear-text">Unable to load IPO data.</p>';
  }
}

function renderRiskTabData() {
  const container = document.getElementById('tab-risk');
  if (!container) return;
  const capital = Number.parseFloat(document.getElementById('ai-capital-input')?.value || '100000');
  const maxRisk = Number.isFinite(capital) ? (capital * 0.02) : 2000;
  container.innerHTML = `
    <h2>Risk Engine</h2>
    <div class="signal-card">
      <div class="sig-kv"><span class="sig-k">Max Risk Per Trade (2%)</span><span class="sig-v">₹${maxRisk.toLocaleString('en-IN')}</span></div>
      <div class="sig-kv"><span class="sig-k">Suggested Rule</span><span class="sig-v">Stop after 3 consecutive losses</span></div>
      <div class="sig-kv"><span class="sig-k">Position Sizing</span><span class="sig-v">Risk / (Entry - StopLoss)</span></div>
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
