/**
 * GET /api/supplier-status — which free/live suppliers are connected
 */
const duffel = require("./lib/duffel");
const amadeus = require("./lib/amadeus");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  let duffelTokenOk = false;
  let duffelError = null;
  if (duffel.configured()) {
    try {
      // lightweight call — list nothing sensitive
      await duffel.duffelFetch("/air/offer_requests?limit=1");
      duffelTokenOk = true;
    } catch (e) {
      // 404/empty list still means auth worked for some endpoints; try places
      try {
        await duffel.duffelFetch("/places/suggestions?query=KIV");
        duffelTokenOk = true;
      } catch (e2) {
        duffelError = e2.message || e.message || String(e2);
      }
    }
  }

  let amadeusTokenOk = false;
  let amadeusError = null;
  if (amadeus.configured()) {
    try {
      await amadeus.getAccessToken();
      amadeusTokenOk = true;
    } catch (e) {
      amadeusError = e.message || String(e);
    }
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      recommended: "duffel",
      notice:
        "Amadeus Self-Service free portal was decommissioned 2026-07-17. Use Duffel free test mode (duffel_test_ token) instead.",
      suppliers: {
        duffel: {
          configured: duffel.configured(),
          tokenOk: duffelTokenOk,
          testMode: duffel.configured() ? duffel.isTestToken() : null,
          error: duffelError,
          signup: "https://app.duffel.com/join",
          tokenUrl: "https://app.duffel.com/tokens",
          env: "DUFFEL_ACCESS_TOKEN",
          free: "Test mode free forever; live orders are pay-per-booking",
        },
        amadeus: {
          configured: amadeus.configured(),
          tokenOk: amadeusTokenOk,
          error: amadeusError,
          freeSelfService: false,
          note: "Enterprise only after July 2026",
        },
        agencyFallback: {
          configured: true,
          note: "Synthetic YouFly inventory always available",
        },
      },
    })
  );
};
