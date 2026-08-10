# CanSat GCS — Integration Contract

The single source of truth that every module integrates against. Do not change
without updating all consumers.

## 1. Telemetry wire format (radio downlink → GCS)

ASCII line, `\n` terminated, 115200 baud. **18 fields after the sentinel**, XOR
checksum over the body (everything between `$` and `*`), hex, upper-case, 2 chars.

```
$CSAT,seq,alt,temp,press,lat,lon,gpsAlt,gpsFix,ax,ay,az,gx,gy,gz,batV,state,sep,chute*XX
```

| idx | field  | unit    | notes                                             |
|-----|--------|---------|---------------------------------------------------|
| 0   | CSAT   | —       | sentinel                                          |
| 1   | seq    | uint    | packet counter (wraps)                            |
| 2   | alt    | m       | barometric altitude (AGL)                         |
| 3   | temp   | °C      |                                                   |
| 4   | press  | hPa     |                                                   |
| 5   | lat    | deg     | 0 if no fix                                       |
| 6   | lon    | deg     | 0 if no fix                                       |
| 7   | gpsAlt | m       | GPS altitude                                      |
| 8   | gpsFix | 0/1     | 1 = valid fix                                     |
| 9   | ax     | g       | accel X (payload)                                 |
| 10  | ay     | g       | accel Y                                           |
| 11  | az     | g       | accel Z                                           |
| 12  | gx     | °/s     | gyro X                                            |
| 13  | gy     | °/s     | gyro Y                                            |
| 14  | gz     | °/s     | gyro Z                                            |
| 15  | batV   | V       | battery voltage                                   |
| 16  | state  | 0..5    | PAD/ASCENT/APOGEE/DESCENT/LANDING/RECOVERY        |
| 17  | sep    | 0/1     | payload separation actuator: 1 = separated        |
| 18  | chute  | 0/1     | emergency parachute actuator: 1 = deployed        |

`parsePacket()` must accept **≥ 19 comma-separated tokens** (sentinel + 18).
Extra trailing tokens are ignored so the format can grow.

## 2. Enriched telemetry event

`parser.js` computes two derived quantities and dispatches a `CustomEvent`
named `telemetry` on `document`. Every consumer reads `e.detail`:

```js
{
  seq, altitude, temp, pressure,          // container baro
  lat, lon, gpsAlt, gpsFix,               // container gps (gpsFix boolean)
  ax, ay, az, gx, gy, gz,                 // payload imu
  batteryV, missionState,                 // system
  payloadSep, parachute,                  // booleans (actuator states)
  descentRate,                            // m/s, COMPUTED (positive = falling)
  errorCode,                              // 4-char string '0000'..'1111', COMPUTED
  timestamp                               // ms epoch
}
```

## 3. 4-digit error code (PDF Requirement 5) — derived in parser.js

`errorCode` is a **4-character string**, one digit per condition. Order fixed:

| digit | condition            | 0 means            | 1 means                         |
|-------|----------------------|--------------------|---------------------------------|
| 1     | Descent Rate         | within 8–10 m/s    | outside safe range              |
| 2     | GPS Availability     | GPS available      | GPS unavailable                 |
| 3     | Payload Separation   | separated OK       | separation failure              |
| 4     | Emergency Parachute  | inactive           | activated                       |

Derivation (avoids false alarms before the relevant flight phase):
- d1 = `1` when `missionState === 3 (DESCENT)` **and** descentRate ∉ [8,10]; else `0`.
- d2 = `gpsFix ? 0 : 1`.
- d3 = `1` when `missionState >= 3` **and** `!payloadSep`; else `0`.
- d4 = `parachute ? 1 : 0`.

Examples: `0000` normal · `1000` descent-rate fault · `0100` GPS lost ·
`0010` separation failure · `0001` parachute deployed · `1111` all faults.

Descent rate = `(prevAlt - alt) / dtSeconds` (module-level prev alt + timestamp).

## 4. Master streaming gate (Start/Stop — PDF Requirement 2)

`window.GCS = { streaming: false }`. `parser.dispatchTelemetry()` and the
simulator return early when `!GCS.streaming`. The **Start** button sets it
`true`, **Stop** sets it `false`. Connecting a link does not auto-start.

## 5. Uplink commands (GCS → CanSat)

`sendCommand(cmd)` (defined in serial.js, falls back to websocket) writes
`cmd + '\n'`. Command vocabulary:

| button                        | command   |
|-------------------------------|-----------|
| Manual Separation             | `SEP`     |
| Emergency Parachute Deployment| `CHUTE`   |
| Redundant Activation          | `REDUND`  |
| ARM / reset flight            | `ARM`     |
| Abort                         | `ABORT`   |
| Ping / link test              | `PING`    |

Firmware replies with `# ACK <cmd>` (comment lines start with `#`, never parsed
as telemetry).

## 6. DOM id registry (every element modules bind to)

**Top bar:** `baudSelect` `connectBtn` `wsConnectBtn` `startBtn` `stopBtn`
`exportCsvBtn` `exportGraphBtn` `syncTimeBtn` `resetPacketBtn` `missionTimer`
`phaseBadge` `connStatus` `pcClock`

**Mission control:** `cmdSepBtn` `cmdChuteBtn` `cmdRedundBtn` `cmdArmBtn`
`cmdAbortBtn` `cmdPingBtn` `cmdStatus` · state items `state-PAD` `state-ASCENT`
`state-APOGEE` `state-DESCENT` `state-LANDING` `state-RECOVERY` · stats
`pktCount` `pktRate` `pktLoss` · testing `simBtn` `scenarioSelect` `injectFaultBtn`

**Error code:** `errorCodeDisplay` `errDigit1` `errDigit2` `errDigit3`
`errDigit4` `errorBanner` `errorLog`

**Graphs (canvas):** `altCanvas` `pressCanvas` `tempCanvas` `descentCanvas`
`batCanvas`

**Map:** `mapContainer`

**Orientation:** `orientContainer` `rollVal` `pitchVal` `yawVal`

**Video:** `liveVideo` `cameraSelect` `videoStartBtn` `videoStopBtn`
`videoStatus` `captureBtn` `snapshotCanvas`

**Telemetry — container group:** `t_alt` `t_press` `t_temp` `t_gpsFix`
`t_lat` `t_lon` `t_gpsAlt` `t_bat` `t_state` `t_seq`

**Telemetry — payload group:** `p_ax` `p_ay` `p_az` `p_gx` `p_gy` `p_gz`
`p_roll` `p_pitch` `p_yaw` `p_descent` `p_sep` `p_chute`

## 7. Cross-module functions (globals)

- `dispatchTelemetry(rawLine)` — parser.js
- `sendCommand(cmd)` — serial.js (uplink)
- `exportCSV()` — data-manager.js
- `exportGraphs()` — charts.js (combined PNG)
- `resetPackets()` — clears log/charts/map/stats (controls.js orchestrates)
- `window.GCS.streaming` — master gate

## 8. Script load order (index.html, end of body)

`parser → serial → websocket → charts → map → orientation → video →
error-codes → mission → data-manager → controls`
