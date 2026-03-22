const EQUITY_WATCHLIST = [
  'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS',
  'WIPRO.NS','BAJFINANCE.NS','ADANIENT.NS','LT.NS','SBIN.NS',
  '^NSEI','^BSESN','^NSEBANK'
];

const CRYPTO_WATCHLIST = ['BTC/INR','ETH/INR','SOL/INR','XRP/INR','BNB/INR','DOGE/INR'];

async function renderWatchlist() {
  const tbody = document.querySelector('#watchlist-table tbody');
  const select = document.getElementById('ai-asset-select');
  if (!tbody || !select) return;

  tbody.innerHTML = EQUITY_WATCHLIST.map(sym => `
    <tr id="row-${sym}">
      <td>${sym.replace('.NS', '')}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym}', 'EQUITY')">Analyze</button></td>
    </tr>
  `).join('') + CRYPTO_WATCHLIST.map(sym => `
    <tr id="row-${sym.replace('/','')}">
      <td>${sym}</td>
      <td class="price skeleton-text"></td>
      <td class="change skeleton-text"></td>
      <td><button class="btn-action" onclick="analyzeWatchlistAsset('${sym}', 'CRYPTO')">Analyze</button></td>
    </tr>
  `).join('');

  // Populate Select
  select.innerHTML = '<optgroup label="Equity">' + EQUITY_WATCHLIST.map(s => `<option value="${s}|EQUITY">${s.replace('.NS','')}</option>`).join('') + '</optgroup>' +
    '<optgroup label="Crypto">' + CRYPTO_WATCHLIST.map(s => `<option value="${s}|CRYPTO">${s}</option>`).join('') + '</optgroup>';

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
    eqData.forEach(d => {
      if (d.error) return;
      const row = document.getElementById(`row-${d.symbol}`);
      if (row) {
        row.querySelector('.price').innerHTML = `₹${d.price}`;
        row.querySelector('.price').classList.remove('skeleton-text');
        row.querySelector('.change').innerHTML = `<span class="${d.changePct >= 0 ? 'bull-text' : 'bear-text'}">${d.changePct >= 0 ? '+' : ''}${d.changePct}%</span>`;
        row.querySelector('.change').classList.remove('skeleton-text');
      }
    });
  } catch (err) {
    showToast('Failed to fetch equity data', 'error');
  }
}

async function updateCryptoPrices() {
  try {
    const crypData = await api.crypto.all();
    crypData.forEach(d => {
      if (d.error) return;
      const t = d.pair.replace('/', '');
      const row = document.getElementById(`row-${t}`);
      if (row) {
        const pr = parseFloat(d.market || d.buy);
        const chg = parseFloat(d.pricechange).toFixed(2);
        row.querySelector('.price').innerHTML = `₹${pr.toLocaleString('en-IN')}`;
        row.querySelector('.price').classList.remove('skeleton-text');
        row.querySelector('.change').innerHTML = `<span class="${chg >= 0 ? 'bull-text' : 'bear-text'}">${chg >= 0 ? '+' : ''}${chg}%</span>`;
        row.querySelector('.change').classList.remove('skeleton-text');
      
        if (d.pair === 'BTC/INR') {
          const btcCard = document.getElementById('card-btc');
          if (btcCard) {
            btcCard.querySelector('.m-value').innerText = `₹${pr.toLocaleString('en-IN')}`;
            btcCard.querySelector('.m-value').classList.remove('skeleton-text');
            btcCard.querySelector('.m-change').innerHTML = `<span class="${chg >= 0 ? 'bull-text' : 'bear-text'}">${chg >= 0 ? '+' : ''}${chg}%</span>`;
          }
        }
      }
    });
  } catch (err) {
    showToast('Failed to fetch watchlist data', 'error');
  }
}
