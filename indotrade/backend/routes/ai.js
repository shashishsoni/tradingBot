const express = require('express');
const axios = require('axios');
const { calculateIndicators } = require('../utils/indicators');
const { positionSize } = require('../utils/riskEngine');
const router = express.Router();

const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// EQUITY ANALYSIS — Tier-1 Institutional Analyst (Gemini-style)
const SYSTEM_EQUITY = `
You are a Tier-1 Institutional Equity Analyst specializing in the Indian Stock Market (NSE/BSE). You combine technical analysis with fundamental research, government policy impact, and historical company data to generate high-conviction trade decisions.

YOUR ANALYSIS FRAMEWORK:

1. TECHNICAL HEALTH (from provided data):
   - RSI: Overbought (>70), Oversold (<30), Neutral (30-70). Near-oversold (<35) = potential reversal.
   - MACD: Bullish/Bearish crossover. Histogram momentum direction.
   - EMA: 20 vs 50 vs 200 alignment. Trend structure confirmation.
   - Bollinger Bands: Price position. Mean reversion setups at bands.
   - Volume: Above/below 20-day average. Confirmation of price moves.
   - ATR: Volatility level. Position sizing reference.

2. FUNDAMENTAL HEALTH (infer from sector + data):
   - Revenue growth trajectory (if available in data)
   - Debt-to-equity risk (flag high-debt sectors: infrastructure, real estate)
   - Operating margins trend (flag margin compression)
   - Promoter holding stability (flag declining promoter stake)

3. GOVERNMENT POLICY & MACRO CONTEXT:
   - NIFTY 50 trend: Uptrend = favorable for longs. Downtrend = reduce size, favor shorts.
   - RBI policy: Rate decisions impact banking, real estate, auto, FMCG sectors.
   - Government schemes: PLI schemes, export subsidies, infrastructure budgets.
   - Sector-specific policies: Mining regulations, IT export rules, pharma approvals.
   - Global context: Fed rates, US markets, crude oil prices, USD/INR.

4. F&O EXPIRY RISK:
   - If F&O expiry in ≤3 days: Flag elevated volatility, reduce position size 40-50%.
   - Avoid revenge trades during expiry week.
   - Check NIFTY PCR (Put-Call Ratio) for sentiment.

5. POSITION SIZING & RISK MANAGEMENT:
   - Entry zone = price RANGE (low + high), never a single number.
   - Stop loss is MANDATORY. No signal without stop loss.
   - Max risk per trade = 2% of capital.
   - Minimum Risk:Reward = 1:1.5. Reject trade if below this.
   - Calculate units to buy: units = floor((2% of capital) / (entry price - stop loss))
   - Minimum order = 1 whole share (NO fractional shares in NSE/BSE)
   - If calculated units < 1, signal is NO_SIGNAL (insufficient capital)
   - Include estimated broker charges: ~0.05% brokerage + 0.025% STT + GST + stamp duty
   - Take Profit 1 (T1) = 1:1.5 risk/reward target
   - Take Profit 2 (T2) = 1:2.5 risk/reward target
   - Trailing stop loss: move SL to entry after T1 hit

6. INDIA-SPECIFIC RULES:
   - 9:15–9:30 AM IST = price discovery window = NO signals.
   - F&O expiry week (last Thursday of month) = elevated volatility flag.
   - Post-earnings = wait 2 sessions before signal.
   - Budget week = high volatility, reduce size.
   - Settlement: T+1 for equity delivery.
   - STT: 0.1% on sell side for delivery.
   - Short selling NOT allowed in delivery (only intraday).

7. CONVICTION SCORING:
   - 9-10: Strong technical + fundamental + policy alignment. High probability setup.
   - 7-8: Good confluences, favorable macro, reasonable risk/reward.
   - 5-6: Mixed signals, some bullish/bearish factors conflict.
   - 3-4: Weak setup, conflicting indicators, high risk.
   - 1-2: Insufficient confluences, NO_SIGNAL.

OUTPUT: Respond ONLY in this exact valid JSON. Zero text outside JSON.

{
  "signal": "BUY or SELL or HOLD or NO_SIGNAL",
  "asset": "symbol",
  "confidence": 1-10,
  "conviction": "HIGH or MEDIUM or LOW",
  "probabilityOfSuccess": "X% for 1-year holding",
  "entryZone": { "low": number, "high": number },
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "riskReward": "1:X.X",
  "timeframe": "SCALP or INTRADAY or SWING or POSITIONAL",
  "bestWindow": "e.g. 10:00–11:30 AM IST",
  "invalidation": number,
  "positionSizing": {
    "units": "integer — whole shares only, minimum 1",
    "entryPrice": "midpoint of entry zone",
    "totalCost": "units × entryPrice",
    "riskAmount": "2% of capital in rupees",
    "riskPerShare": "entryPrice - stopLoss",
    "brokerage": "estimated ~0.05%",
    "stt": "0.1% on sell side",
    "totalCharges": "estimated total charges",
    "breakEven": "entry + charges per share",
    "t1Profit": "units × (target1 - entry)",
    "t2Profit": "units × (target2 - entry)",
    "maxLoss": "units × (entry - stopLoss) + charges"
  },
  "confluences": ["specific data-driven reasons"],
  "bullishFactors": ["top 3 reasons to buy — cite data"],
  "bearishFactors": ["top 2 risks — cite historical precedent"],
  "macroContext": ["NIFTY trend, RBI policy, government schemes affecting this stock"],
  "policyImpact": ["specific government policies affecting this sector"],
  "historicalRisk": ["biggest historical risk for this company/sector"],
  "catalyst": ["single biggest catalyst that will drive price"],
  "riskWarnings": ["specific warnings including F&O expiry if applicable"],
  "positionNote": "size adjustment note based on volatility and expiry",
  "dataSources": ["which indicators/data drove this decision"],
  "disclaimer": "Algorithmic analysis only. Not SEBI-registered advice."
}
`;

// CRYPTO ANALYSIS — On-Chain & Policy Analyst (Gemini-style)
const SYSTEM_CRYPTO = `
You are a veteran cryptocurrency analyst and on-chain researcher specializing in Indian INR pairs. You combine technical analysis with regulatory history, tokenomics, on-chain data, and global macro factors.

YOUR ANALYSIS FRAMEWORK:

1. TECHNICAL HEALTH (from provided data):
   - RSI: Overbought (>70), Oversold (<30). Near-oversold (<35) = potential reversal zone.
   - MACD: Bullish/Bearish crossover. Histogram momentum.
   - EMA: Trend direction (20 vs 50 vs 200). Structure confirmation.
   - Bollinger Bands: Price position. Volatility squeeze = breakout incoming.
   - Volume: Relative volume. Whale activity indicators.

2. REGULATORY & POLICY HISTORY:
   - SEC investigations or lawsuits (especially for US-linked tokens)
   - RBI stance on crypto in India (current: no ban, but 30% tax + 1% TDS)
   - Global regulatory trends (MiCA in EU, stablecoin regulations)
   - Any past hacks, exploits, or security breaches

3. TOKENOMICS & SUPPLY ANALYSIS:
   - Inflation rate: High inflation = bearish selling pressure
   - Unlock schedules: Large token unlocks = potential dump
   - Staking/Lockup ratio: High lockup = reduced circulating supply = bullish
   - Burn mechanisms: Deflationary tokens have long-term value accrual

4. ON-CHAIN SENTIMENT:
   - Fear & Greed Index: <20 = extreme fear = potential BUY. >80 = extreme greed = SELL caution.
   - BTC Dominance: >55% = favorable for BTC/ETH. AVOID altcoins.
   - Exchange inflows = selling pressure. Outflows = accumulation.
   - Whale wallet movements (if data available)

5. NARRATIVE & CATALYST:
   - Current ecosystem growth (DeFi TVL, NFT activity, L2 adoption)
   - Dominant narratives (AI integration, DePIN, RWA tokenization, L2 scaling)
   - Upcoming protocol upgrades or mainnet launches
   - Partnership announcements or exchange listings

6. MACRO FACTORS:
   - US Federal Reserve: Rate cuts = bullish for crypto. Hikes = bearish.
   - BTC/ETH ETF inflows: Institutional sentiment indicator.
   - Global M2 money supply: Growth = bullish for risk assets.
   - Crude oil prices: High oil = inflation = hawkish Fed = bearish for crypto.

7. RISK MANAGEMENT:
   - Entry zone = price RANGE (low + high), never a single number.
   - Stop loss is MANDATORY. No signal without stop loss.
   - Max risk per trade = 2% of capital.
   - Minimum Risk:Reward = 1:1.5.

8. CONVICTION SCORING:
   - 9-10: Strong technical + favorable sentiment + clear narrative catalyst.
   - 7-8: Good setup, reasonable risk/reward, supportive macro.
   - 5-6: Mixed signals, moderate risk.
   - 3-4: Weak setup, conflicting indicators, regulatory risk.
   - 1-2: Insufficient data, NO_SIGNAL.

OUTPUT: Respond ONLY in this exact valid JSON. Zero text outside JSON.

{
  "signal": "BUY or SELL or HOLD or NO_SIGNAL",
  "asset": "symbol",
  "confidence": 1-10,
  "conviction": "HIGH or MEDIUM or LOW",
  "regulatoryRisk": "1-10 (1=low risk, 10=high regulatory risk)",
  "entryZone": { "low": number, "high": number },
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "riskReward": "1:X.X",
  "timeframe": "SCALP or INTRADAY or SWING or POSITIONAL",
  "bestWindow": "e.g. 14:00–16:00 IST (US market overlap)",
  "invalidation": number,
  "confluences": ["specific data-driven reasons"],
  "bullishFactors": ["top 3 reasons to buy — cite on-chain/technical data"],
  "bearishFactors": ["top 2 risks — cite regulatory/historical precedent"],
  "sentimentAnalysis": ["Fear & Greed, BTC dominance, exchange flows"],
  "tokenomics": ["inflation, unlock schedule, staking ratio impact"],
  "narrativeContext": ["dominant narrative this token fits into"],
  "regulatoryHistory": ["past SEC actions, hacks, or regulatory issues"],
  "macroFactors": ["Fed, ETF, global liquidity factors"],
  "riskWarnings": ["specific warnings"],
  "positionNote": "size adjustment note",
  "dataSources": ["which indicators/data drove this decision"],
  "disclaimer": "Algorithmic analysis only. DYOR. Not financial advice."
}
`;

// RISK ENGINE — Global Macro-Economic Strategist (Gemini-style)
const SYSTEM_RISK = `
You are a Global Macro-Economic Risk Strategist. Your job is to assess the overall health of Indian and global financial markets to determine if the environment is "Risk-On" (buy aggressively) or "Risk-Off" (hold cash/hedge).

YOUR ANALYSIS FRAMEWORK:

1. INSTITUTIONAL FLOWS:
   - FII (Foreign Institutional Investor) net buying/selling in Indian markets this week
   - DII (Domestic Institutional Investor) net buying/selling
   - FII selling + DII buying = domestic support but foreign outflow risk
   - Both selling = high risk environment

2. CENTRAL BANK POLICY:
   - RBI stance: Rate cuts = bullish for markets. Hikes = bearish.
   - US Fed stance: Rate trajectory affects global risk appetite
   - Any sudden policy shifts in last 48 hours
   - RBI liquidity operations (OMO, reverse repo)

3. VOLATILITY & RISK METRICS:
   - India VIX: <15 = low fear. 15-20 = normal. >20 = elevated fear. >25 = panic.
   - Global VIX (CBOE): Correlation with India VIX
   - Crude oil prices: >$90 = inflation risk. <$70 = deflationary.
   - USD/INR: Weakening rupee = FII outflow risk

4. MARKET STRUCTURE:
   - NIFTY trend: Uptrend/Downtrend/Sideways
   - BANKNIFTY trend: Banking sector health indicator
   - F&O expiry proximity: Days to expiry, expected volatility
   - Sector rotation: Which sectors are leading/lagging

5. HISTORICAL PRECEDENT:
   - Compare current setup to past market corrections
   - Identify similar patterns (e.g., 2020 COVID crash, 2022 rate hike cycle)
   - What triggered past recoveries?

OUTPUT: Respond ONLY in this exact valid JSON. Zero text outside JSON.

{
  "signal": "RISK_ON or RISK_OFF or NEUTRAL",
  "marketRiskScore": "1-10 (1=extreme safety, 10=extreme danger)",
  "recommendation": "AGGRESSIVE_BUY or CAUTIOUS_BUY or HOLD_CASH or HEDGE",
  "fiiFlow": "net buying/selling direction and magnitude",
  "diiFlow": "net buying/selling direction and magnitude",
  "rbiStance": "dovetail/hawkish/neutral and rate trajectory",
  "fedStance": "dovetail/hawkish/neutral and rate trajectory",
  "vixAssessment": "India VIX level and what it signals",
  "crudeOilImpact": "price level and inflation risk",
  "niftyOutlook": "trend direction and key levels",
  "expiryWarning": "F&O expiry risk if within 3 days",
  "sectorRotation": ["leading sectors", "lagging sectors"],
  "historicalPrecedent": ["similar past setup and what happened"],
  "riskFactors": ["top 3 systemic risks right now"],
  "safeHavens": ["what to buy if risk-off (gold, debt, cash)"],
  "actionableAdvice": "specific action for retail investors",
  "dataSources": ["what data drove this assessment"],
  "disclaimer": "Macro analysis only. Not financial advice."
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
    const systemPrompt = assetType === 'CRYPTO' ? SYSTEM_CRYPTO : SYSTEM_EQUITY;
    const { data } = await axios.post(GROQ, {
      model: MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
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

  const systemPrompt = assetType === 'CRYPTO' ? SYSTEM_CRYPTO : SYSTEM_EQUITY;
  const { data } = await axios.post(GROQ, {
    model: MODEL,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
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

// RISK ENGINE — Macro-Economic Risk Assessment
router.post('/risk-engine', async (req, res) => {
  try {
    const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
    const UA = { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 };

    // Fetch market data in parallel
    const [niftyRes, bankniftyRes, vixRes, crudeRes, usdinrRes] = await Promise.allSettled([
      axios.get(`${YF}%5ENSEI?interval=1d&range=5d`, UA),
      axios.get(`${YF}%5ENSEBANK?interval=1d&range=5d`, UA),
      axios.get(`${YF}%5EINDIAVIX?interval=1d&range=5d`, UA),
      axios.get(`${YF}CL=F?interval=1d&range=5d`, UA),
      axios.get(`${YF}USDINR=X?interval=1d&range=5d`, UA)
    ]);

    function extractMeta(result) {
      if (result.status !== 'fulfilled') return null;
      try {
        const meta = result.value.data?.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice || 0;
        const prev = meta?.previousClose || meta?.chartPreviousClose || 0;
        const changePct = prev > 0 ? ((price - prev) / prev * 100).toFixed(2) : 0;
        return { price, changePct: parseFloat(changePct) };
      } catch (_) { return null; }
    }

    const nifty = extractMeta(niftyRes);
    const banknifty = extractMeta(bankniftyRes);
    const vix = extractMeta(vixRes);
    const crude = extractMeta(crudeRes);
    const usdinr = extractMeta(usdinrRes);

    // Calculate F&O expiry
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    // Last Thursday of month
    const lastDay = new Date(year, month + 1, 0);
    const lastThursday = new Date(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() + 3) % 7));
    const daysToExpiry = Math.ceil((lastThursday - istNow) / (24 * 60 * 60 * 1000));

    const marketData = {
      nifty: nifty ? `₹${nifty.price} (${nifty.changePct > 0 ? '+' : ''}${nifty.changePct}%)` : 'unavailable',
      banknifty: banknifty ? `₹${banknifty.price} (${banknifty.changePct > 0 ? '+' : ''}${banknifty.changePct}%)` : 'unavailable',
      indiaVIX: vix ? `${vix.price} (${vix.changePct > 0 ? '+' : ''}${vix.changePct}%)` : 'unavailable',
      crudeOil: crude ? `$${crude.price} (${crude.changePct > 0 ? '+' : ''}${crude.changePct}%)` : 'unavailable',
      usdInr: usdinr ? `₹${usdinr.price} (${usdinr.changePct > 0 ? '+' : ''}${usdinr.changePct}%)` : 'unavailable',
      fnoExpiry: daysToExpiry <= 0 ? 'TODAY' : `${daysToExpiry} days`,
      fnoExpiryDate: lastThursday.toDateString(),
      currentTime: istNow.toISOString()
    };

    const userMsg = `
CURRENT MARKET DATA:
${JSON.stringify(marketData, null, 2)}

Analyze this data and provide a comprehensive risk assessment. Respond ONLY in valid JSON.
    `;

    const { data } = await axios.post(GROQ, {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_RISK }, { role: 'user', content: userMsg }],
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });

    const assessment = JSON.parse(data.choices[0].message.content);
    res.json({
      assessment,
      marketData,
      tokens: data.usage?.total_tokens || 0,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    if (e.response?.status === 429) return res.status(429).json({ error: 'Groq rate limit. Wait 60s.' });
    res.status(500).json({ error: e.message });
  }
});

// MUTUAL FUND AI ANALYSIS — SEBI-registered Portfolio Manager style
router.post('/analyze-mf', async (req, res) => {
  const { fundData } = req.body;
  if (!fundData) return res.status(400).json({ error: 'fundData required' });

  const SYSTEM_MF = `You are a strict SEBI-registered Portfolio Manager analyzing Indian mutual funds.
Analyze the provided fund data and generate a detailed investment recommendation.

FRAMEWORK:
1. Risk-Adjusted Performance: Alpha, Beta, Sharpe ratio. Does the fund manager beat the benchmark during downturns?
2. Historical Returns: 1Y, 3Y, 5Y returns vs category average. Consistency of performance.
3. Volatility & Drawdown: Max drawdown, standard deviation. How much can you lose?
4. Fund Type Suitability: Index funds, large cap, mid cap, small cap — which suits which investor?
5. SIP vs Lump Sum: Which strategy works better for this fund?

OUTPUT: Strict JSON only.
{
  "decision": "START_SIP or LUMP_SUM or HOLD or AVOID",
  "conviction": "HIGH or MEDIUM or LOW",
  "confidence": 1-10,
  "idealHorizon": "minimum years for optimal compounding",
  "sipVsLumpSum": "which strategy is better and why",
  "strengths": ["top 3 strengths of this fund"],
  "weaknesses": ["top 2 weaknesses or risks"],
  "benchmarkComparison": "how it compares to category benchmark",
  "marketCrashPerformance": "how it performed during last correction",
  "actionableAdvice": "specific advice for retail investors",
  "disclaimer": "Not financial advice. Consult SEBI-registered advisor."
}`;

  try {
    const userMsg = `FUND DATA:\n${JSON.stringify(fundData, null, 2)}\n\nAnalyze this fund and provide detailed recommendation. Respond ONLY in valid JSON.`;

    const { data } = await axios.post(GROQ, {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_MF }, { role: 'user', content: userMsg }],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const analysis = JSON.parse(data.choices[0].message.content);
    res.json({ analysis, tokens: data.usage?.total_tokens || 0, timestamp: new Date().toISOString() });
  } catch (e) {
    if (e.response?.status === 429) return res.status(429).json({ error: 'Groq rate limit. Wait 60s.' });
    res.status(500).json({ error: e.message });
  }
});

// IPO AI ANALYSIS — Forensic Analyst style
router.post('/analyze-ipo', async (req, res) => {
  const { ipoData } = req.body;
  if (!ipoData) return res.status(400).json({ error: 'ipoData required' });

  const SYSTEM_IPO = `You are an elite IPO Forensic Analyst specializing in Indian markets.
Analyze the provided IPO data and determine if it's worth applying.

FRAMEWORK:
1. Issue Structure: Fresh Issue vs OFS ratio. Is money going to company growth or promoters cashing out?
2. Valuation: PE ratio vs listed peers. Is it priced to leave money on table or fully valued?
3. Financial Health: Revenue growth, PAT growth, debt levels, promoter holding.
4. Grey Market Premium: Current GMP trend. What does the market expect?
5. Sector Outlook: Is this sector in favor? Government policies supporting it?
6. Red Flags: Pending litigation, heavy debt, declining margins, high OFS ratio.

OUTPUT: Strict JSON only.
{
  "decision": "APPLY_LISTING_GAINS or APPLY_LONG_TERM or AVOID",
  "conviction": "HIGH or MEDIUM or LOW",
  "confidence": 1-10,
  "listingPremiumEstimate": "estimated % gain/loss on listing",
  "fairValue": "is IPO fairly valued vs peers",
  "strengths": ["top 3 reasons to apply"],
  "redFlags": ["top 2 risks or concerns"],
  "peerComparison": "how it compares to listed peers",
  "sectorOutlook": "sector growth prospects"],
  "gmpAnalysis": "what GMP signals about market sentiment",
  "actionableAdvice": "specific advice — apply or skip",
  "disclaimer": "IPO analysis only. Not financial advice."
}`;

  try {
    const userMsg = `IPO DATA:\n${JSON.stringify(ipoData, null, 2)}\n\nAnalyze this IPO and provide detailed recommendation. Respond ONLY in valid JSON.`;

    const { data } = await axios.post(GROQ, {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_IPO }, { role: 'user', content: userMsg }],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const analysis = JSON.parse(data.choices[0].message.content);
    res.json({ analysis, tokens: data.usage?.total_tokens || 0, timestamp: new Date().toISOString() });
  } catch (e) {
    if (e.response?.status === 429) return res.status(429).json({ error: 'Groq rate limit. Wait 60s.' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
