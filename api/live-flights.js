/**
 * Vercel serverless: live ADS-B for YouFly bookable airlines.
 * Primary: OpenSky Network. Fallback: adsb.lol (when OpenSky is blocked/rate-limited from cloud).
 * GET /api/live-flights?region=corridor
 */

const AIRLINE_RULES = [
  { re: /^(WZZ|W6)/i, code: "W6", name: "Wizz Air", logo: "W6" },
  { re: /^WMT/i, code: "W6", name: "Wizz Air Malta", logo: "W6" },
  { re: /^(THY|THY\d|TK\d|TKJ)/i, code: "TK", name: "Turkish Airlines / AJet", logo: "TK" },
  { re: /^(ROT|RO\d)/i, code: "RO", name: "TAROM", logo: "RO" },
  { re: /^(AUA|OS\d)/i, code: "OS", name: "Austrian", logo: "OS" },
  { re: /^(LOT|LO\d)/i, code: "LO", name: "LOT Polish", logo: "LO" },
  { re: /^(DLH|LH\d|GWI|EWG|VLG)/i, code: "LH", name: "Lufthansa Group", logo: "LH" },
  { re: /^(FIA|5F)/i, code: "5F", name: "FlyOne", logo: "5F" },
  { re: /^(HYM|H4|HSY)/i, code: "H4", name: "HiSky", logo: "H4" },
  { re: /^(FDB|FZ\d)/i, code: "FZ", name: "flydubai", logo: "FZ" },
  { re: /^(RYR|FR\d)/i, code: "FR", name: "Ryanair", logo: "FR" },
  { re: /^(PGT|PC\d)/i, code: "PC", name: "Pegasus", logo: "PC" },
  { re: /^(AEE|A3\d)/i, code: "A3", name: "Aegean", logo: "A3" },
  { re: /^(BTI|BT\d)/i, code: "BT", name: "airBaltic", logo: "BT" },
  { re: /^(TAR|TUN)/i, code: "TU", name: "Tunisair", logo: "TU" },
  { re: /^(TOM|TUI)/i, code: "BY", name: "TUI fly", logo: "X3" },
];

const REGIONS = {
  // lamin, lomin, lamax, lomax
  kiv: [45.5, 27.5, 47.5, 29.5],
  corridor: [41.0, 18.0, 52.0, 42.0],
  europe: [36.0, -10.0, 60.0, 45.0],
};

function matchAirline(callsign) {
  const cs = (callsign || "").trim();
  if (!cs) return null;
  for (const rule of AIRLINE_RULES) {
    if (rule.re.test(cs)) {
      return { code: rule.code, name: rule.name, logo: rule.logo };
    }
  }
  return null;
}

function toFlight({
  icao24,
  callsign,
  country,
  lon,
  lat,
  alt_m,
  on_ground,
  speed_ms,
  track,
  vrate,
  squawk,
  airline,
}) {
  return {
    icao24,
    callsign: (callsign || "").trim(),
    country: country || null,
    lon,
    lat,
    alt_m,
    alt_ft: alt_m != null ? Math.round(alt_m * 3.28084) : null,
    on_ground: Boolean(on_ground),
    status: on_ground ? "ground" : "airborne",
    speed_ms: speed_ms ?? null,
    speed_kmh: speed_ms != null ? Math.round(speed_ms * 3.6) : null,
    track: track ?? null,
    vrate: vrate ?? null,
    squawk: squawk ?? null,
    airline: airline.name,
    airline_code: airline.code,
    logo: airline.logo,
    bookable: true,
  };
}

async function fromOpenSky(bbox) {
  const [lamin, lomin, lamax, lomax] = bbox;
  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "YouFly-ControlTower/1.1 (vercel)" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
  const data = await res.json();
  const flights = [];
  for (const s of data.states || []) {
    if (!s || s[5] == null || s[6] == null) continue;
    const airline = matchAirline(s[1]);
    if (!airline) continue;
    const alt = s[7] != null ? s[7] : s[13];
    flights.push(
      toFlight({
        icao24: s[0],
        callsign: s[1],
        country: s[2],
        lon: Number(s[5]),
        lat: Number(s[6]),
        alt_m: alt,
        on_ground: s[8],
        speed_ms: s[9],
        track: s[10],
        vrate: s[11],
        squawk: s[14],
        airline,
      })
    );
  }
  return { flights, sky_time: data.time || null, source: "OpenSky Network ADS-B" };
}

/** adsb.lol point query — often works when OpenSky rate-limits cloud IPs */
async function fromAdsbLol(bbox) {
  const [lamin, lomin, lamax, lomax] = bbox;
  const lat = (lamin + lamax) / 2;
  const lon = (lomin + lomax) / 2;
  // rough radius km from bbox half-diagonal
  const dLat = (lamax - lamin) * 111;
  const dLon = (lomax - lomin) * 85;
  const dist = Math.min(500, Math.max(150, Math.round(Math.hypot(dLat, dLon) / 2)));

  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "YouFly-ControlTower/1.1 (vercel)" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`adsb.lol HTTP ${res.status}`);
  const data = await res.json();
  const ac = data.ac || data.aircraft || [];
  const flights = [];
  for (const a of ac) {
    const callsign = a.flight || a.callsign || a.r || "";
    const airline = matchAirline(callsign) || matchAirline(a.t || "");
    // also try hex-less matching on flight field only
    if (!airline) continue;
    const latV = a.lat ?? a.latitude;
    const lonV = a.lon ?? a.longitude ?? a.lng;
    if (latV == null || lonV == null) continue;
    if (latV < lamin || latV > lamax || lonV < lomin || lonV > lomax) continue;
    const altFt = a.alt_baro ?? a.alt_geom ?? a.alt;
    const alt_m =
      altFt != null && altFt !== "ground" ? Number(altFt) * 0.3048 : altFt === "ground" ? 0 : null;
    const gs = a.gs != null ? Number(a.gs) * 0.514444 : null; // knots → m/s
    flights.push(
      toFlight({
        icao24: a.hex || a.icao || "unknown",
        callsign,
        country: a.desc || null,
        lon: Number(lonV),
        lat: Number(latV),
        alt_m,
        on_ground: a.alt_baro === "ground" || a.ground === true,
        speed_ms: gs,
        track: a.track ?? a.true_heading ?? a.mag_heading,
        vrate: a.baro_rate ?? a.geom_rate,
        squawk: a.squawk,
        airline,
      })
    );
  }
  return {
    flights,
    sky_time: data.now ? Math.floor(Number(data.now)) : null,
    source: "adsb.lol (OpenSky fallback)",
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
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

  const region = (req.query && req.query.region) || "corridor";
  const bbox = REGIONS[region] || REGIONS.corridor;
  const now = Math.floor(Date.now() / 1000);
  const errors = [];

  let result = null;
  try {
    result = await fromOpenSky(bbox);
  } catch (e) {
    errors.push(String(e.message || e));
    try {
      result = await fromAdsbLol(bbox);
    } catch (e2) {
      errors.push(String(e2.message || e2));
    }
  }

  if (!result) {
    res.statusCode = 502;
    res.end(
      JSON.stringify({
        ok: false,
        error: errors.join(" | ") || "No ADS-B source available",
        source: null,
        region,
        fetched_at: now,
        count: 0,
        flights: [],
      })
    );
    return;
  }

  const flights = result.flights
    .sort((a, b) => Number(a.on_ground) - Number(b.on_ground) || (b.alt_m || 0) - (a.alt_m || 0))
    .slice(0, 120);

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      error: errors.length ? errors.join(" | ") : null,
      source: result.source,
      region,
      bbox: { lamin: bbox[0], lomin: bbox[1], lamax: bbox[2], lomax: bbox[3] },
      sky_time: result.sky_time || now,
      fetched_at: now,
      count: flights.length,
      airlines_filter: AIRLINE_RULES.map((r) => r.name),
      note: "Live positions for airlines typically bookable via YouFly meta-search.",
      flights,
    })
  );
};
