// mission.js — flight-phase machine, mission timer, telemetry DOM, link stats
// Binds to the CONTRACT §6 DOM ids. Command buttons live in controls.js.

const STATES = {
  0: { name: 'PAD'      },
  1: { name: 'ASCENT'   },
  2: { name: 'APOGEE'   },
  3: { name: 'DESCENT'  },
  4: { name: 'LANDING'  },
  5: { name: 'RECOVERY' },
};

let missionStartTime = null;
let timerInterval    = null;
let lastState        = -1;
let lastSeq          = -1;
let pktCount         = 0;
let pktLost          = 0;
let pktTimes         = [];   // timestamps for rate window

// ── Mission timer ──────────────────────────────────────────────
function startMissionTimer() {
  if (timerInterval) return;
  missionStartTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!missionStartTime) return;
  const elapsed = Math.floor((Date.now() - missionStartTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('missionTimer').textContent = `${h}:${m}:${s}`;
}

function stopMissionTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// Full reset of the mission clock (used by Reset Packet + each new sim run).
function resetMissionTimer() {
  stopMissionTimer();
  missionStartTime = null;
  const el = document.getElementById('missionTimer');
  if (el) el.textContent = '00:00:00';
}

// ── State machine ──────────────────────────────────────────────
function setMissionState(stateId) {
  if (stateId === lastState) return;
  lastState = stateId;
  const state = STATES[stateId] || STATES[0];

  const badge = document.getElementById('phaseBadge');
  badge.textContent = state.name;
  badge.className = `phase-badge state-${stateId}`;

  Object.values(STATES).forEach(s => {
    const el = document.getElementById(`state-${s.name}`);
    if (el) el.classList.toggle('active', s.name === state.name);
  });

  if (stateId >= 1 && !missionStartTime) startMissionTimer();
  if (stateId === 5) stopMissionTimer();   // RECOVERY → freeze final flight time
}

// ── Telemetry DOM updates ──────────────────────────────────────
function healthClass(val, warnLow, errLow) {
  if (val <= errLow)  return 'v error';
  if (val <= warnLow) return 'v warning';
  return 'v ok';
}

function setCell(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = cls || 'v';
}

document.addEventListener('telemetry', (e) => {
  const d = e.detail;

  setMissionState(d.missionState);

  // Container group
  setCell('t_alt',    d.altitude.toFixed(1));
  setCell('t_press',  d.pressure.toFixed(1));
  setCell('t_temp',   d.temp.toFixed(1));
  setCell('t_gpsFix', d.gpsFix ? 'FIX' : 'NO FIX', d.gpsFix ? 'v ok' : 'v warning');
  setCell('t_lat',    d.lat.toFixed(5));
  setCell('t_lon',    d.lon.toFixed(5));
  setCell('t_gpsAlt', d.gpsAlt.toFixed(1));
  setCell('t_bat',    d.batteryV.toFixed(2), healthClass(d.batteryV, 3.6, 3.2));
  setCell('t_state',  STATES[d.missionState] ? STATES[d.missionState].name : d.missionState);
  setCell('t_seq',    d.seq);

  // Payload group
  setCell('p_ax', d.ax.toFixed(2));
  setCell('p_ay', d.ay.toFixed(2));
  setCell('p_az', d.az.toFixed(2));
  setCell('p_gx', d.gx.toFixed(1));
  setCell('p_gy', d.gy.toFixed(1));
  setCell('p_gz', d.gz.toFixed(1));
  setCell('p_roll',  document.getElementById('rollVal').textContent);
  setCell('p_pitch', document.getElementById('pitchVal').textContent);
  setCell('p_yaw',   document.getElementById('yawVal').textContent);
  setCell('p_descent', d.descentRate.toFixed(2),
          (d.missionState === 3 && (d.descentRate < 8 || d.descentRate > 10)) ? 'v warning' : 'v');
  setCell('p_sep',   d.payloadSep ? 'YES' : 'NO', d.payloadSep ? 'v ok' : 'v');
  setCell('p_chute', d.parachute  ? 'DEPLOYED' : '—', d.parachute ? 'v warning' : 'v');

  // ── Link stats ──
  pktCount++;
  document.getElementById('pktCount').textContent = pktCount;

  const now = Date.now();
  pktTimes.push(now);
  pktTimes = pktTimes.filter(t => t > now - 5000);
  document.getElementById('pktRate').textContent = (pktTimes.length / 5).toFixed(1);

  if (lastSeq >= 0 && d.seq > lastSeq + 1) {
    pktLost += d.seq - lastSeq - 1;
  }
  lastSeq = d.seq;
  document.getElementById('pktLoss').textContent = `${pktLost} dropped`;
});

// Reset all counters/timer (used by Reset Packet).
function resetMissionStats() {
  stopMissionTimer();
  missionStartTime = null;
  lastState = -1;
  lastSeq = -1;
  pktCount = 0;
  pktLost = 0;
  pktTimes = [];
  document.getElementById('missionTimer').textContent = '00:00:00';
  document.getElementById('pktCount').textContent = '0';
  document.getElementById('pktRate').textContent = '0.0';
  document.getElementById('pktLoss').textContent = '0 dropped';
  setMissionState(0);
}
