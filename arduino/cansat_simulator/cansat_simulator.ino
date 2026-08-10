/*
 * CanSat TELEMETRY SIMULATOR — IN-SPACe CanSat & Model Rocketry 2026
 * (PDF Requirement 11 — dummy-telemetry generator)
 *
 * Runs on ANY Arduino with NO sensors attached. It fabricates a full flight
 * profile (pad → ascent → apogee → descent → landing → recovery) and streams
 * it in the EXACT 18-field wire format the real firmware uses, so the GCS can
 * be demonstrated and graded without hardware or a rocket.
 *
 *   $CSAT,seq,alt,temp,press,lat,lon,gpsAlt,gpsFix,ax,ay,az,gx,gy,gz,batV,state,sep,chute*XX
 *
 * 115200 baud, 5 Hz. Same uplink commands as the real firmware
 * (SEP/CHUTE/REDUND/ARM/ABORT/PING), each ACKed with "# ACK <cmd>".
 *
 * No external libraries required.
 */

const unsigned long TX_INTERVAL_MS = 200;   // 5 Hz
const float LAT0 = 13.0827;                  // Chennai launch site
const float LON0 = 80.2707;

unsigned long lastTxMs = 0;
uint16_t seq   = 0;
float    t     = 0;      // seconds since power-on
float    alt   = 0;      // m AGL
float    vel   = 0;      // m/s (+up)
uint8_t  state = 0;      // 0=PAD..5=RECOVERY
uint8_t  sep   = 0;
uint8_t  chute = 0;

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(A0));                // floating pin → noise
  Serial.println("# CanSat SIMULATOR ready — synthetic 18-field telemetry @ 5 Hz");
}

void loop() {
  if (Serial.available()) handleCommand();

  if (millis() - lastTxMs >= TX_INTERVAL_MS) {
    lastTxMs = millis();
    stepFlight();
    sendPacket();
    seq++;
  }
}

// ── Synthetic flight model (200 ms step) ───────────────────────
void stepFlight() {
  const float dt = 0.2;
  t += dt;

  switch (state) {
    case 0:  if (t > 2) { state = 1; vel = 28; }            break;  // PAD 2 s
    case 1:  vel = 28; if (alt >= 380) { state = 2; vel = 0; } break;  // ASCENT
    case 2:  sep = 1; state = 3; vel = -9;                  break;  // APOGEE → separate
    case 3:  if (alt < 15) { state = 4; vel = -2; }         break;  // DESCENT ~9 m/s
    case 4:  if (alt <= 0.5) { state = 5; vel = 0; alt = 0; } break;// LANDING
    // case 5: RECOVERY — terminal
  }
  alt += vel * dt;
  if (alt < 0) alt = 0;
}

// ── Emit one packet ────────────────────────────────────────────
void sendPacket() {
  float noise = (random(-100, 100)) / 1000.0;
  float press = 1013.25 * pow(1.0 - (alt * 0.0000225577), 5.25588);
  float temp  = 25.0 - alt * 0.0065;
  float batV  = 3.9 - seq * 0.0002;
  uint8_t gpsFix = 1;
  float lat = LAT0 + noise * 0.001;
  float lon = LON0 + noise * 0.001;

  bool  up   = vel > 0;
  float az   = up ? 1.6 : 1.0 + noise;
  float spin = (state >= 3) ? 40.0 : 3.0;

  char body[220];
  // dtostrf-free: use snprintf with %f (AVR snprintf supports %f when
  // configured; if your board prints "?", switch to the dtostrf variant below).
  char sLat[12], sLon[12], sAlt[10], sTemp[8], sPress[9], sBat[7];
  char sAx[8], sAy[8], sAz[8], sGx[8], sGy[8], sGz[8];
  dtostrf(lat,   0, 6, sLat);
  dtostrf(lon,   0, 6, sLon);
  dtostrf(alt,   0, 1, sAlt);
  dtostrf(temp,  0, 1, sTemp);
  dtostrf(press, 0, 1, sPress);
  dtostrf(batV,  0, 2, sBat);
  dtostrf(noise,        0, 3, sAx);
  dtostrf(noise * -1.0, 0, 3, sAy);
  dtostrf(az,           0, 3, sAz);
  dtostrf(random(-spin, spin) / 10.0 * 10.0, 0, 2, sGx);
  dtostrf(random(-spin, spin) / 10.0 * 10.0, 0, 2, sGy);
  dtostrf(random(-spin, spin) / 10.0 * 10.0, 0, 2, sGz);

  snprintf(body, sizeof(body),
    "CSAT,%u,%s,%s,%s,%s,%s,%s,%u,%s,%s,%s,%s,%s,%s,%s,%u,%u,%u",
    seq, sAlt, sTemp, sPress, sLat, sLon, sAlt, gpsFix,
    sAx, sAy, sAz, sGx, sGy, sGz, sBat, state, sep, chute);

  uint8_t chk = 0;
  for (char* p = body; *p; p++) chk ^= (uint8_t)*p;

  // UPPERCASE, zero-padded 2-digit hex checksum (Serial.print(x,HEX) is
  // lowercase). Matches CONTRACT §1 and the real firmware byte-for-byte.
  const char* HEXD = "0123456789ABCDEF";
  Serial.print('$');
  Serial.print(body);
  Serial.print('*');
  Serial.print(HEXD[(chk >> 4) & 0x0F]);
  Serial.println(HEXD[chk & 0x0F]);
}

// ── Uplink commands (mirror the real firmware) ─────────────────
void handleCommand() {
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();

  if      (cmd == "SEP")    { sep = 1;             Serial.println("# ACK SEP"); }
  else if (cmd == "CHUTE")  { chute = 1;           Serial.println("# ACK CHUTE"); }
  else if (cmd == "REDUND") { sep = 1; chute = 1;  Serial.println("# ACK REDUND"); }
  else if (cmd == "ARM")    { state = 0; alt = 0; vel = 0; t = 0; sep = 0; chute = 0;
                              Serial.println("# ACK ARM"); }
  else if (cmd == "ABORT")  { chute = 1; state = 5; Serial.println("# ACK ABORT"); }
  else if (cmd == "PING")   { Serial.println("# PONG"); }
  else if (cmd.startsWith("TIME")) { Serial.println("# ACK TIME"); }
  else if (cmd.length())    { Serial.print("# NAK "); Serial.println(cmd); }
}
