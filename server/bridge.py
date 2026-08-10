#!/usr/bin/env python3
"""
CanSat serial → WebSocket bridge (optional, for WebSocket mode).

Reads NMEA-style telemetry lines from the CanSat radio on a USB serial port and
rebroadcasts each line, verbatim, to every connected browser over WebSocket.
Uplink commands sent by the browser (SEP, CHUTE, ARM, ...) are written straight
back to the serial port. The browser's parser.js does ALL packet decoding — this
bridge is a dumb, lossless pipe, so the wire format never has to be duplicated.

Use this ONLY when you cannot use the Web Serial API directly (e.g. Firefox, or
the radio is on a different machine). Chrome/Edge users should prefer Web Serial.

    pip install pyserial websockets
    python bridge.py --port COM5 --baud 115200 --ws-port 8765

Then in the GCS click "Connect WebSocket" and accept ws://localhost:8765.
"""

import argparse
import asyncio
import sys

try:
    import serial  # pyserial
    import serial.tools.list_ports
except ImportError:
    sys.exit("Missing dependency: pip install pyserial websockets")

try:
    import websockets
except ImportError:
    sys.exit("Missing dependency: pip install websockets")


CLIENTS = set()


def list_ports():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("No serial ports found.")
    for p in ports:
        print(f"  {p.device:12} {p.description}")


async def ws_handler(websocket):
    """Track a browser connection; forward its uplink commands to serial."""
    CLIENTS.add(websocket)
    peer = getattr(websocket, "remote_address", "?")
    print(f"[ws] client connected ({peer}) — {len(CLIENTS)} total")
    try:
        async for message in websocket:
            cmd = message.strip()
            if cmd:
                # Forward uplink command to the CanSat.
                SERIAL.write((cmd + "\n").encode("ascii", "ignore"))
                print(f"[uplink] {cmd}")
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(websocket)
        print(f"[ws] client gone — {len(CLIENTS)} total")


async def serial_pump():
    """Read serial lines in a thread and broadcast to all WebSocket clients."""
    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, SERIAL.readline)
        if not line:
            continue
        try:
            text = line.decode("ascii", "ignore").strip()
        except Exception:
            continue
        if not text:
            continue
        # Broadcast (drop dead clients silently).
        dead = []
        for ws in CLIENTS:
            try:
                await ws.send(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            CLIENTS.discard(ws)


async def main(args):
    global SERIAL
    SERIAL = serial.Serial(args.port, args.baud, timeout=1)
    print(f"[serial] open {args.port} @ {args.baud}")
    print(f"[ws] listening on ws://localhost:{args.ws_port}")
    async with websockets.serve(ws_handler, "localhost", args.ws_port):
        await serial_pump()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="CanSat serial↔WebSocket bridge")
    ap.add_argument("--port", help="serial port, e.g. COM5 or /dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--ws-port", type=int, default=8765)
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    args = ap.parse_args()

    if args.list or not args.port:
        list_ports()
        if not args.port:
            sys.exit("\nSpecify a port with --port")
    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\n[bridge] stopped")
