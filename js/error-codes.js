// error-codes.js — 4-digit error code display + banner + log (CONTRACT §3, §6)
// The 4-char errorCode string is computed in parser.js. This module renders it.

const DIGIT_META = [
  { id: 'errDigit1', label: 'Descent rate outside 8–10 m/s' },
  { id: 'errDigit2', label: 'GPS unavailable' },
  { id: 'errDigit3', label: 'Payload separation failure' },
  { id: 'errDigit4', label: 'Emergency parachute activated' },
];

const _errCodeEl = document.getElementById('errorCodeDisplay');
const _errBanner = document.getElementById('errorBanner');
const _errLog    = document.getElementById('errorLog');
let _lastCode = '0000';

function renderErrorCode(code) {
  // Normalise to 4 chars.
  code = (code || '0000').padStart(4, '0').slice(0, 4);
  _errCodeEl.textContent = code;

  const faults = [];
  for (let i = 0; i < 4; i++) {
    const digit = code[i];
    const meta  = DIGIT_META[i];
    const el = document.getElementById(meta.id);
    if (el) {
      el.textContent = digit;
      el.className = 'd ' + (digit === '1' ? 'fault' : 'ok');
    }
    if (digit === '1') faults.push(meta.label);
  }

  // Banner: hidden when nominal, shown listing active faults.
  if (faults.length === 0) {
    _errBanner.className = 'error-banner hidden';
    _errBanner.textContent = '';
    _errCodeEl.classList.remove('has-fault');
  } else {
    _errBanner.className = 'error-banner error';
    _errBanner.textContent = '⚠ ' + faults.join(' · ');
    _errCodeEl.classList.add('has-fault');
  }

  // Log only on change.
  if (code !== _lastCode) {
    const li = document.createElement('li');
    const t = new Date().toISOString().slice(11, 19);
    if (faults.length === 0) {
      li.className = 'ok';
      li.textContent = `${t}  ${code}  cleared — nominal`;
    } else {
      li.className = 'error';
      li.textContent = `${t}  ${code}  ${faults.join(', ')}`;
    }
    _errLog.prepend(li);
    while (_errLog.children.length > 50) _errLog.lastChild.remove();
    _lastCode = code;
  }
}

document.addEventListener('telemetry', (e) => {
  renderErrorCode(e.detail.errorCode);
});

// Reset display (used by Reset Packet).
function resetErrorCodes() {
  _lastCode = '0000';
  renderErrorCode('0000');
  if (_errLog) _errLog.innerHTML = '';
}
