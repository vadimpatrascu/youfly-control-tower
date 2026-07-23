/**
 * GET /api/search
 * Real inventory via Amadeus Flight Offers Search when credentials are set.
 * Falls back to synthetic YouFly inventory if Amadeus is unavailable.
 */

const amadeus = require("./lib/amadeus");
const duffel = require("./lib/duffel");

const ROUTES = {
  LTN: { city: "Londra", base: 39, dur: 210, airlines: ["5F", "W6", "TK"] },
  OTP: { city: "București", base: 35, dur: 70, airlines: ["RO", "W6", "5F"] },
  IST: { city: "Istanbul", base: 32, dur: 135, airlines: ["TK", "PC", "5F"] },
  VIE: { city: "Viena", base: 39, dur: 130, airlines: ["OS", "W6", "LO"] },
  BCN: { city: "Barcelona", base: 31, dur: 225, airlines: ["W6", "FR", "VY"] },
  BVA: { city: "Paris", base: 73, dur: 220, airlines: ["W6", "FR", "5F"] },
  BGY: { city: "Milano", base: 59, dur: 175, airlines: ["W6", "FR", "5F"] },
  TLV: { city: "Tel Aviv", base: 45, dur: 180, airlines: ["H4", "5F", "LY"] },
  AMS: { city: "Amsterdam", base: 68, dur: 200, airlines: ["W6", "KL", "LO"] },
  BER: { city: "Berlin", base: 55, dur: 165, airlines: ["W6", "FR", "LH"] },
  DXB: { city: "Dubai", base: 189, dur: 320, airlines: ["FZ", "TK", "QR"] },
  MAD: { city: "Madrid", base: 72, dur: 250, airlines: ["W6", "FR", "UX"] },
  CDG: { city: "Paris CDG", base: 85, dur: 210, airlines: ["AF", "W6", "TK"] },
  STN: { city: "Londra STN", base: 42, dur: 215, airlines: ["FR", "W6"] },
  WAW: { city: "Varșovia", base: 48, dur: 120, airlines: ["LO", "W6"] },
};

const CARRIERS = {
  W6: "Wizz Air",
  "5F": "FlyOne",
  TK: "Turkish Airlines",
  RO: "TAROM",
  OS: "Austrian",
  LO: "LOT Polish",
  FR: "Ryanair",
  PC: "Pegasus",
  H4: "HiSky",
  FZ: "flydubai",
  LH: "Lufthansa",
  KL: "KLM",
  LY: "EL AL",
  VY: "Vueling",
  QR: "Qatar Airways",
  UX: "Air Europa",
  AF: "Air France",
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function applyPromo(fare, promo, adults) {
  const code = (promo || "").toUpperCase().trim();
  let discount = 0;
  if (code === "ZBOR30") discount = Math.round(fare.total * 0.3);
  if (code === "YOUFLY10") discount = Math.round(fare.total * 0.1);
  if (code === "KIV15") discount = Math.round(fare.total * 0.15);
  if (!discount) return fare;
  const total = Math.max(19, fare.total - discount);
  return {
    ...fare,
    discount,
    promo: code,
    total,
    perAdult: Math.round(total / adults),
    display: fare.currency === "EUR" ? `€${total}` : `${total} ${fare.currency}`,
  };
}

function buildLeg(rng, from, to, dateStr, airlineCode, baseDur) {
  const depMin = 360 + Math.floor(rng() * 840);
  const jitter = Math.floor((rng() - 0.5) * 30);
  const dur = Math.max(55, baseDur + jitter);
  const arrMin = depMin + dur;
  return {
    from,
    to,
    date: dateStr,
    depart: fmtTime(depMin),
    arrive: fmtTime(arrMin % (24 * 60)),
    arriveNextDay: arrMin >= 24 * 60,
    durationMin: dur,
    duration: fmtDur(dur),
    airline: CARRIERS[airlineCode] || airlineCode,
    airlineCode,
    logo: airlineCode,
    flightNo: `${airlineCode}${100 + Math.floor(rng() * 800)}`,
    aircraft: rng() > 0.5 ? "A320neo" : "B737-800",
    stops: 0,
  };
}

function syntheticSearch({ from, to, depart, returnDate, trip, adults, cabin, promo, toCity }) {
  const route = ROUTES[to];
  if (!route) return [];
  const seed = hash(`${from}|${to}|${depart}|${returnDate || ""}|${trip}|${adults}|${cabin}`);
  const rng = mulberry32(seed);
  const n = 5 + Math.floor(rng() * 4);
  const results = [];
  for (let i = 0; i < n; i++) {
    const airlineCode = route.airlines[Math.floor(rng() * route.airlines.length)];
    const outbound = buildLeg(rng, from, to, depart, airlineCode, route.dur);
    let inbound = null;
    if (trip === "round") {
      inbound = buildLeg(
        rng,
        to,
        from,
        returnDate || depart,
        route.airlines[Math.floor(rng() * route.airlines.length)],
        route.dur
      );
    }
    let p = route.base * (0.88 + rng() * 0.45) * (1 + i * 0.08);
    if (cabin === "business") p *= 2.4;
    if (cabin === "premium") p *= 1.55;
    let total = Math.round(p) * adults;
    if (trip === "round") total = Math.round(total * (1.75 + rng() * 0.25));
    const taxes = Math.round(total * 0.18);
    let fare = {
      currency: "EUR",
      base: total - taxes,
      taxes,
      discount: 0,
      promo: null,
      total,
      perAdult: Math.round(total / adults),
      display: `€${total}`,
    };
    fare = applyPromo(fare, promo, adults);
    results.push({
      id: `YF${seed.toString(36).toUpperCase()}${i}`,
      source: "youfly_synthetic",
      trip,
      cabin,
      adults,
      from,
      to,
      toCity: toCity || route.city,
      outbound,
      inbound,
      fare,
      baggage: {
        cabin: "1×8 kg",
        checked: fare.total > 80 ? "1×23 kg inclus" : "opțional +€25",
      },
      refundable: fare.total > 100,
      seatsLeft: 2 + Math.floor(rng() * 7),
      score: Math.round(100 - i * 7),
    });
  }
  return results.sort((a, b) => a.fare.total - b.fare.total);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  const q = req.query || {};
  const from = String(q.from || "KIV").toUpperCase();
  const to = String(q.to || "").toUpperCase();
  const trip = q.trip === "one" ? "one" : "round";
  const adults = Math.min(9, Math.max(1, parseInt(q.adults || "1", 10) || 1));
  const cabin = ["economy", "premium", "business"].includes(q.cabin) ? q.cabin : "economy";
  const promo = q.promo || "";
  const depart = parseDate(q.depart);
  const ret = parseDate(q.return);
  const toCity = ROUTES[to]?.city || to;

  if (from !== "KIV" && from.length !== 3) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Cod aeroport plecare invalid." }));
    return;
  }
  if (!to || to.length !== 3) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Destinație invalidă (IATA 3 litere)." }));
    return;
  }
  if (!depart) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Data plecării este invalidă (YYYY-MM-DD)." }));
    return;
  }
  if (trip === "round" && ret && ret < depart) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Data întoarcerii trebuie să fie după plecare." }));
    return;
  }

  const queryMeta = {
    from,
    to,
    toCity,
    depart: q.depart,
    return: trip === "round" ? q.return || null : null,
    trip,
    adults,
    cabin,
    promo: promo || null,
  };

  let results = [];
  let source = "youfly_synthetic";
  let duffelError = null;
  let amadeusError = null;
  let amadeusHost = null;
  let duffelMeta = {};

  // 1) Duffel (free test mode) preferred — Amadeus SS portal is decommissioned
  if (duffel.configured()) {
    try {
      const found = await duffel.searchOffers({
        from,
        to,
        depart: q.depart,
        returnDate: trip === "round" ? q.return || undefined : undefined,
        adults,
        cabin,
        toCity,
      });
      results = found.offers.map((o) => ({
        ...o,
        fare: applyPromo(o.fare, promo, adults),
        toCity,
        duffelPassengerIds: found.passengerIds,
        duffelOfferRequestId: found.offerRequestId,
      }));
      source = "duffel";
      duffelMeta = {
        offerRequestId: found.offerRequestId,
        liveMode: found.liveMode,
        testToken: duffel.isTestToken(),
      };
    } catch (e) {
      duffelError = e.message || String(e);
    }
  }

  // 2) Amadeus (only if still have enterprise/old keys)
  if (!results.length && amadeus.configured()) {
    try {
      amadeusHost = amadeus.host();
      const { offers } = await amadeus.searchFlightOffers({
        from,
        to,
        depart: q.depart,
        returnDate: trip === "round" ? q.return || undefined : undefined,
        adults,
        cabin,
        currency: "EUR",
        max: 20,
        toCity,
      });
      results = offers.map((o) => ({
        ...o,
        fare: applyPromo(o.fare, promo, adults),
        toCity,
      }));
      source = "amadeus";
    } catch (e) {
      amadeusError = e.message || String(e);
    }
  }

  // 3) Synthetic agency inventory (always available)
  if (!results.length) {
    results = syntheticSearch({
      from,
      to,
      depart: q.depart,
      returnDate: q.return,
      trip,
      adults,
      cabin,
      promo,
      toCity,
    });
    source =
      duffel.configured() || amadeus.configured()
        ? "youfly_synthetic_fallback"
        : "youfly_synthetic";
  }

  const note =
    source === "duffel"
      ? duffel.isTestToken()
        ? "Duffel TEST mode (free sandbox — Duffel Airways). Set live token for real airlines."
        : "Duffel LIVE airline inventory."
      : source === "amadeus"
        ? "Amadeus inventory."
        : duffelError
          ? `Duffel error → agency fallback: ${duffelError}`
          : "Set DUFFEL_ACCESS_TOKEN (free test token from app.duffel.com) for supplier offers.";

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      query: queryMeta,
      count: results.length,
      currency: "EUR",
      results,
      meta: {
        source,
        duffelConfigured: duffel.configured(),
        duffelTestMode: duffel.configured() ? duffel.isTestToken() : null,
        duffelError,
        duffelMeta,
        amadeusConfigured: amadeus.configured(),
        amadeusHost: amadeus.configured() ? amadeusHost : null,
        amadeusError,
        generatedAt: new Date().toISOString(),
        note,
      },
    })
  );
};
