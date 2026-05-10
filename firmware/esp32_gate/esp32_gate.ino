/**
 * firmware/esp32_gate/esp32_gate.ino
 *
 * ITB Jatinangor Parking Gate — ESP32 Gate Controller Firmware
 * ─────────────────────────────────────────────────────────────
 * Architecture:
 *   • Connects to the local FastAPI backend via WebSocket (persistent connection)
 *   • Listens for JSON command: {"action":"open_gate","duration_ms":1000}
 *   • On command: drives GPIO RELAY_PIN HIGH for exactly duration_ms milliseconds
 *   • Uses a hardware timer (esp_timer) for precision timing — NOT delay()
 *     so the WebSocket loop stays alive during gate operation
 *   • Sends a heartbeat "ping" every 15 s to keep the connection alive
 *   • Auto-reconnects (WiFi + WebSocket) with exponential backoff
 *
 * Dependencies (install via Arduino Library Manager):
 *   - ArduinoWebsockets by Gil Maimon  v0.5.x
 *   - ArduinoJson by Benoit Blanchon   v7.x
 *   - WiFi (built-in ESP32 Arduino Core)
 *
 * Board:  ESP32 DevKit V1 (or any ESP32 variant)
 * Flash:  Arduino IDE 2.x with ESP32 Arduino Core 2.0+
 */

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include "esp_timer.h"

using namespace websockets;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — Change these values before flashing
// ─────────────────────────────────────────────────────────────────────────────
// WiFi credentials (use campus WPA2-Enterprise only in production)
static const char* WIFI_SSID     = "ITB-PARKING-IOT";
static const char* WIFI_PASSWORD = "your_wifi_password_here";

// Backend WebSocket URL
// Format: ws://<server_ip>:<port>/ws/esp32/<gate_id>?token=<jwt>
// Generate token with: python -c "from backend.core.security import create_esp32_gate_token ..."
static const char* WS_URL =
    "ws://192.168.1.100:8000/ws/esp32/G1?token=REPLACE_WITH_ESP32_JWT_TOKEN";

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE PINS
// ─────────────────────────────────────────────────────────────────────────────
static const int RELAY_PIN      = 4;    // GPIO4 → relay coil signal
static const int STATUS_LED_PIN = 2;    // GPIO2 → built-in LED (status indicator)

// Relay logic level (set RELAY_ACTIVE_HIGH = false for active-low relay modules)
static const bool RELAY_ACTIVE_HIGH = true;
#define RELAY_ON  (RELAY_ACTIVE_HIGH ? HIGH : LOW)
#define RELAY_OFF (RELAY_ACTIVE_HIGH ? LOW  : HIGH)

// ─────────────────────────────────────────────────────────────────────────────
// TIMING & RECONNECT
// ─────────────────────────────────────────────────────────────────────────────
static const uint32_t HEARTBEAT_INTERVAL_MS = 15000;  // 15 s
static const uint32_t RECONNECT_BASE_MS     = 2000;   // initial backoff
static const uint32_t RECONNECT_MAX_MS      = 30000;  // maximum backoff cap
static const uint32_t WIFI_TIMEOUT_MS       = 15000;  // WiFi connect timeout

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
WebsocketsClient wsClient;

static bool     gateOpen        = false;   // relay currently energised?
static uint32_t reconnectDelay  = RECONNECT_BASE_MS;
static uint32_t lastHeartbeat   = 0;
static uint32_t lastConnectAttempt = 0;
static bool     wsConnected     = false;

// esp_timer handle for relay auto-close (hardware timer, not delay())
static esp_timer_handle_t relayTimer = nullptr;

// ─────────────────────────────────────────────────────────────────────────────
// RELAY CONTROL (interrupt-safe via esp_timer callback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hardware timer callback — runs in ISR context, keep it minimal.
 * Drives the relay LOW after the configured duration expires.
 */
static void IRAM_ATTR relayAutoClose(void* /*arg*/) {
    // GPIO write is ISR-safe on ESP32
    gpio_set_level((gpio_num_t)RELAY_PIN, RELAY_OFF);
    gateOpen = false;
    // Note: Serial.print is NOT ISR-safe — log the close in loop() via a flag
}

/**
 * Open the gate for exactly durationMs milliseconds.
 * Uses esp_timer for hardware-level precision; never blocks the main loop.
 */
void openGate(uint32_t durationMs) {
    if (gateOpen) {
        Serial.println("[GATE] Already open — restarting timer.");
        esp_timer_stop(relayTimer);
    }

    // Drive relay HIGH
    digitalWrite(RELAY_PIN, RELAY_ON);
    gateOpen = true;
    Serial.printf("[GATE] Relay ON — will auto-close in %u ms\n", durationMs);

    // Schedule auto-close via hardware timer (microseconds)
    esp_timer_start_once(relayTimer, (uint64_t)durationMs * 1000ULL);
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called on every received WebSocket message.
 * Parses JSON and dispatches gate commands.
 *
 * Expected JSON from backend:
 *   {"action":"open_gate","gate_id":"G1","duration_ms":1000,"plate":"D4321ITB"}
 */
void onMessage(WebsocketsMessage msg) {
    if (msg.isEmpty()) return;

    // Handle plaintext heartbeat responses
    if (msg.data() == "pong") {
        Serial.println("[WS] Heartbeat acknowledged.");
        return;
    }

    // Parse JSON payload
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, msg.data());
    if (err) {
        Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
        return;
    }

    const char* action = doc["action"] | "unknown";

    if (strcmp(action, "open_gate") == 0) {
        uint32_t duration  = doc["duration_ms"] | 1000;    // default 1 s
        const char* plate  = doc["plate"]       | "?";
        const char* gateId = doc["gate_id"]     | "?";

        Serial.printf("[CMD] open_gate → gate=%s plate=%s duration=%ums\n",
                      gateId, plate, duration);
        openGate(duration);

        // Visual confirmation blink
        for (int i = 0; i < 3; i++) {
            digitalWrite(STATUS_LED_PIN, HIGH);
            delay(80);
            digitalWrite(STATUS_LED_PIN, LOW);
            delay(80);
        }
    } else {
        Serial.printf("[CMD] Unknown action: %s\n", action);
    }
}

void onEvent(WebsocketsEvent event, String data) {
    switch (event) {
        case WebsocketsEvent::ConnectionOpened:
            Serial.println("[WS] Connected to backend.");
            wsConnected    = true;
            reconnectDelay = RECONNECT_BASE_MS;  // reset backoff
            digitalWrite(STATUS_LED_PIN, HIGH);  // LED solid = connected
            break;

        case WebsocketsEvent::ConnectionClosed:
            Serial.println("[WS] Connection closed. Will reconnect...");
            wsConnected = false;
            digitalWrite(STATUS_LED_PIN, LOW);
            // Safety: close relay if WS drops while gate is open
            if (gateOpen) {
                esp_timer_stop(relayTimer);
                digitalWrite(RELAY_PIN, RELAY_OFF);
                gateOpen = false;
                Serial.println("[SAFETY] Gate closed on WS disconnect.");
            }
            break;

        case WebsocketsEvent::GotPing:
            wsClient.pong();
            break;

        default:
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WIFI
// ─────────────────────────────────────────────────────────────────────────────
bool connectWiFi() {
    Serial.printf("[WiFi] Connecting to %s ...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start > WIFI_TIMEOUT_MS) {
            Serial.println("[WiFi] Timeout.");
            return false;
        }
        delay(250);
        Serial.print(".");
    }

    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
}

bool connectWebSocket() {
    Serial.printf("[WS] Connecting to %s\n", WS_URL);

    wsClient.onMessage(onMessage);
    wsClient.onEvent(onEvent);

    // Set a reasonable connection timeout
    wsClient.setHandshakeTimeout(5);

    if (!wsClient.connect(WS_URL)) {
        Serial.println("[WS] Connection failed.");
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("\n\n=== ITB Jatinangor Parking Gate Controller ===");

    // ── GPIO init ─────────────────────────────────────────────────────────────
    pinMode(RELAY_PIN,      OUTPUT);
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(RELAY_PIN,      RELAY_OFF);   // Ensure gate is closed on boot
    digitalWrite(STATUS_LED_PIN, LOW);

    // ── Hardware timer init ───────────────────────────────────────────────────
    esp_timer_create_args_t timerArgs = {};
    timerArgs.callback              = &relayAutoClose;
    timerArgs.name                  = "relay_timer";
    timerArgs.dispatch_method       = ESP_TIMER_TASK;  // Task context (safer than ISR for GPIO)
    esp_timer_create(&timerArgs, &relayTimer);
    Serial.println("[INIT] Relay timer created.");

    // ── WiFi ──────────────────────────────────────────────────────────────────
    while (!connectWiFi()) {
        Serial.println("[WiFi] Retrying in 5s...");
        delay(5000);
    }

    // ── WebSocket ────────────────────────────────────────────────────────────
    connectWebSocket();
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP  (non-blocking; max iteration time < 1 ms when idle)
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // ── Reconnect WiFi if dropped ─────────────────────────────────────────────
    if (WiFi.status() != WL_CONNECTED) {
        wsConnected = false;
        Serial.println("[WiFi] Lost connection. Reconnecting...");
        connectWiFi();
        return;
    }

    // ── Reconnect WebSocket with exponential backoff ──────────────────────────
    if (!wsConnected) {
        uint32_t now = millis();
        if (now - lastConnectAttempt >= reconnectDelay) {
            lastConnectAttempt = now;
            if (!connectWebSocket()) {
                // Exponential backoff: double delay, cap at max
                reconnectDelay = min(reconnectDelay * 2, RECONNECT_MAX_MS);
                Serial.printf("[WS] Retry in %u ms.\n", reconnectDelay);
            }
        }
        return;
    }

    // ── Poll WebSocket (non-blocking) ─────────────────────────────────────────
    wsClient.poll();

    // ── Heartbeat ping every HEARTBEAT_INTERVAL_MS ───────────────────────────
    uint32_t now = millis();
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        wsClient.send("ping");
    }

    // ── Status LED: fast blink while gate is open ─────────────────────────────
    if (gateOpen) {
        // Non-blocking blink: toggle every 100 ms
        if ((now / 100) % 2 == 0) {
            digitalWrite(STATUS_LED_PIN, HIGH);
        } else {
            digitalWrite(STATUS_LED_PIN, LOW);
        }
    }
}
