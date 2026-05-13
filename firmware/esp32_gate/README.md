# ESP32 Gate Controller — Flashing Guide

## Hardware Requirements
| Component | Spec |
|-----------|------|
| MCU | ESP32 DevKit V1 (or any ESP32 variant) |
| Relay module | 5V single-channel relay (active HIGH or LOW — set `RELAY_ACTIVE_HIGH` in sketch) |
| Status LED | Built-in GPIO2 or external LED + 330Ω resistor |
| Power | 5V USB or regulated 5V from campus LAN patch panel |

## Wiring Diagram
```
ESP32 GPIO4  ──────────────────► Relay IN  (signal)
ESP32 GND    ──────────────────► Relay GND
5V supply    ──────────────────► Relay VCC

Relay NO (Normally Open) ──────► Gate motor common
Relay COM (Common)       ──────► 12V gate motor supply
```

## Arduino IDE Setup

1. Install ESP32 board support:
   - File → Preferences → Additional Boards Manager URLs:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Tools → Board → Boards Manager → search "ESP32" → install **esp32 by Espressif Systems** v2.x

2. Install libraries (Sketch → Include Library → Manage Libraries):
   - **ArduinoWebsockets** by Gil Maimon  (v0.5.x)
   - **ArduinoJson** by Benoit Blanchon (v7.x)

3. Board settings:
   - Board: **ESP32 Dev Module**
   - Upload Speed: **921600**
   - Flash Size: **4MB (32Mb)**
   - Partition Scheme: **Default 4MB with spiffs**

## Configuration Before Flashing

Edit the top of `esp32_gate.ino`:

```cpp
static const char* WIFI_SSID     = "ITB-PARKING-IOT";
static const char* WIFI_PASSWORD = "your_wifi_password";

// Generate with: python backend/core/security.py (create_esp32_gate_token)
static const char* WS_URL =
    "ws://192.168.1.100:8000/ws/esp32/G1?token=<YOUR_ESP32_JWT>";
```

## One-time Token Generation

```bash
cd backend
python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('G1', get_settings()))
"
```

Paste the output into `WS_URL` in the sketch.

## LED Status Codes
| LED pattern | Meaning |
|-------------|---------|
| Solid ON | WebSocket connected to backend |
| OFF | Disconnected / reconnecting |
| Fast blink | Gate relay is currently open (HIGH) |

## Serial Monitor Output (115200 baud)
```
=== ITB Jatinangor Parking Gate Controller ===
[INIT] Relay timer created.
[WiFi] Connecting to ITB-PARKING-IOT ...
[WiFi] Connected. IP: 192.168.1.42
[WS] Connecting to ws://192.168.1.100:8000/ws/esp32/G1?token=...
[WS] Connected to backend.
[CMD] open_gate → gate=G1 plate=D4321ITB duration=1000ms
[GATE] Relay ON — will auto-close in 1000 ms
```
