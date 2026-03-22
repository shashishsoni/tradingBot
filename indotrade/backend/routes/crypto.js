const express = require('express');
const axios = require('axios');
const router = express.Router();

const ZEB = 'https://www.zebapi.com/pro/v1/market/';
const GCK = 'https://api.coingecko.com/api/v3/';

const PAIRS = ['BTC/INR','ETH/INR','SOL/INR','XRP/INR','BNB/INR','ADA/INR','DOGE/INR','USDT/INR'];

router.get('/all', async (req, res) => {
  const results = await Promise.allSettled(PAIRS.map(p => {
    const [b, q] = p.split('/');
    return axios.get(`${ZEB}${b}-${q}/ticker`, { timeout: 5000 });
  }));
  res.json(results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { ...r.value.data, pair: PAIRS[i] };
    }
    return { pair: PAIRS[i], error: true };
  }));
});

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
      trending: trending.status === 'fulfilled' ? trending.value.data.coins.slice(0,5).map(c => ({ name: c.item.name, symbol: c.item.symbol })) : []
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ZebPay coin ticker → CoinGecko coin ID map
const COIN_ID_MAP = {
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'sol': 'solana',
  'xrp': 'ripple',
  'bnb': 'binancecoin',
  'ada': 'cardano',
  'doge': 'dogecoin',
  'usdt': 'tether',
};

// OHLCV via CoinGecko
router.get('/ohlcv/:coin', async (req, res) => {
  try {
    const coin = req.params.coin.toLowerCase().replace('-inr', '').replace('/inr', '');
    const coinId = COIN_ID_MAP[coin];

    if (!coinId) {
      return res.status(400).json({
        error: `Unknown coin: ${coin}. Supported: ${Object.keys(COIN_ID_MAP).join(', ')}`
      });
    }

    const days = req.query.days || 7;
    const { data } = await axios.get(
      `${GCK}coins/${coinId}/ohlc?vs_currency=inr&days=${days}`,
      { timeout: 8000 }
    );

    res.json(
      data.map(([time, open, high, low, close]) => ({
        time: time / 1000,
        open, high, low, close
      }))
    );
  } catch (err) {
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'CoinGecko rate limit. Wait 60s.' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
