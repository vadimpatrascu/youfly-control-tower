/**
 * POST /api/contact — newsletter + contact leads
 */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 2e5) reject(new Error("Body too large"));
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
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: e.message }));
    return;
  }

  const email = String(body.email || "").trim().toLowerCase();
  const type = body.type || "newsletter";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Email invalid." }));
    return;
  }

  const lead = {
    id: `L-${Date.now().toString(36).toUpperCase()}`,
    type,
    email,
    name: body.name ? String(body.name).trim() : null,
    phone: body.phone ? String(body.phone).trim() : null,
    message: body.message ? String(body.message).slice(0, 1000) : null,
    route: body.route || null,
    createdAt: new Date().toISOString(),
  };

  const webhook = process.env.BOOKING_WEBHOOK_URL || process.env.CONTACT_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "lead.created", lead }),
        signal: AbortSignal.timeout(8000),
      });
      lead.webhook = "delivered";
    } catch {
      lead.webhook = "failed";
    }
  }

  res.statusCode = 201;
  res.end(
    JSON.stringify({
      ok: true,
      lead,
      message:
        type === "newsletter"
          ? "Ești abonat la alertele de preț YouFly."
          : "Mesajul a fost înregistrat. Te contactăm în curând.",
    })
  );
};
