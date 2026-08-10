# CanSat & CubeSat GCS — Project Context

## Project Overview
**Competition**: IN-SPACe CanSat & Model Rocketry 2026 (India Space Week)  
**Goal**: Build a complete web-based Ground Control Station (GCS)  
**Project directory**: `Pictures\ISRO\cansat\`  
**Status**: Active development

## What We Are Building
A **browser-based** Ground Control Station that:
- Connects directly to the CanSat radio via **Web Serial API** (Chrome/Edge, no backend needed)
- OR receives data via **WebSocket** from a Python/Node.js backend
- Displays all sensor data live with **Chart.js** real-time scrolling graphs
- Shows a live GPS track on a **Leaflet.js** map
- Visualizes 3D orientation with **Three.js** (attitude cube)
- Streams live video from the onboard camera
- Exports data as CSV using the **Blob API**
- Manages error codes and mission state via DOM

## Tech Stack (from assignment PDF links)
| Purpose | Technology | Docs |
|---|---|---|
| Embedded firmware (CanSat) | Arduino (C++) | https://docs.arduino.cc/ |
| Real-time data streaming | WebSocket API | MDN WebSocket |
| Direct serial port access | Web Serial API | MDN Web Serial API |
| 3D orientation visualization | Three.js | https://threejs.org/docs/ |
| GPS tracking map | Leaflet.js | https://leafletjs.com/reference.html |
| Real-time graphs | Chart.js | https://www.chartjs.org/docs/latest/ |
| Data export | Blob API | MDN Blob |
| HTML manipulation | DOM API | MDN DOM |
| Layout | CSS Flexbox + Grid | MDN Flexbox, MDN Grid |
| Logic / conditionals | JavaScript | MDN JS Conditionals |

## Project File Structure
```
cansat/
├── index.html              ← Main GCS interface (single page)
├── css/
│   └── style.css           ← Flexbox/Grid layout + dark theme
├── js/
│   ├── serial.js           ← Web Serial API (direct browser→CanSat)
│   ├── websocket.js        ← WebSocket client (backend alternative)
│   ├── parser.js           ← Telemetry packet parser
│   ├── charts.js           ← Chart.js real-time graphs
│   ├── map.js              ← Leaflet.js GPS tracking
│   ├── orientation.js      ← Three.js 3D attitude cube
│   ├── data-manager.js     ← Blob API CSV export + session logging
│   ├── error-codes.js      ← Error code registry + alert system
│   ├── mission.js          ← Mission state machine + telemetry DOM + link stats
│   ├── video.js            ← getUserMedia live video + snapshot
│   └── controls.js         ← Top-bar orchestration + streaming gate + simulator
├── arduino/
│   ├── cansat_firmware/
│   │   └── cansat_firmware.ino    ← Real CanSat embedded code (18-field)
│   └── cansat_simulator/
│       └── cansat_simulator.ino   ← Hardware-free dummy-telemetry sketch (Req 11)
├── server/
│   └── bridge.py           ← Optional pyserial→WebSocket bridge
└── data/                   ← Sample telemetry log + CSV deliverables
```

## 11 Required GCS Modules
1. **Interface Layout** — Flexbox/Grid dashboard, dark space theme
2. **Top Control Bar** — Connect button (Web Serial), baud rate, arm, timer, phase badge
3. **Mission Control Panel** — State machine: PAD → ASCENT → APOGEE → DESCENT → LANDING → RECOVERY
4. **Telemetry Display** — Live DOM-updated values for all fields
5. **Error Code System** — JS error registry, alert banners, timestamped log
6. **Real-Time Graphs** — Chart.js scrolling: altitude, pressure, temperature, descent rate, battery (no RSSI field on the wire; descent rate drives the error code, so it earns the 5th plot)
7. **Tracking Map** — Leaflet.js live GPS polyline + launch marker
8. **Orientation Visualization** — Three.js BoxGeometry cube driven by roll/pitch/yaw
9. **Live Video** — `<video>` tag or WebRTC stream from onboard camera
10. **Data Management** — Blob API → download CSV, sessionStorage, replay mode
11. **Testing Strategy** — Simulated packet injection, parser unit tests

## Telemetry Packet (Arduino → Serial → Browser)
CSV format, **18 data fields** (the authoritative spec is `CONTRACT.md §1`):
```
$CSAT,<seq>,<alt_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<gps_alt>,<gps_fix>,<ax>,<ay>,<az>,<gx>,<gy>,<gz>,<bat_v>,<state>,<sep>,<chute>*<checksum>\r\n
```
Example:
```
$CSAT,42,312.5,24.8,980.3,13.082700,80.270700,318.0,1,0.020,-0.010,1.000,0.10,-0.20,0.00,3.82,2,1,0*XX
```
- `sep`   = payload separation (0 attached / 1 separated)
- `chute` = emergency parachute (0 stowed / 1 deployed)
- The **4-digit mission error code is NOT on the wire** — the GCS derives it in
  `parser.js` from `state`, descent rate, `gps_fix`, `sep`, `chute` (see `CONTRACT.md §3`).
- Checksum = XOR of every character between `$` and `*`, 2 hex digits, uppercase.

## Architecture: Web Serial API Mode (primary)
```
CanSat Radio (XBee/LoRa) → USB → PC
                                   ↓
                            Chrome/Edge Browser
                            (Web Serial API)
                                   ↓
                            parser.js → SignalBus (CustomEvent)
                              ↙        ↘        ↘        ↘
                         charts.js  map.js  orientation.js  error-codes.js
```

## Architecture: WebSocket Mode (alternative)
```
CanSat Radio → USB → Python backend (pyserial + websockets lib)
                                   ↓  ws://localhost:8765
                            Browser (WebSocket API)
                                   ↓
                            (same frontend modules)
```

## Key Rules
- Use `requestAnimationFrame` for Three.js + Chart.js — never `setInterval` for animation
- Chart.js: use `chart.data.labels.push()` + `chart.update('none')` for real-time performance
- Leaflet: call `map.invalidateSize()` after any CSS resize
- Web Serial API requires user gesture (button click) to call `requestPort()`
- Web Serial API requires Chrome or Edge — does NOT work in Firefox
- Blob API for CSV: `new Blob([csvString], {type:'text/csv'})` → `URL.createObjectURL(blob)` → `<a>.click()`
- Always validate telemetry checksum before rendering — bad packets → log + skip
- Three.js rotation: use Euler angles from sensor fusion: `cube.rotation.set(roll, pitch, yaw)`

## Arduino Firmware Key Points
- Send telemetry every 200ms (5 Hz) via `Serial.println()`
- Use `millis()` for timing — never `delay()` in main loop
- Include packet sequence number and XOR checksum
- Read BMP280 → altitude + temp; MPU-6050 → accel + gyro; GPS → lat/lon
- Baud rate: 115200 (fast enough, stable)

## Available Agents
- `@cansat-telemetry` — packet design, Arduino serial output, parser.js
- `@cansat-gcs-architect` — module architecture, state machine, module wiring
- `@cansat-sensor-fusion` — IMU data, Madgwick filter, roll/pitch/yaw from accel+gyro
- `@cansat-viz` — Chart.js, Leaflet.js, Three.js implementation

## Available Skills
- `/cansat-parse <string>` — decode a raw telemetry line
- `/cansat-packet` — design the full packet format
- `/cansat-review [file]` — score code against all 11 requirements
