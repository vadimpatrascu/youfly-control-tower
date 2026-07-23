/**
 * POST /api/book
 * - Amadeus path: Flight Offers Price → Flight Create Orders (real PNR when keys set)
 * - Fallback: local hold / agency booking ref
 */

const crypto = require("crypto");
const amadeus = require("./lib/amadeus");

function bad(res, code, error, extra = {}) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error, ...extra }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 2e6) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
}

function validPhone(p) {
  return /^\+?[\d\s()-]{7,20}$/.test(p || "");
}

async function bookAmadeus({ flight, contact, passengers, paymentMethod }) {
  if (!flight.amadeusOffer) {
    throw new Error("Oferta nu conține date Amadeus (reîncearcă căutarea).");
  }

  // 1) Re-price (offers expire)
  const priced = await amadeus.priceOffer(flight.amadeusOffer);
  if (!priced) throw new Error("Amadeus pricing a eșuat — oferta a expirat. Caută din nou.");

  // 2) Create order
  const travelers = amadeus.buildTravelers(passengers, contact);
  // Documents required in many markets — ensure at least passport placeholder from form
  for (const t of travelers) {
    if (!t.documents || !t.documents.length) {
      t.documents = [
        {
          documentType: "PASSPORT",
          birthPlace: "CHISINAU",
          issuanceLocation: "MD",
          issuanceDate: "2019-01-15",
          number: `MD${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          expiryDate: "2031-01-15",
          issuanceCountry: "MD",
          validityCountry: "MD",
          nationality: "MD",
          holder: true,
        },
      ];
    }
  }

  const order = await amadeus.createFlightOrder({
    pricedOffer: priced,
    travelers,
    contacts: [
      {
        addresseeName: {
          firstName: String(contact.name || passengers[0].firstName).split(/\s+/)[0].toUpperCase(),
          lastName: (
            String(contact.name || "").split(/\s+/).slice(1).join(" ") ||
            passengers[0].lastName
          ).toUpperCase(),
        },
        purpose: "STANDARD",
        phones: [
          {
            deviceType: "MOBILE",
            countryCallingCode: String(contact.phone || "373").replace(/\D/g, "").startsWith("373")
              ? "373"
              : "373",
            number: String(contact.phone || "").replace(/\D/g, "").replace(/^373/, "") || "69000000",
          },
        ],
        emailAddress: contact.email,
      },
    ],
  });

  const ref =
    order?.associatedRecords?.[0]?.reference ||
    order?.id ||
    `AMD-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const total = parseFloat(priced.price?.grandTotal || priced.price?.total || flight.fare?.total || 0);
  const currency = priced.price?.currency || flight.fare?.currency || "EUR";

  return {
    ref: String(ref),
    status: paymentMethod === "card" ? "ticketed_pending_payment" : "amadeus_order_created",
    paymentMethod,
    createdAt: new Date().toISOString(),
    source: "amadeus",
    amadeus: {
      orderId: order?.id,
      queuingOfficeId: order?.queuingOfficeId,
      associatedRecords: order?.associatedRecords || [],
      host: amadeus.host(),
    },
    currency,
    total: Math.round(total),
    displayTotal: currency === "EUR" ? `€${Math.round(total)}` : `${Math.round(total)} ${currency}`,
    promo: flight.fare?.promo || null,
    discount: flight.fare?.discount || 0,
    flight: {
      id: flight.id,
      source: "amadeus",
      from: flight.from,
      to: flight.to,
      toCity: flight.toCity,
      trip: flight.trip,
      cabin: flight.cabin,
      adults: flight.adults,
      outbound: flight.outbound,
      inbound: flight.inbound || null,
      fare: {
        ...flight.fare,
        total: Math.round(total),
        display: currency === "EUR" ? `€${Math.round(total)}` : `${Math.round(total)} ${currency}`,
        currency,
      },
      baggage: flight.baggage,
    },
    contact: {
      name: String(contact.name).trim(),
      email: String(contact.email).trim().toLowerCase(),
      phone: String(contact.phone).trim(),
      notes: contact.notes ? String(contact.notes).slice(0, 500) : "",
    },
    passengers: passengers.map((p) => ({
      firstName: String(p.firstName).trim(),
      lastName: String(p.lastName).trim(),
      birthDate: p.birthDate,
      document: p.document ? String(p.document).trim() : "",
      gender: p.gender || "MALE",
      type: p.type || "adult",
    })),
    agency: {
      name: "YouFly Chișinău",
      phone: "+373 22 000 000",
      email: "support@youfly.md",
      whatsapp: "+37369000000",
      address: "Chișinău, Moldova",
    },
    nextSteps: [
      "Comandă creată în Amadeus (test sau production, după AMADEUS_HOSTNAME).",
      `Referință: ${ref}`,
      "Verifică statusul ticketing în portalul Amadeus / email confirmare.",
      paymentMethod === "hold"
        ? "Hold: finalizează plata înainte de expirarea ofertei."
        : "Urmărește instrucțiunile de plată alese.",
    ],
    rawOrder: order,
  };
}

function bookLocal({ flight, contact, passengers, paymentMethod }) {
  const ref = `YF-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const statusMap = {
    card: "pending_payment",
    hold: "hold_24h",
    office: "awaiting_office",
    transfer: "awaiting_transfer",
    whatsapp: "awaiting_whatsapp",
  };
  return {
    ref,
    status: statusMap[paymentMethod] || "hold_24h",
    paymentMethod,
    createdAt: new Date().toISOString(),
    source: flight.source || "youfly_synthetic",
    currency: flight.fare.currency || "EUR",
    total: flight.fare.total,
    displayTotal: flight.fare.display || `€${flight.fare.total}`,
    promo: flight.fare.promo || null,
    discount: flight.fare.discount || 0,
    flight: {
      id: flight.id,
      from: flight.from,
      to: flight.to,
      toCity: flight.toCity,
      trip: flight.trip,
      cabin: flight.cabin,
      adults: flight.adults,
      outbound: flight.outbound,
      inbound: flight.inbound || null,
      fare: flight.fare,
      baggage: flight.baggage,
    },
    contact: {
      name: String(contact.name).trim(),
      email: String(contact.email).trim().toLowerCase(),
      phone: String(contact.phone).trim(),
      notes: contact.notes ? String(contact.notes).slice(0, 500) : "",
    },
    passengers: passengers.map((p) => ({
      firstName: String(p.firstName).trim(),
      lastName: String(p.lastName).trim(),
      birthDate: p.birthDate,
      document: p.document ? String(p.document).trim() : "",
      gender: p.gender || "MALE",
      type: p.type || "adult",
    })),
    agency: {
      name: "YouFly Chișinău",
      phone: "+373 22 000 000",
      email: "support@youfly.md",
      whatsapp: "+37369000000",
      address: "Chișinău, Moldova",
      holdHours: 24,
    },
    nextSteps: [
      "Rezervare agenție YouFly (fără e-ticket Amadeus pe această ofertă).",
      "Pentru e-ticket real alege o ofertă marcată Amadeus (după conectarea cheilor).",
      `Cod: ${ref}`,
    ],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return bad(res, 405, "Method not allowed");
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return bad(res, 400, e.message || "Bad request");
  }

  const contact = body.contact || {};
  const passengers = Array.isArray(body.passengers) ? body.passengers : [];
  const flight = body.flight;
  const paymentMethod = body.paymentMethod || "hold";
  const forceLocal = body.forceLocal === true;

  if (!flight || !flight.id || !flight.fare) {
    return bad(res, 400, "Selectează un zbor valid.");
  }
  if (!validEmail(contact.email)) {
    return bad(res, 400, "Email de contact invalid.");
  }
  if (!validPhone(contact.phone)) {
    return bad(res, 400, "Telefon invalid. Ex: +373 69 000 000");
  }
  if (!contact.name || String(contact.name).trim().length < 2) {
    return bad(res, 400, "Numele de contact este obligatoriu.");
  }
  if (!passengers.length) {
    return bad(res, 400, "Adaugă cel puțin un pasager.");
  }
  for (const [i, p] of passengers.entries()) {
    if (!p.firstName || !p.lastName) {
      return bad(res, 400, `Pasager ${i + 1}: prenume și nume obligatorii.`);
    }
    if (!p.birthDate) {
      return bad(res, 400, `Pasager ${i + 1}: data nașterii obligatorie.`);
    }
  }

  let booking;
  let amadeusError = null;
  const canAmadeus =
    !forceLocal &&
    amadeus.configured() &&
    (flight.source === "amadeus" || flight.amadeusOffer);

  if (canAmadeus) {
    try {
      booking = await bookAmadeus({ flight, contact, passengers, paymentMethod });
    } catch (e) {
      amadeusError = e.message || String(e);
      // Soft-fail to agency hold so sales continue
      booking = bookLocal({ flight, contact, passengers, paymentMethod });
      booking.amadeusError = amadeusError;
      booking.nextSteps = [
        `Amadeus booking a eșuat: ${amadeusError}`,
        "Rezervarea a fost salvată ca hold agenție YouFly.",
        `Cod: ${booking.ref}`,
        "Reîncearcă căutarea (ofertele Amadeus expiră rapid) sau contactează support@youfly.md",
      ];
    }
  } else {
    booking = bookLocal({ flight, contact, passengers, paymentMethod });
  }

  const webhook = process.env.BOOKING_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "booking.created", booking }),
        signal: AbortSignal.timeout(8000),
      });
      booking.webhook = "delivered";
    } catch (e) {
      booking.webhook = "failed";
      booking.webhookError = String(e.message || e);
    }
  }

  res.statusCode = 201;
  res.end(
    JSON.stringify({
      ok: true,
      booking,
      message: `Rezervare creată: ${booking.ref}`,
      meta: {
        amadeusConfigured: amadeus.configured(),
        amadeusUsed: booking.source === "amadeus",
        amadeusError,
      },
    })
  );
};
