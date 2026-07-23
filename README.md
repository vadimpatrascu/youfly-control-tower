# YouFly ∞ Control Tower

Sales-ready flight booking UI for Chișinău (KIV) + live ADS-B radar.

## Production

- **Site:** https://youfly-control-tower.vercel.app/
- **GitHub:** https://github.com/vadimpatrascu/youfly-control-tower

### Sales funnel

1. Search (dates, pax, cabin, promo `ZBOR30`)
2. Results with live fares
3. Passengers + contact
4. Payment path: hold 24h / WhatsApp / office / transfer / card
5. Booking reference `YF-XXXXXX` + local history

### APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/search` | GET | Flight offers KIV → destinations |
| `/api/book` | POST | Create booking |
| `/api/contact` | POST | Newsletter / leads |
| `/api/live-flights` | GET | Live ADS-B bookable airlines |

### Optional env (Vercel)

- `BOOKING_WEBHOOK_URL` — POST bookings/leads to Make/Zapier/CRM
- `CONTACT_WEBHOOK_URL` — optional separate leads webhook
- `STRIPE_SECRET_KEY` — reserved for card checkout (UI ready)

## Local

```bash
python server.py
# http://127.0.0.1:8765/
```

Requires **Node.js** on PATH for `/api/search` and `/api/book` locally.
