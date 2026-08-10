# CanSat Ground Control Software (GCS)

Browser-based ground control station for the **IN-SPACe CanSat & Model Rocketry
2026** competition (India Space Week). Pure HTML / CSS / vanilla JavaScript — no
build step, no framework, no bundler. It reads live telemetry from the CanSat
over the **Web Serial API** (or an optional WebSocket bridge), decodes it, and
drives real-time graphs, a GPS map, a 3D attitude cube, a live camera feed, a
mission-command console, an automatic 4-digit fault system, and CSV/PNG export.

---

## 1. Quick start (30 seconds, no hardware)

Web Serial and the camera (`getUserMedia`) only work from a **secure context**,
so you must serve the folder over `http://localhost` — opening `index.html`
as a `file://` URL will **not** work.

```bash
# from the project root:
py -m http.server 8000        # Windows (python launcher)
# or:  python -m http.server 8000
# or:  npx serve .
```

Then open **http://localhost:8000** in **Google Chrome or Microsoft Edge**
(Web Serial is not available in Firefox/Safari).

To see it run with zero hardware:

1. Click **▶ Simulate Telemetry** (top bar). A full synthetic flight
   (pad → ascent → apogee → descent → landing) streams at 5 Hz.
2. Pick a scenario from the dropdown (`nominal`, `fastdescent`, `gpsloss`,
   `sepfail`) then Simulate, or click **Inject Fault** to force the error
   code to `1111`.
3. Click **Export CSV** / **Export Graphs** to produce deliverable files.

> Browser too old / on Firefox? Use the **WebSocket bridge** instead — see §5.

---

## 2. Connecting real hardware

1. Flash the CanSat (see §6).
2. Serve over localhost and open in Chrome/Edge (§1).
3. Click **Connect Serial**, choose the CanSat's COM port, baud **115200**.
4. Click **Start** to open the streaming gate — telemetry now flows to every
   panel. **Stop** freezes the display (buffers are retained).

---

## 3. Architecture

![Architecture diagram](docs/architecture.png)

> Full write-up in **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** (with a
> GitHub-rendered Mermaid version of the diagram above).

Telemetry has **one entry point and one event**. `parser.js` is the only module
that understands the wire format; every other module is a pure consumer that
listens for the `telemetry` CustomEvent on `document`. This keeps the wire
format in exactly one place.

```
                 Web Serial  ─┐
                              ├─► parser.js ──(CustomEvent 'telemetry')──►  all consumers
   WebSocket bridge (opt.) ──┘   • validates checksum
                                 • splits 18 fields
                                 • derives descent rate + 4-digit error code
                                 • gated by window.GCS.streaming
```

Consumers subscribe independently:

| Module            | Panel / job                                             |
|-------------------|--------------------------------------------------------|
| `charts.js`       | Scrolling altitude / temp / pressure / descent graphs  |
| `map.js`          | Leaflet GPS track + live marker                        |
| `orientation.js`  | Three.js 3D attitude cube (complementary filter)       |
| `video.js`        | Live camera feed + snapshot                            |
| `error-codes.js`  | 4-digit fault banner + event log                       |
| `mission.js`      | Mission state, timer, telemetry read-outs, link stats  |
| `data-manager.js` | Session buffer, CSV export, localStorage persistence   |
| `controls.js`     | Streaming gate, uplink commands, clock, **simulator**  |

Script **load order** is fixed (`index.html`): `parser → serial → websocket →
charts → map → orientation → video → error-codes → mission → data-manager →
controls`. The full integration contract (field order, DOM id registry, global
names) lives in **`CONTRACT.md`** — read that before changing any interface.

---

## 4. The telemetry packet (18 fields)

```
$CSAT,seq,alt,temp,press,lat,lon,gpsAlt,gpsFix,ax,ay,az,gx,gy,gz,batV,state,sep,chute*XX
```

* `*XX` — XOR checksum (hex) over everything between `$` and `*`.
* `state` — 0 PAD · 1 ASCENT · 2 APOGEE · 3 DESCENT · 4 LANDING · 5 RECOVERY.
* `sep` / `chute` — payload-separation / emergency-parachute status (0/1).

Example: `$CSAT,42,312.5,24.8,980.3,13.082700,80.270700,318.0,1,0.020,-0.010,1.000,0.10,-0.20,0.00,3.82,2,1,0*XX`

### 4-digit error code (derived by the GCS, never sent on the wire)

| Digit | Fault              | Set to 1 when …                                   |
|-------|--------------------|---------------------------------------------------|
| d1    | Descent rate       | `state==3` and descent rate ∉ **[8, 10] m/s**     |
| d2    | GPS                | GPS unavailable (`gpsFix==0`)                      |
| d3    | Payload separation | `state>=3` and payload not separated              |
| d4    | Emergency parachute| parachute deployed                                |

`0000` = all nominal. The firmware keeps the code **off the wire** on purpose —
the GCS computes it in `parser.js` so the fault logic is testable in the browser.

---

## 5. WebSocket mode (optional fallback)

For browsers without Web Serial (Firefox/Safari) or when the radio is on another
machine, a Python bridge relays serial ↔ browser. The bridge is a **dumb,
lossless pipe** — the browser's `parser.js` still does all decoding.

```bash
pip install pyserial websockets
py server/bridge.py --list                       # discover ports
py server/bridge.py --port COM5 --baud 115200    # start the bridge
```

Then in the GCS click **Connect WebSocket** and accept `ws://localhost:8765`.

---

## 6. Firmware

Two sketches under `arduino/`:

* **`cansat_firmware/`** — real flight firmware (BMP280 baro, MPU-6050 IMU,
  TinyGPS++, two servos for separation/parachute). 5 Hz, 115200 baud. Wiring and
  library list in `arduino/cansat_firmware/README.txt`.
* **`cansat_simulator/`** — hardware-free sketch that fabricates a full flight in
  the exact 18-field format. Upload to **any** Arduino (no sensors) to demo the
  GCS end-to-end over real serial. *(PDF Requirement 11.)*

Both accept the same uplink commands, each ACKed with `# ACK <cmd>`:
`SEP`, `CHUTE`, `REDUND`, `ARM`, `ABORT`, `PING` (→ `# PONG`), `TIME,<epoch>`.

---

## 7. Sample data & deliverables

`data/generate_samples.py` mirrors `parser.js` exactly (checksum + error-code
logic) and doubles as a cross-language contract check. Run:

```bash
py data/generate_samples.py
```

It writes:

| File                             | Contents                                              |
|----------------------------------|-------------------------------------------------------|
| `sample_telemetry_log.txt`       | Raw `$CSAT` lines, nominal flight                     |
| `sample_session.csv`             | 21-column parsed CSV (matches the Export CSV output)  |
| `sample_telemetry_fault_log.txt` | Raw lines, fault-injection demo                       |
| `sample_session_fault.csv`       | Fault CSV — exercises error digits d1/d2/d3           |

The CSV columns are:
`timestamp_ms, seq, altitude_m, temp_c, pressure_hpa, lat, lon, gps_alt_m,
gps_fix, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps, battery_v, mission_state,
payload_sep, parachute, descent_rate_mps, error_code`.

---

## 8. Requirements checklist (PDF → files)

| # | Requirement                        | Where                                     |
|---|------------------------------------|-------------------------------------------|
| 1 | Serial communication / downlink    | `js/serial.js`, `js/websocket.js`         |
| 2 | Telemetry parsing + checksum       | `js/parser.js`                            |
| 3 | Real-time graphs                   | `js/charts.js` (Chart.js)                 |
| 4 | GPS tracking map                   | `js/map.js` (Leaflet + OSM)               |
| 5 | 4-digit error / fault system       | `js/parser.js` + `js/error-codes.js`      |
| 6 | 3D orientation view                | `js/orientation.js` (Three.js)            |
| 7 | Live video feed                    | `js/video.js` (`getUserMedia`)            |
| 8 | Mission control + uplink commands  | `js/mission.js`, `js/controls.js`         |
| 9 | Data logging + CSV/PNG export      | `js/data-manager.js`, `js/controls.js`    |
| 10| CanSat firmware                    | `arduino/cansat_firmware/`                |
| 11| Dummy-telemetry generator          | `arduino/cansat_simulator/` + in-GCS sim  |

---

## 9. Browser support

| Feature            | Chrome | Edge | Firefox | Safari |
|--------------------|:------:|:----:|:-------:|:------:|
| Web Serial         |   ✅   |  ✅  |   ❌ *  |  ❌ *  |
| Camera / snapshot  |   ✅   |  ✅  |   ✅    |  ✅    |
| Everything else    |   ✅   |  ✅  |   ✅    |  ✅    |

\* Use the WebSocket bridge (§5) for serial on Firefox/Safari.
Always serve over `http://localhost` — `file://` disables Web Serial and camera.
