const express = require('express');
const axios = require('axios');
const router = express.Router();

// F&O expiry: last Thursday of month
function getNextExpiry() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  while (lastDay.getDay() !== 4) lastDay.setDate(lastDay.getDate() - 1);
  return lastDay;
}

router.get('/info', async (req, res) => {
  const expiry = getNextExpiry();
  const today = new Date();
  const daysToExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  const isExpiryWeek = daysToExpiry <= 7;

  // Fetch Nifty + BankNifty for F&O analysis
  try {
    const [nifty, banknifty] = await Promise.all([
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }),
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
    ]);
    res.json({
      expiryDate: expiry.toDateString(),
      daysToExpiry,
      isExpiryWeek,
      expiryWarning: isExpiryWeek ? `⚠️ F&O Expiry in ${daysToExpiry} days — elevated volatility expected` : null,
      nifty: nifty.data.chart.result[0].meta.regularMarketPrice,
      banknifty: banknifty.data.chart.result[0].meta.regularMarketPrice
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
