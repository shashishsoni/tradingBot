const API = (() => {
  const base = typeof window !== 'undefined' && window.INDOTRADE_API_BASE && String(window.INDOTRADE_API_BASE).trim();
  if (base) return base.replace(/\/$/, '') + '/api';
  const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (local) return 'http://localhost:3001/api';
  return '';
})();

function ensureApiBase() {
  if (API) return;
  throw new Error('Set window.INDOTRADE_API_BASE in js/config.js to your backend Render URL.');
}

function emitApiEvent(type, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function fetchJSON(url, options) {
  ensureApiBase();
  const ts = url.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
  const res = await fetch(url + ts, { cache: 'no-store', ...(options || {}) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    if (res.status === 429) emitApiEvent('indotrade:rate-limit', { status: 429 });
    throw err;
  }
  emitApiEvent('indotrade:api-ok');
  return await res.json();
}

const api = {
  equity: {
    quote: (symbol) => fetchJSON(`${API}/equity/quote/${symbol}`),
    batch: (symbols) => fetchJSON(`${API}/equity/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    }),
    analyze: (symbol) => fetchJSON(`${API}/equity/analyze/${symbol}`)
  },
  crypto: {
    pairs: () => fetchJSON(`${API}/crypto/pairs`),
    all: () => fetchJSON(`${API}/crypto/all`),
    global: () => fetchJSON(`${API}/crypto/global`),
    ohlcv: (id, days=7) => fetchJSON(`${API}/crypto/ohlcv/${id}?days=${days}`),
    analyze: (coin) => fetchJSON(`${API}/crypto/analyze/${coin}`)
  },
  mf: {
    watchlist: () => fetchJSON(`${API}/mf/watchlist`),
    search: (q) => fetchJSON(`${API}/mf/search/${encodeURIComponent(q)}`),
    analyze: (code) => fetchJSON(`${API}/mf/analyze/${code}`)
  },
  ipo: { 
    list: () => fetchJSON(`${API}/ipo`),
    analyze: (name) => fetchJSON(`${API}/ipo/analyze/${encodeURIComponent(name)}`)
  },
  fo: { 
    info: () => fetchJSON(`${API}/fo/info`),
    analyze: (symbol) => fetchJSON(`${API}/fo/analyze/${symbol}`)
  },
  watchlist: {
    unified: () => fetchJSON(`${API}/watchlist/unified`)
  },
  risk: {
    portfolio: (portfolio, capital) => fetchJSON(`${API}/risk/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, capital })
    }),
    position: (position, marketData) => fetchJSON(`${API}/risk/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, marketData })
    })
  },
  ai: {
    analyze: (marketData, assetType, capital) => {
      ensureApiBase();
      return fetch(`${API}/ai/analyze`, {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ marketData, assetType, capital })
      }).then(async r => {
        if (!r.ok) {
          const payload = await parseJsonSafe(r);
          if (r.status === 429) emitApiEvent('indotrade:rate-limit', { status: 429 });
          throw new Error(payload?.error || 'AI Analysis Failed');
        }
        emitApiEvent('indotrade:api-ok');
        return r.json();
      });
    }
  }
};
