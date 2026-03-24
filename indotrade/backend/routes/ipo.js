const express = require('express');
const router = express.Router();

// Manually maintained — update when new IPOs list
const IPOS = [
  { 
    name: 'Ather Energy', 
    status: 'Open', 
    price: '304-321', 
    close: '2026-04-03', 
    exchange: 'NSE/BSE',
    sector: 'Electric Vehicles',
    issueSize: '₹2,500 Cr',
    lotSize: 46,
    gmp: 45,
    subscription: { qib: 2.5, nii: 1.8, retail: 3.2, total: 2.4 },
    financials: { revenue: '₹2,800 Cr', profit: '₹120 Cr', pe: 85, roe: 12 },
    strengths: ['EV market leader', 'Strong brand', 'Growing market'],
    risks: ['High valuation', 'Competition from Tata, MG', 'Battery cost dependency']
  },
  { 
    name: 'Schloss Bangalore', 
    status: 'Upcoming', 
    price: 'TBA', 
    close: 'TBA', 
    exchange: 'NSE/BSE',
    sector: 'Real Estate',
    issueSize: 'TBA',
    lotSize: 'TBA',
    gmp: null,
    subscription: null,
    financials: null,
    strengths: ['Premium real estate', 'Bangalore market'],
    risks: ['Real estate cyclicality', 'Interest rate sensitivity']
  },
  { 
    name: 'Premier Energies', 
    status: 'Listed', 
    price: '1560', 
    listedAt: '1560', 
    gain: '+139%', 
    exchange: 'NSE',
    sector: 'Solar Energy',
    issueSize: '₹1,500 Cr',
    lotSize: 12,
    gmp: null,
    subscription: { qib: 5.2, nii: 3.8, retail: 4.1, total: 4.5 },
    financials: { revenue: '₹3,200 Cr', profit: '₹280 Cr', pe: 45, roe: 18 },
    strengths: ['Solar sector tailwind', 'Government support', 'Strong order book'],
    risks: ['Policy dependency', 'Raw material costs', 'Competition']
  },
  { 
    name: 'Ola Electric', 
    status: 'Listed', 
    price: '76', 
    listedAt: '76', 
    gain: '-55%', 
    exchange: 'NSE',
    sector: 'Electric Vehicles',
    issueSize: '₹5,500 Cr',
    lotSize: 195,
    gmp: null,
    subscription: { qib: 1.2, nii: 0.8, retail: 1.5, total: 1.1 },
    financials: { revenue: '₹2,600 Cr', profit: '-₹1,200 Cr', pe: null, roe: -45 },
    strengths: ['Brand recognition', 'EV market growth'],
    risks: ['Loss-making', 'High cash burn', 'Quality issues', 'Competition']
  },
  { 
    name: 'Bajaj Housing Finance', 
    status: 'Listed', 
    price: '150', 
    listedAt: '150', 
    gain: '+114%', 
    exchange: 'NSE',
    sector: 'Housing Finance',
    issueSize: '₹6,560 Cr',
    lotSize: 100,
    gmp: null,
    subscription: { qib: 8.5, nii: 6.2, retail: 5.8, total: 7.1 },
    financials: { revenue: '₹8,500 Cr', profit: '₹1,800 Cr', pe: 28, roe: 15 },
    strengths: ['Bajaj brand', 'Housing demand', 'Low NPAs'],
    risks: ['Interest rate sensitivity', 'Competition from banks']
  }
];

router.get('/', (req, res) => res.json(IPOS));

// Comprehensive IPO Analysis
router.get('/analyze/:name', (req, res) => {
  const ipoName = decodeURIComponent(req.params.name);
  const ipo = IPOS.find(i => i.name.toLowerCase() === ipoName.toLowerCase());
  
  if (!ipo) {
    return res.status(404).json({ error: 'IPO not found' });
  }
  
  // Generate recommendation
  let recommendation = 'WAIT';
  let confidence = 5;
  const reasons = [];
  
  if (ipo.status === 'Listed') {
    const gainNum = parseFloat(ipo.gain);
    if (gainNum > 50) {
      reasons.push(`Strong listing gain: ${ipo.gain}`);
      recommendation = 'BUY';
      confidence += 2;
    } else if (gainNum < -20) {
      reasons.push(`Poor listing performance: ${ipo.gain}`);
      recommendation = 'AVOID';
      confidence -= 2;
    }
    
    // Financials check
    if (ipo.financials) {
      if (ipo.financials.pe && ipo.financials.pe < 30) {
        reasons.push(`Reasonable valuation: P/E ${ipo.financials.pe}`);
        confidence += 1;
      } else if (ipo.financials.pe && ipo.financials.pe > 60) {
        reasons.push(`High valuation: P/E ${ipo.financials.pe}`);
        confidence -= 1;
      }
      
      if (ipo.financials.profit && ipo.financials.profit.includes('-')) {
        reasons.push('Loss-making company — high risk');
        recommendation = 'AVOID';
        confidence -= 2;
      }
      
      if (ipo.financials.roe && ipo.financials.roe > 15) {
        reasons.push(`Strong ROE: ${ipo.financials.roe}%`);
        confidence += 1;
      }
    }
  } else if (ipo.status === 'Open') {
    // Subscription analysis
    if (ipo.subscription) {
      if (ipo.subscription.total > 3) {
        reasons.push(`Strong subscription: ${ipo.subscription.total}x`);
        recommendation = 'SUBSCRIBE';
        confidence += 1;
      } else if (ipo.subscription.total < 1) {
        reasons.push(`Weak subscription: ${ipo.subscription.total}x`);
        recommendation = 'AVOID';
        confidence -= 1;
      }
      
      if (ipo.subscription.qib > 2) {
        reasons.push(`Strong QIB interest: ${ipo.subscription.qib}x — institutional confidence`);
        confidence += 1;
      }
    }
    
    // GMP analysis
    if (ipo.gmp && ipo.gmp > 30) {
      reasons.push(`High GMP: ₹${ipo.gmp} — market expects listing gains`);
      confidence += 1;
    } else if (ipo.gmp && ipo.gmp < 10) {
      reasons.push(`Low GMP: ₹${ipo.gmp} — limited listing gain expectation`);
      confidence -= 1;
    }
    
    // Financials check
    if (ipo.financials) {
      if (ipo.financials.pe && ipo.financials.pe > 80) {
        reasons.push(`Very high valuation: P/E ${ipo.financials.pe} — expensive`);
        recommendation = 'AVOID';
        confidence -= 2;
      }
      
      if (ipo.financials.profit && ipo.financials.profit.includes('-')) {
        reasons.push('Loss-making company — high risk for IPO');
        recommendation = 'AVOID';
        confidence -= 2;
      }
    }
  } else {
    reasons.push('IPO details not yet announced');
  }
  
  // Sector analysis
  if (ipo.sector === 'Electric Vehicles') {
    reasons.push('EV sector: high growth but competitive and capital-intensive');
  } else if (ipo.sector === 'Housing Finance') {
    reasons.push('Housing finance: stable sector with interest rate sensitivity');
  } else if (ipo.sector === 'Solar Energy') {
    reasons.push('Solar energy: government support and growing demand');
  }
  
  confidence = Math.max(1, Math.min(10, confidence));
  
  res.json({
    ...ipo,
    recommendation,
    confidence,
    reasons,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
