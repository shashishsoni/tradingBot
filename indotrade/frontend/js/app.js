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

// App Initialization
async function initApp() {
  updateClock();
  setInterval(updateClock, 1000);
  initTabs();

  // Watchlist & Global setup
  await renderWatchlist();
  fetchGlobals();
  renderHistory();

  // Event Listeners
  document.getElementById('btn-generate-signal')?.addEventListener('click', generateSignal);
  document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    document.getElementById('signal-history-panel').classList.toggle('hidden');
  });

  // Auto Refresh Logic
  setInterval(() => {
    if (window.MARKET_OPEN) {
      updateEquityPrices();
      fetchGlobals();
    }
  }, 5 * 60 * 1000); // 5 min for equity/globals
  
  setInterval(() => {
    // Truely live crypto refresh (every 5 seconds)
    updateCryptoPrices();
  }, 5000);
}

document.addEventListener('DOMContentLoaded', initApp);
