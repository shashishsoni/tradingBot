const express = require('express');
const axios = require('axios');
const router = express.Router();
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

router.get('/quote/:symbol', async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase();
    const { data } = await axios.get(`${YF}${ticker}?interval=5m&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    });
    const meta = data.chart.result[0].meta;
    const q = data.chart.result[0].indicators.quote[0];
    const ts = data.chart.result[0].timestamp;
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
      ohlcv: ts.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })).filter(c => c.close !== null)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batch', async (req, res) => {
  const { symbols } = req.body;
  const results = await Promise.allSettled(symbols.map(s =>
    axios.get(`${YF}${s}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 })
  ));
  res.json(results.map((r, i) => {
    if (r.status === 'rejected') return { symbol: symbols[i], error: true };
    const m = r.value.data.chart.result[0].meta;
    return { symbol: symbols[i], price: m.regularMarketPrice, changePct: +((m.regularMarketPrice - m.previousClose) / m.previousClose * 100).toFixed(2), volume: m.regularMarketVolume };
  }));
});

module.exports = router;
