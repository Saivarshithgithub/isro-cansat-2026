// serial.js — Web Serial API connection + uplink (CONTRACT §5)
// Chrome/Edge only, served from localhost or https:// (file:// won't work).
// Connecting a link does NOT start streaming — the Start button does (CONTRACT §4).

let serialPort = null;
let serialReader = null;
let isSerialConnected = false;

class LineBreakTransformer {
  constructor() { this.buf = ''; }
  transform(chunk, controller) {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop();
    lines.forEach(l => controller.enqueue(l));
  }
  flush(controller) { if (this.buf) controller.enqueue(this.buf); }
}

async function serialConnect() {
  if (!('serial' in navigator)) {
    alert('Web Serial API not supported.\nUse Chrome or Edge, served from http://localhost.');
    return;
  }
  try {
    const baud = parseInt(document.getElementById('baudSelect').value, 10) || 115200;
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: baud });

    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    const lineStream = decoder.readable.pipeThrough(new TransformStream(new LineBreakTransformer()));
    serialReader = lineStream.getReader();

    isSerialConnected = true;
    setConnStatus(true, 'SERIAL');
    serialReadLoop();
  } catch (err) {
    console.error('[serial] Connect failed:', err);
    setConnStatus(false);
  }
}

async function serialDisconnect() {
  try { if (serialReader) { await serialReader.cancel(); serialReader.releaseLock?.(); } } catch (_) {}
  try { if (serialPort)   { await serialPort.close(); } } catch (_) {}
  serialReader = null;
  serialPort   = null;
  isSerialConnected = false;
  setConnStatus(false);
}

async function serialReadLoop() {
  try {
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      dispatchTelemetry(value);   // gated internally by GCS.streaming
    }
  } catch (err) {
    console.error('[serial] Read error:', err);
    setConnStatus(false);
  }
}

// ── Uplink (CONTRACT §5) ───────────────────────────────────────
// sendCommand is the global entry point; falls back to WebSocket when
// serial is not the active link.
async function sendCommand(cmd) {
  if (serialPort && serialPort.writable) {
    try {
      const writer = serialPort.writable.getWriter();
      await writer.write(new TextEncoder().encode(cmd + '\n'));
      writer.releaseLock();
      return true;
    } catch (err) {
      console.error('[serial] Write failed:', err);
    }
  }
  // Fallback to WebSocket uplink if available.
  if (typeof wsSend === 'function' && wsSend(cmd)) return true;
  console.warn('[uplink] No active link for command:', cmd);
  return false;
}

// ── UI wiring ──────────────────────────────────────────────────
const _connectBtn = document.getElementById('connectBtn');
_connectBtn.addEventListener('click', async () => {
  if (isSerialConnected) {
    await serialDisconnect();
    _connectBtn.textContent = '🔌 Connect Serial';
  } else {
    await serialConnect();
    if (isSerialConnected) _connectBtn.textContent = '✕ Disconnect';
  }
});

function setConnStatus(connected, mode = '') {
  const el = document.getElementById('connStatus');
  if (!el) return;
  if (connected) {
    el.textContent = `● CONNECTED [${mode}]`;
    el.className = 'conn-status connected';
  } else {
    el.textContent = '● DISCONNECTED';
    el.className = 'conn-status disconnected';
  }
}
