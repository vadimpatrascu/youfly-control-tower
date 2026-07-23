/**
 * YouFly sales funnel — search → results → passengers → pay → confirm
 * Works on local (server.py) and Vercel (/api/*).
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const state = {
    trip: "round",
    from: "KIV",
    to: "LTN",
    toCity: "Londra",
    depart: "",
    return: "",
    adults: 1,
    cabin: "economy",
    promo: "",
    results: [],
    selected: null,
    passengers: [],
    contact: { name: "", email: "", phone: "", notes: "" },
    paymentMethod: "hold",
    booking: null,
    loading: false,
    step: null, // results | book | confirm
  };

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function addDaysISO(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function toast(msg, kind = "ok") {
    let t = $("#yfToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "yfToast";
      t.className = "yf-toast";
      document.body.appendChild(t);
    }
    t.className = "yf-toast show " + kind;
    t.innerHTML = `<b>${kind === "err" ? "EROARE" : "YOUFLY"}</b><span>${msg}</span>`;
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.remove("show"), 3600);
  }

  function ensureShell() {
    if ($("#yfSalesRoot")) return;
    const root = document.createElement("div");
    root.id = "yfSalesRoot";
    root.innerHTML = `
      <div class="yf-overlay" id="yfOverlay" hidden>
        <div class="yf-panel" role="dialog" aria-modal="true" aria-labelledby="yfTitle">
          <header class="yf-head">
            <div>
              <div class="yf-kicker" id="yfKicker">YOUFLY BOOKING</div>
              <h2 id="yfTitle">Rezultate</h2>
            </div>
            <button type="button" class="yf-close" id="yfClose" aria-label="Închide">×</button>
          </header>
          <div class="yf-steps" id="yfSteps">
            <span data-s="results">1. Zboruri</span>
            <span data-s="book">2. Pasageri</span>
            <span data-s="confirm">3. Confirmare</span>
          </div>
          <div class="yf-body" id="yfBody"></div>
        </div>
      </div>
      <a class="yf-wa" id="yfWa" href="https://wa.me/37369000000?text=Bună!%20Vreau%20să%20rezerv%20un%20zbor%20cu%20YouFly." target="_blank" rel="noopener" title="WhatsApp YouFly">
        <span>WhatsApp</span>
      </a>
    `;
    document.body.appendChild(root);
    $("#yfClose").onclick = closeSales;
    $("#yfOverlay").addEventListener("click", (e) => {
      if (e.target.id === "yfOverlay") closeSales();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSales();
    });
  }

  function openSales(step) {
    ensureShell();
    state.step = step;
    $("#yfOverlay").hidden = false;
    document.body.style.overflow = "hidden";
    render();
  }

  function closeSales() {
    const o = $("#yfOverlay");
    if (o) o.hidden = true;
    document.body.style.overflow = "";
    state.step = null;
  }

  function setStep(step) {
    state.step = step;
    render();
  }

  function markSteps() {
    $$("#yfSteps span").forEach((el) => {
      el.classList.toggle("on", el.dataset.s === state.step);
      el.classList.toggle(
        "done",
        (state.step === "book" && el.dataset.s === "results") ||
          (state.step === "confirm" && el.dataset.s !== "confirm")
      );
    });
  }

  function readSearchFromDom() {
    const toSel = $("#toSelect");
    if (toSel && toSel.value) {
      const [city, code] = toSel.value.split("|");
      state.toCity = city;
      state.to = code;
    }
    const dep = $("#depDate");
    const ret = $("#retDate");
    const pax = $("#paxSelect");
    const cabin = $("#cabinSelect");
    const promo = $("#promoInput");
    state.depart = dep && dep.value ? dep.value : addDaysISO(1);
    state.return = ret && ret.value ? ret.value : addDaysISO(8);
    state.adults = pax ? parseInt(pax.value, 10) || 1 : state.adults;
    state.cabin = cabin ? cabin.value : state.cabin;
    state.promo = promo ? promo.value.trim() : state.promo;
    // trip from toggle
    const activeTrip = document.querySelector("#tripToggle button.active");
    if (activeTrip) state.trip = activeTrip.dataset.trip || state.trip;
  }

  async function runSearch() {
    readSearchFromDom();
    if (!state.depart) {
      toast("Alege data plecării", "err");
      return;
    }
    state.loading = true;
    openSales("results");
    render();
    try {
      const qs = new URLSearchParams({
        from: "KIV",
        to: state.to,
        depart: state.depart,
        return: state.trip === "round" ? state.return : "",
        trip: state.trip,
        adults: String(state.adults),
        cabin: state.cabin,
        promo: state.promo || "",
      });
      const res = await fetch(`/api/search?${qs}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Căutarea a eșuat");
      state.results = data.results || [];
      state.query = data.query;
      if (!state.results.length) toast("Niciun zbor găsit pentru aceste date", "err");
      else toast(`${state.results.length} oferte găsite · KIV → ${state.to}`);
    } catch (e) {
      state.results = [];
      toast(e.message || "Eroare căutare", "err");
    } finally {
      state.loading = false;
      render();
    }
  }

  function selectFlight(id) {
    state.selected = state.results.find((r) => r.id === id) || null;
    if (!state.selected) return;
    state.passengers = Array.from({ length: state.selected.adults }, () => ({
      firstName: "",
      lastName: "",
      birthDate: "",
      document: "",
      gender: "MALE",
      type: "adult",
    }));
    setStep("book");
  }

  async function submitBooking() {
    const name = $("#bkName")?.value.trim();
    const email = $("#bkEmail")?.value.trim();
    const phone = $("#bkPhone")?.value.trim();
    const notes = $("#bkNotes")?.value.trim();
    const paymentMethod = document.querySelector('input[name="pay"]:checked')?.value || "hold";

    const passengers = state.passengers.map((_, i) => ({
      firstName: $(`#p${i}fn`)?.value.trim(),
      lastName: $(`#p${i}ln`)?.value.trim(),
      birthDate: $(`#p${i}bd`)?.value,
      document: $(`#p${i}doc`)?.value.trim(),
      documentExpiry: $(`#p${i}exp`)?.value || "2030-12-31",
      gender: $(`#p${i}gd`)?.value || "MALE",
      nationality: "MD",
      issuanceCountry: "MD",
      type: "adult",
    }));

    state.contact = { name, email, phone, notes };
    state.paymentMethod = paymentMethod;
    state.loading = true;
    render();

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flight: state.selected,
          contact: state.contact,
          passengers,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Rezervarea a eșuat");
      state.booking = data.booking;
      try {
        const all = JSON.parse(localStorage.getItem("youfly_bookings") || "[]");
        all.unshift(data.booking);
        localStorage.setItem("youfly_bookings", JSON.stringify(all.slice(0, 20)));
      } catch (_) {}
      toast(`Rezervare ${data.booking.ref} confirmată`);
      setStep("confirm");
    } catch (e) {
      toast(e.message || "Eroare la rezervare", "err");
      state.loading = false;
      render();
    }
  }

  function logoUrl(code) {
    return `https://www.gstatic.com/flights/airline_logos/70px/${code}.png`;
  }

  function renderResults() {
    $("#yfTitle").textContent = "Alege zborul";
    $("#yfKicker").textContent = `KIV → ${state.to} · ${state.toCity}`;
    if (state.loading) {
      $("#yfBody").innerHTML = `<div class="yf-loading"><div class="yf-spinner"></div><p>Scanăm cerul pentru cele mai bune tarife…</p></div>`;
      return;
    }
    if (!state.results.length) {
      $("#yfBody").innerHTML = `
        <div class="yf-empty">
          <p>Nu am găsit oferte. Schimbă datele și încearcă din nou.</p>
          <button type="button" class="yf-btn" id="yfRetry">Înapoi la căutare</button>
        </div>`;
      $("#yfRetry").onclick = closeSales;
      return;
    }
    const rows = state.results
      .map((r) => {
        const o = r.outbound;
        const ret = r.inbound
          ? `<div class="yf-leg muted">↩ ${r.inbound.depart} ${r.inbound.from}→${r.inbound.to} · ${r.inbound.airline} ${r.inbound.flightNo}</div>`
          : "";
        const srcBadge =
          r.source === "amadeus"
            ? `<span class="yf-badge amd">AMADEUS LIVE</span>`
            : `<span class="yf-badge syn">AGENȚIE</span>`;
        return `
        <article class="yf-offer" data-id="${r.id}">
          <div class="yf-offer-top">
            <img src="${logoUrl(o.logo)}" alt="${o.airline}" width="28" height="28" onerror="this.style.opacity=.2">
            <div>
              <strong>${o.airline}</strong>
              <div class="meta">${o.flightNo} · ${o.aircraft || "—"} · ${o.stops ? (o.stops + " escală") : "direct"} ${srcBadge}</div>
            </div>
            <div class="seats">${r.seatsLeft != null ? r.seatsLeft + " locuri" : "live"}</div>
          </div>
          <div class="yf-times">
            <div><b>${o.depart}</b><span>${o.from}</span></div>
            <div class="line"><span>${o.duration}</span></div>
            <div><b>${o.arrive}${o.arriveNextDay ? " +1" : ""}</b><span>${o.to}</span></div>
          </div>
          ${ret}
          <div class="yf-offer-bot">
            <div class="bag">${r.baggage.cabin} · ${r.baggage.checked}</div>
            <div class="price">
              ${r.fare.discount ? `<s>€${r.fare.total + r.fare.discount}</s>` : ""}
              <b>${r.fare.display}</b>
              <small>${r.adults > 1 ? `total ${r.adults} pax` : "per rezervare"}</small>
            </div>
            <button type="button" class="yf-btn pick" data-id="${r.id}">Rezervă</button>
          </div>
        </article>`;
      })
      .join("");

    const amdCount = state.results.filter((r) => r.source === "amadeus").length;
    $("#yfBody").innerHTML = `
      <div class="yf-summary-bar">
        <span>${state.results.length} oferte · ${state.trip === "round" ? "dus-întors" : "dus"} · ${state.depart}${state.trip === "round" ? " → " + state.return : ""}</span>
        <span>${amdCount ? amdCount + " Amadeus live" : "fallback agenție"} · ${state.promo ? "Promo " + state.promo : "fără promo"}</span>
      </div>
      <div class="yf-offers">${rows}</div>`;
    $$(".yf-offer .pick").forEach((btn) => {
      btn.onclick = () => selectFlight(btn.dataset.id);
    });
  }

  function renderBook() {
    const f = state.selected;
    if (!f) {
      setStep("results");
      return;
    }
    $("#yfTitle").textContent = "Date pasageri";
    $("#yfKicker").textContent = `${f.outbound.airline} · ${f.fare.display}`;
    const paxFields = state.passengers
      .map(
        (p, i) => `
      <fieldset class="yf-fieldset">
        <legend>Pasager ${i + 1}</legend>
        <div class="yf-grid2">
          <label>Prenume<input id="p${i}fn" required autocomplete="given-name" value="${p.firstName || ""}"></label>
          <label>Nume<input id="p${i}ln" required autocomplete="family-name" value="${p.lastName || ""}"></label>
          <label>Data nașterii<input id="p${i}bd" type="date" required value="${p.birthDate || ""}"></label>
          <label>Sex (Amadeus)
            <select id="p${i}gd">
              <option value="MALE"${p.gender !== "FEMALE" ? " selected" : ""}>Masculin</option>
              <option value="FEMALE"${p.gender === "FEMALE" ? " selected" : ""}>Feminin</option>
            </select>
          </label>
          <label>Pașaport (recomandat e-ticket)<input id="p${i}doc" placeholder="nr. pașaport" value="${p.document || ""}"></label>
          <label>Expirare pașaport<input id="p${i}exp" type="date" value="${p.documentExpiry || "2030-12-31"}"></label>
        </div>
      </fieldset>`
      )
      .join("");

    $("#yfBody").innerHTML = `
      <div class="yf-itinerary">
        <div><b>KIV → ${f.to}</b> ${f.toCity}</div>
        <div class="meta">${f.outbound.date} · ${f.outbound.depart}–${f.outbound.arrive} · ${f.outbound.flightNo}</div>
        ${f.inbound ? `<div class="meta">Întoarcere ${f.inbound.date} · ${f.inbound.depart} · ${f.inbound.flightNo}</div>` : ""}
        <div class="total">Total de plată: <b>${f.fare.display}</b> ${f.fare.promo ? `(${f.fare.promo} −€${f.fare.discount})` : ""}</div>
      </div>
      <form id="bkForm" class="yf-form">
        <fieldset class="yf-fieldset">
          <legend>Contact</legend>
          <div class="yf-grid2">
            <label>Nume complet<input id="bkName" required autocomplete="name" value="${state.contact.name || ""}"></label>
            <label>Email<input id="bkEmail" type="email" required autocomplete="email" value="${state.contact.email || ""}"></label>
            <label>Telefon<input id="bkPhone" type="tel" required placeholder="+373 69 000 000" autocomplete="tel" value="${state.contact.phone || ""}"></label>
            <label>Note<input id="bkNotes" placeholder="Preferințe loc, bagaj…" value="${state.contact.notes || ""}"></label>
          </div>
        </fieldset>
        ${paxFields}
        <fieldset class="yf-fieldset">
          <legend>Plată / confirmare</legend>
          <label class="yf-radio"><input type="radio" name="pay" value="hold" checked> Hold 24h — rezervăm locul, plătești după confirmare</label>
          <label class="yf-radio"><input type="radio" name="pay" value="whatsapp"> WhatsApp agent — finalizare live</label>
          <label class="yf-radio"><input type="radio" name="pay" value="office"> Plată la birou YouFly (Chișinău)</label>
          <label class="yf-radio"><input type="radio" name="pay" value="transfer"> Transfer bancar</label>
          <label class="yf-radio"><input type="radio" name="pay" value="card"> Card online (link pe email)</label>
        </fieldset>
        <label class="yf-check"><input type="checkbox" id="bkTerms" required> Accept <button type="button" class="yf-link" id="yfTermsBtn">Termenii</button> și politica de confidențialitate. Prețul final se confirmă la emiterea biletului.</label>
        <div class="yf-actions">
          <button type="button" class="yf-btn ghost" id="bkBack">← Oferte</button>
          <button type="submit" class="yf-btn" id="bkSubmit"${state.loading ? " disabled" : ""}>${state.loading ? "Se trimite…" : "Confirmă rezervarea →"}</button>
        </div>
      </form>`;

    $("#bkBack").onclick = () => setStep("results");
    $("#yfTermsBtn").onclick = () => showLegal("terms");
    $("#bkForm").onsubmit = (e) => {
      e.preventDefault();
      if (!$("#bkTerms").checked) {
        toast("Acceptă termenii pentru a continua", "err");
        return;
      }
      submitBooking();
    };
  }

  function renderConfirm() {
    const b = state.booking;
    if (!b) {
      setStep("results");
      return;
    }
    state.loading = false;
    $("#yfTitle").textContent = "Rezervare confirmată";
    $("#yfKicker").textContent = b.ref;
    const wa = `https://wa.me/37369000000?text=${encodeURIComponent(
      `Bună YouFly! Rezervarea mea: ${b.ref} · ${b.flight.from}→${b.flight.to} · ${b.displayTotal}`
    )}`;
    $("#yfBody").innerHTML = `
      <div class="yf-confirm">
        <div class="yf-ref">${b.ref}</div>
        <p class="lead">Mulțumim, <b>${b.contact.name}</b>! Rezervarea este înregistrată.</p>
        <div class="yf-itinerary">
          <div><b>${b.flight.from} → ${b.flight.to}</b> ${b.flight.toCity || ""}</div>
          <div class="meta">${b.flight.outbound.date} · ${b.flight.outbound.airline} ${b.flight.outbound.flightNo} · ${b.flight.outbound.depart}</div>
          <div class="total">Total: <b>${b.displayTotal}</b> · status: <code>${b.status}</code></div>
        </div>
        <ol class="yf-next">
          ${(b.nextSteps || []).map((s) => `<li>${s}</li>`).join("")}
        </ol>
        <div class="yf-actions">
          <a class="yf-btn" href="${wa}" target="_blank" rel="noopener">Deschide WhatsApp</a>
          <button type="button" class="yf-btn ghost" id="yfDone">Închide</button>
          <button type="button" class="yf-btn ghost" id="yfPrint">Printează</button>
        </div>
        <p class="fine">Confirmarea a fost salvată și pe acest dispozitiv. Email: ${b.contact.email}</p>
      </div>`;
    $("#yfDone").onclick = closeSales;
    $("#yfPrint").onclick = () => window.print();
  }

  function render() {
    ensureShell();
    markSteps();
    if (state.step === "results") renderResults();
    else if (state.step === "book") renderBook();
    else if (state.step === "confirm") renderConfirm();
  }

  function showLegal(kind) {
    const texts = {
      terms: `<h3>Termeni & condiții</h3>
        <p>YouFly acționează ca agenție de turism / intermediar de bilete aeriene. Prețurile afișate sunt orientative până la emiterea biletului. Taxele de aeroport, bagajele extra și modificările de orar țin de compania aeriană.</p>
        <p>Hold 24h: rezervarea poate fi anulată automat dacă plata nu e confirmată. Anulările/rebooking-ul urmează politica transportatorului.</p>
        <p>Contact: support@youfly.md · +373 22 000 000 · Chișinău.</p>`,
      privacy: `<h3>Confidențialitate</h3>
        <p>Datele pasagerilor sunt folosite exclusiv pentru emiterea biletelor și comunicări legate de rezervare. Nu vindem date terților în scop de marketing.</p>
        <p>Poți cere ștergerea datelor la support@youfly.md.</p>`,
    };
    const w = window.open("", "_blank", "width=480,height=640");
    if (w) {
      w.document.write(`<pre style="white-space:pre-wrap;font-family:system-ui;padding:24px">${texts[kind] || ""}</pre>`);
    }
  }

  async function newsletterSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const email = form.querySelector('input[type="email"]')?.value.trim();
    if (!email) return;
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "newsletter", email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Eroare");
      toast(data.message || "Abonat!");
      form.reset();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  function enhanceSearchForm() {
    // Dates defaults
    const dep = $("#depDate");
    const ret = $("#retDate");
    if (dep && !dep.value) dep.value = addDaysISO(1);
    if (ret && !ret.value) ret.value = addDaysISO(8);
    if (dep) {
      dep.min = todayISO();
      dep.addEventListener("change", () => {
        if (ret && ret.value < dep.value) ret.value = dep.value;
        ret.min = dep.value;
      });
    }

    // Replace readonly pax with real controls if missing
    const paxHost = document.querySelector(".field-row");
    if (paxHost && !$("#paxSelect")) {
      const last = paxHost.querySelectorAll(".field");
      // third field is pax — rebuild
      if (last[2]) {
        last[2].innerHTML = `
          <label style="display:block;font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:rgba(247,242,232,0.4);margin-bottom:6px">PASAGERI</label>
          <select id="paxSelect" style="width:100%;background:transparent;border:0;outline:none;font-size:1.05rem;font-weight:600;color:inherit">
            ${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n} pasager${n > 1 ? "i" : ""}</option>`).join("")}
          </select>`;
      }
    }

    // Promo + cabin row under chips
    const chips = $("#chips");
    if (chips && !$("#promoInput")) {
      const bar = document.createElement("div");
      bar.className = "yf-search-extra";
      bar.innerHTML = `
        <label class="yf-mini">Cabină
          <select id="cabinSelect">
            <option value="economy">Economică</option>
            <option value="premium">Premium</option>
            <option value="business">Business</option>
          </select>
        </label>
        <label class="yf-mini">Promo
          <input id="promoInput" placeholder="ZBOR30" maxlength="16" autocomplete="off">
        </label>`;
      chips.after(bar);
    }

    // Wire search
    const btn = $("#searchBtn");
    if (btn) {
      btn.type = "button";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        runSearch();
      });
    }
    const dock = $("#dockBtn");
    if (dock) {
      dock.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("search")?.scrollIntoView({ behavior: "smooth" });
        setTimeout(runSearch, 400);
      });
    }

    // Dest cards → search
    document.addEventListener("click", (e) => {
      const card = e.target.closest(".dest-card[data-code]");
      if (!card) return;
      const code = card.dataset.code;
      const sel = $("#toSelect");
      if (sel) {
        const opt = [...sel.options].find((o) => o.value.endsWith("|" + code));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change"));
        }
      }
      document.getElementById("search")?.scrollIntoView({ behavior: "smooth" });
      setTimeout(runSearch, 350);
    });
  }

  function enhanceNav() {
    // "Rezervarea mea" opens last booking or search
    $$('a.btn-nav, a[href="#search"]').forEach((a) => {
      if (a.classList.contains("btn-nav") || a.textContent.includes("Rezervarea")) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          try {
            const all = JSON.parse(localStorage.getItem("youfly_bookings") || "[]");
            if (all[0]) {
              state.booking = all[0];
              openSales("confirm");
              return;
            }
          } catch (_) {}
          document.getElementById("search")?.scrollIntoView({ behavior: "smooth" });
        });
      }
    });
  }

  function enhanceNewsletter() {
    const form = $("#newsForm");
    if (form) form.addEventListener("submit", newsletterSubmit);
  }

  function enhanceFooterLegal() {
    $$("footer a").forEach((a) => {
      const t = (a.textContent || "").toLowerCase();
      if (t.includes("despre")) {
        a.href = "#";
        a.onclick = (e) => {
          e.preventDefault();
          toast("YouFly — agenție bilete aeriene din Chișinău. support@youfly.md");
        };
      }
    });
  }

  function injectStyles() {
    if ($("#yfSalesCSS")) return;
    const s = document.createElement("style");
    s.id = "yfSalesCSS";
    s.textContent = `
      body { cursor: auto !important; }
      .cursor, .cursor-dot { display: none !important; }
      button, a, input, select { cursor: pointer; }
      input, select, textarea { cursor: text; }
      button, a { cursor: pointer; }

      .yf-search-extra {
        display: flex; gap: 10px; flex-wrap: wrap;
        margin: 0 0 14px; padding: 0 2px;
      }
      .yf-mini {
        flex: 1; min-width: 120px;
        font-family: var(--font-mono, monospace); font-size: 10px;
        letter-spacing: 0.12em; color: rgba(247,242,232,0.45);
        display: flex; flex-direction: column; gap: 6px;
      }
      .yf-mini input, .yf-mini select {
        background: rgba(247,242,232,0.05);
        border: 1px solid rgba(247,242,232,0.12);
        border-radius: 12px; padding: 10px 12px;
        color: var(--cream, #f7f2e8); font-family: var(--font-sans, system-ui);
        font-size: 14px; font-weight: 600; letter-spacing: 0;
      }

      .yf-overlay {
        position: fixed; inset: 0; z-index: 200000;
        background: rgba(4,8,16,0.72);
        backdrop-filter: blur(10px);
        display: grid; place-items: center;
        padding: 16px;
      }
      .yf-overlay[hidden] { display: none !important; }
      .yf-panel {
        width: min(720px, 100%);
        max-height: min(92vh, 900px);
        overflow: auto;
        background: linear-gradient(165deg, #0e1930, #0a1220);
        border: 1px solid rgba(247,242,232,0.12);
        border-radius: 22px;
        box-shadow: 0 40px 100px rgba(0,0,0,0.55);
        color: #f7f2e8;
      }
      .yf-head {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 12px; padding: 20px 22px 8px;
        position: sticky; top: 0; background: rgba(10,18,32,0.95);
        backdrop-filter: blur(8px); z-index: 2;
        border-bottom: 1px solid rgba(247,242,232,0.06);
      }
      .yf-kicker {
        font-family: var(--font-mono, monospace); font-size: 10px;
        letter-spacing: 0.16em; color: #ff6b4a; margin-bottom: 4px;
      }
      .yf-head h2 { font-size: 1.35rem; letter-spacing: -0.03em; margin: 0; }
      .yf-close {
        width: 40px; height: 40px; border-radius: 50%;
        border: 1px solid rgba(247,242,232,0.15);
        background: transparent; color: #f7f2e8; font-size: 24px; line-height: 1;
      }
      .yf-steps {
        display: flex; gap: 8px; padding: 12px 22px;
        font-family: var(--font-mono, monospace); font-size: 10px; letter-spacing: 0.08em;
        color: rgba(247,242,232,0.35);
      }
      .yf-steps span.on { color: #ff6b4a; }
      .yf-steps span.done { color: #2fbf8f; }
      .yf-body { padding: 8px 22px 24px; }

      .yf-loading, .yf-empty { text-align: center; padding: 48px 16px; color: rgba(247,242,232,0.7); }
      .yf-spinner {
        width: 36px; height: 36px; margin: 0 auto 16px;
        border: 3px solid rgba(255,107,74,0.2); border-top-color: #ff6b4a;
        border-radius: 50%; animation: yfspin .7s linear infinite;
      }
      @keyframes yfspin { to { transform: rotate(360deg); } }

      .yf-summary-bar {
        display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
        font-family: var(--font-mono, monospace); font-size: 11px;
        color: rgba(247,242,232,0.45); margin-bottom: 12px;
      }
      .yf-offers { display: flex; flex-direction: column; gap: 12px; }
      .yf-offer {
        border: 1px solid rgba(247,242,232,0.1);
        border-radius: 16px; padding: 14px 16px;
        background: rgba(247,242,232,0.03);
      }
      .yf-offer-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .yf-offer-top .meta { font-size: 12px; color: rgba(247,242,232,0.45); }
      .yf-offer-top .seats {
        margin-left: auto; font-family: var(--font-mono, monospace);
        font-size: 10px; color: #e8a33d; letter-spacing: 0.08em;
      }
      .yf-times {
        display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;
        margin-bottom: 8px;
      }
      .yf-times b { font-size: 1.25rem; letter-spacing: -0.02em; display: block; }
      .yf-times span { font-size: 12px; color: rgba(247,242,232,0.45); }
      .yf-times .line {
        height: 1px; background: rgba(247,242,232,0.15); position: relative; min-width: 64px;
      }
      .yf-times .line span {
        position: absolute; left: 50%; top: -9px; transform: translateX(-50%);
        background: #0c1526; padding: 0 6px; font-size: 10px; white-space: nowrap;
      }
      .yf-leg.muted { font-size: 12px; color: rgba(247,242,232,0.5); margin-bottom: 8px; }
      .yf-offer-bot {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        border-top: 1px dashed rgba(247,242,232,0.1); padding-top: 10px; margin-top: 4px;
      }
      .yf-offer-bot .bag { font-size: 12px; color: rgba(247,242,232,0.5); flex: 1; }
      .yf-offer-bot .price { text-align: right; }
      .yf-offer-bot .price b { font-size: 1.35rem; color: #ff6b4a; display: block; }
      .yf-offer-bot .price s { color: rgba(247,242,232,0.35); font-size: 12px; margin-right: 6px; }
      .yf-offer-bot .price small { font-size: 10px; color: rgba(247,242,232,0.4); }
      .yf-badge {
        display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px;
        font-family: var(--font-mono, monospace); font-size: 9px; letter-spacing: 0.06em;
        vertical-align: middle;
      }
      .yf-badge.amd { background: rgba(47,191,143,0.18); color: #2fbf8f; border: 1px solid rgba(47,191,143,0.35); }
      .yf-badge.syn { background: rgba(247,242,232,0.08); color: rgba(247,242,232,0.45); border: 1px solid rgba(247,242,232,0.12); }

      .yf-btn {
        appearance: none; border: 0; border-radius: 999px;
        background: linear-gradient(135deg, #ff6b4a, #ff8a4a);
        color: #1a100c; font-weight: 700; font-size: 14px;
        padding: 12px 18px; cursor: pointer;
      }
      .yf-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .yf-btn.ghost {
        background: transparent; color: #f7f2e8;
        border: 1px solid rgba(247,242,232,0.2);
      }
      .yf-btn.pick { padding: 10px 16px; }

      .yf-itinerary {
        background: rgba(255,107,74,0.08);
        border: 1px solid rgba(255,107,74,0.25);
        border-radius: 14px; padding: 14px 16px; margin-bottom: 14px;
      }
      .yf-itinerary .meta { font-size: 13px; color: rgba(247,242,232,0.55); margin-top: 4px; }
      .yf-itinerary .total { margin-top: 8px; font-size: 15px; }
      .yf-fieldset {
        border: 1px solid rgba(247,242,232,0.1);
        border-radius: 14px; padding: 12px 14px 16px; margin: 0 0 12px;
      }
      .yf-fieldset legend {
        font-family: var(--font-mono, monospace); font-size: 10px;
        letter-spacing: 0.14em; color: #ff6b4a; padding: 0 6px;
      }
      .yf-grid2 {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }
      @media (max-width: 560px) { .yf-grid2 { grid-template-columns: 1fr; } }
      .yf-form label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: rgba(247,242,232,0.55); }
      .yf-form input, .yf-form select, .yf-form textarea {
        background: rgba(0,0,0,0.25); border: 1px solid rgba(247,242,232,0.12);
        border-radius: 10px; padding: 10px 12px; color: #f7f2e8; font-size: 14px;
      }
      .yf-radio, .yf-check {
        display: flex !important; flex-direction: row !important; align-items: flex-start;
        gap: 10px; margin: 8px 0; font-size: 13px; color: rgba(247,242,232,0.75); cursor: pointer;
      }
      .yf-radio input, .yf-check input { margin-top: 3px; }
      .yf-link { background: none; border: 0; color: #ff6b4a; text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
      .yf-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
      .yf-confirm { text-align: center; }
      .yf-ref {
        font-family: var(--font-mono, monospace); font-size: 1.6rem; font-weight: 700;
        letter-spacing: 0.12em; color: #ff6b4a; margin: 8px 0 12px;
      }
      .yf-confirm .lead { font-size: 1.05rem; margin-bottom: 14px; }
      .yf-next { text-align: left; margin: 16px auto; max-width: 420px; color: rgba(247,242,232,0.7); line-height: 1.5; }
      .yf-confirm .fine { font-size: 12px; color: rgba(247,242,232,0.4); margin-top: 16px; }

      .yf-toast {
        position: fixed; top: 88px; right: 16px; z-index: 200001;
        background: #0e1930; border: 1px solid rgba(47,191,143,0.4);
        color: #f7f2e8; padding: 12px 16px; border-radius: 14px;
        max-width: 320px; box-shadow: 0 20px 50px rgba(0,0,0,0.4);
        transform: translateX(120%); transition: transform .35s ease;
      }
      .yf-toast.show { transform: translateX(0); }
      .yf-toast.err { border-color: rgba(255,107,74,0.5); }
      .yf-toast b {
        display: block; font-family: var(--font-mono, monospace);
        font-size: 10px; letter-spacing: 0.14em; color: #2fbf8f; margin-bottom: 4px;
      }
      .yf-toast.err b { color: #ff6b4a; }

      .yf-wa {
        position: fixed; right: 18px; bottom: 22px; z-index: 90;
        background: #25d366; color: #06240f; font-weight: 800; font-size: 13px;
        padding: 12px 16px; border-radius: 999px;
        box-shadow: 0 12px 30px rgba(37,211,102,0.35);
        text-decoration: none;
      }
      .yf-wa:hover { filter: brightness(1.05); color: #06240f; }
      @media print {
        .yf-overlay { position: static; background: #fff; color: #000; }
        .yf-panel { box-shadow: none; border: 0; max-height: none; color: #000; }
        .yf-close, .yf-wa, .yf-steps, .nav, .ops-strip, .dock { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  function boot() {
    injectStyles();
    ensureShell();
    enhanceSearchForm();
    enhanceNav();
    enhanceNewsletter();
    enhanceFooterLegal();
    // global hook
    window.YouFlySales = { search: runSearch, open: openSales, close: closeSales };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
