const express = require('express');
const router = express.Router();

// Manually maintained — update when new IPOs list
const IPOS = [
  { name: 'Ather Energy', status: 'Open', price: '304-321', close: '2026-04-03', exchange: 'NSE/BSE' },
  { name: 'Schloss Bangalore', status: 'Upcoming', price: 'TBA', close: 'TBA', exchange: 'NSE/BSE' },
  { name: 'Premier Energies', status: 'Listed', price: '1560', listedAt: '1560', gain: '+139%', exchange: 'NSE' },
  { name: 'Ola Electric', status: 'Listed', price: '76', listedAt: '76', gain: '-55%', exchange: 'NSE' },
  { name: 'Bajaj Housing Finance', status: 'Listed', price: '150', listedAt: '150', gain: '+114%', exchange: 'NSE' }
];

router.get('/', (req, res) => res.json(IPOS));
module.exports = router;
