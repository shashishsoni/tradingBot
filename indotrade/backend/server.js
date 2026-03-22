require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 60000, max: 30 }));

app.use('/api/equity', require('./routes/equity'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/mf', require('./routes/mf'));
app.use('/api/ipo', require('./routes/ipo'));
app.use('/api/fo', require('./routes/fo'));
app.use('/api/ai', require('./routes/ai'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});
