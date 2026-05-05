/*
 * gate_servo.ino
 * ==============
 * Arduino — Kontrol Servo Gerbang Parkir SIX
 *
 * Menerima perintah Serial 1 karakter dari anpr_scanner.py:
 *   'O' → Buka servo ke 90° (gate terbuka), jeda 5 detik, tutup ke 0°
 *   'R' → LED hijau (kendaraan terdaftar)
 *   'G' → LED kuning (tamu / guest)
 *   'C' → Tutup paksa servo ke 0° (manual override)
 *   'S' → Status: kirim balik status saat ini
 *
 * Wiring:
 *   Servo signal → Pin 9
 *   LED Hijau    → Pin 4 (melalui resistor 220Ω)
 *   LED Kuning   → Pin 5
 *   LED Merah    → Pin 6  (menandakan gate tertutup/siap)
 *   Buzzer       → Pin 7  (opsional, bunyi saat gate buka)
 *
 * Board: Arduino Uno / Nano
 * Baud : 9600
 */

#include <Servo.h>

// ── Pin Config ──
const int PIN_SERVO   = 9;
const int PIN_LED_REG = 4;   // LED Hijau — kendaraan terdaftar
const int PIN_LED_GST = 5;   // LED Kuning — tamu
const int PIN_LED_RDY = 6;   // LED Merah — gate tertutup / ready
const int PIN_BUZZER  = 7;

// ── Servo Config ──
const int ANGLE_OPEN  = 90;   // derajat gate terbuka
const int ANGLE_CLOSE = 0;    // derajat gate tertutup
const int GATE_OPEN_DURATION_MS = 5000;  // jeda sebelum tutup (ms)

// ── State ──
Servo gateServo;
bool  gateOpen    = false;
bool  isRegistered = false;

// ── Timing ──
unsigned long gateOpenedAt = 0;

void setup() {
  Serial.begin(9600);
  gateServo.attach(PIN_SERVO);

  pinMode(PIN_LED_REG, OUTPUT);
  pinMode(PIN_LED_GST, OUTPUT);
  pinMode(PIN_LED_RDY, OUTPUT);
  pinMode(PIN_BUZZER,  OUTPUT);

  // Inisialisasi: gate tertutup, LED merah menyala
  closeGate();
  Serial.println("SIX Gate Controller READY");
}

void loop() {
  // ── Cek perintah Serial ──
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    handleCommand(cmd);
  }

  // ── Auto-close gate setelah GATE_OPEN_DURATION_MS ──
  if (gateOpen && (millis() - gateOpenedAt >= GATE_OPEN_DURATION_MS)) {
    closeGate();
  }
}

// ═══════════════════════════════════════
// HANDLER PERINTAH
// ═══════════════════════════════════════
void handleCommand(char cmd) {
  switch (cmd) {

    case 'O':  // OPEN gate
      openGate();
      Serial.println("ACK:OPEN");
      break;

    case 'R':  // LED Registered (hijau)
      isRegistered = true;
      setLED(true, false);   // hijau on, kuning off
      beep(1, 80);           // 1x bunyi pendek
      Serial.println("ACK:REGISTERED");
      break;

    case 'G':  // LED Guest (kuning)
      isRegistered = false;
      setLED(false, true);   // hijau off, kuning on
      beep(2, 80);           // 2x bunyi pendek
      Serial.println("ACK:GUEST");
      break;

    case 'C':  // Force CLOSE
      closeGate();
      Serial.println("ACK:CLOSE");
      break;

    case 'S':  // Status
      Serial.print("STATUS:");
      Serial.print(gateOpen ? "OPEN" : "CLOSED");
      Serial.print("|REG:");
      Serial.println(isRegistered ? "YES" : "NO");
      break;

    default:
      Serial.print("UNKNOWN:");
      Serial.println(cmd);
      break;
  }
}

// ═══════════════════════════════════════
// GATE FUNCTIONS
// ═══════════════════════════════════════
void openGate() {
  if (gateOpen) return;  // sudah terbuka, skip
  gateOpen = true;
  gateOpenedAt = millis();

  gateServo.write(ANGLE_OPEN);
  digitalWrite(PIN_LED_RDY, LOW);   // matikan LED merah
  beep(1, 200);                      // bunyi panjang saat buka

  Serial.print("GATE_OPENED|WILL_CLOSE_IN:");
  Serial.println(GATE_OPEN_DURATION_MS / 1000);
}

void closeGate() {
  gateOpen    = false;
  isRegistered = false;

  gateServo.write(ANGLE_CLOSE);
  delay(500);  // tunggu servo bergerak

  // Reset semua LED, nyalakan merah (ready)
  setLED(false, false);
  digitalWrite(PIN_LED_RDY, HIGH);

  Serial.println("GATE_CLOSED");
}

// ═══════════════════════════════════════
// LED HELPER
// ═══════════════════════════════════════
void setLED(bool green, bool yellow) {
  digitalWrite(PIN_LED_REG, green  ? HIGH : LOW);
  digitalWrite(PIN_LED_GST, yellow ? HIGH : LOW);
}

// ═══════════════════════════════════════
// BUZZER HELPER
// ═══════════════════════════════════════
void beep(int times, int durationMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(durationMs);
    digitalWrite(PIN_BUZZER, LOW);
    if (i < times - 1) delay(100);
  }
}
