/**
 * Vercel serverless: live ADS-B for YouFly bookable airlines (OpenSky Network).
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

async function fetchOpenSky(lamin, lomin, lamax, lomax) {
  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "YouFly-ControlTower/1.0 (vercel; flight meta-search demo)",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenSky HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const region = (req.query && req.query.region) || "corridor";
  const bbox = REGIONS[region] || REGIONS.corridor;
  const now = Math.floor(Date.now() / 1000);

  try {
    const data = await fetchOpenSky(...bbox);
    const states = data.states || [];
    const flights = [];

    for (const s of states) {
      if (!s || s[5] == null || s[6] == null) continue;
      const callsign = (s[1] || "").trim();
      const airline = matchAirline(callsign);
      if (!airline) continue;

      const alt = s[7] != null ? s[7] : s[13];
      flights.push({
        icao24: s[0],
        callsign,
        country: s[2],
        lon: Number(s[5]),
        lat: Number(s[6]),
        alt_m: alt,
        alt_ft: alt != null ? Math.round(alt * 3.28084) : null,
        on_ground: Boolean(s[8]),
        status: s[8] ? "ground" : "airborne",
        speed_ms: s[9],
        speed_kmh: s[9] != null ? Math.round(s[9] * 3.6) : null,
        track: s[10],
        vrate: s[11],
        squawk: s[14],
        airline: airline.name,
        airline_code: airline.code,
        logo: airline.logo,
        bookable: true,
      });
    }

    flights.sort((a, b) => Number(a.on_ground) - Number(b.on_ground) || (b.alt_m || 0) - (a.alt_m || 0));

    res.status(200).json({
      ok: true,
      error: null,
      source: "OpenSky Network ADS-B",
      region,
      bbox: { lamin: bbox[0], lomin: bbox[1], lamax: bbox[2], lomax: bbox[3] },
      sky_time: data.time || now,
      fetched_at: now,
      count: flights.length,
      airlines_filter: AIRLINE_RULES.map((r) => r.name),
      note:
        "Live positions for airlines typically bookable via YouFly meta-search. ADS-B shows real ops.",
      flights: flights.slice(0, 120),
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
      source: "OpenSky Network ADS-B",
      region,
      fetched_at: now,
      count: 0,
      flights: [],
    });
  }
};
