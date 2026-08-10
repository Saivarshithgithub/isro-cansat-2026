CanSat Firmware - Quick Setup
==============================

Board: Arduino Nano / Uno / Mega (5V logic)

Required Libraries (Install via Arduino Library Manager):
  1. Adafruit BMP280  (search: "Adafruit BMP280")
  2. MPU6050 by Electronic Cats (search: "MPU6050")
  3. TinyGPSPlus by Mikal Hart (search: "TinyGPSPlus")
  4. Servo (bundled with the Arduino IDE - no install needed)

Wiring:
  BMP280  → SDA=A4, SCL=A5, VCC=3.3V, GND=GND
  MPU6050 → SDA=A4, SCL=A5, VCC=3.3V, GND=GND
  GPS NEO-6M → TX→pin4, RX→pin3, VCC=5V, GND=GND
  Battery → A0 (voltage divider: 10k+10k to GND)
  Separation servo → pin 9   (payload release)
  Parachute servo  → pin 10  (emergency chute)
  Radio (XBee/LoRa) → TX→RX0, RX→TX0 (transparent serial)

No hardware? Upload arduino/cansat_simulator/cansat_simulator.ino instead -
it needs no sensors/servos and streams a full synthetic flight at 5 Hz.

Baud Rate: 115200 (both Serial port and radio module)

Test without radio:
  Open Arduino Serial Monitor at 115200 baud
  You should see $CSAT packets every 200ms

Test with GCS:
  Open index.html in Chrome via localhost (npx serve .)
  Click CONNECT → select the COM port
  Click ▶ Simulate to test GCS without hardware
