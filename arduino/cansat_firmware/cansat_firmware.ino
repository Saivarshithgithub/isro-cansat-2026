/*
 * CanSat Firmware — IN-SPACe CanSat & Model Rocketry 2026
 * Sensors: BMP280 (baro), MPU-6050 (IMU), TinyGPS++ (GPS)
 * Output : 115200 baud, NMEA-style CSV telemetry at 5 Hz
 *
 * Packet (18 data fields — matches CONTRACT.md §1 exactly):
 *   $CSAT,seq,alt,temp,press,lat,lon,gpsAlt,gpsFix,ax,ay,az,gx,gy,gz,batV,state,sep,chute*XX
 *
 *   sep   = payload separation status  (0 = attached, 1 = separated)
 *   chute = emergency parachute status (0 = stowed,   1 = deployed)
 *   NOTE: the 4-digit mission error code is NOT sent on the wire — the GCS
 *         derives it from these fields (see CONTRACT.md §3). Comment lines
 *         begin with '#' and are ignored by the parser.
 *
 * Uplink commands (newline-terminated, see CONTRACT.md §5):
 *   SEP   — fire payload-separation actuator
 *   CHUTE — deploy emergency parachute
 *   REDUND— fire redundant/backup deployment
 *   ARM   — reset mission state & latches
 *   ABORT — abort (deploy chute, mark recovery)
 *   PING  — link check → "# PONG"
 * Every command is acknowledged with "# ACK <cmd>".
 *
 * Libraries (Arduino Library Manager):
 *   Adafruit BMP280 · MPU6050 (Electronic Cats / Jeff Rowberg) · TinyGPSPlus · Servo
 */

#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <MPU6050.h>
#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <Servo.h>

// ── Pin config ─────────────────────────────────────────────────
#define GPS_RX_PIN   4    // Arduino pin ← GPS TX
#define GPS_TX_PIN   3    // Arduino pin → GPS RX (usually unused)
#define BATTERY_PIN  A0   // Battery voltage divider
#define SEP_SERVO_PIN   9 // Payload-separation servo
#define CHUTE_SERVO_PIN 10// Parachute-release servo

// ── Timing ─────────────────────────────────────────────────────
const unsigned long TX_INTERVAL_MS = 200;  // 5 Hz

// ── Objects ────────────────────────────────────────────────────
Adafruit_BMP280 bmp;
MPU6050         mpu;
TinyGPSPlus     gps;
SoftwareSerial  gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
Servo           sepServo;
Servo           chuteServo;

// ── State ──────────────────────────────────────────────────────
uint16_t      seqNum       = 0;
unsigned long lastTxMs     = 0;
uint8_t       missionState = 0;  // 0=PAD 1=ASCENT 2=APOGEE 3=DESCENT 4=LANDING 5=RECOVERY
uint8_t       sepStatus    = 0;  // payload separated?
uint8_t       chuteStatus  = 0;  // parachute deployed?

// Sensor-init faults (used only to zero out bad readings, not sent on wire)
bool baroFail = false;
bool imuFail  = false;

// Apogee / phase detection
float maxAlt  = 0;
float prevAlt = 0;

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin();
  gpsSerial.begin(9600);

  sepServo.attach(SEP_SERVO_PIN);
  chuteServo.attach(CHUTE_SERVO_PIN);
  sepServo.write(0);     // locked
  chuteServo.write(0);   // locked

  if (!bmp.begin(0x76)) {
    baroFail = true;
    Serial.println("# WARN: BMP280 not found at 0x76");
  } else {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X4,
                    Adafruit_BMP280::STANDBY_MS_62);
  }

  mpu.initialize();
  if (!mpu.testConnection()) {
    imuFail = true;
    Serial.println("# WARN: MPU6050 not found");
  }

  Serial.println("# CanSat firmware ready — 18-field telemetry @ 5 Hz");
}

// ── Main loop ──────────────────────────────────────────────────
void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());   // feed GPS every pass
  if (Serial.available()) handleCommand();

  if (millis() - lastTxMs >= TX_INTERVAL_MS) {
    lastTxMs = millis();
    updateMissionState();
    sendTelemetry();
    seqNum++;
  }
}

// ── Telemetry transmit ─────────────────────────────────────────
void sendTelemetry() {
  float alt   = baroFail ? 0.0 : bmp.readAltitude(1013.25);
  float temp  = baroFail ? 0.0 : bmp.readTemperature();
  float press = baroFail ? 0.0 : bmp.readPressure() / 100.0;

  int16_t axr, ayr, azr, gxr, gyr, gzr;
  if (!imuFail) mpu.getMotion6(&axr, &ayr, &azr, &gxr, &gyr, &gzr);
  else          axr = ayr = azr = gxr = gyr = gzr = 0;

  float ax = axr / 16384.0, ay = ayr / 16384.0, az = azr / 16384.0;   // g
  float gx = gxr / 131.0,   gy = gyr / 131.0,   gz = gzr / 131.0;     // deg/s

  double  lat    = gps.location.isValid() ? gps.location.lat() : 0.0;
  double  lon    = gps.location.isValid() ? gps.location.lng() : 0.0;
  float   gpsAlt = gps.altitude.isValid() ? (float)gps.altitude.meters() : 0.0;
  uint8_t gpsFix = gps.location.isValid() ? 1 : 0;

  float batV = readBatteryV();

  // Packet body — 18 fields, no leading '$', no checksum yet.
  // IMPORTANT: the AVR core (Uno/Nano) does NOT link %f into snprintf by
  // default, so every float would emit empty. Convert with dtostrf → %s,
  // exactly like the simulator sketch, to guarantee real numeric fields.
  char sAlt[10], sTemp[8], sPress[9], sLat[13], sLon[13], sGpsAlt[10], sBat[7];
  char sAx[8], sAy[8], sAz[8], sGx[8], sGy[8], sGz[8];
  dtostrf(alt,    0, 1, sAlt);
  dtostrf(temp,   0, 1, sTemp);
  dtostrf(press,  0, 1, sPress);
  dtostrf(lat,    0, 6, sLat);
  dtostrf(lon,    0, 6, sLon);
  dtostrf(gpsAlt, 0, 1, sGpsAlt);
  dtostrf(ax,     0, 3, sAx);
  dtostrf(ay,     0, 3, sAy);
  dtostrf(az,     0, 3, sAz);
  dtostrf(gx,     0, 2, sGx);
  dtostrf(gy,     0, 2, sGy);
  dtostrf(gz,     0, 2, sGz);
  dtostrf(batV,   0, 2, sBat);

  char body[220];
  snprintf(body, sizeof(body),
    "CSAT,%u,%s,%s,%s,%s,%s,%s,%u,%s,%s,%s,%s,%s,%s,%s,%u,%u,%u",
    seqNum, sAlt, sTemp, sPress, sLat, sLon, sGpsAlt, gpsFix,
    sAx, sAy, sAz, sGx, sGy, sGz,
    sBat, missionState, sepStatus, chuteStatus);

  uint8_t chk = 0;
  for (char* p = body; *p; p++) chk ^= (uint8_t)*p;   // XOR checksum

  // Emit an UPPERCASE, zero-padded 2-digit hex checksum. Serial.print(x, HEX)
  // prints lowercase (e.g. "5a"); the GCS parser upper-cases before comparing so
  // it still matches, but the sample logs, the simulator sketch and CONTRACT §1
  // all specify uppercase — keep the wire byte-identical to spec.
  const char* HEXD = "0123456789ABCDEF";
  Serial.print('$');
  Serial.print(body);
  Serial.print('*');
  Serial.print(HEXD[(chk >> 4) & 0x0F]);
  Serial.println(HEXD[chk & 0x0F]);
}

// ── Battery voltage ────────────────────────────────────────────
float readBatteryV() {
  // 50% divider (R1=R2=10k) → up to 10 V on a 5 V ADC. Tune for your divider.
  int raw = analogRead(BATTERY_PIN);
  return raw * (5.0 / 1023.0) * 2.0;
}

// ── Mission-state auto-detection ───────────────────────────────
void updateMissionState() {
  float alt = baroFail ? prevAlt : bmp.readAltitude(1013.25);
  if (alt < 0) alt = 0;

  switch (missionState) {
    case 0:  // PAD
      if (alt > 10) missionState = 1;
      break;
    case 1:  // ASCENT
      if (alt > maxAlt) maxAlt = alt;
      if (alt < prevAlt - 5) missionState = 2;      // began to fall → apogee
      break;
    case 2:  // APOGEE — auto-separate payload, then descend
      if (!sepStatus) deploySeparation();
      missionState = 3;
      break;
    case 3:  // DESCENT
      if (alt < 20) missionState = 4;
      break;
    case 4:  // LANDING
      if (alt < 5 && abs(alt - prevAlt) < 0.5) missionState = 5;
      break;
    // case 5: RECOVERY is terminal
  }
  prevAlt = alt;
}

// ── Actuators ──────────────────────────────────────────────────
void deploySeparation() {
  sepServo.write(90);   // release payload
  sepStatus = 1;
}
void deployChute() {
  chuteServo.write(90); // release parachute
  chuteStatus = 1;
}

// ── Ground command handler ─────────────────────────────────────
void handleCommand() {
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();

  if (cmd.startsWith("TIME")) {            // clock sync — logged, no action needed
    Serial.println("# ACK TIME");
  } else if (cmd == "SEP") {
    deploySeparation();                    Serial.println("# ACK SEP");
  } else if (cmd == "CHUTE") {
    deployChute();                         Serial.println("# ACK CHUTE");
  } else if (cmd == "REDUND") {
    deploySeparation(); deployChute();     Serial.println("# ACK REDUND");
  } else if (cmd == "ARM") {
    missionState = 0; sepStatus = 0; chuteStatus = 0; maxAlt = 0; prevAlt = 0;
    sepServo.write(0); chuteServo.write(0);
    Serial.println("# ACK ARM");
  } else if (cmd == "ABORT") {
    deployChute(); missionState = 5;       Serial.println("# ACK ABORT");
  } else if (cmd == "PING") {
    Serial.println("# PONG");
  } else if (cmd.length()) {
    Serial.print("# NAK "); Serial.println(cmd);
  }
}
