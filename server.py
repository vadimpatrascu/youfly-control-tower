#!/usr/bin/env python3
"""YouFly local server: static files + live ADS-B proxy (OpenSky)."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
PORT = 8765

# Airlines bookable via YouFly (callsign / ICAO airline code prefixes)
# Matched against OpenSky callsign (field index 1).
AIRLINE_MAP: list[tuple[re.Pattern[str], dict[str, str]]] = [
    (re.compile(r"^(WZZ|W6)", re.I), {"code": "W6", "name": "Wizz Air", "logo": "W6"}),
    (re.compile(r"^WMT", re.I), {"code": "W6", "name": "Wizz Air Malta", "logo": "W6"}),
    (re.compile(r"^(THY|THY\d|TK\d|TKJ)", re.I), {"code": "TK", "name": "Turkish Airlines / AJet", "logo": "TK"}),
    (re.compile(r"^(ROT|RO\d)", re.I), {"code": "RO", "name": "TAROM", "logo": "RO"}),
    (re.compile(r"^(AUA|OS\d)", re.I), {"code": "OS", "name": "Austrian", "logo": "OS"}),
    (re.compile(r"^(LOT|LO\d)", re.I), {"code": "LO", "name": "LOT Polish", "logo": "LO"}),
    (re.compile(r"^(DLH|LH\d|GWI|EWG|VLG)", re.I), {"code": "LH", "name": "Lufthansa Group", "logo": "LH"}),
    (re.compile(r"^(FIA|5F)", re.I), {"code": "5F", "name": "FlyOne", "logo": "5F"}),
    (re.compile(r"^(HYM|H4|HSY)", re.I), {"code": "H4", "name": "HiSky", "logo": "H4"}),
    (re.compile(r"^(FDB|FZ\d)", re.I), {"code": "FZ", "name": "flydubai", "logo": "FZ"}),
    # Extra carriers often sold on KIV meta-search
    (re.compile(r"^(RYR|FR\d)", re.I), {"code": "FR", "name": "Ryanair", "logo": "FR"}),
    (re.compile(r"^(PGT|PC\d)", re.I), {"code": "PC", "name": "Pegasus", "logo": "PC"}),
    (re.compile(r"^(AEE|A3\d)", re.I), {"code": "A3", "name": "Aegean", "logo": "A3"}),
    (re.compile(r"^(BTI|BT\d)", re.I), {"code": "BT", "name": "airBaltic", "logo": "BT"}),
    (re.compile(r"^(TAR|TUN)", re.I), {"code": "TU", "name": "Tunisair", "logo": "TU"}),
    (re.compile(r"^(TOM|TUI)", re.I), {"code": "BY", "name": "TUI fly", "logo": "X3"}),
]

# SE Europe + route corridor (KIV ↔ Europe / Med / Mid-East)
# OpenSky bbox: lamin, lomin, lamax, lomax
REGIONS = {
    "kiv": (45.5, 27.5, 47.5, 29.5),       # tight around Chișinău
    "corridor": (41.0, 18.0, 52.0, 42.0),  # Balkans → Baltics → Turkey
    "europe": (36.0, -10.0, 60.0, 45.0),   # broader Europe
}

CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
CACHE_TTL = 12.0  # OpenSky free tier is rate-limited


def match_airline(callsign: str) -> dict[str, str] | None:
    cs = (callsign or "").strip().upper()
    if not cs:
        return None
    for pat, meta in AIRLINE_MAP:
        if pat.search(cs):
            return meta
    return None


def fetch_opensky(lamin: float, lomin: float, lamax: float, lomax: float) -> list[list[Any]]:
    url = (
        "https://opensky-network.org/api/states/all"
        f"?lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "YouFly-ControlTower/1.0 (local demo; flight meta-search)"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("states") or [], data.get("time")


def build_flights(region: str = "corridor") -> dict[str, Any]:
    now = time.time()
    if CACHE["payload"] and now - CACHE["ts"] < CACHE_TTL and CACHE.get("region") == region:
        return CACHE["payload"]

    bbox = REGIONS.get(region, REGIONS["corridor"])
    try:
        states, sky_time = fetch_opensky(*bbox)
        err = None
    except Exception as e:  # noqa: BLE001
        states, sky_time, err = [], None, str(e)
        if CACHE["payload"]:
            # serve stale on error
            stale = dict(CACHE["payload"])
            stale["stale"] = True
            stale["error"] = err
            return stale

    flights = []
    for s in states:
        # OpenSky state vector indices:
        # 0 icao24, 1 callsign, 2 origin_country, 5 lon, 6 lat, 7 baro_alt,
        # 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate, 13 geo_alt, 14 squawk
        if not s or s[5] is None or s[6] is None:
            continue
        callsign = (s[1] or "").strip()
        airline = match_airline(callsign)
        if not airline:
            continue
        if s[8]:  # on ground — still show near airports optionally
            status = "ground"
        else:
            status = "airborne"

        lon, lat = float(s[5]), float(s[6])
        alt = s[7] if s[7] is not None else s[13]
        flights.append(
            {
                "icao24": s[0],
                "callsign": callsign,
                "country": s[2],
                "lon": lon,
                "lat": lat,
                "alt_m": alt,
                "alt_ft": round(alt * 3.28084) if alt is not None else None,
                "on_ground": bool(s[8]),
                "status": status,
                "speed_ms": s[9],
                "speed_kmh": round(s[9] * 3.6) if s[9] is not None else None,
                "track": s[10],
                "vrate": s[11],
                "squawk": s[14],
                "airline": airline["name"],
                "airline_code": airline["code"],
                "logo": airline["logo"],
                "bookable": True,
            }
        )

    # Prefer airborne first, then by altitude
    flights.sort(key=lambda f: (f["on_ground"], -(f["alt_m"] or 0)))

    payload = {
        "ok": err is None,
        "error": err,
        "source": "OpenSky Network ADS-B",
        "region": region,
        "bbox": {"lamin": bbox[0], "lomin": bbox[1], "lamax": bbox[2], "lomax": bbox[3]},
        "sky_time": sky_time,
        "fetched_at": int(now),
        "count": len(flights),
        "airlines_filter": [m["name"] for _, m in AIRLINE_MAP],
        "note": (
            "Live positions for airlines typically bookable via YouFly meta-search "
            "(Wizz, Turkish, TAROM, Austrian, LOT, Lufthansa, FlyOne, HiSky, flydubai, …). "
            "Not all airborne flights are currently on sale — ADS-B shows real ops."
        ),
        "flights": flights[:120],
    }
    CACHE["ts"] = now
    CACHE["region"] = region
    CACHE["payload"] = payload
    return payload


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/live-flights", "/api/flights"):
            qs = parse_qs(parsed.query)
            region = (qs.get("region") or ["corridor"])[0]
            payload = build_flights(region)
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200 if payload.get("ok") or payload.get("flights") else 502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/health":
            body = json.dumps({"ok": True, "service": "youfly-tower"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, fmt: str, *args):
        # quieter logs
        if args and str(args[0]).startswith("/api/"):
            print("[api]", args[0])
        elif args and any(x in str(args[0]) for x in (".html", ".js", ".css")):
            print("[static]", args[0])


def main() -> None:
    # Warm cache
    try:
        n = build_flights("corridor")["count"]
        print(f"OpenSky warm: {n} bookable-airline flights in corridor")
    except Exception as e:  # noqa: BLE001
        print("OpenSky warm failed:", e)

    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"YouFly Control Tower → http://127.0.0.1:{PORT}/v2.html")
    print(f"Live flights API     → http://127.0.0.1:{PORT}/api/live-flights")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
