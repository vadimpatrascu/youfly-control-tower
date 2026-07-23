/**
 * Duffel Flights API (free test mode with duffel_test_… token)
 * Docs: https://duffel.com/docs
 *
 * Env:
 *   DUFFEL_ACCESS_TOKEN  (duffel_test_… sandbox | duffel_live_… production)
 *   DUFFEL_VERSION       optional, default v2
 */

const API = "https://api.duffel.com";

function configured() {
  return Boolean(process.env.DUFFEL_ACCESS_TOKEN);
}

function isTestToken() {
  const t = process.env.DUFFEL_ACCESS_TOKEN || "";
  return t.startsWith("duffel_test_");
}

async function duffelFetch(path, { method = "GET", body, query } = {}) {
  if (!configured()) throw new Error("DUFFEL_ACCESS_TOKEN not set");
  const url = new URL(API + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`,
      "Duffel-Version": process.env.DUFFEL_VERSION || "v2",
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.errors?.[0]?.message ||
      data.errors?.[0]?.title ||
      data.message ||
      `Duffel HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function cabinClass(cabin) {
  const map = {
    economy: "economy",
    premium: "premium_economy",
    business: "business",
    first: "first",
  };
  return map[(cabin || "economy").toLowerCase()] || "economy";
}

function mapSlice(slice) {
  const segs = slice.segments || [];
  const first = segs[0];
  const last = segs[segs.length - 1];
  const dep = first?.departing_at || "";
  const arr = last?.arriving_at || "";
  const carrier = first?.marketing_carrier || first?.operating_carrier || {};
  const code = carrier.iata_code || "XX";
  const name = carrier.name || code;
  const durMin = Math.round((slice.duration ? parseIsoDuration(slice.duration) : 0) / 60);
  const h = Math.floor(durMin / 60);
  const m = durMin % 60;
  return {
    from: first?.origin?.iata_code || slice.origin?.iata_code,
    to: last?.destination?.iata_code || slice.destination?.iata_code,
    date: dep.slice(0, 10),
    depart: dep.slice(11, 16),
    arrive: arr.slice(11, 16),
    arriveNextDay: dep.slice(0, 10) !== arr.slice(0, 10),
    durationMin: durMin,
    duration: `${h}h ${String(m).padStart(2, "0")}m`,
    airline: name,
    airlineCode: code,
    logo: code,
    flightNo: `${code}${first?.marketing_carrier_flight_number || first?.operating_carrier_flight_number || ""}`,
    aircraft: first?.aircraft?.name || first?.aircraft?.iata_code || "",
    stops: Math.max(0, segs.length - 1),
    segments: segs.map((s) => ({
      from: s.origin?.iata_code,
      to: s.destination?.iata_code,
      depart: s.departing_at,
      arrive: s.arriving_at,
      flightNo: `${s.marketing_carrier?.iata_code || ""}${s.marketing_carrier_flight_number || ""}`,
      carrier: s.operating_carrier?.name || s.marketing_carrier?.name,
    })),
  };
}

function parseIsoDuration(iso) {
  // PT2H15M → seconds
  if (!iso) return 0;
  const h = /(\d+)H/.exec(iso);
  const m = /(\d+)M/.exec(iso);
  const s = /(\d+)S/.exec(iso);
  return (
    (h ? parseInt(h[1], 10) * 3600 : 0) +
    (m ? parseInt(m[1], 10) * 60 : 0) +
    (s ? parseInt(s[1], 10) : 0)
  );
}

function mapOffer(offer, query) {
  const slices = offer.slices || [];
  const outbound = mapSlice(slices[0] || {});
  const inbound = slices[1] ? mapSlice(slices[1]) : null;
  const amount = parseFloat(offer.total_amount || "0");
  const currency = offer.total_currency || "EUR";
  const adults = Number(query.adults) || 1;
  const owner = offer.owner || {};

  return {
    id: `DFL-${offer.id}`,
    source: "duffel",
    duffelOfferId: offer.id,
    duffelOffer: offer,
    trip: inbound ? "round" : "one",
    cabin: (query.cabin || "economy").toLowerCase(),
    adults,
    from: query.from,
    to: query.to,
    toCity: query.toCity || query.to,
    outbound: {
      ...outbound,
      airline: owner.name || outbound.airline,
      airlineCode: owner.iata_code || outbound.airlineCode,
      logo: owner.iata_code || outbound.logo,
    },
    inbound,
    fare: {
      currency,
      base: Math.round(amount * 0.85),
      taxes: Math.round(amount * 0.15),
      discount: 0,
      promo: null,
      total: Math.round(amount),
      perAdult: Math.round(amount / adults),
      display: currency === "EUR" ? `€${Math.round(amount)}` : `${Math.round(amount)} ${currency}`,
      rawAmount: offer.total_amount,
      rawCurrency: offer.total_currency,
    },
    baggage: {
      cabin: "conform ofertei Duffel",
      checked: offer.conditions?.refund_before_departure
        ? "condiții în ofertă"
        : "verifică la rezervare",
    },
    refundable: Boolean(offer.conditions?.refund_before_departure?.allowed),
    seatsLeft: offer.available_services ? null : offer.total_emissions_kg ? null : null,
    score: 100,
    expiresAt: offer.expires_at,
    liveMode: offer.live_mode,
  };
}

/** Chișinău: UI uses KIV historically; IATA/Duffel use RMO */
function normalizeIata(code) {
  const c = String(code || "").toUpperCase();
  if (c === "KIV") return "RMO";
  return c;
}

async function searchOffers({
  from,
  to,
  depart,
  returnDate,
  adults = 1,
  cabin = "economy",
  toCity,
}) {
  const origin = normalizeIata(from);
  const dest = normalizeIata(to);
  const passengers = Array.from({ length: adults }, () => ({ type: "adult" }));
  const slices = [
    {
      origin,
      destination: dest,
      departure_date: depart,
    },
  ];
  if (returnDate) {
    slices.push({
      origin: dest,
      destination: origin,
      departure_date: returnDate,
    });
  }

  const data = await duffelFetch("/air/offer_requests?return_offers=true", {
    method: "POST",
    body: {
      data: {
        slices,
        passengers,
        cabin_class: cabinClass(cabin),
        max_connections: 1,
      },
    },
  });

  const offers = (data.data?.offers || []).map((o) => {
    const mapped = mapOffer(o, { from: origin, to: dest, toCity, adults, cabin });
    // Keep UI branding as KIV when user searched KIV
    if (String(from).toUpperCase() === "KIV") {
      mapped.from = "KIV";
      if (mapped.outbound) mapped.outbound.from = mapped.outbound.from === "RMO" ? "KIV" : mapped.outbound.from;
      if (mapped.inbound) mapped.inbound.to = mapped.inbound.to === "RMO" ? "KIV" : mapped.inbound.to;
    }
    return mapped;
  });
  // cheapest first
  offers.sort((a, b) => a.fare.total - b.fare.total);

  return {
    offers: offers.slice(0, 20),
    offerRequestId: data.data?.id,
    liveMode: data.data?.live_mode,
    passengerIds: (data.data?.passengers || []).map((p) => p.id),
  };
}

/**
 * Create order in test mode with balance payment.
 * passengers: [{ id from offer request, given_name, family_name, born_on, gender, email, phone_number, title }]
 */
async function createOrder({ offerId, passengers, paymentAmount, paymentCurrency }) {
  // Refresh offer first (recommended)
  const offerRes = await duffelFetch(`/air/offers/${offerId}`);
  const offer = offerRes.data;
  const amount = paymentAmount || offer.total_amount;
  const currency = paymentCurrency || offer.total_currency;

  const body = {
    data: {
      type: "instant",
      selected_offers: [offerId],
      passengers,
      payments: [
        {
          type: "balance",
          currency,
          amount,
        },
      ],
    },
  };

  const orderRes = await duffelFetch("/air/orders", {
    method: "POST",
    body,
  });
  return orderRes.data;
}

function buildPassengersForOrder(offerPassengerIds, formPassengers, contact) {
  // Match form pax to offer request passenger IDs
  return formPassengers.map((p, i) => {
    const id = offerPassengerIds[i] || offerPassengerIds[0];
    const phone = String(contact.phone || "").replace(/\s+/g, "");
    return {
      id,
      given_name: String(p.firstName || "").trim(),
      family_name: String(p.lastName || "").trim(),
      born_on: p.birthDate,
      gender: (p.gender || "m").toLowerCase().startsWith("f") ? "f" : "m",
      title: (p.gender || "MALE").toUpperCase() === "FEMALE" ? "ms" : "mr",
      email: contact.email,
      phone_number: phone.startsWith("+") ? phone : `+${phone}`,
    };
  });
}

module.exports = {
  configured,
  isTestToken,
  duffelFetch,
  searchOffers,
  createOrder,
  buildPassengersForOrder,
  mapOffer,
};
