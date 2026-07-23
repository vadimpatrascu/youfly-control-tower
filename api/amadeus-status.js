/**
 * GET /api/amadeus-status — diagnostics (no secrets)
 */
const amadeus = require("./lib/amadeus");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  const configured = amadeus.configured();
  let tokenOk = false;
  let error = null;
  if (configured) {
    try {
      await amadeus.getAccessToken();
      tokenOk = true;
    } catch (e) {
      error = e.message || String(e);
    }
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      configured,
      tokenOk,
      host: configured ? amadeus.host() : null,
      mode: (process.env.AMADEUS_HOSTNAME || "test.api.amadeus.com").includes("test")
        ? "test"
        : "production",
      error,
      envPresent: {
        AMADEUS_CLIENT_ID: Boolean(process.env.AMADEUS_CLIENT_ID),
        AMADEUS_CLIENT_SECRET: Boolean(process.env.AMADEUS_CLIENT_SECRET),
        AMADEUS_HOSTNAME: Boolean(process.env.AMADEUS_HOSTNAME),
      },
      endpoints: {
        search: "Flight Offers Search v2",
        price: "Flight Offers Price v1",
        order: "Flight Create Orders v1",
      },
    })
  );
};
