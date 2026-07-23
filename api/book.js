/**
 * POST /api/book
 * Body JSON: search + selected flight + passengers + contact + paymentMethod
 * Creates a booking reference and (optionally) forwards to BOOKING_WEBHOOK_URL.
 */

const crypto = require("crypto");

// Ephemeral confirmation store is not durable across isolates — we always return
// a full booking payload the client can keep; webhook is the durable path.

function bad(res, code, error) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("Body too large"));
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

  const ref = `YF-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const statusMap = {
    card: "pending_payment",
    hold: "hold_24h",
    office: "awaiting_office",
    transfer: "awaiting_transfer",
    whatsapp: "awaiting_whatsapp",
  };

  const booking = {
    ref,
    status: statusMap[paymentMethod] || "hold_24h",
    paymentMethod,
    createdAt,
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
    nextSteps: [],
  };

  if (paymentMethod === "hold") {
    booking.nextSteps = [
      "Rezervarea este ținută 24h.",
      "Te contactăm pentru confirmare și plată.",
      "Păstrează codul de rezervare.",
    ];
  } else if (paymentMethod === "office") {
    booking.nextSteps = [
      "Vino la birou cu actele pasagerilor.",
      "Plătești cash / card la agenție.",
      `Cod: ${ref}`,
    ];
  } else if (paymentMethod === "transfer") {
    booking.nextSteps = [
      "Transfer bancar pe contul YouFly (detalii pe email).",
      "Trimite dovada plății pe support@youfly.md",
      `Referință: ${ref}`,
    ];
  } else if (paymentMethod === "whatsapp") {
    booking.nextSteps = [
      "Scrie-ne pe WhatsApp cu codul rezervării.",
      "Un agent finalizează biletul cu tine live.",
    ];
  } else if (paymentMethod === "card") {
    booking.nextSteps = [
      "Plata cu cardul: link securizat trimis pe email (Stripe — activează STRIPE_SECRET_KEY).",
      "Sau alege hold 24h / plată la birou.",
    ];
    booking.paymentNote =
      "Card online: configurează STRIPE_SECRET_KEY pe Vercel pentru checkout live. Până atunci rezervarea e înregistrată ca pending_payment.";
  }

  // Optional webhook for CRM / Google Sheets / Make.com
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
      message: `Rezervare creată: ${ref}`,
    })
  );
};
