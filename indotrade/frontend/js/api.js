const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001/api' : 'https://your-backend.onrender.com/api';

async function fetchJSON(url) {
  try {
    const ts = url.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
    const res = await fetch(url + ts, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

const api = {
  equity: {
    quote: (symbol) => fetchJSON(`${API}/equity/quote/${symbol}`),
    batch: (symbols) => fetch(`${API}/equity/batch`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({symbols}) }).then(r=>r.json())
  },
  crypto: {
    all: () => fetchJSON(`${API}/crypto/all`),
    global: () => fetchJSON(`${API}/crypto/global`),
    ohlcv: (id, days=7) => fetchJSON(`${API}/crypto/ohlcv/${id}?days=${days}`)
  },
  mf: {
    watchlist: () => fetchJSON(`${API}/mf/watchlist`),
    search: (q) => fetchJSON(`${API}/mf/search/${encodeURIComponent(q)}`)
  },
  ipo: { list: () => fetchJSON(`${API}/ipo`) },
  fo: { info: () => fetchJSON(`${API}/fo/info`) },
  ai: {
    analyze: (marketData, assetType, capital) => fetch(`${API}/ai/analyze`, {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ marketData, assetType, capital })
    }).then(async r => {
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'AI Analysis Failed');
      }
      return r.json();
    })
  }
};
