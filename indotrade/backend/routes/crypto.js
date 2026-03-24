const express = require('express');
const axios = require('axios');
const router = express.Router();
const { calculateIndicators } = require('../utils/indicators');
const tickerWs = require('../services/tickerWs');

const SAPI = 'https://sapi.zebpay.com/api/v2';
const GCK = 'https://api.coingecko.com/api/v3/';

// Cache for exchangeInfo (pair listing changes rarely, refresh every 5 min)
let pairsCache = null;
let pairsCacheTime = 0;
const PAIRS_CACHE_MS = 5 * 60 * 1000;

async function getInrPairs() {
  const now = Date.now();
  if (pairsCache && now - pairsCacheTime < PAIRS_CACHE_MS) return pairsCache;
  const { data } = await axios.get(`${SAPI}/ex/exchangeInfo`, { timeout: 8000 });
  const symbols = data?.data?.symbols || [];
  pairsCache = symbols
    .filter(s => s.symbol.endsWith('-INR') && s.status === 'Open')
    .map(s => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      tickSz: s.tickSz,
      lotSz: s.lotSz,
      orderTypes: s.orderTypes
    }));
  pairsCacheTime = now;
  return pairsCache;
}

// GET /pairs — all available INR trading pairs (live from ZebPay)
router.get('/pairs', async (req, res) => {
  try {
    const pairs = await getInrPairs();
    // Subscribe all pairs to WebSocket for real-time updates
    tickerWs.subscribeAll(pairs.map(p => p.symbol));
    res.json(pairs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /all — live tickers for ALL INR pairs (WebSocket real-time + REST fallback)
router.get('/all', async (req, res) => {
  try {
    const [tickersRes, pairsRes] = await Promise.allSettled([
      axios.get(`${SAPI}/market/allTickers`, { timeout: 10000 }),
      getInrPairs()
    ]);

    // Use pairs from cache or fetch result, with fallback to common pairs
    let pairs = pairsRes.status === 'fulfilled' ? pairsRes.value : [];
    if (pairs.length === 0) {
      pairs = ['BTC-INR','ETH-INR','SOL-INR','XRP-INR','BNB-INR','DOGE-INR','ADA-INR','SHIB-INR'].map(s => ({ symbol: s }));
    }

    // Subscribe all pairs to WebSocket for real-time updates
    tickerWs.subscribeAll(pairs.map(p => p.symbol));
    // Wait briefly for initial WebSocket data to arrive
    await new Promise(r => setTimeout(r, 800));

    if (tickersRes.status !== 'fulfilled') {
      return res.status(502).json({ error: 'ZebPay API unavailable' });
    }

    const allTickers = tickersRes.value.data?.data || [];
    const inrPairSet = new Set(pairs.map(p => p.symbol));
    // Build tick size lookup for price precision
    const tickMap = {};
    pairs.forEach(p => { tickMap[p.symbol] = p.tickSz; });
    function roundToTick(val, symbol) {
      const ts = tickMap[symbol];
      if (!ts || !val) return val;
      const dp = Math.max(0, -Math.floor(Math.log10(parseFloat(ts))));
      return +parseFloat(val).toFixed(dp);
    }
    const inrTickers = allTickers
      .filter(t => inrPairSet.has(t.symbol))
      .map(t => {
        // Prefer WebSocket real-time price if available
        const ws = tickerWs.getTicker(t.symbol);
        const lastPrice = parseFloat(t.last) || ws?.price || 0;
        const avg = parseFloat(t.average) || 0;
        const spread = parseFloat(t.ask) - parseFloat(t.bid);
        const spreadPct = lastPrice > 0 ? (spread / lastPrice * 100) : 0;
        // For illiquid pairs (>10% spread), use average-based % to avoid inflated values
        const pct = spreadPct > 10 && avg > 0
          ? +((lastPrice - avg) / avg * 100).toFixed(2)
          : (parseFloat(t.percentage) || 0);
        return {
          pair: t.symbol,
          baseAsset: t.symbol.split('-')[0],
          market: roundToTick(lastPrice, t.symbol),
          buy: roundToTick(ws?.bid || t.bid, t.symbol),
          sell: roundToTick(ws?.ask || t.ask, t.symbol),
          pricechange: pct,
          volume: t.baseVolume,
          volumeQt: t.quoteVolume,
          high: roundToTick(ws?.high || t.high, t.symbol),
          low: roundToTick(ws?.low || t.low, t.symbol),
          open: t.open,
          close: t.close,
          wsLive: !!ws?.price
        };
      });
    res.json(inrTickers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /global — crypto market overview (CoinGecko + Fear & Greed)
router.get('/global', async (req, res) => {
  try {
    const [global, fg, trending] = await Promise.allSettled([
      axios.get(`${GCK}global`, { timeout: 8000 }),
      axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 }),
      axios.get(`${GCK}search/trending`, { timeout: 8000 })
    ]);
    res.json({
      marketCap: global.status === 'fulfilled' ? global.value.data.data.total_market_cap.usd : 0,
      btcDominance: global.status === 'fulfilled' ? +global.value.data.data.market_cap_percentage.btc.toFixed(1) : 0,
      totalVolume: global.status === 'fulfilled' ? global.value.data.data.total_volume.usd : 0,
      fearGreed: fg.status === 'fulfilled' ? fg.value.data.data[0].value : 50,
      fearGreedLabel: fg.status === 'fulfilled' ? fg.value.data.data[0].value_classification : 'Neutral',
      trending: trending.status === 'fulfilled' ? trending.value.data.coins.slice(0, 5).map(c => ({ name: c.item.name, symbol: c.item.symbol })) : []
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /ohlcv/:coin — OHLCV from ZebPay SAPI v2 klines (no CoinGecko, no caching)
router.get('/ohlcv/:coin', async (req, res) => {
  try {
    const coin = req.params.coin.toUpperCase().replace('-INR', '').replace('/INR', '');
    const symbol = `${coin}-INR`;
    const days = parseInt(req.query.days) || 7;
    const interval = days <= 1 ? '5m' : days <= 7 ? '1h' : days <= 30 ? '4h' : '1d';
    // ZebPay klines expects seconds, not milliseconds
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - days * 24 * 60 * 60;

    const { data } = await axios.get(`${SAPI}/market/klines`, {
      params: { symbol, interval, startTime, endTime },
      timeout: 10000
    });

    const raw = data?.data || [];
    const ohlcv = raw.map(([time, open, high, low, close]) => ({
      time,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close)
    }));

    if (!ohlcv.length) {
      return res.status(404).json({ error: `No OHLCV data for ${symbol}. Pair may not exist.` });
    }
    res.json(ohlcv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /analyze/:coin — comprehensive analysis using ZebPay live data
router.get('/analyze/:coin', async (req, res) => {
  try {
    const coin = req.params.coin.toUpperCase().replace('-INR', '').replace('/INR', '');
    const symbol = `${coin}-INR`;

    // Fetch all data in parallel — ZebPay klines + CoinGecko global context
    // ZebPay klines expects seconds, not milliseconds
    const endTime = Math.floor(Date.now() / 1000);
    const startTime30d = endTime - 30 * 24 * 60 * 60;

    const [klinesRes, tickerRes, coinGeckoRes, globalRes, fgRes] = await Promise.allSettled([
      axios.get(`${SAPI}/market/klines`, { params: { symbol, interval: '4h', startTime: startTime30d, endTime }, timeout: 10000 }),
      axios.get(`${SAPI}/market/ticker`, { params: { symbol }, timeout: 5000 }),
      axios.get(`${GCK}coins/${coin.toLowerCase()}?localization=false&tickers=false&community_data=true&developer_data=true`, { timeout: 10000 }),
      axios.get(`${GCK}global`, { timeout: 8000 }),
      axios.get('https://api.alternative.me/fng/?limit=7', { timeout: 5000 })
    ]);

    // Parse OHLCV
    const raw = klinesRes.status === 'fulfilled' ? (klinesRes.value.data?.data || []) : [];
    const ohlcv = raw.map(([time, open, high, low, close]) => ({
      time,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close)
    }));

    // Current price from ticker — prefer WebSocket real-time price
    const tickerData = tickerRes.status === 'fulfilled' ? tickerRes.value.data?.data : null;
    const ws = tickerWs.getTicker(symbol);
    const currentPrice = ws?.price || (tickerData ? parseFloat(tickerData.last) : (ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : 0));
    const tickerAvg = tickerData ? parseFloat(tickerData.average) : 0;
    // Use average (24h midpoint) for accurate % — avoids inflated values on illiquid pairs
    const change24h = tickerAvg > 0 ? +((currentPrice - tickerAvg) / tickerAvg * 100).toFixed(2) : 0;

    // Calculate indicators
    const indicators = ohlcv.length >= 26 ? calculateIndicators(ohlcv) : null;

    // Volatility from OHLCV returns
    const returns = [];
    for (let i = 1; i < ohlcv.length; i++) {
      if (ohlcv[i].close > 0 && ohlcv[i - 1].close > 0) {
        returns.push(Math.log(ohlcv[i].close / ohlcv[i - 1].close));
      }
    }
    const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length : 0;
    const volatility = +(Math.sqrt(variance) * Math.sqrt(365) * 100).toFixed(2);

    // Liquidity from ZebPay quote volume
    const quoteVolume = tickerData ? parseFloat(tickerData.quoteVolume) : 0;
    const liquidityScore = quoteVolume > 1000000000 ? 'HIGH' : quoteVolume > 100000000 ? 'MEDIUM' : 'LOW';

    // CoinGecko on-chain metrics
    const coinMeta = coinGeckoRes.status === 'fulfilled' ? coinGeckoRes.value.data : null;
    const onChain = coinMeta ? {
      marketCapRank: coinMeta.market_cap_rank,
      totalSupply: coinMeta.total_supply,
      circulatingSupply: coinMeta.circulating_supply,
      maxSupply: coinMeta.max_supply,
      supplyRatio: coinMeta.max_supply ? +((coinMeta.circulating_supply / coinMeta.max_supply) * 100).toFixed(2) : null,
      ath: coinMeta.market_data?.ath?.inr,
      athChange: coinMeta.market_data?.ath_change_percentage?.inr,
      atl: coinMeta.market_data?.atl?.inr,
      atlChange: coinMeta.market_data?.atl_change_percentage?.inr
    } : null;

    // Community & Development
    const community = coinMeta ? {
      twitterFollowers: coinMeta.community_data?.twitter_followers,
      redditSubscribers: coinMeta.community_data?.reddit_subscribers,
      githubStars: coinMeta.developer_data?.stars,
      githubForks: coinMeta.developer_data?.forks,
      commitCount4w: coinMeta.developer_data?.commit_count_4_weeks
    } : null;

    // Global context
    const globalData = globalRes.status === 'fulfilled' ? globalRes.value.data.data : null;
    const fngData = fgRes.status === 'fulfilled' ? fgRes.value.data.data : [];
    const currentFNG = fngData[0]?.value || 50;
    const fngTrend = fngData.length >= 3
      ? (fngData[0].value > fngData[2].value ? 'RISING' : fngData[0].value < fngData[2].value ? 'FALLING' : 'STABLE')
      : 'UNKNOWN';
    const btcDominance = globalData?.market_cap_percentage?.btc || 50;

    // Generate recommendation
    let recommendation = 'HOLD';
    let confidence = 5;
    const reasons = [];

    if (btcDominance > 55 && coin !== 'BTC' && coin !== 'ETH') {
      reasons.push(`BTC dominance ${btcDominance.toFixed(1)}% — altcoin risk elevated`);
      confidence -= 1;
    }

    if (currentFNG < 20) {
      reasons.push(`Extreme fear (${currentFNG}) — potential reversal zone`);
      recommendation = 'BUY';
      confidence += 1;
    } else if (currentFNG > 80) {
      reasons.push(`Extreme greed (${currentFNG}) — caution, reduce size`);
      recommendation = 'SELL';
      confidence -= 1;
    }

    if (indicators) {
      if (indicators.trend === 'UPTREND') {
        reasons.push('Strong uptrend: EMA20 > EMA50');
        if (recommendation !== 'SELL') recommendation = 'BUY';
        confidence += 1;
      } else if (indicators.trend === 'DOWNTREND') {
        reasons.push('Downtrend: EMA20 < EMA50');
        if (recommendation !== 'BUY') recommendation = 'SELL';
        confidence -= 1;
      }

      if (indicators.rsiSignal === 'OVERSOLD') {
        reasons.push(`RSI ${indicators.rsi} — oversold`);
        if (recommendation !== 'SELL') recommendation = 'BUY';
        confidence += 2;
      } else if (indicators.rsiSignal === 'NEAR_OVERSOLD') {
        reasons.push(`RSI ${indicators.rsi} — approaching oversold zone`);
        if (recommendation !== 'SELL') recommendation = 'BUY';
        confidence += 1;
      } else if (indicators.rsiSignal === 'OVERBOUGHT') {
        reasons.push(`RSI ${indicators.rsi} — overbought`);
        if (recommendation !== 'BUY') recommendation = 'SELL';
        confidence -= 2;
      } else if (indicators.rsiSignal === 'NEAR_OVERBOUGHT') {
        reasons.push(`RSI ${indicators.rsi} — approaching overbought zone`);
        if (recommendation !== 'BUY') recommendation = 'SELL';
        confidence -= 1;
      }

      if (indicators.macdCross === 'BULLISH') {
        reasons.push('MACD bullish crossover');
        confidence += 1;
      } else if (indicators.macdCross === 'BEARISH') {
        reasons.push('MACD bearish crossover');
        confidence -= 1;
      }
    }

    if (volatility > 80) {
      reasons.push(`High volatility ${volatility}% — use smaller position sizes`);
      confidence -= 1;
    }

    confidence = Math.max(1, Math.min(10, confidence));

    res.json({
      coin,
      symbol: coin,
      name: coinMeta?.name || coin,
      currentPrice,
      change24h: +change24h,
      volatility: +volatility,
      liquidityScore,
      quoteVolume: +quoteVolume,
      onChain,
      community,
      fearGreed: {
        current: currentFNG,
        label: fngData[0]?.value_classification || 'Neutral',
        trend: fngTrend,
        history: fngData.map(f => ({ value: f.value, label: f.value_classification }))
      },
      btcDominance: +btcDominance.toFixed(1),
      indicators,
      recommendation,
      confidence,
      reasons,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
