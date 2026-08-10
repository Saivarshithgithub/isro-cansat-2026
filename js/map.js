// map.js — Leaflet.js GPS tracking (CONTRACT §6)

let gcsMap, trackLine, currentDot, launchMarker;
let track = [];
let launchSet = false;

function initMap() {
  gcsMap = L.map('mapContainer', { zoomControl: true }).setView([13.0827, 80.2707], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(gcsMap);

  trackLine  = L.polyline([], { color: '#34c3ff', weight: 2.5, opacity: 0.9 }).addTo(gcsMap);
  currentDot = L.circleMarker([13.0827, 80.2707], {
    radius: 7, color: '#ff4d4d', fillColor: '#ff8080', fillOpacity: 0.9, weight: 2,
  }).addTo(gcsMap);

  // Leaflet measures its container at construction time. In a flex/grid panel
  // that size isn't final on DOMContentLoaded, so tiles render half-drawn/grey
  // until the next layout tick — recompute once the panel has its real size.
  requestAnimationFrame(() => gcsMap.invalidateSize());
}

// Any window resize changes the panel size → Leaflet must re-measure.
window.addEventListener('resize', () => { if (gcsMap) gcsMap.invalidateSize(); });

function updateMap(lat, lon) {
  if (!lat || !lon || (lat === 0 && lon === 0)) return;
  const pos = [lat, lon];
  track.push(pos);
  trackLine.setLatLngs(track);
  currentDot.setLatLng(pos);
  gcsMap.panTo(pos, { animate: false });

  if (!launchSet) {
    launchMarker = L.marker(pos).addTo(gcsMap).bindPopup('🟢 Launch / First Fix').openPopup();
    launchSet = true;
  }
}

document.addEventListener('telemetry', (e) => {
  const d = e.detail;
  if (d.gpsFix) updateMap(d.lat, d.lon);
});

// Clear track (used by Reset Packet).
function resetMap() {
  track = [];
  launchSet = false;
  if (trackLine) trackLine.setLatLngs([]);
  if (launchMarker && gcsMap) { gcsMap.removeLayer(launchMarker); launchMarker = null; }
}

document.addEventListener('DOMContentLoaded', initMap);
