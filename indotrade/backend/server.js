require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const tickerWs = require('./services/tickerWs');
const { assessPortfolioRisk, calculatePositionRisk } = require('./utils/riskEngine');

const app = express();
app.set('trust proxy', 1); // Trust Render's proxy for rate limiting
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
    validate: { xForwardedForHeader: false }, // Disable X-Forwarded-For validation (Render proxy)
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
const { calculateIndicators } = require('./utils/indicators');

// NIFTY 50 + NIFTY Next 50 + Sector Leaders (~100 symbols)
const EQUITY_SYMBOLS = [
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
  // NIFTY Next 50 / Large Cap
  'ZOMATO.NS','DMART.NS','TRENT.NS','VBL.NS','PIIND.NS','PERSISTENT.NS',
  'COFORGE.NS','JIOFIN.NS','ICICIPRULI.NS','LICI.NS','MAXHEALTH.NS',
  'TATAPOWER.NS','ABB.NS','SIEMENS.NS','BOSCHLTD.NS','HAVELLS.NS',
  'PIDILITIND.NS','DABUR.NS','GODREJCP.NS','MARICO.NS','COLPAL.NS',
  'BERGEPAINT.NS','VEDL.NS','NMDC.NS','SAIL.NS','NATIONALUM.NS',
  'BANKBARODA.NS','PNB.NS','CANFINHOME.NS','LICHSGFIN.NS',
  'BHEL.NS','HAL.NS','BEL.NS','COCHINSHIP.NS','IRCTC.NS',
  // Mid Cap / High Growth
  'DEEPAKNTR.NS','ATUL.NS','CLEAN.NS','LALPATHLAB.NS','METROPOLIS.NS',
  'STARHEALTH.NS','POLICYBZR.NS','NYKAA.NS','PAYTM.NS','DELHIVERY.NS',
  'MAPMYINDIA.NS','KPITTECH.NS','TATAELXSI.NS','MPHASIS.NS','OFSS.NS',
  'BALKRISIND.NS','MRF.NS','CEATLTD.NS','EXIDEIND.NS','AMBUJACEM.NS',
  'ACC.NS','SHREECEM.NS','DALBHARAT.NS','RAMCOCEM.NS',
  // Indices
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

// Signal Scan — batch technical analysis across top assets, ranked by composite score
app.get('/api/signals/scan', async (req, res) => {
  try {
    const type = (req.query.type || 'all').toLowerCase(); // equity, crypto, all
    const limit = Math.min(parseInt(req.query.limit) || 10, 25);
    const SAPI = 'https://sapi.zebpay.com/api/v2';
    const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

    const results = [];

    // Scan equity (top 20 by fetching batch, then scoring)
    if (type === 'equity' || type === 'all') {
      const topEqSymbols = EQUITY_SYMBOLS.filter(s => !s.startsWith('^')).slice(0, 30);
      const eqResults = await Promise.allSettled(topEqSymbols.map(s =>
        axios.get(`${YF}${s}?interval=1d&range=3mo`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
      ));
      eqResults.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        try {
          const meta = r.value.data.chart.result[0].meta;
          const q = r.value.data.chart.result[0].indicators.quote[0];
          const ts = r.value.data.chart.result[0].timestamp;
          const ohlcv = ts.map((t, j) => ({
            time: t, open: q.open[j], high: q.high[j], low: q.low[j],
            close: q.close[j], volume: q.volume[j]
          })).filter(c => c.close !== null);
          if (ohlcv.length < 30) return;
          const indicators = calculateIndicators(ohlcv);
          const score = compositeScore(indicators);
          const prev = Number(meta.previousClose);
          const pct = prev > 0 ? +((meta.regularMarketPrice - prev) / prev * 100).toFixed(2) : 0;
          results.push({
            type: 'EQUITY', symbol: topEqSymbols[i], name: topEqSymbols[i].replace('.NS', ''),
            price: meta.regularMarketPrice, changePct: pct,
            rsi: indicators.rsi, trend: indicators.trend,
            macd: indicators.macdCross, volume: indicators.volumeSignal,
            score, signal: score >= 2 ? 'STRONG BUY' : score >= 1 ? 'BUY' : score <= -2 ? 'STRONG SELL' : score <= -1 ? 'SELL' : 'HOLD'
          });
        } catch (_) {}
      });
    }

    // Scan crypto (top 30 by volume from ZebPay klines)
    if (type === 'crypto' || type === 'all') {
      const tickersRes = await axios.get(`${SAPI}/market/allTickers`, { timeout: 8000 });
      const topCrypto = (tickersRes.data?.data || [])
        .filter(t => t.symbol.endsWith('-INR'))
        .sort((a, b) => parseFloat(b.quoteVolume || 0) - parseFloat(a.quoteVolume || 0))
        .slice(0, 30);

      const cryptoKlines = await Promise.allSettled(topCrypto.map(t => {
        const end = Math.floor(Date.now() / 1000);
        const start = end - 90 * 24 * 60 * 60;
        return axios.get(`${SAPI}/market/klines`, {
          params: { symbol: t.symbol, interval: '1d', startTime: start, endTime: end },
          timeout: 8000
        });
      }));

      topCrypto.forEach((t, i) => {
        const r = cryptoKlines[i];
        if (r.status !== 'fulfilled') return;
        try {
          const raw = r.value.data?.data || [];
          const ohlcv = raw.map(([time, open, high, low, close]) => ({
            time: +time, open: +open, high: +high, low: +low, close: +close
          })).filter(c => c.close > 0);
          if (ohlcv.length < 30) return;
          const indicators = calculateIndicators(ohlcv);
          const score = compositeScore(indicators);
          const pct = parseFloat(t.percentage) || 0;
          results.push({
            type: 'CRYPTO', symbol: t.symbol, name: t.symbol.split('-')[0],
            price: parseFloat(t.last) || 0, changePct: pct,
            rsi: indicators.rsi, trend: indicators.trend,
            macd: indicators.macdCross, volume: indicators.volumeSignal,
            score, signal: score >= 2 ? 'STRONG BUY' : score >= 1 ? 'BUY' : score <= -2 ? 'STRONG SELL' : score <= -1 ? 'SELL' : 'HOLD'
          });
        } catch (_) {}
      });
    }

    // Rank by score
    results.sort((a, b) => b.score - a.score);
    const topBuys = results.filter(r => r.score >= 1).slice(0, limit);
    const topSells = results.filter(r => r.score <= -1).slice(0, limit);
    const topHolds = results.filter(r => r.score === 0).slice(0, limit);

    res.json({
      topBuys, topSells, topHolds,
      totalScanned: results.length,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Composite signal score: +1 to +5 for bullish, -1 to -5 for bearish
function compositeScore(ind) {
  let score = 0;
  // RSI
  if (ind.rsiSignal === 'OVERSOLD') score += 2;
  else if (ind.rsiSignal === 'NEAR_OVERSOLD') score += 1;
  else if (ind.rsiSignal === 'OVERBOUGHT') score -= 2;
  else if (ind.rsiSignal === 'NEAR_OVERBOUGHT') score -= 1;
  // MACD
  if (ind.macdCross === 'BULLISH') score += 2;
  else if (ind.macdCross === 'BEARISH') score -= 2;
  // Trend
  if (ind.trend === 'UPTREND') score += 1;
  else if (ind.trend === 'DOWNTREND') score -= 1;
  // Volume confirmation
  if (ind.volumeSignal === 'HIGH') score += 1;
  else if (ind.volumeSignal === 'LOW') score -= 1;
  // Bollinger
  if (ind.bbPosition === 'BELOW') score += 1;
  else if (ind.bbPosition === 'ABOVE') score -= 1;
  // OBV
  if (ind.obvTrend === 'RISING') score += 1;
  else if (ind.obvTrend === 'FALLING') score -= 1;
  return score;
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});
