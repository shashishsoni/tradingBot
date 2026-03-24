function positionSize(capital, price, atr, riskPct = 0.02) {
  if (!atr) return null;
  const risk = capital * riskPct;
  const stopDist = atr * 1.5;
  const units = Math.floor(risk / stopDist);
  return {
    units,
    totalInvestment: +(units * price).toFixed(2),
    investmentPct: +((units * price / capital) * 100).toFixed(1),
    riskAmount: +risk.toFixed(2),
    suggestedStop: +(price - stopDist).toFixed(2)
  };
}

// Portfolio Risk Assessment
function assessPortfolioRisk(portfolio, capital) {
  if (!portfolio || !portfolio.length) {
    return {
      riskScore: 0,
      riskLevel: 'UNKNOWN',
      diversification: 0,
      recommendations: ['No portfolio data available']
    };
  }
  
  const totalValue = portfolio.reduce((sum, p) => sum + (p.value || 0), 0);
  const positions = portfolio.map(p => ({
    ...p,
    weight: totalValue > 0 ? (p.value / totalValue * 100) : 0
  }));
  
  // Concentration risk
  const maxWeight = Math.max(...positions.map(p => p.weight));
  const concentrationRisk = maxWeight > 30 ? 'HIGH' : maxWeight > 20 ? 'MEDIUM' : 'LOW';
  
  // Sector diversification
  const sectors = [...new Set(positions.map(p => p.sector).filter(Boolean))];
  const sectorWeights = {};
  positions.forEach(p => {
    if (p.sector) {
      sectorWeights[p.sector] = (sectorWeights[p.sector] || 0) + p.weight;
    }
  });
  const maxSectorWeight = Math.max(...Object.values(sectorWeights), 0);
  const sectorDiversification = sectors.length >= 5 && maxSectorWeight < 40 ? 'GOOD' : 
                                 sectors.length >= 3 && maxSectorWeight < 50 ? 'MODERATE' : 'POOR';
  
  // Asset class diversification
  const assetClasses = [...new Set(positions.map(p => p.assetClass).filter(Boolean))];
  const assetDiversification = assetClasses.length >= 3 ? 'GOOD' : assetClasses.length >= 2 ? 'MODERATE' : 'POOR';
  
  // Volatility-based risk
  const avgVolatility = positions.reduce((sum, p) => sum + (p.volatility || 15), 0) / positions.length;
  const volatilityRisk = avgVolatility > 30 ? 'HIGH' : avgVolatility > 15 ? 'MEDIUM' : 'LOW';
  
  // Overall risk score (0-100)
  let riskScore = 50;
  
  // Concentration penalty
  if (maxWeight > 40) riskScore += 20;
  else if (maxWeight > 25) riskScore += 10;
  
  // Diversification bonus
  if (sectors.length >= 5) riskScore -= 15;
  else if (sectors.length >= 3) riskScore -= 5;
  
  // Volatility penalty
  if (avgVolatility > 30) riskScore += 15;
  else if (avgVolatility > 20) riskScore += 5;
  else if (avgVolatility < 10) riskScore -= 10;
  
  // Asset class bonus
  if (assetClasses.length >= 3) riskScore -= 10;
  
  riskScore = Math.max(0, Math.min(100, riskScore));
  
  const riskLevel = riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW';
  
  // Generate recommendations
  const recommendations = [];
  
  if (concentrationRisk === 'HIGH') {
    recommendations.push(`Reduce concentration: largest position is ${maxWeight.toFixed(1)}% of portfolio`);
  }
  
  if (sectorDiversification === 'POOR') {
    recommendations.push(`Improve sector diversification: ${sectors.length} sectors, max sector weight ${maxSectorWeight.toFixed(1)}%`);
  }
  
  if (assetDiversification === 'POOR') {
    recommendations.push('Add different asset classes (equity, debt, gold, crypto) for better diversification');
  }
  
  if (volatilityRisk === 'HIGH') {
    recommendations.push(`Portfolio volatility is high (${avgVolatility.toFixed(1)}%) — consider adding stable assets`);
  }
  
  if (positions.length < 5) {
    recommendations.push('Consider adding more positions to reduce single-stock risk');
  }
  
  // Stress test scenarios
  const stressTests = [
    { scenario: 'Market crash (-20%)', impact: -(totalValue * 0.20).toFixed(0) },
    { scenario: 'Sector rotation (-15%)', impact: -(totalValue * 0.15).toFixed(0) },
    { scenario: 'Interest rate hike (-10%)', impact: -(totalValue * 0.10).toFixed(0) },
    { scenario: 'Crypto winter (-40%)', impact: -(totalValue * 0.40 * (positions.filter(p => p.assetClass === 'CRYPTO').reduce((s, p) => s + p.weight, 0) / 100)).toFixed(0) }
  ];
  
  return {
    riskScore: +riskScore.toFixed(0),
    riskLevel,
    totalValue: +totalValue.toFixed(2),
    positions: positions.length,
    concentration: {
      maxWeight: +maxWeight.toFixed(1),
      risk: concentrationRisk
    },
    diversification: {
      sectors: sectors.length,
      sectorRisk: sectorDiversification,
      assetClasses: assetClasses.length,
      assetRisk: assetDiversification,
      score: sectors.length >= 5 && assetClasses.length >= 3 ? 85 : 
             sectors.length >= 3 && assetClasses.length >= 2 ? 65 : 40
    },
    volatility: {
      average: +avgVolatility.toFixed(1),
      risk: volatilityRisk
    },
    stressTests,
    recommendations,
    timestamp: new Date().toISOString()
  };
}

// Real-time Risk Score for a single position
function calculatePositionRisk(position, marketData) {
  const { price, atr, volatility, sector } = position;
  const { marketTrend, vix, sectorPerformance } = marketData || {};
  
  let riskScore = 50;
  
  // Volatility risk
  if (volatility > 30) riskScore += 20;
  else if (volatility > 20) riskScore += 10;
  else if (volatility < 10) riskScore -= 10;
  
  // ATR-based risk
  if (atr && price) {
    const atrPct = (atr / price) * 100;
    if (atrPct > 3) riskScore += 15;
    else if (atrPct > 2) riskScore += 5;
  }
  
  // Market trend adjustment
  if (marketTrend === 'DOWNTREND') riskScore += 15;
  else if (marketTrend === 'UPTREND') riskScore -= 10;
  
  // VIX adjustment
  if (vix && vix > 25) riskScore += 10;
  else if (vix && vix < 15) riskScore -= 5;
  
  // Sector performance
  if (sectorPerformance && sectorPerformance[sector] < -5) riskScore += 10;
  else if (sectorPerformance && sectorPerformance[sector] > 5) riskScore -= 5;
  
  riskScore = Math.max(0, Math.min(100, riskScore));
  
  return {
    riskScore: +riskScore.toFixed(0),
    riskLevel: riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW',
    factors: {
      volatility: volatility > 20 ? 'HIGH' : 'LOW',
      atrRisk: atr && price ? ((atr / price) * 100).toFixed(2) + '%' : 'N/A',
      marketTrend: marketTrend || 'UNKNOWN',
      vix: vix || 'N/A'
    }
  };
}

module.exports = { positionSize, assessPortfolioRisk, calculatePositionRisk };
