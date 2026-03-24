require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { assessPortfolioRisk, calculatePositionRisk } = require('./utils/riskEngine');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api/equity', require('./routes/equity'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/mf', require('./routes/mf'));
app.use('/api/ipo', require('./routes/ipo'));
app.use('/api/fo', require('./routes/fo'));
app.use('/api/ai', require('./routes/ai'));

// Risk Engine API
app.post('/api/risk/portfolio', (req, res) => {
  try {
    const { portfolio, capital } = req.body;
    if (!portfolio || !Array.isArray(portfolio)) {
      return res.status(400).json({ error: 'portfolio array required' });
    }
    const assessment = assessPortfolioRisk(portfolio, capital || 100000);
    res.json(assessment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/risk/position', (req, res) => {
  try {
    const { position, marketData } = req.body;
    if (!position) {
      return res.status(400).json({ error: 'position data required' });
    }
    const risk = calculatePositionRisk(position, marketData);
    res.json(risk);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});
