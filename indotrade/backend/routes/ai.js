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
- BTC dominance > 55% = favorable for BTC/ETH signals, flag as positive context. AVOID altcoin signals (SOL, DOGE, XRP, ADA) and warn against them.
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
  "confluences": [
    "RSI at 36.7 — below 40, approaching oversold, bullish divergence forming",
    "EMA 20 (658420) above EMA 50 (654891) — uptrend structure intact",
    "Price at lower Bollinger Band (657800) — mean reversion setup"
  ],
  "riskWarnings": ["warning if any"],
  "positionNote": "size adjustment note",
  "disclaimer": "Algorithmic analysis only. Not SEBI-registered advice."
}
`;

router.post('/analyze', async (req, res) => {
  const { marketData, assetType, capital = 100000 } = req.body;
  if (!marketData) return res.status(400).json({ error: 'marketData required' });

  console.log('[AI INPUT] Asset:', marketData.symbol);
  console.log('[AI INPUT] Current Price:', marketData.price);
  
  let enriched = marketData;
  if (marketData.ohlcv?.length > 0) {
    enriched = {
      ...marketData,
      indicators: calculateIndicators(marketData.ohlcv),
      sizing: positionSize(capital, marketData.price, calculateIndicators(marketData.ohlcv).atr)
    };
  }

  // Add market context for better AI analysis
  let marketContext = '';
  try {
    if (assetType === 'CRYPTO') {
      const fgRes = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
      const fng = fgRes.data?.data?.[0];
      if (fng) {
        enriched.fearGreed = { value: parseInt(fng.value), label: fng.value_classification };
        marketContext += `\nMARKET CONTEXT (CRYPTO):\n- Fear & Greed Index: ${fng.value} (${fng.value_classification})\n- < 20 = extreme fear = potential reversal = bullish\n- > 80 = extreme greed = caution = bearish\n`;
      }
      if (marketData.globalStats) {
        const btcDom = marketData.globalStats.btcDominance;
        if (btcDom) {
          enriched.btcDominance = btcDom;
          marketContext += `- BTC Dominance: ${btcDom}%\n- > 55% = favorable for BTC/ETH, avoid altcoins\n`;
        }
      }
    } else {
      // For equity, add NIFTY context
      const niftyRes = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000
      });
      if (niftyRes.data?.chart?.result?.[0]) {
        const meta = niftyRes.data.chart.result[0].meta;
        const niftyPrice = meta.regularMarketPrice;
        const niftyPrev = meta.previousClose;
        const niftyChange = niftyPrev > 0 ? ((niftyPrice - niftyPrev) / niftyPrev * 100).toFixed(2) : 0;
        enriched.nifty = { price: niftyPrice, changePct: parseFloat(niftyChange) };
        marketContext += `\nMARKET CONTEXT (EQUITY):\n- NIFTY 50: ₹${niftyPrice} (${niftyChange > 0 ? '+' : ''}${niftyChange}%)\n- NIFTY uptrend = favorable for long positions\n- NIFTY downtrend = reduce position size, favor shorts\n`;
      }
    }
  } catch (_) { /* market context is optional */ }

  const userMsg = `
ASSET TYPE: ${assetType}
CURRENT LIVE PRICE (RAW NUMBER, NO COMMAS): ${marketData.price}
CAPITAL (RAW NUMBER): ${capital}
TIME (IST): ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
${marketContext}
CRITICAL RULES FOR THIS SIGNAL:
- Current ${assetType} price is EXACTLY ${marketData.price} rupees
- Entry zone low must be between ${Math.round(marketData.price * 0.99)} and ${Math.round(marketData.price * 1.005)}
- Entry zone high must be between ${Math.round(marketData.price * 0.995)} and ${Math.round(marketData.price * 1.01)}
- Stop loss must be between ${Math.round(marketData.price * 0.97)} and ${Math.round(marketData.price * 0.995)}
- All price values in your JSON must be plain integers or decimals. No commas. No formatting.

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

    if (signal.signal === 'BUY' || signal.signal === 'SELL') {
      const midEntry = (signal.entryZone.low + signal.entryZone.high) / 2;
      const threshold = assetType === 'CRYPTO' ? 0.05 : 0.03;
      const priceDiff = Math.abs(midEntry - marketData.price) / marketData.price;

      if (priceDiff > threshold) {
        console.error(`[INVALID SIGNAL] Entry zone ${midEntry} is ${(priceDiff*100).toFixed(1)}% away from price ${marketData.price}`);
        signal.signal = 'NO_SIGNAL';
        signal.confidence = 0;
        signal.riskWarnings = signal.riskWarnings || [];
        signal.riskWarnings.push(`Entry zone ₹${Math.round(midEntry)} is ${(priceDiff*100).toFixed(1)}% from live price ₹${Math.round(marketData.price)} — AI received bad price data`);
      }
    }

    res.json({ signal, tokens: data.usage.total_tokens, model: MODEL, at: new Date().toISOString() });
  } catch(e) {
    if (e.response?.status === 429) return res.status(429).json({ error: 'Groq rate limit. Wait 60s.' });
    res.status(500).json({ error: e.message });
  }
});

// Batch AI Analysis — analyze all assets, rank by potential, detailed plan for top picks
router.post('/batch', async (req, res) => {
  const { assets, capital = 100000, topN = 5 } = req.body;
  if (!assets || !Array.isArray(assets) || assets.length === 0) {
    return res.status(400).json({ error: 'assets array required' });
  }

  try {
    const SAPI = 'https://sapi.zebpay.com/api/v2';
    const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
    const results = [];

    // Process each asset: fetch data + calculate indicators + score
    for (const asset of assets) {
      try {
        let ohlcv = [];
        let price = 0;
        let changePct = 0;

        if (asset.type === 'CRYPTO') {
          const end = Math.floor(Date.now() / 1000);
          const start = end - 90 * 24 * 60 * 60;
          const [klinesRes, tickerRes] = await Promise.allSettled([
            axios.get(`${SAPI}/market/klines`, { params: { symbol: asset.symbol, interval: '1h', startTime: start, endTime: end }, timeout: 8000 }),
            axios.get(`${SAPI}/market/ticker`, { params: { symbol: asset.symbol }, timeout: 5000 })
          ]);
          if (klinesRes.status === 'fulfilled') {
            const raw = klinesRes.value.data?.data || [];
            ohlcv = raw.map(([time, open, high, low, close]) => ({
              time: +time, open: +open, high: +high, low: +low, close: +close
            })).filter(c => c.close > 0);
          }
          if (tickerRes.status === 'fulfilled') {
            const t = tickerRes.value.data?.data;
            price = parseFloat(t?.last) || 0;
            changePct = parseFloat(t?.percentage) || 0;
          }
        } else {
          const yfRes = await axios.get(`${YF}${asset.symbol}?interval=1d&range=6mo`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
          });
          if (yfRes.data?.chart?.result?.[0]) {
            const meta = yfRes.data.chart.result[0].meta;
            const q = yfRes.data.chart.result[0].indicators.quote[0];
            const ts = yfRes.data.chart.result[0].timestamp;
            ohlcv = ts.map((t, i) => ({
              time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i]
            })).filter(c => c.close !== null);
            price = meta.regularMarketPrice;
            const prev = meta.previousClose;
            changePct = prev > 0 ? ((price - prev) / prev * 100) : 0;
          }
        }

        if (ohlcv.length >= 30 && price > 0) {
          const indicators = calculateIndicators(ohlcv);
          const score = scoreIndicators(indicators);
          results.push({
            symbol: asset.symbol,
            type: asset.type,
            name: asset.symbol.replace('.NS', '').replace('-INR', ''),
            price, changePct: +changePct.toFixed(2),
            rsi: indicators.rsi,
            trend: indicators.trend,
            macd: indicators.macdCross,
            volume: indicators.volumeSignal,
            bb: indicators.bbPosition,
            obv: indicators.obvTrend,
            score,
            signal: score >= 2 ? 'STRONG BUY' : score >= 1 ? 'BUY' : score <= -2 ? 'STRONG SELL' : score <= -1 ? 'SELL' : 'HOLD',
            indicators
          });
        }
      } catch (_) {}
    }

    // Sort by absolute score (strongest signals first)
    results.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    // Send top N candidates to Groq for detailed trade plans
    const topCandidates = results.slice(0, topN);
    const detailedPlans = [];

    for (const candidate of topCandidates) {
      try {
        const enriched = {
          symbol: candidate.symbol,
          price: candidate.price,
          indicators: candidate.indicators,
          sizing: positionSize(capital, candidate.price, candidate.indicators?.atr)
        };

        const signal = await callGroq(enriched, candidate.type, capital);
        detailedPlans.push({
          ...candidate,
          tradePlan: signal,
          planTokens: signal._tokens || 0
        });
      } catch (e) {
        detailedPlans.push({
          ...candidate,
          tradePlan: { signal: candidate.signal, confidence: candidate.score >= 2 ? 7 : candidate.score >= 1 ? 5 : 3, error: e.message }
        });
      }
    }

    res.json({
      ranked: results,
      detailedPlans,
      totalAnalyzed: results.length,
      topN: detailedPlans.length,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function scoreIndicators(ind) {
  let score = 0;
  if (ind.rsiSignal === 'OVERSOLD') score += 2;
  else if (ind.rsiSignal === 'NEAR_OVERSOLD') score += 1;
  else if (ind.rsiSignal === 'OVERBOUGHT') score -= 2;
  else if (ind.rsiSignal === 'NEAR_OVERBOUGHT') score -= 1;
  if (ind.macdCross === 'BULLISH') score += 2;
  else if (ind.macdCross === 'BEARISH') score -= 2;
  if (ind.trend === 'UPTREND') score += 1;
  else if (ind.trend === 'DOWNTREND') score -= 1;
  if (ind.volumeSignal === 'HIGH') score += 1;
  else if (ind.volumeSignal === 'LOW') score -= 1;
  if (ind.bbPosition === 'BELOW') score += 1;
  else if (ind.bbPosition === 'ABOVE') score -= 1;
  if (ind.obvTrend === 'RISING') score += 1;
  else if (ind.obvTrend === 'FALLING') score -= 1;
  return score;
}

async function callGroq(enriched, assetType, capital) {
  const marketContext = assetType === 'CRYPTO'
    ? 'CRYPTO market — use Fear & Greed and BTC dominance if available in data'
    : 'EQUITY market — use NIFTY trend if available in data';

  const userMsg = `
ASSET TYPE: ${assetType}
CURRENT PRICE: ${enriched.price}
CAPITAL: ${capital}
${marketContext}

DATA: ${JSON.stringify(enriched, null, 2)}

Generate trade plan. Respond ONLY in valid JSON.
  `;

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
  signal._tokens = data.usage?.total_tokens || 0;
  return signal;
}

module.exports = router;
