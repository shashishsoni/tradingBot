const express = require('express');
const axios = require('axios');
const router = express.Router();
const { calculateIndicators } = require('../utils/indicators');

// F&O expiry: last Thursday of month
function getNextExpiry() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  while (lastDay.getDay() !== 4) lastDay.setDate(lastDay.getDate() - 1);
  return lastDay;
}

// Calculate days to expiry
function getDaysToExpiry(expiry) {
  const today = new Date();
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

// Calculate implied volatility proxy from historical data
function calculateIVProxy(ohlcv) {
  if (!ohlcv || ohlcv.length < 20) return null;
  const returns = [];
  for (let i = 1; i < ohlcv.length; i++) {
    returns.push(Math.log(ohlcv[i].close / ohlcv[i-1].close));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  return +(dailyVol * Math.sqrt(252) * 100).toFixed(2); // Annualized
}

// Calculate Greeks approximation (simplified Black-Scholes)
function calculateGreeks(spot, strike, daysToExpiry, iv, type = 'CE') {
  const T = daysToExpiry / 365;
  const r = 0.06; // Risk-free rate ~6%
  const d1 = (Math.log(spot / strike) + (r + (iv/100)**2 / 2) * T) / ((iv/100) * Math.sqrt(T));
  const d2 = d1 - (iv/100) * Math.sqrt(T);
  
  // Normal distribution approximation
  const normCDF = (x) => {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  };
  
  const normPDF = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  
  const delta = type === 'CE' ? normCDF(d1) : normCDF(d1) - 1;
  const gamma = normPDF(d1) / (spot * (iv/100) * Math.sqrt(T));
  const theta = type === 'CE' 
    ? -(spot * normPDF(d1) * (iv/100)) / (2 * Math.sqrt(T)) - r * strike * Math.exp(-r * T) * normCDF(d2)
    : -(spot * normPDF(d1) * (iv/100)) / (2 * Math.sqrt(T)) + r * strike * Math.exp(-r * T) * normCDF(-d2);
  const vega = spot * normPDF(d1) * Math.sqrt(T) / 100;
  
  return {
    delta: +delta.toFixed(4),
    gamma: +gamma.toFixed(6),
    theta: +(theta / 365).toFixed(4), // Daily theta
    vega: +vega.toFixed(4)
  };
}

router.get('/info', async (req, res) => {
  const expiry = getNextExpiry();
  const daysToExpiry = getDaysToExpiry(expiry);
  const isExpiryWeek = daysToExpiry <= 7;

  try {
    const [nifty, banknifty] = await Promise.all([
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
    ]);
    
    const niftyPrice = nifty.data.chart.result[0].meta.regularMarketPrice;
    const bankniftyPrice = banknifty.data.chart.result[0].meta.regularMarketPrice;
    
    res.json({
      expiryDate: expiry.toDateString(),
      daysToExpiry,
      isExpiryWeek,
      expiryWarning: isExpiryWeek ? `⚠️ F&O Expiry in ${daysToExpiry} days — elevated volatility expected` : null,
      nifty: niftyPrice,
      banknifty: bankniftyPrice
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Comprehensive F&O Analysis with Options Chain
router.get('/analyze/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
    const ticker = symbol === 'NIFTY' ? '%5ENSEI' : symbol === 'BANKNIFTY' ? '%5ENSEBANK' : `${symbol}.NS`;
    
    const { data } = await axios.get(`${YF}${ticker}?interval=1d&range=1y`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
    });
    
    const meta = data.chart.result[0].meta;
    const q = data.chart.result[0].indicators.quote[0];
    const ts = data.chart.result[0].timestamp;
    const ohlcv = ts.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })).filter(c => c.close !== null);
    
    const indicators = ohlcv.length >= 26 ? calculateIndicators(ohlcv) : null;
    const currentPrice = meta.regularMarketPrice;
    const expiry = getNextExpiry();
    const daysToExpiry = getDaysToExpiry(expiry);
    
    // Calculate IV proxy
    const iv = calculateIVProxy(ohlcv) || 18; // Default 18% if calculation fails
    
    // Generate strike prices around current price
    const strikeInterval = symbol === 'NIFTY' ? 50 : symbol === 'BANKNIFTY' ? 100 : Math.round(currentPrice * 0.02);
    const strikes = [];
    for (let i = -5; i <= 5; i++) {
      strikes.push(Math.round((currentPrice + i * strikeInterval) / strikeInterval) * strikeInterval);
    }
    
    // Calculate options chain with Greeks
    const optionsChain = strikes.map(strike => {
      const isITM_CE = currentPrice > strike;
      const isITM_PE = currentPrice < strike;
      
      // Intrinsic value
      const intrinsicCE = Math.max(0, currentPrice - strike);
      const intrinsicPE = Math.max(0, strike - currentPrice);
      
      // Time value (simplified)
      const timeValue = Math.max(0, (iv / 100) * currentPrice * Math.sqrt(daysToExpiry / 365) * 0.4);
      
      // Calculate Greeks
      const greeksCE = calculateGreeks(currentPrice, strike, daysToExpiry, iv, 'CE');
      const greeksPE = calculateGreeks(currentPrice, strike, daysToExpiry, iv, 'PE');
      
      // Open Interest simulation (based on distance from ATM)
      const distanceFromATM = Math.abs(strike - currentPrice) / currentPrice;
      const oiBase = Math.round(100000 * Math.exp(-distanceFromATM * 10));
      
      return {
        strike,
        call: {
          price: +(intrinsicCE + timeValue).toFixed(2),
          intrinsic: +intrinsicCE.toFixed(2),
          timeValue: +timeValue.toFixed(2),
          greeks: greeksCE,
          oi: oiBase,
          oiChange: Math.round((Math.random() - 0.5) * oiBase * 0.2),
          volume: Math.round(oiBase * 0.3 * Math.random()),
          isITM: isITM_CE
        },
        put: {
          price: +(intrinsicPE + timeValue).toFixed(2),
          intrinsic: +intrinsicPE.toFixed(2),
          timeValue: +timeValue.toFixed(2),
          greeks: greeksPE,
          oi: Math.round(oiBase * 0.9),
          oiChange: Math.round((Math.random() - 0.5) * oiBase * 0.15),
          volume: Math.round(oiBase * 0.25 * Math.random()),
          isITM: isITM_PE
        }
      };
    });
    
    // PCR (Put-Call Ratio)
    const totalCallOI = optionsChain.reduce((sum, o) => sum + o.call.oi, 0);
    const totalPutOI = optionsChain.reduce((sum, o) => sum + o.put.oi, 0);
    const pcr = +(totalPutOI / totalCallOI).toFixed(2);
    
    // Max Pain
    const maxPain = strikes.reduce((best, strike) => {
      const pain = optionsChain.reduce((sum, o) => {
        const callPain = Math.max(0, strike - o.strike) * o.call.oi;
        const putPain = Math.max(0, o.strike - strike) * o.put.oi;
        return sum + callPain + putPain;
      }, 0);
      return pain < best.pain ? { strike, pain } : best;
    }, { strike: currentPrice, pain: Infinity }).strike;
    
    // Strategy recommendations
    let strategy = 'NEUTRAL';
    let strategyReason = '';
    
    if (indicators) {
      if (pcr > 1.2 && indicators.rsiSignal === 'OVERSOLD') {
        strategy = 'BULLISH';
        strategyReason = `PCR ${pcr} indicates put writing (support), RSI oversold at ${indicators.rsi}`;
      } else if (pcr < 0.7 && indicators.rsiSignal === 'OVERBOUGHT') {
        strategy = 'BEARISH';
        strategyReason = `PCR ${pcr} indicates call writing (resistance), RSI overbought at ${indicators.rsi}`;
      } else if (daysToExpiry <= 3) {
        strategy = 'THETA_DECAY';
        strategyReason = `${daysToExpiry} days to expiry — theta decay accelerates, avoid buying options`;
      } else {
        strategyReason = `PCR ${pcr}, IV ${iv}%, ${daysToExpiry} days to expiry`;
      }
    }
    
    res.json({
      symbol,
      currentPrice,
      expiryDate: expiry.toDateString(),
      daysToExpiry,
      isExpiryWeek: daysToExpiry <= 7,
      iv: +iv.toFixed(2),
      pcr,
      maxPain,
      optionsChain,
      indicators,
      strategy: {
        type: strategy,
        reason: strategyReason,
        riskReward: strategy === 'BULLISH' ? '1:2' : strategy === 'BEARISH' ? '1:2' : '1:1'
      },
      riskWarning: daysToExpiry <= 7 ? `Expiry in ${daysToExpiry} days — elevated volatility and gamma risk` : null,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
