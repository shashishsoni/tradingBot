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
  const signalClass = s.signal === 'BUY' ? 'bull' : s.signal === 'SELL' ? 'bear' : 'neutral';
  const signalIcon = s.signal === 'BUY' ? '📈' : s.signal === 'SELL' ? '📉' : '➡️';
  const convictionIcon = s.conviction === 'HIGH' ? '🔥' : s.conviction === 'MEDIUM' ? '⚡' : '💤';
  
  container.className = `signal-card modern ${signalClass}`;
  container.innerHTML = `
    <!-- THE VERDICT -->
    <div class="verdict-section">
      <div class="verdict-header">
        <div class="verdict-icon">${signalIcon}</div>
        <div class="verdict-content">
          <div class="verdict-label">THE VERDICT</div>
          <div class="verdict-value ${signalClass}">${s.signal}</div>
          <div class="verdict-asset">${s.asset}</div>
        </div>
        <div class="verdict-confidence">
          <div class="conf-label">Confidence</div>
          <div class="conf-value">${s.confidence}/10</div>
          <div class="conf-bar-bg"><div class="conf-bar-fill ${signalClass}" style="width: ${s.confidence * 10}%"></div></div>
        </div>
      </div>
      <div class="conviction-badge ${s.conviction?.toLowerCase()}">
        ${convictionIcon} ${s.conviction || 'MEDIUM'} Conviction | Success Probability: ${s.probabilityOfSuccess || 'N/A'}
      </div>
    </div>

    <!-- TRADE PARAMETERS -->
    <div class="analysis-section">
      <div class="section-title">
        <span class="section-icon">🎯</span>
        <span>TRADE PARAMETERS</span>
      </div>
      <div class="params-grid">
        <div class="param-card">
          <div class="param-label">Timeframe</div>
          <div class="param-value">${s.timeframe || '-'}</div>
        </div>
        <div class="param-card">
          <div class="param-label">Best Window</div>
          <div class="param-value">${s.bestWindow || '-'}</div>
        </div>
        <div class="param-card entry">
          <div class="param-label">Entry Zone</div>
          <div class="param-value">₹${s.entryZone?.low || 0} - ₹${s.entryZone?.high || 0}</div>
        </div>
        <div class="param-card stop">
          <div class="param-label">Stop Loss</div>
          <div class="param-value bear-text">₹${s.stopLoss || 0}</div>
        </div>
        <div class="param-card target">
          <div class="param-label">Target 1</div>
          <div class="param-value bull-text">₹${s.target1 || 0}</div>
        </div>
        <div class="param-card target">
          <div class="param-label">Target 2</div>
          <div class="param-value bull-text">₹${s.target2 || 0}</div>
        </div>
        <div class="param-card">
          <div class="param-label">Risk/Reward</div>
          <div class="param-value">${s.riskReward || '-'}</div>
        </div>
        <div class="param-card invalidation">
          <div class="param-label">Invalidation</div>
          <div class="param-value bear-text">₹${s.invalidation || 0}</div>
        </div>
      </div>
    </div>

    <!-- WHY TO BUY / WHY TO AVOID -->
    <div class="analysis-section">
      <div class="section-title">
        <span class="section-icon">💡</span>
        <span>WHY TO ${s.signal === 'BUY' ? 'BUY' : s.signal === 'SELL' ? 'AVOID' : 'HOLD'} (The ${s.signal === 'BUY' ? 'Bull' : s.signal === 'SELL' ? 'Bear' : 'Neutral'} Case)</span>
      </div>
      <div class="factors-list">
        ${(s.bullishFactors || []).map((f, i) => `
          <div class="factor-item bull">
            <span class="factor-number">${i + 1}</span>
            <span class="factor-text">${f}</span>
          </div>
        `).join('')}
        ${(s.bearishFactors || []).map((f, i) => `
          <div class="factor-item bear">
            <span class="factor-number">${i + 1}</span>
            <span class="factor-text">${f}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- CONFLUENCES -->
    <div class="analysis-section">
      <div class="section-title">
        <span class="section-icon">🔗</span>
        <span>CONFLUENCES (${s.confluences?.length || 0}/3 required)</span>
      </div>
      <div class="confluences-grid">
        ${(s.confluences || []).map((c, i) => `
          <div class="confluence-item">
            <span class="confluence-check">✓</span>
            <span class="confluence-text">${c}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- MACRO CONTEXT & POLICY IMPACT -->
    ${s.macroContext?.length || s.policyImpact?.length ? `
    <div class="analysis-section">
      <div class="section-title">
        <span class="section-icon">🏛️</span>
        <span>MACRO CONTEXT & POLICY IMPACT</span>
      </div>
      <div class="context-list">
        ${(s.macroContext || []).map(c => `
          <div class="context-item">
            <span class="context-icon">📊</span>
            <span class="context-text">${c}</span>
          </div>
        `).join('')}
        ${(s.policyImpact || []).map(p => `
          <div class="context-item">
            <span class="context-icon">📜</span>
            <span class="context-text">${p}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- HISTORICAL RISK & CATALYST -->
    ${s.historicalRisk?.length || s.catalyst?.length ? `
    <div class="analysis-section">
      <div class="section-title">
        <span class="section-icon">⚠️</span>
        <span>HISTORICAL RISK & CATALYST</span>
      </div>
      <div class="risk-catalyst-grid">
        ${(s.historicalRisk || []).map(r => `
          <div class="risk-item">
            <span class="risk-icon">🔴</span>
            <span class="risk-text">${r}</span>
          </div>
        `).join('')}
        ${(s.catalyst || []).map(c => `
          <div class="catalyst-item">
            <span class="catalyst-icon">🚀</span>
            <span class="catalyst-text">${c}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- RISK WARNINGS -->
    ${s.riskWarnings?.length ? `
    <div class="analysis-section warnings">
      <div class="section-title">
        <span class="section-icon">🚨</span>
        <span>RISK WARNINGS</span>
      </div>
      <div class="warnings-list">
        ${s.riskWarnings.map(w => `
          <div class="warning-item">
            <span class="warning-icon">⚠️</span>
            <span class="warning-text">${w}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- THE CONDITIONAL TRIGGER -->
    <div class="analysis-section trigger">
      <div class="section-title">
        <span class="section-icon">🎯</span>
        <span>THE CONDITIONAL TRIGGER</span>
      </div>
      <div class="trigger-content">
        <div class="trigger-text">${s.positionNote || 'Monitor price action and volume for confirmation.'}</div>
      </div>
    </div>

    <!-- DATA SOURCES -->
    ${s.dataSources?.length ? `
    <div class="analysis-section sources">
      <div class="section-title">
        <span class="section-icon">📚</span>
        <span>DATA SOURCES</span>
      </div>
      <div class="sources-list">
        ${s.dataSources.map(ds => `
          <div class="source-item">
            <span class="source-icon">📊</span>
            <span class="source-text">${ds}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- DISCLAIMER -->
    <div class="disclaimer">
      <span class="disclaimer-icon">⚖️</span>
      <span>${s.disclaimer || 'Algorithmic analysis only. Not SEBI-registered advice.'}</span>
    </div>
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
