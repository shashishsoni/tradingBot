function ema(closes, p) {
  const k = 2 / (p + 1); let e = closes[0];
  return closes.map(v => { e = v * k + e * (1 - k); return +e.toFixed(2); });
}

function rsi(closes, p = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i-1]; d > 0 ? g += d : l -= d; }
  let ag = g/p, al = l/p, vals = [];
  for (let i = p+1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag*(p-1) + (d>0?d:0))/p; al = (al*(p-1) + (d<0?-d:0))/p;
    vals.push(+(100 - 100/(1+(al===0?100:ag/al))).toFixed(2));
  }
  return vals;
}

function macd(closes, f=12, s=26, sig=9) {
  const fast = ema(closes,f), slow = ema(closes,s);
  const line = fast.map((v,i) => +(v-slow[i]).toFixed(2));
  const signal = ema(line.slice(s-f), sig);
  const hist = signal.map((v,i) => +(line[i+(s-f)]-v).toFixed(2));
  return { line, signal, hist };
}

function atr(ohlcv, p=14) {
  const trs = ohlcv.slice(1).map((b,i) => Math.max(b.high-b.low, Math.abs(b.high-ohlcv[i].close), Math.abs(b.low-ohlcv[i].close)));
  let a = trs.slice(0,p).reduce((s,v)=>s+v,0)/p;
  for (let i=p; i<trs.length; i++) a = (a*(p-1)+trs[i])/p;
  return +a.toFixed(2);
}

function bb(closes, p=20, sd=2) {
  const s = closes.slice(-p), sma = s.reduce((a,b)=>a+b,0)/p;
  const std = Math.sqrt(s.reduce((sum,v)=>sum+Math.pow(v-sma,2),0)/p);
  return { upper: +(sma+sd*std).toFixed(2), middle: +sma.toFixed(2), lower: +(sma-sd*std).toFixed(2), width: +(sd*2*std/sma*100).toFixed(2) };
}

function obv(ohlcv) {
  let o = 0;
  return ohlcv.map((b,i) => { if(i===0) return 0; o += b.close > ohlcv[i-1].close ? b.volume : b.close < ohlcv[i-1].close ? -b.volume : 0; return o; });
}

function calculateIndicators(ohlcv) {
  if (!ohlcv || ohlcv.length < 26) return { error: 'Need 26+ candles' };
  const closes = ohlcv.map(c => c.close).filter(Boolean);
  const vols = ohlcv.map(c => c.volume).filter(Boolean);
  const e20 = ema(closes,20), e50 = ema(closes,50);
  const e200 = closes.length >= 200 ? ema(closes,200) : null;
  const rsiVals = rsi(closes);
  const macdVals = macd(closes);
  const atrVal = atr(ohlcv);
  const bbVals = bb(closes);
  const obvVals = obv(ohlcv);
  const avgVol = vols.slice(-20).reduce((a,b)=>a+b,0)/20;
  const cur = closes[closes.length-1];
  const curRSI = rsiVals[rsiVals.length-1];
  const curHist = macdVals.hist[macdVals.hist.length-1];
  const prevHist = macdVals.hist[macdVals.hist.length-2];
  return {
    ema20: e20[e20.length-1], ema50: e50[e50.length-1],
    ema200: e200 ? e200[e200.length-1] : null,
    rsi: curRSI,
    rsiSignal: curRSI > 70 ? 'OVERBOUGHT' : curRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
    macdHistogram: curHist,
    macdCross: prevHist < 0 && curHist > 0 ? 'BULLISH' : prevHist > 0 && curHist < 0 ? 'BEARISH' : 'NONE',
    atr: atrVal, bb: bbVals,
    bbPosition: cur > bbVals.upper ? 'ABOVE' : cur < bbVals.lower ? 'BELOW' : 'INSIDE',
    volumeRatio: +(vols[vols.length-1]/avgVol).toFixed(2),
    volumeSignal: vols[vols.length-1] > avgVol*1.5 ? 'HIGH' : vols[vols.length-1] < avgVol*0.5 ? 'LOW' : 'NORMAL',
    obvTrend: obvVals[obvVals.length-1] > obvVals[obvVals.length-5] ? 'RISING' : 'FALLING',
    trend: cur > e20[e20.length-1] && e20[e20.length-1] > e50[e50.length-1] ? 'UPTREND' : cur < e20[e20.length-1] && e20[e20.length-1] < e50[e50.length-1] ? 'DOWNTREND' : 'SIDEWAYS'
  };
}

module.exports = { calculateIndicators };
