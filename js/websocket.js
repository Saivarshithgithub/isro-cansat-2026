// websocket.js — WebSocket alternative downlink/uplink (CONTRACT §5)
// A Python backend (backend/server.py) bridges the radio serial port to
// ws://localhost:8765. Telemetry lines arrive as messages; commands go out
// as text frames. Streaming is still gated by the Start button (CONTRACT §4).

let ws = null;
let wsConnected = false;

function wsConnect(url = 'ws://localhost:8765') {
  if (ws) { try { ws.close(); } catch (_) {} }

  ws = new WebSocket(url);

  ws.onopen = () => {
    wsConnected = true;
    console.log('[ws] Connected to', url);
    if (typeof setConnStatus === 'function') setConnStatus(true, 'WS');
  };

  ws.onmessage = (event) => {
    dispatchTelemetry(event.data);   // gated internally by GCS.streaming
  };

  ws.onclose = () => {
    wsConnected = false;
    console.warn('[ws] Connection closed');
    if (typeof setConnStatus === 'function') setConnStatus(false);
    const btn = document.getElementById('wsConnectBtn');
    if (btn) btn.textContent = '🌐 WebSocket';
  };

  ws.onerror = (e) => console.error('[ws] Error:', e);
}

function wsDisconnect() {
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  wsConnected = false;
}

// Uplink over WebSocket — used as fallback by sendCommand() in serial.js.
function wsSend(cmd) {
  if (ws && wsConnected && ws.readyState === WebSocket.OPEN) {
    ws.send(cmd + '\n');
    return true;
  }
  return false;
}

document.getElementById('wsConnectBtn').addEventListener('click', () => {
  const btn = document.getElementById('wsConnectBtn');
  if (wsConnected) {
    wsDisconnect();
    btn.textContent = '🌐 WebSocket';
  } else {
    const url = prompt('WebSocket URL:', 'ws://localhost:8765');
    if (url) { wsConnect(url); btn.textContent = '✕ WebSocket'; }
  }
});
