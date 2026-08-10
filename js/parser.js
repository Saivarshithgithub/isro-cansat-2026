// parser.js — telemetry packet parser + enrichment (CONTRACT.md §1–§4)
// Wire format (18 fields after sentinel):
//   $CSAT,seq,alt,temp,press,lat,lon,gpsAlt,gpsFix,ax,ay,az,gx,gy,gz,batV,state,sep,chute*XX
//
// This module is the SOLE producer of the 'telemetry' CustomEvent. It:
//   1. validates the XOR checksum,
//   2. parses the 18 fields (tolerant of extra trailing tokens),
//   3. computes descentRate (m/s) from the altitude derivative,
//   4. computes the 4-digit errorCode string,
//   5. gates all dispatch behind window.GCS.streaming.

// ── Master streaming gate (CONTRACT §4) ────────────────────────
window.GCS = window.GCS || { streaming: false };

// ── Derived-quantity state (module-level, survives across packets)
let _prevAlt   = null;   // last altitude (m)
let _prevTs    = null;   // last timestamp (ms)

function validateChecksum(body, declared) {
  let calc = 0;
  for (const c of body) calc ^= c.charCodeAt(0);
  const hex = calc.toString(16).toUpperCase().padStart(2, '0');
  return hex === (declared || '').trim().toUpperCase();
}

// Compute the 4-digit error code string (CONTRACT §3).
// digit1 Descent Rate · digit2 GPS · digit3 Payload Sep · digit4 E-Chute
function computeErrorCode(missionState, descentRate, gpsFix, payloadSep, parachute, rateValid = true) {
  const d1 = (rateValid && missionState === 3 && (descentRate < 8 || descentRate > 10)) ? 1 : 0;
  const d2 = gpsFix ? 0 : 1;
  const d3 = (missionState >= 3 && !payloadSep) ? 1 : 0;
  const d4 = parachute ? 1 : 0;
  return `${d1}${d2}${d3}${d4}`;
}

function parsePacket(raw) {
  if (!raw || !raw.startsWith('$CSAT')) return null;

  const starIdx = raw.indexOf('*');
  if (starIdx === -1) return null;

  const body     = raw.slice(1, starIdx);        // CSAT,f1,f2,...
  const checksum = raw.slice(starIdx + 1).trim();

  if (!validateChecksum(body, checksum)) {
    console.warn('[parser] Checksum mismatch:', raw);
    return null;
  }

  const fields = body.split(',');
  if (fields.length < 19) {                        // CSAT + 18 fields
    console.warn('[parser] Too few fields:', fields.length, raw);
    return null;
  }

  const f = fields.slice(1);                        // drop sentinel
  const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : 0; };

  const seq          = parseInt(f[0], 10) || 0;
  const altitude     = num(f[1]);
  const temp         = num(f[2]);
  const pressure     = num(f[3]);
  const lat          = num(f[4]);
  const lon          = num(f[5]);
  const gpsAlt       = num(f[6]);
  const gpsFix       = parseInt(f[7], 10) === 1;
  const ax           = num(f[8]);
  const ay           = num(f[9]);
  const az           = num(f[10]);
  const gx           = num(f[11]);
  const gy           = num(f[12]);
  const gz           = num(f[13]);
  const batteryV     = num(f[14]);
  const missionState = parseInt(f[15], 10) || 0;
  const payloadSep   = parseInt(f[16], 10) === 1;
  const parachute    = parseInt(f[17], 10) === 1;

  const timestamp = Date.now();

  // Descent rate = (prevAlt - alt) / dt  (positive = falling)
  let descentRate = 0;
  let rateValid   = false;
  if (_prevAlt !== null && _prevTs !== null) {
    const dt = (timestamp - _prevTs) / 1000;
    // Clamp to a plausible sample gap: bursty/coalesced line delivery (dt≈0)
    // or a resume-after-pause (dt≫1) would otherwise corrupt the rate and
    // flicker the d1 fault. Only a real derivative gates the d1 check.
    if (dt > 0.05 && dt < 2) { descentRate = (_prevAlt - altitude) / dt; rateValid = true; }
  }
  _prevAlt = altitude;
  _prevTs  = timestamp;

  const errorCode = computeErrorCode(missionState, descentRate, gpsFix, payloadSep, parachute, rateValid);

  return {
    seq, altitude, temp, pressure,
    lat, lon, gpsAlt, gpsFix,
    ax, ay, az, gx, gy, gz,
    batteryV, missionState,
    payloadSep, parachute,
    descentRate,
    errorCode,
    timestamp,
  };
}

// Emits 'telemetry' CustomEvent on document after parsing.
// Comment lines (# ...) and non-CSAT lines are silently ignored.
// Returns true only when a packet was dispatched.
function dispatchTelemetry(raw) {
  if (!window.GCS.streaming) return false;   // master gate (Start/Stop)
  if (!raw) return false;
  const line = raw.trim();
  if (line.startsWith('#')) return false;    // firmware comment / ACK

  const pkt = parsePacket(line);
  if (pkt) {
    document.dispatchEvent(new CustomEvent('telemetry', { detail: pkt }));
    return true;
  }
  return false;
}

// Reset derived-quantity history (used by Reset Packet + Start).
function resetParserState() {
  _prevAlt = null;
  _prevTs  = null;
}

// Seed the altitude derivative so the NEXT packet yields a known descent rate.
// Used by the Inject-Fault helper to force a deterministic d1 fault regardless
// of how long ago the previous packet arrived.
function primeDescentRate(prevAlt, dtSeconds) {
  _prevAlt = prevAlt;
  _prevTs  = Date.now() - dtSeconds * 1000;
}
