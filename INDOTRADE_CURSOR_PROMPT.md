# INDOTRADE AI — CURSOR BUILD PROMPT

## ROLE
You are a senior full-stack developer. Build a complete personal trading intelligence dashboard called **IndoTrade AI** from scratch. No placeholders. No mock data. Every feature must work with live APIs.

---

## STACK
- **Backend:** Node.js + Express (proxy server)
- **Frontend:** Plain HTML + CSS + Vanilla JS (no frameworks)
- **AI:** Groq API — model `llama-3.3-70b-versatile`
- **Charts:** Chart.js (CDN)
- **Deployment:** Render (free tier — `render.yaml` included)
- **Fonts:** JetBrains Mono (data/numbers) + Syne (headings) — Google Fonts CDN

---

## PROJECT STRUCTURE

```
indotrade/
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── equity.js
│   │   ├── crypto.js
│   │   ├── mf.js
│   │   ├── ipo.js
│   │   ├── fo.js
│   │   └── ai.js
│   ├── utils/
│   │   ├── indicators.js
│   │   └── riskEngine.js
│   ├── package.json
│   └── .env
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── api.js
│       ├── charts.js
│       ├── signals.js
│       └── ai.js
└── render.yaml
```

---

## DATA SOURCES (All Free, No Paid Keys)

| Data | Source | Notes |
|------|---------|-------|
| NSE/BSE quotes + OHLCV | Yahoo Finance unofficial API | Append `.NS` for NSE, `.BO` for BSE |
| Crypto prices (INR) | ZebPay public API `zebapi.com/api/v1/market/` | No auth needed |
| Crypto global data | CoinGecko free API `api.coingecko.com/api/v3/` | 30 req/min |
| Fear & Greed Index | `api.alternative.me/fng/?limit=1` | Free |
| Mutual Fund NAVs | `api.mfapi.in/mf/` | Free, no key |
| IPO data | NSE website scrape + hardcoded recent listings | Update manually |
| AI signals | Groq API — Llama 3.3 70B | Needs `GROQ_API_KEY` in `.env` |

---

## BACKEND — server.js

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 60000, max: 30 }));

app.use('/api/equity', require('./routes/equity'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/mf', require('./routes/mf'));
app.use('/api/ipo', require('./routes/ipo'));
app.use('/api/fo', require('./routes/fo'));
app.use('/api/ai', require('./routes/ai'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3001);
```

**Dependencies:** `npm install express cors axios dotenv node-cron helmet express-rate-limit`

---

## BACKEND — routes/equity.js

Proxy Yahoo Finance. Prevent browser CORS failure.

```js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

router.get('/quote/:symbol', async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase();
    const { data } = await axios.get(`${YF}${ticker}?interval=5m&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    });
    const meta = data.chart.result[0].meta;
    const q = data.chart.result[0].indicators.quote[0];
    const ts = data.chart.result[0].timestamp;
    res.json({
      symbol: ticker,
      price: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      change: +(meta.regularMarketPrice - meta.previousClose).toFixed(2),
      changePct: +((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
      volume: meta.regularMarketVolume,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      ohlcv: ts.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })).filter(c => c.close !== null)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batch', async (req, res) => {
  const { symbols } = req.body;
  const results = await Promise.allSettled(symbols.map(s =>
    axios.get(`${YF}${s}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 })
  ));
  res.json(results.map((r, i) => {
    if (r.status === 'rejected') return { symbol: symbols[i], error: true };
    const m = r.value.data.chart.result[0].meta;
    return { symbol: symbols[i], price: m.regularMarketPrice, changePct: +((m.regularMarketPrice - m.previousClose) / m.previousClose * 100).toFixed(2), volume: m.regularMarketVolume };
  }));
});

module.exports = router;
```

---

## BACKEND — routes/crypto.js

```js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const ZEB = 'https://www.zebapi.com/api/v1/market/ticker/';
const GCK = 'https://api.coingecko.com/api/v3/';

const PAIRS = ['BTC/INR','ETH/INR','SOL/INR','XRP/INR','BNB/INR','ADA/INR','DOGE/INR','USDT/INR'];

router.get('/all', async (req, res) => {
  const results = await Promise.allSettled(PAIRS.map(p => {
    const [b, q] = p.split('/');
    return axios.get(`${ZEB}${b}/${q}`, { timeout: 5000 });
  }));
  res.json(results.map((r, i) => ({
    pair: PAIRS[i],
    ...(r.status === 'fulfilled' ? r.value.data : { error: true })
  })));
});

router.get('/global', async (req, res) => {
  try {
    const [global, fg, trending] = await Promise.all([
      axios.get(`${GCK}global`, { timeout: 8000 }),
      axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 }),
      axios.get(`${GCK}search/trending`, { timeout: 8000 })
    ]);
    res.json({
      marketCap: global.data.data.total_market_cap.usd,
      btcDominance: +global.data.data.market_cap_percentage.btc.toFixed(1),
      totalVolume: global.data.data.total_volume.usd,
      fearGreed: fg.data.data[0].value,
      fearGreedLabel: fg.data.data[0].value_classification,
      trending: trending.data.coins.slice(0,5).map(c => ({ name: c.item.name, symbol: c.item.symbol }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/ohlcv/:id', async (req, res) => {
  try {
    const { data } = await axios.get(`${GCK}coins/${req.params.id}/ohlc?vs_currency=inr&days=${req.query.days||7}`, { timeout: 8000 });
    res.json(data.map(([t,o,h,l,c]) => ({ time: t/1000, open:o, high:h, low:l, close:c })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
```

---

## BACKEND — routes/mf.js

```js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const MFAPI = 'https://api.mfapi.in/mf/';

const WATCHLIST = [
  { code: '119598', name: 'Mirae Asset Large Cap' },
  { code: '125354', name: 'Axis Midcap Fund' },
  { code: '120503', name: 'Parag Parikh Flexi Cap' },
  { code: '118989', name: 'SBI Small Cap Fund' },
  { code: '122639', name: 'HDFC Index Nifty 50' }
];

router.get('/watchlist', async (req, res) => {
  const results = await Promise.allSettled(WATCHLIST.map(m => axios.get(`${MFAPI}${m.code}`, { timeout: 6000 })));
  res.json(results.map((r, i) => ({
    ...WATCHLIST[i],
    ...(r.status === 'fulfilled' ? {
      nav: r.value.data.data[0].nav,
      date: r.value.data.data[0].date,
      prevNav: r.value.data.data[1]?.nav,
      change: +(parseFloat(r.value.data.data[0].nav) - parseFloat(r.value.data.data[1]?.nav)).toFixed(4)
    } : { error: true })
  })));
});

router.get('/search/:q', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(req.params.q)}`, { timeout: 8000 });
    res.json(data.slice(0,10));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
```

---

## BACKEND — routes/fo.js

```js
const express = require('express');
const axios = require('axios');
const router = express.Router();

// F&O expiry: last Thursday of month
function getNextExpiry() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  while (lastDay.getDay() !== 4) lastDay.setDate(lastDay.getDate() - 1);
  return lastDay;
}

router.get('/info', async (req, res) => {
  const expiry = getNextExpiry();
  const today = new Date();
  const daysToExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  const isExpiryWeek = daysToExpiry <= 7;

  // Fetch Nifty + BankNifty for F&O analysis
  try {
    const [nifty, banknifty] = await Promise.all([
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
    ]);
    res.json({
      expiryDate: expiry.toDateString(),
      daysToExpiry,
      isExpiryWeek,
      expiryWarning: isExpiryWeek ? `⚠️ F&O Expiry in ${daysToExpiry} days — elevated volatility expected` : null,
      nifty: nifty.data.chart.result[0].meta.regularMarketPrice,
      banknifty: banknifty.data.chart.result[0].meta.regularMarketPrice
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
```

---

## BACKEND — routes/ipo.js

```js
const express = require('express');
const router = express.Router();

// Manually maintained — update when new IPOs list
const IPOS = [
  { name: 'Ather Energy', status: 'Open', price: '304-321', close: '2026-04-03', exchange: 'NSE/BSE' },
  { name: 'Schloss Bangalore', status: 'Upcoming', price: 'TBA', close: 'TBA', exchange: 'NSE/BSE' },
  { name: 'Premier Energies', status: 'Listed', price: '1560', listedAt: '1560', gain: '+139%', exchange: 'NSE' },
  { name: 'Ola Electric', status: 'Listed', price: '76', listedAt: '76', gain: '-55%', exchange: 'NSE' },
  { name: 'Bajaj Housing Finance', status: 'Listed', price: '150', listedAt: '150', gain: '+114%', exchange: 'NSE' }
];

router.get('/', (req, res) => res.json(IPOS));
module.exports = router;
```

---

## BACKEND — utils/indicators.js

```js
function ema(closes, p) {
  const k = 2 / (p + 1); let e = closes[0];
  return closes.map(v => { e = v * k + e * (1 - k); return +e.toFixed(2); });
}

function rsi(closes, p = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i-1]; d > 0 ? g += d : l -= d; }
  let ag = g/p, al = l/p, vals = [];
  for (let i = p+1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag*(p-1) + (d>0?d:0))/p; al = (al*(p-1) + (d<0?-d:0))/p;
    vals.push(+(100 - 100/(1+(al===0?100:ag/al))).toFixed(2));
  }
  return vals;
}

function macd(closes, f=12, s=26, sig=9) {
  const fast = ema(closes,f), slow = ema(closes,s);
  const line = fast.map((v,i) => +(v-slow[i]).toFixed(2));
  const signal = ema(line.slice(s-f), sig);
  const hist = signal.map((v,i) => +(line[i+(s-f)]-v).toFixed(2));
  return { line, signal, hist };
}

function atr(ohlcv, p=14) {
  const trs = ohlcv.slice(1).map((b,i) => Math.max(b.high-b.low, Math.abs(b.high-ohlcv[i].close), Math.abs(b.low-ohlcv[i].close)));
  let a = trs.slice(0,p).reduce((s,v)=>s+v,0)/p;
  for (let i=p; i<trs.length; i++) a = (a*(p-1)+trs[i])/p;
  return +a.toFixed(2);
}

function bb(closes, p=20, sd=2) {
  const s = closes.slice(-p), sma = s.reduce((a,b)=>a+b,0)/p;
  const std = Math.sqrt(s.reduce((sum,v)=>sum+Math.pow(v-sma,2),0)/p);
  return { upper: +(sma+sd*std).toFixed(2), middle: +sma.toFixed(2), lower: +(sma-sd*std).toFixed(2), width: +(sd*2*std/sma*100).toFixed(2) };
}

function obv(ohlcv) {
  let o = 0;
  return ohlcv.map((b,i) => { if(i===0) return 0; o += b.close > ohlcv[i-1].close ? b.volume : b.close < ohlcv[i-1].close ? -b.volume : 0; return o; });
}

function calculateIndicators(ohlcv) {
  if (!ohlcv || ohlcv.length < 26) return { error: 'Need 26+ candles' };
  const closes = ohlcv.map(c => c.close).filter(Boolean);
  const vols = ohlcv.map(c => c.volume).filter(Boolean);
  const e20 = ema(closes,20), e50 = ema(closes,50);
  const e200 = closes.length >= 200 ? ema(closes,200) : null;
  const rsiVals = rsi(closes);
  const macdVals = macd(closes);
  const atrVal = atr(ohlcv);
  const bbVals = bb(closes);
  const obvVals = obv(ohlcv);
  const avgVol = vols.slice(-20).reduce((a,b)=>a+b,0)/20;
  const cur = closes[closes.length-1];
  const curRSI = rsiVals[rsiVals.length-1];
  const curHist = macdVals.hist[macdVals.hist.length-1];
  const prevHist = macdVals.hist[macdVals.hist.length-2];
  return {
    ema20: e20[e20.length-1], ema50: e50[e50.length-1],
    ema200: e200 ? e200[e200.length-1] : null,
    rsi: curRSI,
    rsiSignal: curRSI > 70 ? 'OVERBOUGHT' : curRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
    macdHistogram: curHist,
    macdCross: prevHist < 0 && curHist > 0 ? 'BULLISH' : prevHist > 0 && curHist < 0 ? 'BEARISH' : 'NONE',
    atr: atrVal, bb: bbVals,
    bbPosition: cur > bbVals.upper ? 'ABOVE' : cur < bbVals.lower ? 'BELOW' : 'INSIDE',
    volumeRatio: +(vols[vols.length-1]/avgVol).toFixed(2),
    volumeSignal: vols[vols.length-1] > avgVol*1.5 ? 'HIGH' : vols[vols.length-1] < avgVol*0.5 ? 'LOW' : 'NORMAL',
    obvTrend: obvVals[obvVals.length-1] > obvVals[obvVals.length-5] ? 'RISING' : 'FALLING',
    trend: cur > e20[e20.length-1] && e20[e20.length-1] > e50[e50.length-1] ? 'UPTREND' : cur < e20[e20.length-1] && e20[e20.length-1] < e50[e50.length-1] ? 'DOWNTREND' : 'SIDEWAYS'
  };
}

module.exports = { calculateIndicators };
```

---

## BACKEND — utils/riskEngine.js

```js
function positionSize(capital, price, atr, riskPct = 0.02) {
  if (!atr) return null;
  const risk = capital * riskPct;
  const stopDist = atr * 1.5;
  const units = Math.floor(risk / stopDist);
  return {
    units,
    totalInvestment: +(units * price).toFixed(2),
    investmentPct: +((units * price / capital) * 100).toFixed(1),
    riskAmount: +risk.toFixed(2),
    suggestedStop: +(price - stopDist).toFixed(2)
  };
}

module.exports = { positionSize };
```

---

## BACKEND — routes/ai.js (THE CORE — BUILD WITH PRECISION)

```js
const express = require('express');
const axios = require('axios');
const { calculateIndicators } = require('../utils/indicators');
const { positionSize } = require('../utils/riskEngine');
const router = express.Router();

const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const SYSTEM = `
You are IndoTrade AI — an elite quantitative trading analyst specializing in Indian equity markets (NSE/BSE) and cryptocurrency markets with INR pairs.

YOUR ONLY JOB: Analyze provided live market data and generate one precise trading signal.

SIGNAL RULES — ABSOLUTE, NO EXCEPTIONS:
1. Entry zone = price RANGE (low + high), never a single number
2. Stop loss is MANDATORY. Signal without stop loss = invalid.
3. Max risk per trade = 2% of capital
4. Minimum Risk:Reward = 1:1.5. Reject trade if below this.
5. RSI between 42–58 = sideways = NO_SIGNAL unless strong volume spike
6. Low volume (volumeSignal = LOW) = downgrade confidence by 2 points
7. Confidence below 5 = set signal to NO_SIGNAL automatically
8. Never use words "guaranteed", "certain", "100%", "sure"

INDIA MARKET RULES:
- 9:15–9:30 AM IST = price discovery window = NO signals
- F&O expiry week (last Thursday of month) = flag elevated volatility, reduce size 50%
- Post-earnings = wait 2 sessions before signal

CRYPTO RULES:
- BTC dominance > 55% = prefer BTC/ETH only
- Fear & Greed < 20 = extreme fear = potential reversal zone
- Fear & Greed > 80 = extreme greed = caution, reduce size

TECHNICAL CONFLUENCE REQUIRED (minimum 3 of these must align):
- EMA 20 / 50 / 200 crossover or alignment
- RSI direction + level
- MACD histogram cross direction
- Volume confirmation (HIGH volumeSignal)
- Bollinger Band position
- OBV trend matching price direction

OUTPUT: Respond ONLY in this exact valid JSON. Zero text outside JSON. Zero markdown.

{
  "signal": "BUY or SELL or HOLD or NO_SIGNAL",
  "asset": "symbol",
  "confidence": 1-10,
  "entryZone": { "low": number, "high": number },
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "riskReward": "1:X.X",
  "timeframe": "SCALP or INTRADAY or SWING or POSITIONAL",
  "bestWindow": "e.g. 10:00–11:30 AM IST",
  "invalidation": number,
  "confluences": ["reason1", "reason2", "reason3"],
  "riskWarnings": ["warning if any"],
  "positionNote": "size adjustment note",
  "disclaimer": "Algorithmic analysis only. Not SEBI-registered advice."
}
`;

router.post('/analyze', async (req, res) => {
  const { marketData, assetType, capital = 100000 } = req.body;
  if (!marketData) return res.status(400).json({ error: 'marketData required' });

  let enriched = marketData;
  if (marketData.ohlcv?.length > 0) {
    enriched = {
      ...marketData,
      indicators: calculateIndicators(marketData.ohlcv),
      sizing: positionSize(capital, marketData.price, calculateIndicators(marketData.ohlcv).atr)
    };
  }

  const userMsg = `
ASSET TYPE: ${assetType}
TIME (IST): ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
CAPITAL: ₹${capital.toLocaleString('en-IN')}
LIVE DATA: ${JSON.stringify(enriched, null, 2)}
Generate signal. Respond ONLY in valid JSON.
  `;

  try {
    const { data } = await axios.post(GROQ, {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const signal = JSON.parse(data.choices[0].message.content);
    if (!signal.stopLoss) { signal.signal = 'NO_SIGNAL'; signal.confidence = 0; }

    res.json({ signal, tokens: data.usage.total_tokens, model: MODEL, at: new Date().toISOString() });
  } catch(e) {
    if (e.response?.status === 429) return res.status(429).json({ error: 'Groq rate limit. Wait 60s.' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

---

## FRONTEND — index.html

Full single-page dashboard. Tabs: Dashboard, Equity, F&O, Crypto, Mutual Funds, IPOs, Risk.

**Layout:** Sidebar nav (220px) + top status bar (36px) + main content area. Grid layout.

**Status bar shows:**
- NSE open/closed (auto-detect: 9:15–15:30 IST weekdays)
- Crypto always open
- Live IST clock (updates every second)
- Groq AI status dot

**Dashboard tab contains:**
1. 4 metric cards: NIFTY 50, SENSEX, BTC/INR, Fear & Greed Index
2. AI Signal Engine panel — asset dropdown + capital input + Generate Signal button
3. Watchlist table — 13 symbols with live price, change%, volume, quick-analyze button

**Signal card renders:**
- BUY = teal border + teal glow
- SELL = red border + red glow
- NO_SIGNAL = grey, muted
- Confidence bar (colored fill, animated)
- All fields from AI JSON response displayed cleanly

**Auto-refresh logic:**
- NSE market hours: refresh watchlist every 5 minutes
- Crypto: refresh every 60 seconds
- Outside NSE hours: show "Market Closed" badge, stop equity refresh
- AI generate button: 30-second cooldown after each click (show countdown)

**Signal history:**
- Store last 20 signals in `localStorage`
- Show in collapsible history panel below signal output

---

## FRONTEND — css/style.css

```css
:root {
  --bg: #0a0b0d;
  --surface: #111318;
  --surface2: #1a1d24;
  --border: rgba(255,255,255,0.06);
  --bull: #00d4aa;
  --bear: #ff4466;
  --neutral: #7a7f8e;
  --text: #e8eaf0;
  --text2: #9ea3b0;
  --accent: #7c6af7;
  --warn: #f59e0b;
  --glow-bull: 0 0 24px rgba(0,212,170,0.18);
  --glow-bear: 0 0 24px rgba(255,68,102,0.18);
  --font-mono: 'JetBrains Mono', monospace;
  --font-head: 'Syne', sans-serif;
  --sidebar: 220px;
  --topbar: 36px;
  --r: 8px;
}
```

**Design rules:**
- All backgrounds use CSS variables — no hardcoded hex values in component styles
- Numbers animate on update using a count-up JS function
- Positive change% = `var(--bull)`, negative = `var(--bear)`
- Cards have `border: 1px solid var(--border)` base, upgrade to colored border on signal
- Skeleton loading state on every data card (grey animated shimmer)
- Mobile responsive: sidebar collapses to bottom tab bar on < 768px

---

## FRONTEND — js/api.js

All fetch calls point to backend. Backend URL from a config constant at top of file.

```js
const API = window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : 'https://your-backend.onrender.com/api';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    }).then(r=>r.json())
  }
};
```

---

## FRONTEND — Watchlist Symbols

```js
const EQUITY_WATCHLIST = [
  'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS',
  'WIPRO.NS','BAJFINANCE.NS','ADANIENT.NS','LT.NS','SBIN.NS',
  '^NSEI','^BSESN','^NSEBANK'
];

const CRYPTO_WATCHLIST = ['BTC/INR','ETH/INR','SOL/INR','XRP/INR','BNB/INR','DOGE/INR'];
```

---

## .env

```
GROQ_API_KEY=your_key_here
PORT=3001
FRONTEND_URL=https://your-frontend.onrender.com
NODE_ENV=production
```

---

## render.yaml

```yaml
services:
  - type: web
    name: indotrade-backend
    env: node
    buildCommand: cd backend && npm install
    startCommand: cd backend && node server.js
    envVars:
      - key: GROQ_API_KEY
        sync: false
      - key: NODE_ENV
        value: production
    plan: free

  - type: static
    name: indotrade-frontend
    staticPublishPath: ./frontend
    plan: free
```

---

## MANDATORY DEVELOPER RULES

1. **Never put GROQ_API_KEY in any frontend file.** Backend only. Always.
2. **Every API call needs try/catch + error state in UI.** No silent failures.
3. **Every data card needs a skeleton loading state.** No blank screens while fetching.
4. **AI generate button: 30-second cooldown after press.** Show countdown timer.
5. **Never use `alert()`.** Use toast notifications styled with CSS.
6. **No mock/fake data anywhere.** If an API fails, show error state — not fake numbers.
7. **Signal card must show ALL fields from AI JSON.** No field gets dropped.
8. **Confidence < 5 from AI = render NO_SIGNAL card regardless of signal field value.**
9. **NSE market hours check must use IST timezone.** Not browser local time.
10. **Store last 20 signals in localStorage under key `indotrade_signal_history`.**

---

## SEBI DISCLAIMER (render in footer — always visible)

> Algorithmic analysis only. Not registered with SEBI as an Investment Advisor. Past performance does not guarantee future results. Crypto: RBI advisory applies. F&O involves substantial risk. Verify all signals with a SEBI-registered advisor before trading.

---

*IndoTrade AI | Personal Trading Intelligence | Groq Llama 3.3 70B | Render Free Tier*
