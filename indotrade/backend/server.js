require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const tickerWs = require('./services/tickerWs');
const { assessPortfolioRisk, calculatePositionRisk } = require('./utils/riskEngine');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api/equity', require('./routes/equity'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/mf', require('./routes/mf'));
app.use('/api/ipo', require('./routes/ipo'));
app.use('/api/fo', require('./routes/fo'));
app.use('/api/ai', require('./routes/ai'));

// Risk Engine API
app.post('/api/risk/portfolio', (req, res) => {
  try {
    const { portfolio, capital } = req.body;
    if (!portfolio || !Array.isArray(portfolio)) {
      return res.status(400).json({ error: 'portfolio array required' });
    }
    const assessment = assessPortfolioRisk(portfolio, capital || 100000);
    res.json(assessment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/risk/position', (req, res) => {
  try {
    const { position, marketData } = req.body;
    if (!position) {
      return res.status(400).json({ error: 'position data required' });
    }
    const risk = calculatePositionRisk(position, marketData);
    res.json(risk);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unified Watchlist — all crypto + equity with live prices and lightweight recommendations
const axios = require('axios');
const EQUITY_SYMBOLS = [
  'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS','WIPRO.NS',
  'BAJFINANCE.NS','ADANIENT.NS','LT.NS','SBIN.NS','HINDUNILVR.NS','ITC.NS',
  'AXISBANK.NS','KOTAKBANK.NS','ASIANPAINT.NS','MARUTI.NS','TITAN.NS',
  'SUNPHARMA.NS','DRREDDY.NS','BHARTIARTL.NS','NTPC.NS','POWERGRID.NS',
  'COALINDIA.NS','ONGC.NS','TATASTEEL.NS','JSWSTEEL.NS','HINDALCO.NS',
  'ULTRACEMCO.NS','NESTLEIND.NS','BAJAJFINSV.NS','TATAMOTORS.NS',
  'M&M.NS','EICHERMOT.NS','HEROMOTOCO.NS','CIPLA.NS','DIVISLAB.NS',
  'TECHM.NS','HCLTECH.NS','BPCL.NS','INDUSINDBK.NS',
  'ZOMATO.NS','DMART.NS','PIIND.NS','PERSISTENT.NS','COFORGE.NS',
  'TRENT.NS','VBL.NS','LTIM.NS','SBILIFE.NS','HDFCLIFE.NS',
  '^NSEI','^BSESN','^NSEBANK'
];

app.get('/api/watchlist/unified', async (req, res) => {
  try {
    // Fetch crypto from ZebPay SAPI + equity from Yahoo Finance in parallel
    const SAPI = 'https://sapi.zebpay.com/api/v2';
    const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

    const [tickersRes, equityResults] = await Promise.allSettled([
      axios.get(`${SAPI}/market/allTickers`, { timeout: 8000 }),
      Promise.allSettled(EQUITY_SYMBOLS.map(s =>
        axios.get(`${YF}${s}?interval=5m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 })
      ))
    ]);

    // Process crypto — prefer WebSocket real-time prices
    const allTickers = tickersRes.status === 'fulfilled' ? (tickersRes.value.data?.data || []) : [];
    const cryptoItems = allTickers
      .filter(t => t.symbol.endsWith('-INR'))
      .map(t => {
        const ws = tickerWs.getTicker(t.symbol);
        const price = parseFloat(t.last) || ws?.price || 0;
        const avg = parseFloat(t.average) || 0;
        const spread = parseFloat(t.ask) - parseFloat(t.bid);
        const spreadPct = price > 0 ? (spread / price * 100) : 0;
        // For illiquid pairs (>10% spread), use average-based % to avoid inflated values
        const pct = spreadPct > 10 && avg > 0
          ? +((price - avg) / avg * 100).toFixed(2)
          : (parseFloat(t.percentage) || 0);
        const vol = parseFloat(t.quoteVolume) || 0;
        let rec = 'HOLD', conf = 5;
        if (pct > 5) { rec = 'BUY'; conf = 7; }
        else if (pct > 2) { rec = 'BUY'; conf = 6; }
        else if (pct < -5) { rec = 'SELL'; conf = 7; }
        else if (pct < -2) { rec = 'SELL'; conf = 6; }
        return {
          type: 'CRYPTO', symbol: t.symbol, name: t.symbol.split('-')[0],
          price, changePct: pct,
          volume: vol, recommendation: rec, confidence: conf
        };
      });

    // Process equity
    const eqResults = equityResults.status === 'fulfilled' ? equityResults.value : [];
    const equityItems = EQUITY_SYMBOLS.map((sym, i) => {
      const r = eqResults[i];
      if (r.status !== 'fulfilled') return null;
      try {
        const meta = r.value.data.chart.result[0].meta;
        const price = Number(meta.regularMarketPrice);
        const prev = Number(meta.previousClose);
        const pct = prev && prev !== 0 ? +(((price - prev) / prev) * 100).toFixed(2) : 0;
        const vol = meta.regularMarketVolume || 0;
        let rec = 'HOLD', conf = 5;
        if (pct > 3) { rec = 'BUY'; conf = 7; }
        else if (pct > 1) { rec = 'BUY'; conf = 6; }
        else if (pct < -3) { rec = 'SELL'; conf = 7; }
        else if (pct < -1) { rec = 'SELL'; conf = 6; }
        return {
          type: 'EQUITY', symbol: sym, name: sym.replace('.NS', '').replace('^', ''),
          price, changePct: pct, volume: vol,
          recommendation: rec, confidence: conf
        };
      } catch (_) { return null; }
    }).filter(Boolean);

    res.json({ crypto: cryptoItems, equity: equityItems, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});
