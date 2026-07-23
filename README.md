# YouFly ∞ Control Tower

Premium flight search UI for Chișinău (KIV) with **live ADS-B radar** for airlines bookable via YouFly meta-search.

## Live site

Deployed on Vercel (see GitHub Actions / Vercel dashboard after push).

## Local

```bash
# Full local (static + OpenSky proxy)
python server.py
# → http://127.0.0.1:8765/
```

## Stack

- Static: `v2.html` (Control Tower Edition)
- Live flights: `/api/live-flights` (Vercel serverless → OpenSky Network)
- Local Python twin: `server.py`

## API

`GET /api/live-flights?region=corridor`

Regions: `kiv` | `corridor` | `europe`
