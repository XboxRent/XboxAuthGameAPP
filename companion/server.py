#!/usr/bin/env python3
"""Read-only Xbox UPnP discovery companion for Xbox AutoPilot.

Run from any directory: python companion/server.py
Open http://<computer-LAN-IP>:8765/ on the iPhone.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("AUTOPILOT_PORT", "8765"))
PROBE_LOCK = threading.Lock()
CACHE_LOCK = threading.Lock()
CACHE = {"checked_at": 0.0, "result": None}
SSDP_ADDRESS = ("239.255.255.250", 1900)
SEARCH_TARGETS = (
    "ssdp:all",
    "urn:schemas-upnp-org:device:MediaRenderer:1",
    "urn:schemas-upnp-org:device:Basic:1",
)


def parse_ssdp_response(packet: bytes) -> dict[str, str]:
    """Parse an SSDP response without trusting or fetching its LOCATION URL."""
    text = packet.decode("iso-8859-1", errors="replace")
    lines = text.replace("\r\n", "\n").split("\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def is_xbox_advertisement(headers: dict[str, str]) -> bool:
    """Only classify explicit Microsoft/Xbox identifiers as Xbox."""
    identifying = " ".join(headers.get(k, "") for k in ("server", "st", "usn")).lower()
    return "xbox" in identifying or "microsoft" in identifying


def discover_xbox(timeout: float = 2.2) -> dict:
    started = time.time()
    found: dict[str, dict] = {}
    errors: list[str] = []
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.settimeout(0.25)
        for target in SEARCH_TARGETS:
            request = (
                "M-SEARCH * HTTP/1.1\r\n"
                "HOST: 239.255.255.250:1900\r\n"
                'MAN: "ssdp:discover"\r\n'
                "MX: 1\r\n"
                f"ST: {target}\r\n\r\n"
            ).encode("ascii")
            try:
                sock.sendto(request, SSDP_ADDRESS)
            except OSError as exc:
                errors.append(str(exc))
        deadline = started + timeout
        while time.time() < deadline:
            try:
                packet, address = sock.recvfrom(8192)
            except socket.timeout:
                continue
            except OSError as exc:
                errors.append(str(exc))
                break
            headers = parse_ssdp_response(packet)
            if not headers:
                continue
            key = headers.get("usn") or headers.get("location") or address[0]
            found[key] = {
                "ip": address[0],
                "server": headers.get("server", ""),
                "st": headers.get("st", ""),
                "xbox": is_xbox_advertisement(headers),
            }
    finally:
        sock.close()

    xbox_devices = [item for item in found.values() if item["xbox"]]
    return {
        "state": "found" if xbox_devices else "not_found",
        "message": (
            "Обнаружено объявление Xbox/Microsoft по UPnP"
            if xbox_devices
            else "UPnP-объявление Xbox не обнаружено; это не доказывает, что консоль выключена"
        ),
        "xbox_devices": xbox_devices,
        "other_upnp_devices": len(found) - len(xbox_devices),
        "elapsed_ms": round((time.time() - started) * 1000),
        "errors": errors[:3],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[AutoPilot] " + (fmt % args))

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/status":
            with CACHE_LOCK:
                cached = CACHE["result"]
                age = time.time() - CACHE["checked_at"]
            self.send_json(200, {
                "helper": "ready",
                "version": "1.0.0",
                "cached": bool(cached),
                "cache_age_seconds": round(age, 1) if cached else None,
                "discovery": cached,
                "remote_play": {
                    "state": "not_verifiable",
                    "message": "Браузер и этот локальный компонент не получают официальный статус активного сеанса Remote Play."
                }
            })
            return
        if path == "/api/probe":
            if not PROBE_LOCK.acquire(blocking=False):
                self.send_json(429, {"error": "Проверка уже выполняется"})
                return
            try:
                with CACHE_LOCK:
                    if CACHE["result"] and time.time() - CACHE["checked_at"] < 5:
                        result = CACHE["result"]
                    else:
                        result = discover_xbox()
                        CACHE["result"] = result
                        CACHE["checked_at"] = time.time()
                self.send_json(200, {"helper": "ready", "discovery": result})
            except Exception as exc:
                self.send_json(500, {"error": "Ошибка UPnP-проверки", "detail": str(exc)[:240]})
            finally:
                PROBE_LOCK.release()
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "Неизвестный API endpoint"})
            return
        return super().do_GET()


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print("Xbox AutoPilot local companion is running.")
    print(f"On this computer: http://127.0.0.1:{PORT}/")
    print("On your iPhone, open this computer's LAN IP at the same port.")
    print("Keep this terminal open. The helper performs read-only SSDP discovery.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping companion.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
