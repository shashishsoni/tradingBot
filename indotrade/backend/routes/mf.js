const express = require('express');
const axios = require('axios');
const router = express.Router();
const MFAPI = 'https://api.mfapi.in/mf/';
const mfCache = new Map();
const MF_CACHE_MS = 10 * 60 * 1000;

const WATCHLIST = [
  { code: '119598', name: 'Mirae Asset Large Cap', category: 'Large Cap', risk: 'Moderate' },
  { code: '125354', name: 'Axis Midcap Fund', category: 'Mid Cap', risk: 'High' },
  { code: '120503', name: 'Parag Parikh Flexi Cap', category: 'Flexi Cap', risk: 'Moderate' },
  { code: '118989', name: 'SBI Small Cap Fund', category: 'Small Cap', risk: 'Very High' },
  { code: '122639', name: 'HDFC Index Nifty 50', category: 'Index', risk: 'Low' }
];

router.get('/watchlist', async (req, res) => {
  const now = Date.now();
  const results = await Promise.allSettled(WATCHLIST.map(m => axios.get(`${MFAPI}${m.code}`, { timeout: 8000 })));

  const payload = results.map((r, i) => {
    const item = WATCHLIST[i];
    if (r.status !== 'fulfilled') {
      const cached = mfCache.get(item.code);
      if (cached && now - cached.t < MF_CACHE_MS) return { ...item, ...cached.data, stale: true };
      return { ...item, error: true };
    }

    const rows = Array.isArray(r.value.data?.data) ? r.value.data.data : [];
    if (!rows.length) return { ...item, error: true };
    const latest = rows[0] || {};
    const prev = rows[1] || {};
    const nav = Number.parseFloat(latest.nav);
    const prevNav = Number.parseFloat(prev.nav);
    const out = {
      nav: Number.isFinite(nav) ? +nav.toFixed(4) : null,
      date: latest.date || null,
      prevNav: Number.isFinite(prevNav) ? +prevNav.toFixed(4) : null,
      change: Number.isFinite(nav) && Number.isFinite(prevNav) ? +(nav - prevNav).toFixed(4) : null
    };
    mfCache.set(item.code, { t: now, data: out });
    return { ...item, ...out };
  });

  res.json(payload);
});

router.get('/search/:q', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(req.params.q)}`, { timeout: 8000 });
    res.json(data.slice(0,10));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Comprehensive Mutual Fund Analysis
router.get('/analyze/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const { data } = await axios.get(`${MFAPI}${code}`, { timeout: 10000 });
    
    const rows = Array.isArray(data?.data) ? data.data : [];
    if (!rows.length) {
      return res.status(404).json({ error: 'Fund not found' });
    }
    
    const meta = data.meta || {};
    const latest = rows[0] || {};
    const nav = Number.parseFloat(latest.nav);
    
    // Calculate returns
    const getReturn = (days) => {
      const idx = Math.min(days, rows.length - 1);
      const pastNav = Number.parseFloat(rows[idx]?.nav);
      if (!Number.isFinite(nav) || !Number.isFinite(pastNav) || pastNav === 0) return null;
      return +((nav - pastNav) / pastNav * 100).toFixed(2);
    };
    
    const returns = {
      '1w': getReturn(7),
      '1m': getReturn(30),
      '3m': getReturn(90),
      '6m': getReturn(180),
      '1y': getReturn(365),
      '3y': getReturn(1095),
      '5y': getReturn(1825)
    };
    
    // Calculate volatility (standard deviation of daily returns)
    const dailyReturns = [];
    for (let i = 1; i < Math.min(rows.length, 365); i++) {
      const curr = Number.parseFloat(rows[i-1].nav);
      const prev = Number.parseFloat(rows[i].nav);
      if (Number.isFinite(curr) && Number.isFinite(prev) && prev > 0) {
        dailyReturns.push((curr - prev) / prev);
      }
    }
    
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
    const volatility = +(Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2);
    
    // Sharpe ratio (simplified, assuming 6% risk-free rate)
    const annualReturn = returns['1y'] || 0;
    const sharpeRatio = volatility > 0 ? +((annualReturn - 6) / volatility).toFixed(2) : null;
    
    // Max drawdown
    let maxDrawdown = 0;
    let peak = Number.parseFloat(rows[rows.length - 1]?.nav) || 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const currNav = Number.parseFloat(rows[i].nav);
      if (currNav > peak) peak = currNav;
      const drawdown = (peak - currNav) / peak * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Consistency score (based on positive months)
    let positiveMonths = 0;
    let totalMonths = 0;
    for (let i = 0; i < Math.min(rows.length, 365); i += 30) {
      const monthStart = Number.parseFloat(rows[Math.min(i + 29, rows.length - 1)]?.nav);
      const monthEnd = Number.parseFloat(rows[i]?.nav);
      if (Number.isFinite(monthStart) && Number.isFinite(monthEnd)) {
        totalMonths++;
        if (monthEnd > monthStart) positiveMonths++;
      }
    }
    const consistency = totalMonths > 0 ? +((positiveMonths / totalMonths) * 100).toFixed(1) : null;
    
    // Generate recommendation
    let recommendation = 'HOLD';
    let confidence = 5;
    const reasons = [];
    
    // Returns analysis
    if (returns['1y'] > 15) {
      reasons.push(`Strong 1Y return: ${returns['1y']}%`);
      confidence += 1;
    } else if (returns['1y'] < 0) {
      reasons.push(`Negative 1Y return: ${returns['1y']}%`);
      confidence -= 1;
    }
    
    // Risk-adjusted returns
    if (sharpeRatio && sharpeRatio > 1) {
      reasons.push(`Good risk-adjusted returns (Sharpe: ${sharpeRatio})`);
      recommendation = 'BUY';
      confidence += 1;
    } else if (sharpeRatio && sharpeRatio < 0) {
      reasons.push(`Poor risk-adjusted returns (Sharpe: ${sharpeRatio})`);
      recommendation = 'AVOID';
      confidence -= 1;
    }
    
    // Consistency
    if (consistency && consistency > 70) {
      reasons.push(`Consistent performer: ${consistency}% positive months`);
      confidence += 1;
    } else if (consistency && consistency < 50) {
      reasons.push(`Inconsistent: only ${consistency}% positive months`);
      confidence -= 1;
    }
    
    // Volatility check
    if (volatility > 25) {
      reasons.push(`High volatility: ${volatility}% — suitable for aggressive investors`);
    } else if (volatility < 10) {
      reasons.push(`Low volatility: ${volatility}% — stable, conservative choice`);
    }
    
    // Category-based advice
    const category = WATCHLIST.find(w => w.code === code)?.category || 'Unknown';
    const riskLevel = WATCHLIST.find(w => w.code === code)?.risk || 'Moderate';
    
    if (category === 'Small Cap' && returns['1y'] < 10) {
      reasons.push('Small cap with below-average returns — consider large cap alternatives');
      confidence -= 1;
    }
    
    confidence = Math.max(1, Math.min(10, confidence));
    
    // Suitability assessment
    const suitability = {
      shortTerm: returns['1m'] > 0 && volatility < 15 ? 'Good' : 'Moderate',
      longTerm: returns['3y'] > 20 || returns['5y'] > 50 ? 'Excellent' : returns['1y'] > 10 ? 'Good' : 'Moderate',
      sip: category === 'Index' || category === 'Large Cap' ? 'Excellent' : category === 'Flexi Cap' ? 'Good' : 'Moderate'
    };
    
    res.json({
      code,
      name: meta.scheme_name || WATCHLIST.find(w => w.code === code)?.name,
      category,
      riskLevel,
      currentNAV: Number.isFinite(nav) ? +nav.toFixed(4) : null,
      date: latest.date,
      returns,
      volatility: +volatility,
      sharpeRatio,
      maxDrawdown: +maxDrawdown.toFixed(2),
      consistency,
      suitability,
      recommendation,
      confidence,
      reasons,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
