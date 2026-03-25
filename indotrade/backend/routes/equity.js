const express = require('express');
const axios = require('axios');
const router = express.Router();
const { calculateIndicators } = require('../utils/indicators');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// No caching - always fetch fresh data
router.get('/quote/:symbol', async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase();
    const { data } = await axios.get(`${YF}${ticker}?interval=5m&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    });
    const meta = data.chart.result[0].meta;
    const q = data.chart.result[0].indicators.quote[0];
    const ts = data.chart.result[0].timestamp;
    const ohlcv = ts.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })).filter(c => c.close !== null);
    
    // Calculate technical indicators
    const indicators = ohlcv.length >= 26 ? calculateIndicators(ohlcv) : null;
    
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
      ohlcv,
      indicators
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batch', async (req, res) => {
  const { symbols } = req.body;
  // Process in batches of 10 to avoid overwhelming Yahoo Finance on shared IPs
  const BATCH_SIZE = 10;
  const results = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(s =>
      axios.get(`${YF}${s}?interval=5m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
    ));
    results.push(...batchResults);
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 200));
  }
  res.json(results.map((r, i) => {
    if (r.status === 'rejected') return { symbol: symbols[i], error: true };
    try {
      const m = r.value.data.chart.result[0].meta;
      const price = Number(m.regularMarketPrice);
      const prev = Number(m.previousClose);
      const rawPct = Number(m.regularMarketChangePercent);
      const hasValidPrev = Number.isFinite(prev) && prev !== 0;
      const computedPct = hasValidPrev && Number.isFinite(price)
        ? ((price - prev) / prev) * 100
        : null;
      const changePct = Number.isFinite(rawPct)
        ? +rawPct.toFixed(2)
        : (computedPct !== null ? +computedPct.toFixed(2) : null);
      return {
        symbol: symbols[i],
        price: Number.isFinite(price) ? price : null,
        changePct,
        volume: m.regularMarketVolume ?? null
      };
    } catch (_) { return { symbol: symbols[i], error: true }; }
  }));
});

// Comprehensive Equity Analysis
router.get('/analyze/:symbol', async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase();
    const { data } = await axios.get(`${YF}${ticker}?interval=1d&range=1y`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
    });
    
    const meta = data.chart.result[0].meta;
    const q = data.chart.result[0].indicators.quote[0];
    const ts = data.chart.result[0].timestamp;
    const ohlcv = ts.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })).filter(c => c.close !== null);
    
    const indicators = ohlcv.length >= 26 ? calculateIndicators(ohlcv) : null;
    const closes = ohlcv.map(c => c.close);
    const volumes = ohlcv.map(c => c.volume);
    
    // Performance metrics
    const currentPrice = meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const yearStart = closes[0];
    const monthAgo = closes[Math.max(0, closes.length - 22)];
    const weekAgo = closes[Math.max(0, closes.length - 5)];
    
    // Day change from previous close
    const dayChange = previousClose ? ((currentPrice - previousClose) / previousClose * 100).toFixed(2) : null;
    const ytdReturn = yearStart ? ((currentPrice - yearStart) / yearStart * 100).toFixed(2) : null;
    const monthReturn = monthAgo ? ((currentPrice - monthAgo) / monthAgo * 100).toFixed(2) : null;
    const weekReturn = weekAgo ? ((currentPrice - weekAgo) / weekAgo * 100).toFixed(2) : null;
    
    // Volume analysis
    const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = (currentVolume / avgVolume20).toFixed(2);
    
    // Volatility (ATR-based)
    const atr = indicators?.atr || 0;
    const volatilityPct = ((atr / currentPrice) * 100).toFixed(2);
    
    // Support/Resistance levels
    const recentHighs = ohlcv.slice(-20).map(c => c.high);
    const recentLows = ohlcv.slice(-20).map(c => c.low);
    const resistance = Math.max(...recentHighs);
    const support = Math.min(...recentLows);
    
    // Generate recommendation
    let recommendation = 'HOLD';
    let confidence = 5;
    const reasons = [];
    
    if (indicators) {
      // Trend analysis
      if (indicators.trend === 'UPTREND') {
        reasons.push('Strong uptrend: EMA20 > EMA50');
        confidence += 1;
      } else if (indicators.trend === 'DOWNTREND') {
        reasons.push('Downtrend: EMA20 < EMA50');
        confidence -= 1;
      }
      
      // RSI analysis
      if (indicators.rsiSignal === 'OVERSOLD') {
        reasons.push(`RSI ${indicators.rsi} — oversold, potential reversal`);
        recommendation = 'BUY';
        confidence += 2;
      } else if (indicators.rsiSignal === 'NEAR_OVERSOLD') {
        reasons.push(`RSI ${indicators.rsi} — approaching oversold zone, watch for reversal`);
        if (recommendation !== 'SELL') recommendation = 'BUY';
        confidence += 1;
      } else if (indicators.rsiSignal === 'OVERBOUGHT') {
        reasons.push(`RSI ${indicators.rsi} — overbought, caution`);
        recommendation = 'SELL';
        confidence -= 2;
      } else if (indicators.rsiSignal === 'NEAR_OVERBOUGHT') {
        reasons.push(`RSI ${indicators.rsi} — approaching overbought zone, consider taking profits`);
        if (recommendation !== 'BUY') recommendation = 'SELL';
        confidence -= 1;
      }
      
      // MACD analysis
      if (indicators.macdCross === 'BULLISH') {
        reasons.push('MACD bullish crossover');
        if (recommendation !== 'SELL') recommendation = 'BUY';
        confidence += 1;
      } else if (indicators.macdCross === 'BEARISH') {
        reasons.push('MACD bearish crossover');
        if (recommendation !== 'BUY') recommendation = 'SELL';
        confidence -= 1;
      }
      
      // Volume confirmation
      if (indicators.volumeSignal === 'HIGH') {
        reasons.push(`Volume ${volumeRatio}x average — strong conviction`);
        confidence += 1;
      } else if (indicators.volumeSignal === 'LOW') {
        reasons.push(`Volume ${volumeRatio}x average — weak conviction`);
        confidence -= 1;
      }
      
      // Bollinger Band position
      if (indicators.bbPosition === 'BELOW') {
        reasons.push('Price at lower Bollinger Band — mean reversion setup');
        if (recommendation !== 'SELL') recommendation = 'BUY';
      } else if (indicators.bbPosition === 'ABOVE') {
        reasons.push('Price at upper Bollinger Band — potential pullback');
        if (recommendation !== 'BUY') recommendation = 'SELL';
      }
    }
    
    confidence = Math.max(1, Math.min(10, confidence));
    
    const prev = Number(meta.previousClose);
    const hasPrev = Number.isFinite(prev) && prev > 0;
    const changePctVal = hasPrev ? +((currentPrice - prev) / prev * 100).toFixed(2) : 0;

    res.json({
      symbol: ticker,
      currentPrice,
      previousClose: prev,
      change: hasPrev ? +(currentPrice - prev).toFixed(2) : 0,
      changePct: dayChange !== null ? +dayChange : changePctVal,
      volume: meta.regularMarketVolume,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      performance: {
        ytd: +ytdReturn,
        month: +monthReturn,
        week: +weekReturn
      },
      volumeAnalysis: {
        current: currentVolume,
        avg20: Math.round(avgVolume20),
        ratio: +volumeRatio,
        signal: indicators?.volumeSignal || 'NORMAL'
      },
      volatility: {
        atr: +atr.toFixed(2),
        pct: +volatilityPct
      },
      levels: {
        resistance: +resistance.toFixed(2),
        support: +support.toFixed(2)
      },
      indicators,
      recommendation,
      confidence,
      reasons,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
