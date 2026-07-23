/**
 * Amadeus Self-Service client (test + production).
 * Env:
 *   AMADEUS_CLIENT_ID
 *   AMADEUS_CLIENT_SECRET
 *   AMADEUS_HOSTNAME  (optional) test.api.amadeus.com | api.amadeus.com
 */

const DEFAULT_HOST = "test.api.amadeus.com";

let tokenCache = { accessToken: null, expiresAt: 0 };

function host() {
  return (process.env.AMADEUS_HOSTNAME || DEFAULT_HOST).replace(/^https?:\/\//, "");
}

function configured() {
  return Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
}

async function getAccessToken() {
  if (!configured()) {
    throw new Error("Amadeus not configured (AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET)");
  }
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.AMADEUS_CLIENT_ID,
    client_secret: process.env.AMADEUS_CLIENT_SECRET,
  });

  const res = await fetch(`https://${host()}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || data.title || `Amadeus auth HTTP ${res.status}`
    );
  }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 1799) * 1000,
  };
  return tokenCache.accessToken;
}

async function amadeusFetch(path, { method = "GET", query, body } = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://${host()}${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/vnd.amadeus+json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data.errors?.[0]?.detail ||
      data.errors?.[0]?.title ||
      data.error_description ||
      data.title ||
      `Amadeus HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function parseDuration(iso) {
  // PT2H15M / PT45M
  if (!iso || typeof iso !== "string") return { min: 0, label: "—" };
  const h = /(\d+)H/.exec(iso);
  const m = /(\d+)M/.exec(iso);
  const hours = h ? parseInt(h[1], 10) : 0;
  const mins = m ? parseInt(m[1], 10) : 0;
  return { min: hours * 60 + mins, label: `${hours}h ${String(mins).padStart(2, "0")}m` };
}

function mapSegmentLeg(itinerary) {
  const segs = itinerary.segments || [];
  const first = segs[0];
  const last = segs[segs.length - 1];
  const dur = parseDuration(itinerary.duration);
  const dep = first.departure;
  const arr = last.arrival;
  const carrier = first.carrierCode;
  const flightNo = `${carrier}${first.number}`;
  const stops = Math.max(0, segs.length - 1);
  return {
    from: dep.iataCode,
    to: arr.iataCode,
    date: (dep.at || "").slice(0, 10),
    depart: (dep.at || "").slice(11, 16),
    arrive: (arr.at || "").slice(11, 16),
    arriveNextDay: (dep.at || "").slice(0, 10) !== (arr.at || "").slice(0, 10),
    durationMin: dur.min,
    duration: dur.label,
    airline: carrier,
    airlineCode: carrier,
    logo: carrier,
    flightNo,
    aircraft: first.aircraft?.code || "",
    stops,
    stopCity: stops ? segs[0].arrival?.iataCode : null,
    segments: segs.map((s) => ({
      from: s.departure.iataCode,
      to: s.arrival.iataCode,
      depart: s.departure.at,
      arrive: s.arrival.at,
      flightNo: `${s.carrierCode}${s.number}`,
      carrier: s.carrierCode,
    })),
  };
}

function mapOffer(offer, query, dictionaries = {}) {
  const carriers = dictionaries.carriers || {};
  const itineraries = offer.itineraries || [];
  const outbound = mapSegmentLeg(itineraries[0]);
  if (carriers[outbound.airlineCode]) {
    outbound.airline = carriers[outbound.airlineCode];
  }
  let inbound = null;
  if (itineraries[1]) {
    inbound = mapSegmentLeg(itineraries[1]);
    if (carriers[inbound.airlineCode]) inbound.airline = carriers[inbound.airlineCode];
  }

  const total = parseFloat(offer.price?.grandTotal || offer.price?.total || "0");
  const currency = offer.price?.currency || "EUR";
  const adults = Number(query.adults) || 1;
  const travelerPricings = offer.travelerPricings || [];
  const taxes = travelerPricings.reduce((sum, tp) => {
    const t = (tp.price?.taxes || []).reduce((a, x) => a + parseFloat(x.amount || 0), 0);
    return sum + t;
  }, 0);

  return {
    id: `AMD-${offer.id}`,
    source: "amadeus",
    amadeusOffer: offer,
    trip: inbound ? "round" : "one",
    cabin: (query.cabin || "economy").toLowerCase(),
    adults,
    from: query.from,
    to: query.to,
    toCity: query.toCity || query.to,
    outbound,
    inbound,
    fare: {
      currency,
      base: Math.max(0, Math.round(total - taxes)),
      taxes: Math.round(taxes) || Math.round(total * 0.15),
      discount: 0,
      promo: null,
      total: Math.round(total),
      perAdult: Math.round(total / adults),
      display: currency === "EUR" ? `€${Math.round(total)}` : `${Math.round(total)} ${currency}`,
    },
    baggage: {
      cabin: "conform companiei",
      checked: offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.includedCheckedBags
        ? "bagaj inclus (vezi ofertă)"
        : "verifică la rezervare",
    },
    refundable: Boolean(
      offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.amenities?.some(
        (a) => /refund/i.test(a.description || "") && a.isChargeable === false
      )
    ),
    seatsLeft: offer.numberOfBookableSeats || null,
    score: 100,
    validatingAirlineCodes: offer.validatingAirlineCodes || [],
  };
}

function cabinToAmadeus(cabin) {
  const map = {
    economy: "ECONOMY",
    premium: "PREMIUM_ECONOMY",
    business: "BUSINESS",
    first: "FIRST",
  };
  return map[(cabin || "economy").toLowerCase()] || "ECONOMY";
}

async function searchFlightOffers(params) {
  const {
    from = "KIV",
    to,
    depart,
    returnDate,
    adults = 1,
    cabin = "economy",
    currency = "EUR",
    max = 15,
  } = params;

  const query = {
    originLocationCode: from,
    destinationLocationCode: to,
    departureDate: depart,
    adults: String(adults),
    currencyCode: currency,
    max: String(max),
    nonStop: "false",
  };
  if (returnDate) query.returnDate = returnDate;
  if (cabin) query.travelClass = cabinToAmadeus(cabin);

  const data = await amadeusFetch("/v2/shopping/flight-offers", { query });
  const dictionaries = data.dictionaries || {};
  const offers = (data.data || []).map((o) =>
    mapOffer(
      o,
      {
        from,
        to,
        toCity: params.toCity,
        adults,
        cabin,
      },
      dictionaries
    )
  );
  return {
    offers,
    dictionaries,
    meta: data.meta || {},
    rawCount: (data.data || []).length,
  };
}

async function priceOffer(amadeusOffer) {
  const data = await amadeusFetch("/v1/shopping/flight-offers/pricing", {
    method: "POST",
    body: {
      data: {
        type: "flight-offers-pricing",
        flightOffers: [amadeusOffer],
      },
    },
  });
  return data.data?.flightOffers?.[0] || null;
}

async function createFlightOrder({ pricedOffer, travelers, contacts }) {
  const data = await amadeusFetch("/v1/booking/flight-orders", {
    method: "POST",
    body: {
      data: {
        type: "flight-order",
        flightOffers: [pricedOffer],
        travelers,
        remarks: {
          general: [
            {
              subType: "GENERAL_MISCELLANEOUS",
              text: "YouFly Control Tower booking",
            },
          ],
        },
        ticketingAgreement: {
          option: "DELAY_TO_CANCEL",
          delay: "6D",
        },
        contacts: contacts || undefined,
      },
    },
  });
  return data.data;
}

function buildTravelers(passengers, contact) {
  return passengers.map((p, i) => {
    const id = String(i + 1);
    const gender = (p.gender || "MALE").toUpperCase() === "FEMALE" ? "FEMALE" : "MALE";
    const traveler = {
      id,
      dateOfBirth: p.birthDate,
      name: {
        firstName: String(p.firstName || "").toUpperCase(),
        lastName: String(p.lastName || "").toUpperCase(),
      },
      gender,
      contact: {
        emailAddress: contact.email,
        phones: [
          {
            deviceType: "MOBILE",
            countryCallingCode: phoneCountryCode(contact.phone),
            number: phoneNational(contact.phone),
          },
        ],
      },
    };
    if (p.document) {
      traveler.documents = [
        {
          documentType: "PASSPORT",
          birthPlace: p.birthPlace || "UNKNOWN",
          issuanceLocation: p.issuanceCountry || "MD",
          issuanceDate: p.issuanceDate || "2018-01-01",
          number: String(p.document).replace(/\s+/g, ""),
          expiryDate: p.documentExpiry || "2030-12-31",
          issuanceCountry: p.issuanceCountry || "MD",
          validityCountry: p.issuanceCountry || "MD",
          nationality: p.nationality || p.issuanceCountry || "MD",
          holder: true,
        },
      ];
    }
    return traveler;
  });
}

function phoneCountryCode(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("373")) return "373";
  if (d.startsWith("40")) return "40";
  if (d.startsWith("1") && d.length === 11) return "1";
  return d.slice(0, 3) || "373";
}

function phoneNational(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  const cc = phoneCountryCode(phone);
  return d.startsWith(cc) ? d.slice(cc.length) : d;
}

module.exports = {
  configured,
  host,
  getAccessToken,
  amadeusFetch,
  searchFlightOffers,
  priceOffer,
  createFlightOrder,
  buildTravelers,
  mapOffer,
};
