// video.js — live video feed via MediaDevices getUserMedia (CONTRACT §6)
// Populates the camera picker, starts/stops the stream, and captures snapshots.
// Requires localhost or https:// (getUserMedia is blocked on file://).

let videoStream = null;

const videoEl     = document.getElementById('liveVideo');
const cameraSel   = document.getElementById('cameraSelect');
const startBtn    = document.getElementById('videoStartBtn');
const stopBtn     = document.getElementById('videoStopBtn');
const captureBtn  = document.getElementById('captureBtn');
const statusEl    = document.getElementById('videoStatus');
const snapCanvas  = document.getElementById('snapshotCanvas');

function setVideoStatus(text, on) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = on ? 'var(--go)' : 'var(--text-dim)';
}

async function listCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (!cams.length) return;
    cameraSel.innerHTML = '';
    cams.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${i + 1}`;
      cameraSel.appendChild(opt);
    });
  } catch (err) {
    console.warn('[video] enumerateDevices failed:', err);
  }
}

async function startVideo() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera not supported.\nServe from http://localhost or https://.');
    return;
  }
  try {
    const deviceId = cameraSel.value;
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
      audio: false,
    };
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = videoStream;
    setVideoStatus('● live', true);
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    // Labels become available only after permission is granted.
    await listCameras();
  } catch (err) {
    console.error('[video] getUserMedia failed:', err);
    setVideoStatus('error', false);
    alert('Could not start camera: ' + err.message);
  }
}

function stopVideo() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  videoEl.srcObject = null;
  setVideoStatus('off', false);
  startBtn.disabled = false;
  stopBtn.disabled  = true;
}

function captureSnapshot() {
  if (!videoStream) { alert('Start the camera first.'); return; }
  const w = videoEl.videoWidth  || 640;
  const h = videoEl.videoHeight || 480;
  snapCanvas.width  = w;
  snapCanvas.height = h;
  snapCanvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  snapCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `cansat_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

startBtn.addEventListener('click', startVideo);
stopBtn.addEventListener('click', stopVideo);
captureBtn.addEventListener('click', captureSnapshot);

// Enumerate cameras up front (labels appear after first permission grant).
document.addEventListener('DOMContentLoaded', listCameras);
