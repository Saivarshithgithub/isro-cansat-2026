// data-manager.js — session logging + Blob API CSV export (CONTRACT §7)

const CSV_HEADER = [
  'timestamp_ms', 'seq', 'altitude_m', 'temp_c', 'pressure_hpa',
  'lat', 'lon', 'gps_alt_m', 'gps_fix',
  'ax_g', 'ay_g', 'az_g', 'gx_dps', 'gy_dps', 'gz_dps',
  'battery_v', 'mission_state', 'payload_sep', 'parachute',
  'descent_rate_mps', 'error_code',
].join(',') + '\n';

const LS_KEY = 'cansat_session_log';
let sessionLog = [];

// Restore any previous session so an accidental reload doesn't lose data.
try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) sessionLog = JSON.parse(saved);
} catch (_) { sessionLog = []; }

let _persistTimer = null;
function schedulePersist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(sessionLog.slice(-5000))); } catch (_) {}
  }, 1000);
}

document.addEventListener('telemetry', (e) => {
  const d = e.detail;
  sessionLog.push([
    d.timestamp, d.seq, d.altitude, d.temp, d.pressure,
    d.lat, d.lon, d.gpsAlt, d.gpsFix ? 1 : 0,
    d.ax, d.ay, d.az, d.gx, d.gy, d.gz,
    d.batteryV, d.missionState, d.payloadSep ? 1 : 0, d.parachute ? 1 : 0,
    d.descentRate.toFixed(2), d.errorCode,
  ].join(','));
  schedulePersist();
});

// Blob API CSV download (CONTRACT §7).
function exportCSV() {
  if (!sessionLog.length) { alert('No telemetry logged yet.'); return; }
  const csv  = CSV_HEADER + sessionLog.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `cansat_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// Clear the log (used by Reset Packet).
function clearSessionLog() {
  sessionLog = [];
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
}
