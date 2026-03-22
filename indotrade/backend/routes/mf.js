const express = require('express');
const axios = require('axios');
const router = express.Router();
const MFAPI = 'https://api.mfapi.in/mf/';

const WATCHLIST = [
  { code: '119598', name: 'Mirae Asset Large Cap' },
  { code: '125354', name: 'Axis Midcap Fund' },
  { code: '120503', name: 'Parag Parikh Flexi Cap' },
  { code: '118989', name: 'SBI Small Cap Fund' },
  { code: '122639', name: 'HDFC Index Nifty 50' }
];

router.get('/watchlist', async (req, res) => {
  const results = await Promise.allSettled(WATCHLIST.map(m => axios.get(`${MFAPI}${m.code}`, { timeout: 6000 })));
  res.json(results.map((r, i) => ({
    ...WATCHLIST[i],
    ...(r.status === 'fulfilled' ? {
      nav: r.value.data.data[0].nav,
      date: r.value.data.data[0].date,
      prevNav: r.value.data.data[1]?.nav,
      change: +(parseFloat(r.value.data.data[0].nav) - parseFloat(r.value.data.data[1]?.nav)).toFixed(4)
    } : { error: true })
  })));
});

router.get('/search/:q', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(req.params.q)}`, { timeout: 8000 });
    res.json(data.slice(0,10));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
