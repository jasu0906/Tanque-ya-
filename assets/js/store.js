/*
 * Tanque ya: capa de datos.
 * En esta demo todo se guarda en el navegador (localStorage). La interfaz
 * habla solo con este archivo, así que cambiarlo por una API real
 * (Supabase, Firebase, un servidor propio...) no obliga a tocar las pantallas.
 */
(function () {
  "use strict";

  var KEYS = {
    overrides: "ty.stations.v1",
    reports: "ty.reports.v1",
    payments: "ty.payments.v1",
    settings: "ty.settings.v1",
    session: "ty.session.v1",
    wallet: "ty.wallet.v1",
    osm: "ty.osm.v2"
  };

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var FUELS = [
    { key: "g91", label: "Gasolina 91", short: "91" },
    { key: "g95", label: "Gasolina 95", short: "95" },
    { key: "diesel", label: "Diésel", short: "Diésel" }
  ];

  var AVAIL = {
    ok: { label: "Disponible", tone: "ok" },
    low: { label: "Queda poco", tone: "warn" },
    out: { label: "Agotado", tone: "out" },
    none: { label: "No vende", tone: "na" }
  };

  var QUEUE = {
    none: { label: "Sin cola", tone: "ok", mins: "0 min" },
    short: { label: "Cola corta", tone: "ok", mins: "~15 min" },
    long: { label: "Cola larga", tone: "warn", mins: "+45 min" },
    empty: { label: "Sin combustible", tone: "out", mins: "" }
  };

  var MODALITY = {
    intl: "Precio internacional ($)",
    subs: "Subsidiada (Bs)"
  };

  // Valores de ejemplo para la demo. El gerente los cambia desde su panel.
  var DEFAULTS = {
    rate: 230.0,          // Bs por USD, valor de EJEMPLO
    priceIntl: 0.5,       // USD por litro, estaciones con precio internacional
    priceSubs: 0.02,      // USD equivalentes por litro, estaciones subsidiadas
    serviceFee: 0.01      // 1 % de tarifa de servicio por pago en la app
  };

  /* ---------- utilidades ---------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function prng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, weights) {
    var x = r(), acc = 0;
    for (var k in weights) { acc += weights[k]; if (x <= acc) return k; }
    return Object.keys(weights)[0];
  }

  /* ---------- ajustes ---------- */
  function settings() {
    var s = read(KEYS.settings, {});
    return { simulate: s.simulate !== false };
  }
  function setSettings(patch) {
    var s = Object.assign(settings(), patch);
    write(KEYS.settings, s);
    return s;
  }

  /* ---------- estado simulado ---------- */
  // Da a cada estación un estado verosímil y estable (siempre el mismo para la
  // misma estación) para que la demo no se vea vacía. Se marca como simulado.
  function simulated(st) {
    var r = prng(hash(st.id));
    var modality = r() < 0.72 ? "intl" : "subs";
    var price = modality === "intl" ? DEFAULTS.priceIntl : DEFAULTS.priceSubs;
    var hasDiesel = r() < 0.55;
    var fuels = {
      g91: { status: pick(r, { ok: 0.62, low: 0.2, out: 0.18 }), price: price },
      g95: { status: pick(r, { ok: 0.5, low: 0.22, out: 0.2, none: 0.08 }), price: price },
      diesel: { status: hasDiesel ? pick(r, { ok: 0.6, low: 0.2, out: 0.2 }) : "none", price: price }
    };
    var anyFuel = FUELS.some(function (f) { return fuels[f.key].status === "ok" || fuels[f.key].status === "low"; });
    var queue = anyFuel ? pick(r, { none: 0.3, short: 0.4, long: 0.3 }) : "empty";
    var minutesAgo = 4 + Math.floor(r() * 170);
    return {
      fuels: fuels,
      modality: modality,
      rate: DEFAULTS.rate,
      open: r() > 0.06,
      hours: r() < 0.35 ? "24 horas" : "6:00 a. m. – 8:00 p. m.",
      queue: queue,
      acceptsApp: r() < 0.7,
      updatedAt: Date.now() - minutesAgo * 60000,
      updatedBy: "simulado",
      simulated: true
    };
  }

  function emptyState() {
    return {
      fuels: { g91: { status: null, price: null }, g95: { status: null, price: null }, diesel: { status: null, price: null } },
      modality: "intl", rate: DEFAULTS.rate, open: true, hours: "", queue: null,
      acceptsApp: false, updatedAt: null, updatedBy: null, simulated: false, unknown: true
    };
  }

  /* ---------- estado de una estación ---------- */
  function getOverrides() { return read(KEYS.overrides, {}); }
  function getReports() { return read(KEYS.reports, {}); }

  function stateOf(st) {
    var base = settings().simulate ? simulated(st) : emptyState();
    var ov = getOverrides()[st.id];
    if (ov) {
      base = JSON.parse(JSON.stringify(base));
      Object.keys(ov).forEach(function (k) {
        if (k === "fuels") {
          FUELS.forEach(function (f) { if (ov.fuels[f.key]) base.fuels[f.key] = Object.assign({}, base.fuels[f.key], ov.fuels[f.key]); });
        } else { base[k] = ov[k]; }
      });
      base.simulated = false;
      base.unknown = false;
    }
    var reps = getReports()[st.id] || [];
    var last = reps[reps.length - 1];
    if (last && (!base.updatedAt || last.at >= base.updatedAt || !ov)) {
      base.queue = last.status;
      base.queueReportedAt = last.at;
      base.queueReports = reps.filter(function (x) { return Date.now() - x.at < 3 * 3600000; }).length;
      base.unknown = false;
    }
    return base;
  }

  function overallTone(state) {
    if (state.unknown) return "na";
    if (!state.open) return "out";
    var statuses = FUELS.map(function (f) { return state.fuels[f.key].status; });
    var any = statuses.some(function (s) { return s === "ok" || s === "low"; });
    if (!any || state.queue === "empty") return "out";
    if (state.queue === "long" || !statuses.some(function (s) { return s === "ok"; })) return "warn";
    return "ok";
  }

  function saveStation(id, patch) {
    var all = getOverrides();
    all[id] = Object.assign({}, all[id] || {}, patch, { updatedAt: Date.now(), updatedBy: "gerente" });
    write(KEYS.overrides, all);
    return all[id];
  }

  function addReport(id, status) {
    var all = getReports();
    var list = (all[id] || []).concat([{ status: status, at: Date.now() }]).slice(-20);
    all[id] = list;
    write(KEYS.reports, all);
  }

  /* ---------- pagos (simulados) ---------- */
  function payments() { return read(KEYS.payments, []); }

  function makeCode() {
    var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var s = "";
    for (var i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return "TY-" + s.slice(0, 3) + "-" + s.slice(3);
  }

  function createPayment(p) {
    var list = payments();
    var pay = Object.assign({ id: "p" + Date.now().toString(36), code: makeCode(), status: "pagado", createdAt: Date.now() }, p);
    list.unshift(pay);
    write(KEYS.payments, list.slice(0, 300));
    if (p.method === "wallet") setWallet(wallet() - p.totalUsd);
    return pay;
  }

  function updatePayment(code, patch) {
    var list = payments();
    var found = null;
    list.forEach(function (p) { if (p.code === code) { Object.assign(p, patch); found = p; } });
    write(KEYS.payments, list);
    return found;
  }

  function wallet() { var w = read(KEYS.wallet, null); return w === null ? 25 : w; }
  function setWallet(v) { write(KEYS.wallet, Math.max(0, Math.round(v * 100) / 100)); }

  /* ---------- sesión de gerente ---------- */
  function session() { return read(KEYS.session, null); }
  function setSession(s) {
    if (s) write(KEYS.session, s);
    else { try { window.localStorage.removeItem(KEYS.session); } catch (e) {} }
  }

  /* ---------- estaciones reales (OpenStreetMap) ---------- */
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var QUERY = '[out:json][timeout:90];area["ISO3166-1"="VE"][admin_level=2]->.ve;' +
    '(node["amenity"="fuel"](area.ve);way["amenity"="fuel"](area.ve););out center tags;';

  function parseOsm(json) {
    return (json.elements || []).map(function (el) {
      var t = el.tags || {};
      var lat = el.lat != null ? el.lat : el.center && el.center.lat;
      var lng = el.lon != null ? el.lon : el.center && el.center.lon;
      if (lat == null || lng == null) return null;
      var street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
      var city = t["addr:city"] || t["addr:municipality"] || t["is_in:city"] || "";
      var brand = t.brand || t.operator || "";
      return {
        id: "osm-" + el.type[0] + el.id,
        name: t.name || (brand ? "Estación " + brand : "Estación de servicio"),
        brand: brand,
        lat: +lat.toFixed(5), lng: +lng.toFixed(5),
        address: street || t["addr:full"] || "",
        city: [city, t["addr:state"]].filter(Boolean).join(", "),
        source: "osm"
      };
    }).filter(Boolean);
  }

  function cachedOsm() {
    var c = read(KEYS.osm, null);
    if (c && c.stations && c.stations.length && Date.now() - c.at < 7 * 86400000) return c;
    return null;
  }

  function fetchOsm() {
    var body = "data=" + encodeURIComponent(QUERY);
    function attempt(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error("Sin conexión con OpenStreetMap"));
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 60000);
      return fetch(OVERPASS[i], {
        method: "POST", body: body, signal: ctl ? ctl.signal : undefined,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (json) {
        var stations = parseOsm(json);
        if (!stations.length) throw new Error("Respuesta vacía");
        write(KEYS.osm, { at: Date.now(), stations: stations });
        return { at: Date.now(), stations: stations };
      }).catch(function () { clearTimeout(timer); return attempt(i + 1); });
    }
    return attempt(0);
  }

  function resetDemo() {
    [KEYS.overrides, KEYS.reports, KEYS.payments, KEYS.wallet, KEYS.session].forEach(function (k) {
      try { window.localStorage.removeItem(k); } catch (e) {}
    });
  }

  window.TYStore = {
    FUELS: FUELS, AVAIL: AVAIL, QUEUE: QUEUE, MODALITY: MODALITY, DEFAULTS: DEFAULTS,
    settings: settings, setSettings: setSettings,
    stateOf: stateOf, overallTone: overallTone, saveStation: saveStation, addReport: addReport,
    payments: payments, createPayment: createPayment, updatePayment: updatePayment,
    wallet: wallet, setWallet: setWallet,
    session: session, setSession: setSession,
    cachedOsm: cachedOsm, fetchOsm: fetchOsm, resetDemo: resetDemo
  };
})();
