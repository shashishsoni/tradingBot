const express = require('express');
const axios = require('axios');
const router = express.Router();

// ─── AMFI NAV Cache ─────────────────────────────────────────────────
// Cache the full AMFI NAV file instead of fetching per-fund
let amfiNavCache = { data: null, timestamp: 0 };
const AMFI_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

async function getAmfiNavData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && amfiNavCache.data && (now - amfiNavCache.timestamp < AMFI_CACHE_TTL)) {
    return amfiNavCache.data;
  }

  try {
    console.log('[MF] Fetching fresh AMFI NAV data...');
    const { data } = await axios.get(AMFI_NAV_URL, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    // Parse into a map: schemeCode -> { nav, date, name }
    const navMap = new Map();
    const lines = data.split('\n');
    for (const line of lines) {
      const parts = line.split(';');
      if (parts.length >= 5) {
        const code = parts[0].trim();
        const nav = parseFloat(parts[4]);
        const date = (parts[5] || '').trim();
        const name = (parts[3] || '').trim();
        if (code && !isNaN(nav)) {
          navMap.set(code, { nav, date, name });
        }
      }
    }

    if (navMap.size > 0) {
      amfiNavCache = { data: navMap, timestamp: now };
      console.log(`[MF] AMFI NAV cache refreshed: ${navMap.size} funds loaded`);
      return navMap;
    }
    console.warn('[MF] AMFI returned empty/invalid data');
    return amfiNavCache.data; // return stale if available
  } catch (e) {
    console.error('[MF] AMFI fetch failed:', e.message);
    return amfiNavCache.data; // return stale if available
  }
}

function getNavFromCache(code) {
  if (!amfiNavCache.data) return null;
  return amfiNavCache.data.get(code) || null;
}

// ─── MFAPI (for historical data only) ───────────────────────────────
const MFAPI_BASE = 'https://api.mfapi.in/mf/';
const MFAPI_TIMEOUT = 10000;

// Track if mfapi.in is responsive
let mfapiHealthy = true;
let mfapiLastCheck = 0;
const MFAPI_HEALTH_INTERVAL = 2 * 60 * 1000; // re-check every 2 min

async function checkMfapiHealth() {
  const now = Date.now();
  if (now - mfapiLastCheck < MFAPI_HEALTH_INTERVAL) return mfapiHealthy;

  try {
    await axios.get(`${MFAPI_BASE}119598/latest`, { timeout: 5000 });
    mfapiHealthy = true;
    console.log('[MF] mfapi.in health check: OK');
  } catch {
    mfapiHealthy = false;
    console.log('[MF] mfapi.in health check: FAILED (will use AMFI only)');
  }
  mfapiLastCheck = now;
  return mfapiHealthy;
}

// ─── Per-fund NAV cache (for watchlist response enrichment) ─────────
const mfCache = new Map();
const MF_CACHE_MS = 10 * 60 * 1000;

// ─── Watchlist ──────────────────────────────────────────────────────
const WATCHLIST = [
  { code: '119598', name: 'Mirae Asset Large Cap', category: 'Large Cap', risk: 'Moderate' },
  { code: '125354', name: 'Axis Midcap Fund', category: 'Mid Cap', risk: 'High' },
  { code: '120503', name: 'Parag Parikh Flexi Cap', category: 'Flexi Cap', risk: 'Moderate' },
  { code: '118989', name: 'SBI Small Cap Fund', category: 'Small Cap', risk: 'Very High' },
  { code: '122639', name: 'HDFC Index Nifty 50', category: 'Index', risk: 'Low' }
];

router.get('/watchlist', async (req, res) => {
  console.log('[MF] Watchlist requested');
  const now = Date.now();

  // Primary: Get all NAVs from cached AMFI data (single request, not per-fund)
  const navMap = await getAmfiNavData();

  if (!navMap) {
    // AMFI completely unavailable — return cached or error
    console.error('[MF] AMFI data unavailable, using local cache');
    const payload = WATCHLIST.map(item => {
      const cached = mfCache.get(item.code);
      if (cached && now - cached.t < MF_CACHE_MS) {
        return { ...item, ...cached.data, stale: true };
      }
      return { ...item, error: true, errorMessage: 'Data temporarily unavailable', nav: null, change: null, date: null };
    });
    return res.json(payload);
  }

  const payload = WATCHLIST.map(item => {
    const amfi = navMap.get(item.code);
    if (amfi && Number.isFinite(amfi.nav)) {
      const cached = mfCache.get(item.code);
      const prevNav = cached?.data?.nav;
      const change = (prevNav && Number.isFinite(prevNav) && prevNav !== amfi.nav)
        ? +(amfi.nav - prevNav).toFixed(4)
        : null;

      const out = {
        nav: +amfi.nav.toFixed(4),
        date: amfi.date || null,
        prevNav: prevNav ? +prevNav.toFixed(4) : null,
        change
      };
      mfCache.set(item.code, { t: now, data: out });
      return { ...item, ...out, source: 'amfi' };
    }

    // Fallback to local cache
    const cached = mfCache.get(item.code);
    if (cached && now - cached.t < MF_CACHE_MS) {
      return { ...item, ...cached.data, stale: true };
    }
    return { ...item, error: true, errorMessage: 'Fund not found in AMFI data', nav: null, change: null, date: null };
  });

  console.log('[MF] Watchlist response:', payload.map(p => ({ code: p.code, nav: p.nav })));
  res.json(payload);
});

// ─── Search ─────────────────────────────────────────────────────────
router.get('/search/:q', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(req.params.q)}`, { timeout: 8000 });
    res.json(data.slice(0, 10));
  } catch (e) {
    // Fallback: search AMFI data by name
    const navMap = await getAmfiNavData();
    if (navMap) {
      const q = req.params.q.toLowerCase();
      const results = [];
      for (const [code, info] of navMap.entries()) {
        if (info.name && info.name.toLowerCase().includes(q)) {
          results.push({ schemeCode: code, schemeName: info.name });
          if (results.length >= 10) break;
        }
      }
      return res.json(results);
    }
    res.status(500).json({ error: e.message });
  }
});

// ─── Debug / Health ─────────────────────────────────────────────────
router.get('/test-api', async (req, res) => {
  const healthy = await checkMfapiHealth();
  const amfiOk = !!amfiNavCache.data;
  const amfiAge = amfiNavCache.timestamp ? Math.round((Date.now() - amfiNavCache.timestamp) / 1000) : null;

  res.json({
    mfapi: { healthy, lastCheck: new Date(mfapiLastCheck).toISOString() },
    amfi: { cached: amfiOk, fundsLoaded: amfiNavCache.data?.size || 0, cacheAgeSeconds: amfiAge },
    strategy: healthy ? 'mfapi.in primary + AMFI fallback' : 'AMFI primary (mfapi.in down)'
  });
});

// ─── Comprehensive Mutual Fund Analysis ─────────────────────────────
router.get('/analyze/:code', async (req, res) => {
  const code = req.params.code;
  console.log('[MF] Analyzing fund code:', code);

  const fundInfo = WATCHLIST.find(w => w.code === code);
  const category = fundInfo?.category || 'Unknown';
  const riskLevel = fundInfo?.risk || 'Moderate';

  // Get current NAV from AMFI first (instant from cache)
  const navMap = await getAmfiNavData();
  const amfiData = navMap ? navMap.get(code) : null;
  const currentNav = amfiData && Number.isFinite(amfiData.nav) ? +amfiData.nav.toFixed(4) : null;

  // Try mfapi.in for historical data only if it's healthy
  const isHealthy = await checkMfapiHealth();
  let rows = [];

  if (isHealthy) {
    try {
      console.log('[MF] Fetching historical data from mfapi.in for:', code);
      const response = await axios.get(`${MFAPI_BASE}${code}`, {
        timeout: MFAPI_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const rawData = response.data;

      if (Array.isArray(rawData?.data)) rows = rawData.data;
      else if (Array.isArray(rawData?.navdata)) rows = rawData.navdata;
      else if (Array.isArray(rawData)) rows = rawData;

      if (rows.length > 0) {
        console.log(`[MF] Got ${rows.length} historical data points for ${code}`);
      }
    } catch (e) {
      console.warn('[MF] mfapi.in historical fetch failed for', code, ':', e.message);
      mfapiHealthy = false; // mark as unhealthy to avoid slow retries
    }
  } else {
    console.log('[MF] Skipping mfapi.in (unhealthy), using AMFI-only analysis for:', code);
  }

  // If no historical data, return AMFI-only analysis with category-based intelligence
  if (!rows.length) {
    if (currentNav) {
      // Category-based suitability and recommendation (when historical data is unavailable)
      const catSuitability = {
        'Index':     { shortTerm: 'Good',     longTerm: 'Excellent', sip: 'Excellent' },
        'Large Cap': { shortTerm: 'Good',     longTerm: 'Good',      sip: 'Excellent' },
        'Flexi Cap': { shortTerm: 'Moderate', longTerm: 'Good',      sip: 'Good' },
        'Mid Cap':   { shortTerm: 'Moderate', longTerm: 'Good',      sip: 'Good' },
        'Small Cap': { shortTerm: 'Low',      longTerm: 'Moderate',  sip: 'Moderate' },
      };
      const catRecommendation = {
        'Index':     { rec: 'START_SIP', conf: 7, reasons: ['Index funds are ideal for passive long-term investing', 'Low cost, diversified, and tracks Nifty 50 — suitable for beginners', 'Best via SIP for rupee cost averaging'] },
        'Large Cap': { rec: 'BUY',       conf: 6, reasons: ['Large cap funds offer stability and steady compounding', 'Suitable for moderate risk investors with 3-5 year horizon', 'Good core portfolio holding — consider SIP entry'] },
        'Flexi Cap': { rec: 'BUY',       conf: 6, reasons: ['Flexi cap allows fund manager to pick across market caps', 'Good diversification — reduces concentration risk', 'Ideal for investors wanting professional allocation decisions'] },
        'Mid Cap':   { rec: 'HOLD',      conf: 5, reasons: ['Mid caps offer growth potential but higher volatility', 'Best suited for investors with 5+ year horizon', 'Consider if you already have large cap exposure'] },
        'Small Cap': { rec: 'HOLD',      conf: 4, reasons: ['Small caps are high risk, high reward — not for beginners', 'Requires 7+ year investment horizon to smooth volatility', 'Limit allocation to 10-15% of portfolio'] },
      };
      const catInfo = catRecommendation[category] || { rec: 'HOLD', conf: 5, reasons: ['Category-based analysis applied'] };
      const suitability = catSuitability[category] || { shortTerm: 'Moderate', longTerm: 'Moderate', sip: 'Moderate' };

      return res.json({
        code,
        name: amfiData?.name || fundInfo?.name || 'Unknown Fund',
        category,
        riskLevel,
        currentNAV: currentNav,
        date: amfiData?.date || null,
        returns: { '1w': null, '1m': null, '3m': null, '6m': null, '1y': null, '3y': null, '5y': null },
        volatility: null,
        sharpeRatio: null,
        maxDrawdown: null,
        consistency: null,
        suitability,
        recommendation: catInfo.rec,
        confidence: catInfo.conf,
        reasons: [...catInfo.reasons, 'Note: Historical returns unavailable — recommendation based on fund category and risk profile'],
        fallback: true,
        source: 'amfi'
      });
    }

    // Nothing at all
    const cached = mfCache.get(code);
    if (cached) {
      return res.json({
        code,
        name: fundInfo?.name || 'Unknown Fund',
        category, riskLevel,
        currentNAV: cached.data.nav,
        date: cached.data.date,
        returns: { '1w': null, '1m': null, '3m': null, '6m': null, '1y': null, '3y': null, '5y': null },
        volatility: null, sharpeRatio: null, maxDrawdown: null, consistency: null,
        suitability: { shortTerm: 'Unknown', longTerm: 'Unknown', sip: 'Unknown' },
        recommendation: 'HOLD', confidence: 3,
        reasons: ['All APIs unavailable — using cached data'],
        fallback: true
      });
    }

    return res.status(502).json({ error: 'Data temporarily unavailable. Please try again later.', retryAfter: 30 });
  }

  // ─── Full analysis with historical data ───────────────────────────
  try {
    const meta = rows._meta || {};
    const latest = rows[0] || {};
    const nav = currentNav || Number.parseFloat(latest.nav || latest.nav_value || latest.net_asset_value);

    if (!Number.isFinite(nav)) {
      return res.status(500).json({ error: 'Invalid NAV data' });
    }

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

    // Volatility (std dev of daily returns over 1 year)
    const dailyReturns = [];
    for (let i = 1; i < Math.min(rows.length, 365); i++) {
      const curr = Number.parseFloat(rows[i - 1].nav);
      const prev = Number.parseFloat(rows[i].nav);
      if (Number.isFinite(curr) && Number.isFinite(prev) && prev > 0) {
        dailyReturns.push((curr - prev) / prev);
      }
    }

    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
    const volatility = +(Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2);

    // Sharpe ratio (assuming 6% risk-free rate)
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

    // Consistency score
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

    // Recommendation
    let recommendation = 'HOLD';
    let confidence = 5;
    const reasons = [];

    if (returns['1y'] > 15) { reasons.push(`Strong 1Y return: ${returns['1y']}%`); confidence += 1; }
    else if (returns['1y'] < 0) { reasons.push(`Negative 1Y return: ${returns['1y']}%`); confidence -= 1; }

    if (sharpeRatio && sharpeRatio > 1) { reasons.push(`Good risk-adjusted returns (Sharpe: ${sharpeRatio})`); recommendation = 'BUY'; confidence += 1; }
    else if (sharpeRatio && sharpeRatio < 0) { reasons.push(`Poor risk-adjusted returns (Sharpe: ${sharpeRatio})`); recommendation = 'AVOID'; confidence -= 1; }

    if (consistency && consistency > 70) { reasons.push(`Consistent performer: ${consistency}% positive months`); confidence += 1; }
    else if (consistency && consistency < 50) { reasons.push(`Inconsistent: only ${consistency}% positive months`); confidence -= 1; }

    if (volatility > 25) reasons.push(`High volatility: ${volatility}% — suitable for aggressive investors`);
    else if (volatility < 10) reasons.push(`Low volatility: ${volatility}% — stable, conservative choice`);

    if (category === 'Small Cap' && returns['1y'] < 10) { reasons.push('Small cap with below-average returns — consider large cap alternatives'); confidence -= 1; }

    confidence = Math.max(1, Math.min(10, confidence));

    const suitability = {
      shortTerm: returns['1m'] > 0 && volatility < 15 ? 'Good' : 'Moderate',
      longTerm: returns['3y'] > 20 || returns['5y'] > 50 ? 'Excellent' : returns['1y'] > 10 ? 'Good' : 'Moderate',
      sip: category === 'Index' || category === 'Large Cap' ? 'Excellent' : category === 'Flexi Cap' ? 'Good' : 'Moderate'
    };

    res.json({
      code,
      name: amfiData?.name || fundInfo?.name || 'Unknown Fund',
      category,
      riskLevel,
      currentNAV: Number.isFinite(nav) ? +nav.toFixed(4) : null,
      date: amfiData?.date || latest.date,
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Pre-warm AMFI cache on startup ─────────────────────────────────
getAmfiNavData().then(() => console.log('[MF] AMFI cache pre-warmed on startup'));

module.exports = router;
