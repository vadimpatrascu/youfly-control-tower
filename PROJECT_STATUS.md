# YouFly Control Tower — saved project status

**Date saved:** 2026-07-23  
**Live site:** https://youfly-control-tower.vercel.app/  
**GitHub:** https://github.com/vadimpatrascu/youfly-control-tower  
**Local path:** `C:\Users\vadim\youfly-clone`

---

## What’s working

| Piece | Status |
|-------|--------|
| Control Tower UI (v2) | Live at site root |
| Sales funnel (search → pax → request) | Live (`js/sales-app.js`) |
| Duffel LIVE search | Connected (`DUFFEL_ACCESS_TOKEN` on Vercel Production) |
| KIV → RMO mapping | In `api/lib/duffel.js` (Chișinău IATA) |
| Booking hold / WhatsApp / transfer / office | `api/book.js` → agency hold + Duffel offer id |
| Live ADS-B radar | `api/live-flights.js` |
| GitHub ↔ Vercel auto-deploy | Connected on `main` |

---

## Duffel account (existing)

- Email: `vadimpatrascu@gmail.com` (Gmail confirms Welcome Mar 2026 + support Jul 2026)
- Org links from welcome email: `app.duffel.com/2c8881e04fedf251fb5f471/...`
- Token source: old Nuxt project  
  `Desktop\FOLDERS FROM DESCKTOP\03 - COD & PROIECTE\DEV\youfly\.env`  
  (`DUFFEL_API_TOKEN` / live)
- Local copy of token: `.env.local` (gitignored)
- **Duffel Payments:** discontinued (support email 17 Jul 2026) — do **not** rely on in-Duffel card pay for MD

---

## Correct sales flow (agency)

1. Client searches → **DUFFEL LIVE** prices  
2. Client submits request (WhatsApp / hold / transfer / office)  
3. You collect money outside Duffel  
4. You ticket in [Duffel Dashboard](https://app.duffel.com) (Orders)  
5. Send e-ticket to client  

Instant auto-ticket from Balance only if you fund Duffel Balance + set `DUFFEL_ALLOW_BALANCE_ORDERS=true` (not default).

---

## Key files

```
index.html / v2.html     UI
js/sales-app.js          Funnel + how-to-sell box
api/search.js            Duffel → Amadeus → synthetic
api/book.js              Duffel hold / optional balance ticket
api/lib/duffel.js        Duffel client + KIV→RMO
api/lib/amadeus.js       Legacy Amadeus (SS portal closed)
api/live-flights.js      ADS-B
api/supplier-status.js   Diagnostics
server.py                Local static + API proxy
.env.example             Env template
```

---

## Commands

```bash
# Local
cd C:\Users\vadim\youfly-clone
python server.py
# http://127.0.0.1:8765/

# Deploy
git push origin main
# or: npx vercel --prod --yes
```

---

## Optional next

- Stripe Checkout → then ticket in Duffel after pay  
- Wire `BOOKING_WEBHOOK_URL` to CRM / Make / Telegram  
- Reuse full Nuxt YouFly in `DEV\youfly` if you need seat maps / richer payments UI
