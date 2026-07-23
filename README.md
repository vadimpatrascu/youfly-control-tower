# YouFly ∞ Control Tower

Premium flight search UI for Chișinău (KIV) with **live ADS-B radar** for airlines bookable via YouFly meta-search.

## Production

- **Live site:** https://youfly-control-tower.vercel.app
- **GitHub:** https://github.com/vadimpatrascu/youfly-control-tower
- **API:** https://youfly-control-tower.vercel.app/api/live-flights

Vercel is connected to the GitHub repo — pushes to `main` auto-deploy.

## Local

```bash
python server.py
# → http://127.0.0.1:8765/
```

## Stack

- Static: `v2.html` (Control Tower Edition)
- Live flights: `/api/live-flights` (Vercel serverless → OpenSky Network)
- Local Python twin: `server.py`
