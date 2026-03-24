const express = require('express');
const axios = require('axios');
const router = express.Router();
const MFAPI = 'https://api.mfapi.in/mf/';
const mfCache = new Map();
const MF_CACHE_MS = 10 * 60 * 1000;

const WATCHLIST = [
  { code: '119598', name: 'Mirae Asset Large Cap' },
  { code: '125354', name: 'Axis Midcap Fund' },
  { code: '120503', name: 'Parag Parikh Flexi Cap' },
  { code: '118989', name: 'SBI Small Cap Fund' },
  { code: '122639', name: 'HDFC Index Nifty 50' }
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

module.exports = router;
