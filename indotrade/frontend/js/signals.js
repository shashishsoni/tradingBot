const EQUITY_WATCHLIST = [
  // NIFTY 50 Core
  'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS','BHARTIARTL.NS',
  'ITC.NS','SBIN.NS','LT.NS','AXISBANK.NS','KOTAKBANK.NS','HINDUNILVR.NS',
  'BAJFINANCE.NS','ASIANPAINT.NS','MARUTI.NS','SUNPHARMA.NS','TITAN.NS',
  'WIPRO.NS','ULTRACEMCO.NS','NTPC.NS','ONGC.NS','TATASTEEL.NS','JSWSTEEL.NS',
  'HINDALCO.NS','POWERGRID.NS','COALINDIA.NS','NESTLEIND.NS','BAJAJFINSV.NS',
  'ADANIENT.NS','TATAMOTORS.NS','M&M.NS','EICHERMOT.NS','HEROMOTOCO.NS',
  'CIPLA.NS','DIVISLAB.NS','TECHM.NS','HCLTECH.NS','BPCL.NS','INDUSINDBK.NS',
  'DRREDDY.NS','APOLLOHOSP.NS','GRASIM.NS','ADANIPORTS.NS','SBILIFE.NS',
  'HDFCLIFE.NS','BRITANNIA.NS','LTIM.NS','BAJAJ-AUTO.NS',
  // Large Cap / High Growth
  'ZOMATO.NS','DMART.NS','TRENT.NS','VBL.NS','PIIND.NS','PERSISTENT.NS',
  'COFORGE.NS','TATAPOWER.NS','ABB.NS','SIEMENS.NS','HAVELLS.NS',
  'PIDILITIND.NS','DABUR.NS','GODREJCP.NS','MARICO.NS',
  'BHEL.NS','HAL.NS','BEL.NS','IRCTC.NS',
  'DEEPAKNTR.NS','KPITTECH.NS','TATAELXSI.NS','MPHASIS.NS',
  'BALKRISIND.NS','AMBUJACEM.NS','ACC.NS',
  // Indices
  '^NSEI','^BSESN','^NSEBANK'
];

// Default top crypto pairs shown in watchlist (user can see all in Crypto tab)
const DEFAULT_CRYPTO_WATCHLIST = ['BTC-INR','ETH-INR','SOL-INR','XRP-INR','BNB-INR','DOGE-INR'];

// Dynamic crypto pairs list — populated from ZebPay API on init
let CRYPTO_WATCHLIST = [...DEFAULT_CRYPTO_WATCHLIST];
let ALL_CRYPTO_PAIRS = [];

// Unified signal lookup: symbol → { recommendation, confidence }
let SIGNAL_LOOKUP = {};

function updateWatchlistLastUpdated() {
  const el = document.getElementById('watchlist-last-updated');
  if (!el) return;
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  el.textContent = `(Last updated: ${time} IST)`;
}

async function initCryptoPairs() {
  try {
    const pairs = await api.crypto.pairs();
    ALL_CRYPTO_PAIRS = pairs.map(p => p.symbol);
    CRYPTO_WATCHLIST = DEFAULT_CRYPTO_WATCHLIST.filter(s => ALL_CRYPTO_PAIRS.includes(s));
  } catch (e) {
    CRYPTO_WATCHLIST = [...DEFAULT_CRYPTO_WATCHLIST];
  }
}

// Fetch unified data to get technical-based signals for dashboard
async function loadUnifiedSignals() {
  try {
    const data = await api.watchlist.unified();
    SIGNAL_LOOKUP = {};
    (data.equity || []).forEach(e => {
      SIGNAL_LOOKUP[e.symbol] = { recommendation: e.recommendation, confidence: e.confidence };
    });
    (data.crypto || []).forEach(c => {
      SIGNAL_LOOKUP[c.symbol] = { recommendation: c.recommendation, confidence: c.confidence };
    });
  } catch (e) {
    // Fallback: no signals available
  }
}

async function renderWatchlist() {
  const tbody = document.querySelector('#watchlist-table tbody');
  const select = document.getElementById('ai-asset-select');
  if (!tbody || !select) return;

  // Fetch crypto pairs and unified signals in parallel
  await Promise.all([initCryptoPairs(), loadUnifiedSignals()]);

  tbody.innerHTML = EQUITY_WATCHLIST.map(sym => `
    <tr id="row-${sym}">
      <td>${sym.replace('.NS', '').replace('^', '')}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td class="signal-cell skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym}', 'EQUITY')">Analyze</button></td>
    </tr>
  `).join('') + CRYPTO_WATCHLIST.map(sym => `
    <tr id="row-${sym}">
      <td>${sym}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td class="signal-cell skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym.replace('-','/')}', 'CRYPTO')">Analyze</button></td>
    </tr>
  `).join('');

  // Populate Select — show all available INR pairs for analysis
  const allPairsForSelect = ALL_CRYPTO_PAIRS.length > 0 ? ALL_CRYPTO_PAIRS : CRYPTO_WATCHLIST;
  select.innerHTML = '<optgroup label="Equity">' + EQUITY_WATCHLIST.map(s => `<option value="${s}|EQUITY">${s.replace('.NS','').replace('^','')}</option>`).join('') + '</optgroup>' +
    '<optgroup label="Crypto">' + allPairsForSelect.map(s => `<option value="${s.replace('-','/')}|CRYPTO">${s}</option>`).join('') + '</optgroup>';

  updateEquityPrices();
  updateCryptoPrices();
}

function renderSignalBadge(row, symbol) {
  const cell = row.querySelector('.signal-cell');
  if (!cell) return;
  const sig = SIGNAL_LOOKUP[symbol];
  if (sig) {
    const cls = sig.recommendation === 'BUY' ? 'bull-text' : sig.recommendation === 'SELL' ? 'bear-text' : 'muted';
    cell.innerHTML = `<span class="signal-mini ${sig.recommendation}">${sig.recommendation}</span>`;
    cell.classList.remove('skeleton-text');
  } else {
    cell.innerHTML = '<span class="muted">—</span>';
    cell.classList.remove('skeleton-text');
  }
}

async function updateWatchlistPrices() {
  // Refresh unified signals periodically
  await loadUnifiedSignals();
  updateEquityPrices();
  updateCryptoPrices();
}

async function updateEquityPrices() {
  try {
    const eqData = await api.equity.batch(EQUITY_WATCHLIST);
    let updated = false;
    eqData.forEach(d => {
      if (d.error) return;
      const row = document.getElementById(`row-${d.symbol}`);
      if (row) {
        const price = Number(d.price);
        const pct = Number(d.changePct);
        const hasPct = Number.isFinite(pct);
        row.querySelector('.price').innerHTML = Number.isFinite(price) ? `₹${price}` : '—';
        row.querySelector('.price').classList.remove('skeleton-text');
        if (hasPct) {
          row.querySelector('.change').innerHTML = `<span class="${pct >= 0 ? 'bull-text' : 'bear-text'}">${pct >= 0 ? '+' : ''}${pct}%</span>`;
        } else {
          row.querySelector('.change').innerHTML = '<span class="muted">—</span>';
        }
        row.querySelector('.change').classList.remove('skeleton-text');
        renderSignalBadge(row, d.symbol);
        updated = true;
      }
    });
    if (updated) updateWatchlistLastUpdated();
  } catch (err) {
    showToast('Failed to fetch equity data', 'error');
  }
}

async function updateCryptoPrices() {
  try {
    const crypData = await api.crypto.all();
    let updated = false;
    crypData.forEach(d => {
      if (d.error) return;
      const row = document.getElementById(`row-${d.pair}`);
      if (row) {
        const pr = parseFloat(d.market || d.buy);
        const chg = parseFloat(d.pricechange).toFixed(2);
        row.querySelector('.price').innerHTML = `₹${pr.toLocaleString('en-IN')}`;
        row.querySelector('.price').classList.remove('skeleton-text');
        row.querySelector('.change').innerHTML = `<span class="${chg >= 0 ? 'bull-text' : 'bear-text'}">${chg >= 0 ? '+' : ''}${chg}%</span>`;
        row.querySelector('.change').classList.remove('skeleton-text');
        renderSignalBadge(row, d.pair);
        updated = true;
      
        if (d.pair === 'BTC-INR') {
          const btcCard = document.getElementById('card-btc');
          if (btcCard) {
            btcCard.querySelector('.m-value').innerText = `₹${pr.toLocaleString('en-IN')}`;
            btcCard.querySelector('.m-value').classList.remove('skeleton-text');
            btcCard.querySelector('.m-change').innerHTML = `<span class="${chg >= 0 ? 'bull-text' : 'bear-text'}">${chg >= 0 ? '+' : ''}${chg}%</span>`;
          }
        }
      }
    });
    if (updated) updateWatchlistLastUpdated();
  } catch (err) {
    showToast('Failed to fetch watchlist data', 'error');
  }
}
