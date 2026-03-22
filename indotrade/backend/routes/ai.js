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

  const userMsg = `
ASSET TYPE: ${assetType}
CURRENT LIVE PRICE (RAW NUMBER, NO COMMAS): ${marketData.price}
CAPITAL (RAW NUMBER): ${capital}
TIME (IST): ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

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

module.exports = router;
