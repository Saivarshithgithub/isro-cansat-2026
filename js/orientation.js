// orientation.js — Three.js 3D attitude cube (CONTRACT §6)
// Roll/pitch from the accelerometer (atan2), fused with the gyro via a
// complementary filter; yaw is integrated from gyro Z (no magnetometer).

let scene, camera, renderer, canSatMesh;
let targetRoll = 0, targetPitch = 0, targetYaw = 0;

// Fused attitude state (radians)
let fRoll = 0, fPitch = 0, fYaw = 0;
let _lastAttTs = null;
const ALPHA = 0.96;                 // complementary filter weight (gyro)
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function initOrientation() {
  const container = document.getElementById('orientContainer');
  const W = container.clientWidth || 260;
  const H = container.clientHeight || 200;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1420);

  camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
  camera.position.set(1.8, 1.5, 2.5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const geo = new THREE.BoxGeometry(0.55, 1.1, 0.55);
  const mat = new THREE.MeshPhongMaterial({ color: 0x2277dd, specular: 0x335577 });
  canSatMesh = new THREE.Mesh(geo, mat);
  scene.add(canSatMesh);

  const origin = new THREE.Vector3(0, 0, 0);
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 1.3, 0xff4d4d, 0.15, 0.08));
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 1.3, 0x21c07a, 0.15, 0.08));
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 1.3, 0x34c3ff, 0.15, 0.08));

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(4, 6, 5);
  scene.add(sun);

  const grid = new THREE.GridHelper(3, 6, 0x335577, 0x1e2a3a);
  grid.position.y = -0.7;
  scene.add(grid);

  animate();

  window.addEventListener('resize', () => {
    const W2 = container.clientWidth || W;
    const H2 = container.clientHeight || H;
    camera.aspect = W2 / H2;
    camera.updateProjectionMatrix();
    renderer.setSize(W2, H2);
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (!canSatMesh) return;
  // Smooth interpolation toward the fused target attitude.
  canSatMesh.rotation.x += (targetPitch - canSatMesh.rotation.x) * 0.15;
  canSatMesh.rotation.z += (targetRoll  - canSatMesh.rotation.z) * 0.15;
  canSatMesh.rotation.y += (targetYaw   - canSatMesh.rotation.y) * 0.15;
  renderer.render(scene, camera);
}

// Accel-only roll/pitch (radians).
function accelAttitude(ax, ay, az) {
  const roll  = Math.atan2(ay, az);
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));
  return { roll, pitch };
}

document.addEventListener('telemetry', (e) => {
  const d = e.detail;
  const ts = d.timestamp;
  let dt = 0;
  if (_lastAttTs !== null) dt = (ts - _lastAttTs) / 1000;
  _lastAttTs = ts;
  if (dt <= 0 || dt > 1) dt = 0.2;   // guard against gaps

  const acc = accelAttitude(d.ax, d.ay, d.az);

  // Complementary filter: integrate gyro (deg/s → rad), correct with accel.
  const gxr = d.gx * DEG2RAD, gyr = d.gy * DEG2RAD, gzr = d.gz * DEG2RAD;
  fRoll  = ALPHA * (fRoll  + gxr * dt) + (1 - ALPHA) * acc.roll;
  fPitch = ALPHA * (fPitch + gyr * dt) + (1 - ALPHA) * acc.pitch;
  fYaw  += gzr * dt;                  // integrated yaw (drifts, no mag reference)

  targetRoll  = fRoll;
  targetPitch = fPitch;
  targetYaw   = fYaw;

  const rollDeg  = fRoll  * RAD2DEG;
  const pitchDeg = fPitch * RAD2DEG;
  let   yawDeg   = (fYaw  * RAD2DEG) % 360;
  if (yawDeg < 0) yawDeg += 360;

  document.getElementById('rollVal').textContent  = rollDeg.toFixed(1)  + '°';
  document.getElementById('pitchVal').textContent = pitchDeg.toFixed(1) + '°';
  document.getElementById('yawVal').textContent   = yawDeg.toFixed(1)   + '°';
});

// Reset integrated attitude (used by Reset Packet).
function resetOrientation() {
  fRoll = fPitch = fYaw = 0;
  _lastAttTs = null;
  targetRoll = targetPitch = targetYaw = 0;
}

document.addEventListener('DOMContentLoaded', initOrientation);
