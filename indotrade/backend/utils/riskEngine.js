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

module.exports = { positionSize };
