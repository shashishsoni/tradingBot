const WebSocket = require('ws');

// Real-time ticker cache via ZebPay WebSocket
const tickerCache = {};
const WS_URL = 'wss://socket.zebapi.com/api/v1/websocket/public';
let ws = null;
let reconnectTimer = null;
let subscribedPairs = [];

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('[TickerWS] Connected to ZebPay WebSocket');
    // Re-subscribe to all pairs
    subscribedPairs.forEach(pair => subscribe(pair));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const pair = msg.requestType;
      if (!pair) return;

      if (!tickerCache[pair]) {
        tickerCache[pair] = { pair, timestamp: Date.now() };
      }
      const t = tickerCache[pair];
      t.timestamp = Date.now();

      switch (msg.type) {
        case 'exchange-marketprice':
          t.price = parseFloat(msg.data);
          break;
        case 'exchange-pricechange':
          t.pricechange = parseFloat(msg.data);
          break;
        case 'exchange-topbuy':
          t.bid = parseFloat(msg.data);
          break;
        case 'exchange-topsell':
          t.ask = parseFloat(msg.data);
          break;
        case 'exchange-high':
          t.high = parseFloat(msg.data);
          break;
        case 'exchange-low':
          t.low = parseFloat(msg.data);
          break;
        case 'exchange-volumechange':
          t.volume = parseFloat(msg.data);
          break;
      }
    } catch (_) {}
  });

  ws.on('error', (err) => {
    console.error('[TickerWS] Error:', err.message);
  });

  ws.on('close', () => {
    console.log('[TickerWS] Disconnected, reconnecting in 3s...');
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });
}

function subscribe(pair) {
  if (subscribedPairs.includes(pair)) return;
  subscribedPairs.push(pair);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ request: `exchange/${pair}` }));
  }
}

function subscribeAll(pairs) {
  pairs.forEach(p => subscribe(p));
}

function getTicker(pair) {
  return tickerCache[pair] || null;
}

function getAllTickers() {
  return { ...tickerCache };
}

function isLive(pair) {
  const t = tickerCache[pair];
  if (!t) return false;
  return (Date.now() - t.timestamp) < 30000; // live if updated within 30s
}

// Start connection
connect();

module.exports = { subscribe, subscribeAll, getTicker, getAllTickers, isLive };
