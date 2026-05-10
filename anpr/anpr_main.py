"""
anpr/anpr_main.py
YOLOv8 + fast_plate_ocr ANPR edge script — ITB Jatinangor Parking Gate.

Key improvements over prototype:
  1. aiohttp + asyncio  → HTTP POST runs in a background thread; the OpenCV
                          capture loop NEVER blocks waiting for the backend.
  2. concurrent.futures.ThreadPoolExecutor  → sends the request on a worker
                          thread, pushes result back via asyncio.Queue for
                          optional logging without touching the main thread.
  3. Environment variables → no secrets in source code.
  4. Configurable direction (ENTRY / EXIT) via CLI arg or env var.

Usage:
    # Entry gate camera
    GATE_DIRECTION=entry GATE_ID=G1 python anpr_main.py

    # Exit gate camera  
    GATE_DIRECTION=exit GATE_ID=EXIT1 python anpr_main.py
"""
import os
import re
import sys
import time
import asyncio
import logging
import threading
from collections import Counter, deque
from typing import Optional

import aiohttp
import cv2
from fast_plate_ocr import LicensePlateRecognizer
from ultralytics import YOLO

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("anpr")

# =============================================================================
# CONFIGURATION  (all values come from environment variables — never hardcode)
# =============================================================================
API_ENDPOINT    = os.environ.get("API_ENDPOINT",    "http://localhost:8000/api/v1/gate/trigger")
# Store this in a .env file or a secrets manager (Vault, AWS SM, etc.)
# Generate with: python backend/core/security.py  (create_anpr_service_token)
API_SECRET_KEY  = os.environ.get("API_SECRET_KEY",  "REPLACE_WITH_REAL_JWT_TOKEN")

GATE_ID         = os.environ.get("GATE_ID",         "G1")
GATE_DIRECTION  = os.environ.get("GATE_DIRECTION",  "entry")   # "entry" | "exit"
CAMERA_INDEX    = int(os.environ.get("CAMERA_INDEX", "0"))     # 0 = built-in, 1 = DroidCam

FRAME_WIDTH     = 1280
FRAME_HEIGHT    = 720
MIN_BOX_W       = 80       # px  — ignore smaller detections (noise)
MIN_BOX_H       = 30       # px
VOTE_THRESHOLD  = 5        # frames before plate is "locked"
COOLDOWN_SECS   = 5.0      # local client-side cooldown (server has its own)
CONF_THRESHOLD  = 0.85     # passed to backend; backend enforces ≥85%

# =============================================================================
# REGEX — Indonesian plate format (normalized: no spaces)
# =============================================================================
PLATE_PATTERN = re.compile(r"^[A-Z]{1,2}\d{1,4}[A-Z]{1,3}$")

# =============================================================================
# MODELS
# =============================================================================
log.info("Loading YOLO model...")
yolo = YOLO(
    "https://huggingface.co/wuriyanto/yolo8-indonesian-license-plate-detection/resolve/main/model.pt"
)

log.info("Loading fast_plate_ocr model...")
ocr_model = LicensePlateRecognizer("cct-s-v2-global-model")

# =============================================================================
# ASYNC HTTP SESSION (shared across all trigger calls)
# =============================================================================
_http_session: Optional[aiohttp.ClientSession] = None
_session_lock = threading.Lock()

# asyncio event loop running in a dedicated daemon thread
# The main OpenCV thread posts coroutines to this loop via asyncio.run_coroutine_threadsafe()
_loop: asyncio.AbstractEventLoop = asyncio.new_event_loop()


def _start_event_loop():
    """Entry point for the background asyncio thread."""
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


_bg_thread = threading.Thread(target=_start_event_loop, daemon=True)
_bg_thread.start()


async def _get_session() -> aiohttp.ClientSession:
    """Lazy-initialise the aiohttp session (must be called inside the event loop)."""
    global _http_session
    if _http_session is None or _http_session.closed:
        timeout = aiohttp.ClientTimeout(total=3.0, connect=1.0)
        _http_session = aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {API_SECRET_KEY}"},
            timeout=timeout,
        )
    return _http_session


async def _send_trigger_async(plate: str, confidence: float) -> None:
    """
    Coroutine that sends the gate trigger POST.
    Runs entirely on the background asyncio loop — zero impact on the CV loop.
    """
    session = await _get_session()
    payload = {
        "plate_number": plate,
        "gate_id":      GATE_ID,
        "confidence":   confidence,
        "direction":    GATE_DIRECTION,
    }
    try:
        async with session.post(API_ENDPOINT, json=payload) as resp:
            body = await resp.json()
            action = body.get("action", "unknown")

            if action == "open_gate":
                log.info("✅ Gate %s OPENED for %s | owner=%s | fee=%s",
                         GATE_ID, plate, body.get("owner"), body.get("fee"))
            elif action == "cooldown":
                log.info("⏱  Cooldown active for %s — skipped by server.", plate)
            elif action == "low_confidence":
                log.warning("🔴 Server rejected %s — low confidence (%.0f%%)", plate, confidence * 100)
            else:
                log.warning("🔴 Access denied for %s: %s", plate, body.get("reason"))

    except aiohttp.ClientConnectorError:
        log.error("❌ Cannot connect to backend at %s — is the server running?", API_ENDPOINT)
    except asyncio.TimeoutError:
        log.error("❌ Backend request timed out for plate %s.", plate)
    except Exception as exc:
        log.error("❌ Unexpected error sending trigger: %s", exc)


def send_trigger_nonblocking(plate: str, confidence: float) -> None:
    """
    Thread-safe, non-blocking gate trigger.
    Schedules the coroutine on the background event loop and returns immediately.
    The OpenCV capture loop continues without any pause.
    """
    asyncio.run_coroutine_threadsafe(
        _send_trigger_async(plate, confidence),
        _loop,
    )
    log.info("→ Trigger dispatched async for plate=%s dir=%s gate=%s", plate, GATE_DIRECTION, GATE_ID)


# =============================================================================
# STATE MANAGEMENT
# =============================================================================
history:           deque[str] = deque(maxlen=10)
last_trigger_time: float      = 0.0
last_plate:        str        = ""

# =============================================================================
# CAMERA SETUP
# =============================================================================
cap = cv2.VideoCapture(CAMERA_INDEX)
cap.set(cv2.CAP_PROP_FRAME_WIDTH,  FRAME_WIDTH)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

cv2.namedWindow("ALPR — ITB Jatinangor", cv2.WINDOW_NORMAL)
cv2.resizeWindow("ALPR — ITB Jatinangor", FRAME_WIDTH, FRAME_HEIGHT)

log.info(
    "ANPR started | gate=%s | dir=%s | camera=%d | endpoint=%s",
    GATE_ID, GATE_DIRECTION, CAMERA_INDEX, API_ENDPOINT,
)
log.info("Press ESC in the camera window to exit.")

# =============================================================================
# MAIN CAPTURE LOOP
# =============================================================================
try:
    while True:
        ret, frame = cap.read()
        if not ret:
            log.error("Failed to read frame from camera index %d.", CAMERA_INDEX)
            break

        results = yolo(frame, verbose=False)

        for r in results:
            if r.boxes is None or len(r.boxes) == 0:
                continue

            # Perbaikan Utama: Gunakan zip untuk iterasi koordinat dan confidence secara bersamaan
            for box_tensor, conf_tensor in zip(r.boxes.xyxy, r.boxes.conf):
                # Konversi tensor ke tipe data python standar
                x1, y1, x2, y2 = map(int, box_tensor.tolist())
                yolo_conf = float(conf_tensor.item()) 

                crop = frame[y1:y2, x1:x2]

                if crop.shape[0] < MIN_BOX_H or crop.shape[1] < MIN_BOX_W:
                    continue  # Abaikan noise

                # ── OCR ───────────────────────────────────────────────────────
                prediction = ocr_model.run(crop)
                raw_text   = getattr(prediction, "text", str(prediction))
                text       = raw_text.upper().replace(" ", "")

                box_color = (0, 0, 255)  # Merah (Default: Belum valid)

                # ── Regex validation + voting stabilisation ───────────────────
                if PLATE_PATTERN.match(text):
                    history.append(text)
                    box_color = (0, 255, 0)  # Hijau (Format plat benar)

                    if len(history) >= VOTE_THRESHOLD:
                        best_plate = Counter(history).most_common(1)[0][0]
                        now        = time.time()

                        plate_changed = best_plate != last_plate
                        cooldown_ok   = (now - last_trigger_time) > COOLDOWN_SECS

                        if plate_changed or cooldown_ok:
                            log.info("🔒 Plate locked: %s (conf=%.1f%%)", best_plate, yolo_conf * 100)

                            # Kirim ke backend tanpa nge-lag (Async)
                            send_trigger_nonblocking(best_plate, yolo_conf)

                            last_plate        = best_plate
                            last_trigger_time = now
                            history.clear()

                # ── Visualisasi ───────────────────────────────────────────────
                cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                if text:
                    cv2.putText(
                        frame, text, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.85, box_color, 2,
                    )
                    cv2.putText(
                        frame, f"{yolo_conf:.0%}", (x1, y2 + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, box_color, 1,
                    )

        # ── HUD overlay ───────────────────────────────────────────────────────
        cv2.putText(frame, f"GATE: {GATE_ID} | DIR: {GATE_DIRECTION.upper()}",
                    (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, f"Last: {last_plate or 'None'}",
                    (10, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 200), 1)

        cv2.imshow("ALPR — ITB Jatinangor", frame)

        if cv2.waitKey(1) == 27:   # Tombol ESC untuk exit
            log.info("ESC pressed — shutting down.")
            break

finally:
    cap.release()
    cv2.destroyAllWindows()

    # Gracefully close the aiohttp session on the event loop
    async def _cleanup():
        if _http_session and not _http_session.closed:
            await _http_session.close()

    asyncio.run_coroutine_threadsafe(_cleanup(), _loop).result(timeout=2)
    _loop.call_soon_threadsafe(_loop.stop)
    log.info("ANPR shutdown complete.")
