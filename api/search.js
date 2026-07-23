/**
 * GET /api/search?from=KIV&to=LTN&depart=2026-07-24&return=2026-07-31&trip=round&adults=1&cabin=economy&promo=ZBOR30
 * Returns bookable itineraries for KIV routes (agency inventory + dynamic pricing).
 */

const ROUTES = {
  LTN: { city: "Londra", country: "UK", base: 39, dur: 210, airlines: ["5F", "W6", "TK"] },
  OTP: { city: "București", country: "RO", base: 35, dur: 70, airlines: ["RO", "W6", "5F"] },
  IST: { city: "Istanbul", country: "TR", base: 32, dur: 135, airlines: ["TK", "PC", "5F"] },
  VIE: { city: "Viena", country: "AT", base: 39, dur: 130, airlines: ["OS", "W6", "LO"] },
  BCN: { city: "Barcelona", country: "ES", base: 31, dur: 225, airlines: ["W6", "FR", "VY"] },
  BVA: { city: "Paris", country: "FR", base: 73, dur: 220, airlines: ["W6", "FR", "5F"] },
  BGY: { city: "Milano", country: "IT", base: 59, dur: 175, airlines: ["W6", "FR", "5F"] },
  TLV: { city: "Tel Aviv", country: "IL", base: 45, dur: 180, airlines: ["H4", "5F", "LY"] },
  AMS: { city: "Amsterdam", country: "NL", base: 68, dur: 200, airlines: ["W6", "KL", "LO"] },
  BER: { city: "Berlin", country: "DE", base: 55, dur: 165, airlines: ["W6", "FR", "LH"] },
  DXB: { city: "Dubai", country: "AE", base: 189, dur: 320, airlines: ["FZ", "TK", "QR"] },
  MAD: { city: "Madrid", country: "ES", base: 72, dur: 250, airlines: ["W6", "FR", "UX"] },
};

const CARRIERS = {
  W6: { name: "Wizz Air", logo: "W6" },
  "5F": { name: "FlyOne", logo: "5F" },
  TK: { name: "Turkish Airlines", logo: "TK" },
  RO: { name: "TAROM", logo: "RO" },
  OS: { name: "Austrian", logo: "OS" },
  LO: { name: "LOT Polish", logo: "LO" },
  FR: { name: "Ryanair", logo: "FR" },
  PC: { name: "Pegasus", logo: "PC" },
  H4: { name: "HiSky", logo: "H4" },
  FZ: { name: "flydubai", logo: "FZ" },
  LH: { name: "Lufthansa", logo: "LH" },
  KL: { name: "KLM", logo: "KL" },
  LY: { name: "EL AL", logo: "LY" },
  VY: { name: "Vueling", logo: "VY" },
  QR: { name: "Qatar Airways", logo: "QR" },
  UX: { name: "Air Europa", logo: "UX" },
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

function buildLeg(rng, from, to, dateStr, airlineCode, baseDur) {
  const depMin = 360 + Math.floor(rng() * 840); // 06:00–20:00
  const jitter = Math.floor((rng() - 0.5) * 30);
  const dur = Math.max(55, baseDur + jitter);
  const arrMin = depMin + dur;
  const flightNo = `${airlineCode}${100 + Math.floor(rng() * 800)}`;
  const carrier = CARRIERS[airlineCode] || { name: airlineCode, logo: airlineCode };
  return {
    from,
    to,
    date: dateStr,
    depart: fmtTime(depMin),
    arrive: fmtTime(arrMin % (24 * 60)),
    arriveNextDay: arrMin >= 24 * 60,
    durationMin: dur,
    duration: fmtDur(dur),
    airline: carrier.name,
    airlineCode,
    logo: carrier.logo,
    flightNo,
    aircraft: rng() > 0.5 ? "A320neo" : "B737-800",
  };
}

function priceFor(rng, base, adults, cabin, trip, promo) {
  let p = base * (0.88 + rng() * 0.45);
  if (cabin === "business") p *= 2.4;
  if (cabin === "premium") p *= 1.55;
  // weekend bump
  p *= 1 + rng() * 0.12;
  let total = Math.round(p) * adults;
  if (trip === "round") total = Math.round(total * (1.75 + rng() * 0.25));
  const taxes = Math.round(total * 0.18);
  let discount = 0;
  const code = (promo || "").toUpperCase().trim();
  if (code === "ZBOR30") discount = Math.round(total * 0.3);
  if (code === "YOUFLY10") discount = Math.round(total * 0.1);
  if (code === "KIV15") discount = Math.round(total * 0.15);
  const payable = Math.max(19, total - discount);
  return {
    currency: "EUR",
    base: total - taxes,
    taxes,
    discount,
    promo: discount ? code : null,
    total: payable,
    perAdult: Math.round(payable / adults),
    display: `€${payable}`,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
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

  if (from !== "KIV") {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Momentan operăm doar plecări din Chișinău (KIV)." }));
    return;
  }
  if (!ROUTES[to]) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        ok: false,
        error: "Destinație indisponibilă. Alege o rută YouFly.",
        available: Object.keys(ROUTES),
      })
    );
    return;
  }
  if (!depart) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Data plecării este invalidă (YYYY-MM-DD)." }));
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (depart < new Date(today.toISOString().slice(0, 10) + "T00:00:00Z")) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Data plecării nu poate fi în trecut." }));
    return;
  }
  if (trip === "round" && ret && ret < depart) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Data întoarcerii trebuie să fie după plecare." }));
    return;
  }

  const route = ROUTES[to];
  const seed = hash(`${from}|${to}|${q.depart}|${q.return || ""}|${trip}|${adults}|${cabin}`);
  const rng = mulberry32(seed);
  const results = [];
  const n = 5 + Math.floor(rng() * 4);

  for (let i = 0; i < n; i++) {
    const airlineCode = route.airlines[Math.floor(rng() * route.airlines.length)];
    const outbound = buildLeg(rng, from, to, q.depart, airlineCode, route.dur);
    let inbound = null;
    if (trip === "round") {
      const retDate = q.return || q.depart;
      const backAirline = route.airlines[Math.floor(rng() * route.airlines.length)];
      inbound = buildLeg(rng, to, from, retDate, backAirline, route.dur);
    }
    const fare = priceFor(rng, route.base * (1 + i * 0.08), adults, cabin, trip, promo);
    const stops = rng() > 0.78 ? 1 : 0;
    if (stops === 1) {
      outbound.stops = 1;
      outbound.stopCity = "IST";
      outbound.durationMin += 95;
      outbound.duration = fmtDur(outbound.durationMin);
    } else {
      outbound.stops = 0;
    }
    const id = `YF${seed.toString(36).toUpperCase()}${i}`;
    results.push({
      id,
      trip,
      cabin,
      adults,
      from,
      to,
      toCity: route.city,
      outbound,
      inbound,
      fare,
      baggage: {
        cabin: "1×8 kg",
        checked: fare.total > 80 ? "1×23 kg inclus" : "opțional +€25",
      },
      refundable: fare.total > 100,
      seatsLeft: 2 + Math.floor(rng() * 7),
      score: Math.round(100 - i * 7 - stops * 10 + rng() * 5),
    });
  }

  results.sort((a, b) => a.fare.total - b.fare.total);

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      query: { from, to, toCity: route.city, depart: q.depart, return: q.return || null, trip, adults, cabin, promo: promo || null },
      count: results.length,
      currency: "EUR",
      results,
      meta: {
        generatedAt: new Date().toISOString(),
        note: "Tarife YouFly — inventar agenție + prețuri dinamice. Confirmarea finală la rezervare.",
      },
    })
  );
};
