// charts.js — Chart.js real-time scrolling graphs + combined PNG export
// Five graphs (CONTRACT §6): altitude, pressure, temperature, descent rate, battery.

const MAX_POINTS = 300;

function makeChart(canvasId, label, color, yUnit) {
  const el = document.getElementById(canvasId);
  if (!el) { console.warn('[charts] missing canvas', canvasId); return null; }
  const ctx = el.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: `${label} (${yUnit})`,
        data: [],
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 1.6,
        pointRadius: 0,
        tension: 0.2,
        fill: true,
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: {
          ticks: { color: '#8fa3bf', font: { size: 10 } },
          grid:  { color: '#182234' },
          title: { display: true, text: `${label} (${yUnit})`, color: '#8fa3bf', font: { size: 10 } },
        }
      },
      plugins: { legend: { display: false } },
    }
  });
}

const altChart     = makeChart('altCanvas',     'Altitude',     '#34c3ff', 'm');
const pressChart   = makeChart('pressCanvas',   'Pressure',     '#a06bff', 'hPa');
const tempChart    = makeChart('tempCanvas',    'Temperature',  '#ffab3d', '°C');
const descentChart = makeChart('descentCanvas', 'Descent Rate', '#21c07a', 'm/s');
const batChart     = makeChart('batCanvas',     'Battery',      '#ffd24d', 'V');

const ALL_CHARTS = [altChart, pressChart, tempChart, descentChart, batChart].filter(Boolean);

function push(chart, label, value) {
  if (!chart) return;
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none');
}

document.addEventListener('telemetry', (e) => {
  const d = e.detail;
  const t = ((d.timestamp / 1000) % 100000).toFixed(1);
  push(altChart,     t, d.altitude);
  push(pressChart,   t, d.pressure);
  push(tempChart,    t, d.temp);
  push(descentChart, t, d.descentRate);
  push(batChart,     t, d.batteryV);
});

// Clear all chart series (used by Reset Packet).
function resetCharts() {
  ALL_CHARTS.forEach(c => {
    c.data.labels = [];
    c.data.datasets[0].data = [];
    c.update('none');
  });
}

// Combined PNG export (CONTRACT §7). Stacks all five charts onto one canvas.
function exportGraphs() {
  const charts = ALL_CHARTS;
  if (!charts.length) { alert('No charts to export.'); return; }

  const pad = 12, W = 900, H = 220;
  const out = document.createElement('canvas');
  out.width  = W;
  out.height = charts.length * (H + pad) + pad;
  const g = out.getContext('2d');
  g.fillStyle = '#0a0e14';
  g.fillRect(0, 0, out.width, out.height);

  charts.forEach((c, i) => {
    const y = pad + i * (H + pad);
    // Chart.js canvases already have a transparent bg; paint a panel behind.
    g.fillStyle = '#0f1622';
    g.fillRect(pad, y, W - 2 * pad, H);
    g.drawImage(c.canvas, pad, y, W - 2 * pad, H);
  });

  out.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `cansat_graphs_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
