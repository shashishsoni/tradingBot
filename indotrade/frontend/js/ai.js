async function generateSignal() {
  const btn = document.getElementById('btn-generate-signal');
  const sel = document.getElementById('ai-asset-select');
  const cap = document.getElementById('ai-capital-input');
  const output = document.getElementById('ai-signal-output');
  const countdown = document.getElementById('ai-cooldown-timer');

  const [asset, type] = sel.value.split('|');
  const capital = parseFloat(cap.value) || 100000;

  btn.disabled = true;
  output.className = 'signal-card';
  output.innerHTML = '<div class="placeholder-text">Analyzing market data with Groq Llama 3.3... <span class="skeleton-text"></span></div>';

  try {
    let mData = {};
    if (type === 'EQUITY') {
      mData = await api.equity.quote(asset);
    } else {
      const [base] = asset.split('/');
      const pairKey = asset.replace('/', '-'); // Convert BTC/INR → BTC-INR for API matching
      const [quote, ohlcv, globalStats] = await Promise.allSettled([
        fetch(`${API}/crypto/all`).then(r=>r.json()).then(res => res.find(i => i.pair === pairKey)),
        api.crypto.ohlcv(base.toLowerCase()),
        api.crypto.global()
      ]);
      const quoteData = quote.status === 'fulfilled' ? quote.value : null;
      const ohlcvData = ohlcv.status === 'fulfilled' ? ohlcv.value : [];
      const globalData = globalStats.status === 'fulfilled' ? globalStats.value : {};
      const price = parseFloat(quoteData?.market || quoteData?.buy) || 0;
      if (price === 0) throw new Error('Could not fetch price for ' + pairKey);
      mData = { symbol: pairKey, price, ohlcv: ohlcvData, globalStats: globalData };
    }

    const { signal } = await api.ai.analyze(mData, type, capital);
    
    // Save to history
    saveToHistory(signal);
    
    // Render signal
    renderSignal(signal, output);

    // Cooldown
    let ticks = 30;
    const intv = setInterval(() => {
      ticks--;
      countdown.innerText = `Cooldown: ${ticks}s`;
      if (ticks <= 0) {
        clearInterval(intv);
        btn.disabled = false;
        countdown.innerText = '';
      }
    }, 1000);

  } catch(e) {
    output.innerHTML = `<div class="placeholder-text bear-text">Analysis failed: ${e.message}</div>`;
    btn.disabled = false;
    showToast(e.message, 'error');
  }
}

function analyzeWatchlistAsset(symbol, type) {
  const sel = document.getElementById('ai-asset-select');
  if (sel) {
    sel.value = `${symbol}|${type}`;
    generateSignal();
  }
}

function renderSignal(s, container) {
  container.className = `signal-card ${s.signal}`;
  container.innerHTML = `
    <div class="signal-header">
      <div class="signal-badge ${s.signal}">${s.signal} — ${s.asset}</div>
      <div class="sig-v">Conf: ${s.confidence}/10</div>
    </div>
    <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${s.confidence * 10}%"></div></div>
    
    <div class="signal-grid" style="margin-top:20px;">
      <div class="sig-kv"><span class="sig-k">Timeframe</span><span class="sig-v">${s.timeframe || '-'}</span></div>
      <div class="sig-kv"><span class="sig-k">Best Window</span><span class="sig-v">${s.bestWindow || '-'}</span></div>
      <div class="sig-kv"><span class="sig-k">Entry Zone</span><span class="sig-v">₹${s.entryZone?.low || 0} - ₹${s.entryZone?.high || 0}</span></div>
      <div class="sig-kv"><span class="sig-k">Stop Loss</span><span class="sig-v">₹${s.stopLoss || 0}</span></div>
      <div class="sig-kv"><span class="sig-k">Target 1</span><span class="sig-v">₹${s.target1 || 0}</span></div>
      <div class="sig-kv"><span class="sig-k">Target 2</span><span class="sig-v">₹${s.target2 || 0}</span></div>
      <div class="sig-kv"><span class="sig-k">Risk/Reward</span><span class="sig-v">${s.riskReward || '-'}</span></div>
      <div class="sig-kv"><span class="sig-k">Invalidation</span><span class="sig-v">₹${s.invalidation || 0}</span></div>
    </div>
    
    <div class="confluences-list">
      <div class="sig-k">Confluences (<span class="${s.confluences?.length >= 3 ? 'bull-text' : 'bear-text'}">${s.confluences?.length || 0}/3 req</span>)</div>
      <ul>${(s.confluences || []).map(c => `<li>${c}</li>`).join('')}</ul>
    </div>
    
    ${s.riskWarnings?.length ? `<div class="warnings-list"><div class="sig-k">Warnings</div><ul>${s.riskWarnings.map(w => `<li class="bear-text">${w}</li>`).join('')}</ul></div>` : ''}
    
    <div class="signal-note">${s.positionNote || ''}</div>
  `;
}

function saveToHistory(signal) {
  let hist = JSON.parse(localStorage.getItem('indotrade_signal_history') || '[]');
  hist.unshift({ ...signal, t: new Date().toISOString() });
  hist = hist.slice(0, 20);
  localStorage.setItem('indotrade_signal_history', JSON.stringify(hist));
  renderHistory();
}

function renderHistory() {
  const c = document.getElementById('history-container');
  if(!c) return;
  const hist = JSON.parse(localStorage.getItem('indotrade_signal_history') || '[]');
  c.innerHTML = hist.map(s => `
    <div class="history-item">
      <div class="flex-row">
        <strong>${s.signal} ${s.asset}</strong>
        <span class="sig-k">${new Date(s.t).toLocaleTimeString()}</span>
      </div>
      <div class="sig-k">Entry: ₹${s.entryZone?.low}-₹${s.entryZone?.high} | Target: ₹${s.target1}</div>
    </div>
  `).join('');
}
