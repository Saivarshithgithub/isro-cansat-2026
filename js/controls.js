// controls.js — top-bar + mission-command orchestration (CONTRACT §4, §5, §7)
// Owns the streaming gate, exports, uplink command buttons, the PC clock,
// Reset Packet, and the hardware-free telemetry simulator (PDF Req 11).

// ── Streaming gate (Start / Stop) ──────────────────────────────
const startBtnEl = document.getElementById('startBtn');
const stopBtnEl  = document.getElementById('stopBtn');

function startStreaming() {
  window.GCS.streaming = true;
  // Fresh session → clear the altitude-derivative history so the first packet
  // after a Stop→Start (e.g. mid-descent) can't compute a bogus descent rate.
  if (typeof resetParserState === 'function') resetParserState();
  startBtnEl.disabled = true;
  stopBtnEl.disabled  = false;
  startBtnEl.classList.add('armed');
}

function stopStreaming() {
  window.GCS.streaming = false;
  startBtnEl.disabled = false;
  stopBtnEl.disabled  = true;
  startBtnEl.classList.remove('armed');
  stopSimulator();
}

startBtnEl.addEventListener('click', startStreaming);
stopBtnEl.addEventListener('click', stopStreaming);

// ── Exports ────────────────────────────────────────────────────
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (typeof exportCSV === 'function') exportCSV();
});
document.getElementById('exportGraphBtn').addEventListener('click', () => {
  if (typeof exportGraphs === 'function') exportGraphs();
});

// ── Reset Packet — clears every consumer (CONTRACT §7) ──────────
function resetPackets() {
  if (typeof resetParserState  === 'function') resetParserState();
  if (typeof resetCharts       === 'function') resetCharts();
  if (typeof resetMap          === 'function') resetMap();
  if (typeof resetOrientation  === 'function') resetOrientation();
  if (typeof resetErrorCodes   === 'function') resetErrorCodes();
  if (typeof resetMissionStats === 'function') resetMissionStats();
  if (typeof resetMissionTimer === 'function') resetMissionTimer();
  if (typeof clearSessionLog   === 'function') clearSessionLog();
  setCmdStatus('Reset — telemetry buffers cleared');
}
document.getElementById('resetPacketBtn').addEventListener('click', resetPackets);

// ── PC clock + Sync ────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  const el = document.getElementById('pcClock');
  if (el) el.textContent = now.toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000);
tickClock();

document.getElementById('syncTimeBtn').addEventListener('click', () => {
  tickClock();
  // Also push PC epoch to the CanSat so on-board logs can be aligned.
  sendCommand('TIME,' + Date.now());
  setCmdStatus('PC time synced → ' + new Date().toTimeString().slice(0, 8));
});

// ── Mission command buttons (data-cmd → sendCommand) ────────────
function setCmdStatus(msg) {
  const el = document.getElementById('cmdStatus');
  if (el) el.textContent = 'Command status: ' + msg;
}

document.querySelectorAll('[data-cmd]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const cmd = btn.getAttribute('data-cmd');
    // Guard destructive commands.
    if ((cmd === 'CHUTE' || cmd === 'ABORT') &&
        !confirm(`Send ${cmd} command to the CanSat?`)) return;
    const ok = await sendCommand(cmd);
    setCmdStatus(ok ? `${cmd} sent` : `${cmd} FAILED (no link)`);
  });
});

// ── Telemetry simulator (PDF Requirement 11) ───────────────────
// Builds real $CSAT packets (with XOR checksum) and feeds them through the
// same parser as hardware, so descent rate / error codes are genuinely tested.
let simTimer = null;
let sim = null;
let simLastTs = null;   // wall-clock of previous sim step, for real-dt integration

function buildRawPacket(fields) {
  const body = 'CSAT,' + fields.join(',');
  let chk = 0;
  for (const c of body) chk ^= c.charCodeAt(0);
  return '$' + body + '*' + chk.toString(16).toUpperCase().padStart(2, '0');
}

function newSimState() {
  return { seq: 0, alt: 0, vel: 0, t: 0, state: 0, sep: 0, chute: 0 };
}

// One 200 ms step of the flight model. scenario tweaks the profile.
function simStep(scenario) {
  // Integrate on the REAL elapsed interval, not a fixed 0.2 s. parser.js derives
  // descent rate from wall-clock timestamps, so if setInterval drifts (tab
  // throttling, heavy redraws) a fixed dt would desync alt-delta from the parser's
  // divisor and flash a spurious descent-rate fault on an otherwise nominal flight.
  const now = Date.now();
  const dt = simLastTs === null ? 0.2 : (now - simLastTs) / 1000;
  simLastTs = now;
  sim.t += dt;

  // Phase progression by altitude + velocity.
  if (sim.state === 0) {                     // PAD (1 s dwell)
    if (sim.t > 1) { sim.state = 1; sim.vel = 28; }
  } else if (sim.state === 1) {              // ASCENT
    sim.vel = 28;
    if (sim.alt >= 380) { sim.state = 2; sim.vel = 0; }
  } else if (sim.state === 2) {              // APOGEE (brief)
    sim.sep = (scenario === 'sepfail') ? 0 : 1;   // payload separates
    sim.state = 3;
    sim.vel = (scenario === 'fastdescent') ? -16 : -9;   // nominal 8–10 m/s
  } else if (sim.state === 3) {              // DESCENT
    if (sim.alt < 15) { sim.state = 4; sim.vel = -2; }
  } else if (sim.state === 4) {              // LANDING
    if (sim.alt <= 0.5) { sim.state = 5; sim.vel = 0; sim.alt = 0; }
  }

  sim.alt = Math.max(0, sim.alt + sim.vel * dt);

  const ascending = sim.vel > 0;
  const press = 1013.25 * Math.pow(1 - (sim.alt * 0.0000225577), 5.25588);
  const temp  = 25 - sim.alt * 0.0065;
  const batV  = (3.9 - sim.seq * 0.0002).toFixed(3);

  // GPS: lost mid-flight in the gpsloss scenario.
  const gpsFix = (scenario === 'gpsloss' && sim.t > 6 && sim.t < 14) ? 0 : 1;
  const jitter = () => (Math.random() - 0.5) * 0.0002;
  const lat = gpsFix ? (13.0827 + jitter()).toFixed(6) : '0.000000';
  const lon = gpsFix ? (80.2707 + jitter()).toFixed(6) : '0.000000';

  // IMU: gentle tumble on descent.
  const spin = sim.state >= 3 ? 40 : 3;
  const fields = [
    sim.seq,
    sim.alt.toFixed(1), temp.toFixed(1), press.toFixed(1),
    lat, lon, sim.alt.toFixed(1), gpsFix,
    ((Math.random() - 0.5) * 0.2).toFixed(3),
    ((Math.random() - 0.5) * 0.2).toFixed(3),
    (ascending ? 1.6 : 1.0 + (Math.random() - 0.5) * 0.1).toFixed(3),
    ((Math.random() - 0.5) * spin).toFixed(2),
    ((Math.random() - 0.5) * spin).toFixed(2),
    ((Math.random() - 0.5) * spin).toFixed(2),
    batV, sim.state, sim.sep, sim.chute,
  ];

  dispatchTelemetry(buildRawPacket(fields));
  sim.seq++;

  if (sim.state === 5) stopSimulator();      // landed → stop
}

function startSimulator() {
  if (simTimer) return;
  if (!window.GCS.streaming) startStreaming();   // sim is a data source
  if (typeof resetMissionTimer === 'function') resetMissionTimer();  // fresh T+
  sim = newSimState();
  simLastTs = null;                              // first step uses nominal 0.2 s
  const scenario = document.getElementById('scenarioSelect').value;
  document.getElementById('simBtn').textContent = '■ Stop Simulation';
  simTimer = setInterval(() => simStep(scenario), 200);   // 5 Hz
  setCmdStatus(`simulating: ${scenario}`);
}

function stopSimulator() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  simLastTs = null;
  const btn = document.getElementById('simBtn');
  if (btn) btn.textContent = '▶ Simulate Telemetry';
}

document.getElementById('simBtn').addEventListener('click', () => {
  if (simTimer) stopSimulator(); else startSimulator();
});

// Inject a single faulty packet reflecting the selected scenario.
document.getElementById('injectFaultBtn').addEventListener('click', () => {
  if (!window.GCS.streaming) startStreaming();
  const scenario = document.getElementById('scenarioSelect').value;
  // Force a large altitude drop so the parser sees a descent-rate fault,
  // plus GPS loss, separation failure and parachute deployment.
  const base = sim ? sim.alt : 200;
  const dropped = Math.max(0, base - 40);   // ~200 m/s over 0.2 s → out of range
  // Seed the altitude derivative so the parser sees a VALID, out-of-range
  // descent rate on this single packet (base→dropped over 0.2 s). Without this
  // the first post-reset packet has no prior sample, rateValid=false, and d1
  // would wrongly read 0 → error code 0111 instead of the intended 1111.
  if (typeof primeDescentRate === 'function') primeDescentRate(base, 0.2);
  const fields = [
    (sim ? sim.seq++ : 9999),
    dropped.toFixed(1), '18.0', '990.0',
    '0.000000', '0.000000', dropped.toFixed(1), 0,   // GPS lost
    '0.100', '0.100', '0.500', '90.0', '90.0', '90.0',
    '3.10', 3, 0, 1,                                  // DESCENT, sep fail, chute on
  ];
  dispatchTelemetry(buildRawPacket(fields));
  setCmdStatus('injected fault packet (errorCode → 1111)');
});
