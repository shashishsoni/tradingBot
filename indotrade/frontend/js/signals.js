const EQUITY_WATCHLIST = [
  'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS',
  'WIPRO.NS','BAJFINANCE.NS','ADANIENT.NS','LT.NS','SBIN.NS',
  '^NSEI','^BSESN','^NSEBANK'
];

// Default top crypto pairs shown in watchlist (user can see all in Crypto tab)
const DEFAULT_CRYPTO_WATCHLIST = ['BTC-INR','ETH-INR','SOL-INR','XRP-INR','BNB-INR','DOGE-INR'];

// Dynamic crypto pairs list — populated from ZebPay API on init
let CRYPTO_WATCHLIST = [...DEFAULT_CRYPTO_WATCHLIST];
let ALL_CRYPTO_PAIRS = [];

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
    // Keep default watchlist but validate they exist on ZebPay
    CRYPTO_WATCHLIST = DEFAULT_CRYPTO_WATCHLIST.filter(s => ALL_CRYPTO_PAIRS.includes(s));
  } catch (e) {
    // Fallback to defaults if API unavailable
    CRYPTO_WATCHLIST = [...DEFAULT_CRYPTO_WATCHLIST];
  }
}

async function renderWatchlist() {
  const tbody = document.querySelector('#watchlist-table tbody');
  const select = document.getElementById('ai-asset-select');
  if (!tbody || !select) return;

  // Fetch available crypto pairs first
  await initCryptoPairs();

  tbody.innerHTML = EQUITY_WATCHLIST.map(sym => `
    <tr id="row-${sym}">
      <td>${sym.replace('.NS', '')}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym}', 'EQUITY')">Analyze</button></td>
    </tr>
  `).join('') + CRYPTO_WATCHLIST.map(sym => `
    <tr id="row-${sym}">
      <td>${sym}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym.replace('-','/')}', 'CRYPTO')">Analyze</button></td>
    </tr>
  `).join('');

  // Populate Select — show all available INR pairs for analysis
  const allPairsForSelect = ALL_CRYPTO_PAIRS.length > 0 ? ALL_CRYPTO_PAIRS : CRYPTO_WATCHLIST;
  select.innerHTML = '<optgroup label="Equity">' + EQUITY_WATCHLIST.map(s => `<option value="${s}|EQUITY">${s.replace('.NS','')}</option>`).join('') + '</optgroup>' +
    '<optgroup label="Crypto">' + allPairsForSelect.map(s => `<option value="${s.replace('-','/')}|CRYPTO">${s}</option>`).join('') + '</optgroup>';

  updateEquityPrices();
  updateCryptoPrices();
}

async function updateWatchlistPrices() {
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
