/*
 * Tanque ya: capa de datos.
 *
 * Dos modos con la misma interfaz:
 *  - demo: todo se guarda en este navegador (localStorage).
 *  - live: Supabase (base de datos compartida, cuentas y pagos reales con
 *          Pago Móvil confirmados por el gerente). Se activa en config.js.
 *
 * Las lecturas son síncronas sobre una copia en memoria; las escrituras
 * devuelven promesas. refresh() vuelve a traer los datos del servidor.
 */
(function () {
  "use strict";

  var CFG = window.TY_CONFIG || {};
  var LIVE = !window.TY_EMBED && !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var FEE = typeof CFG.fee === "number" ? CFG.fee : 0.01;

  var KEYS = {
    overrides: "ty.stations.v1",
    reports: "ty.reports.v1",
    payments: "ty.payments.v2",
    settings: "ty.settings.v1",
    session: "ty.session.v1",
    osm: "ty.osm.v2"
  };

  function read(key, fallback) {
    try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function remove(key) { try { window.localStorage.removeItem(key); } catch (e) {} }

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
  var MODALITY = { intl: "Precio internacional ($)", subs: "Subsidiada (Bs)" };
  var STATUS = {
    por_verificar: { label: "Esperando confirmación", tone: "warn" },
    aprobado: { label: "Listo para despachar", tone: "ok" },
    rechazado: { label: "Rechazado", tone: "out" },
    despachado: { label: "Despachado", tone: "na" }
  };
  // Códigos de banco usados en Pago Móvil. Revisa la lista con tu banco antes de producción.
  var BANKS = [
    ["0102", "Banco de Venezuela"], ["0104", "Venezolano de Crédito"], ["0105", "Mercantil"],
    ["0108", "Provincial"], ["0114", "Bancaribe"], ["0115", "Exterior"], ["0128", "Banco Caroní"],
    ["0134", "Banesco"], ["0137", "Sofitasa"], ["0138", "Banco Plaza"], ["0151", "BFC"],
    ["0156", "100% Banco"], ["0157", "DelSur"], ["0163", "Banco del Tesoro"], ["0166", "Banco Agrícola"],
    ["0168", "Bancrecer"], ["0169", "Mi Banco"], ["0171", "Banco Activo"], ["0172", "Bancamiga"],
    ["0174", "Banplus"], ["0175", "Banco Digital de los Trabajadores"], ["0177", "Banfanb"], ["0191", "BNC"]
  ];
  function bankName(code) {
    for (var i = 0; i < BANKS.length; i++) if (BANKS[i][0] === code) return BANKS[i][1];
    return code || "";
  }

  // Frescura: pasado STALE el dato se marca como viejo; pasado EXPIRE deja de contar.
  var HOUR = 3600000;
  var FRESH = { stale: 6 * HOUR, expire: 24 * HOUR, restock: 6 * HOUR, queue: 3 * HOUR };
  var DEFAULTS = { rate: 230.0, priceIntl: 0.5, priceSubs: 0.02, fee: FEE };

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
  function round2(n) { return Math.round(n * 100) / 100; }
  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  /* ---------- copia en memoria ---------- */
  var cache = {
    overrides: {},   // id -> estado publicado por el gerente
    reports: {},     // id -> [{status, at}]
    payments: [],    // míos y, si soy gerente, los de mi estación
    manager: null,   // {stationId, email, live:boolean} | null
    user: null       // usuario de Supabase (anónimo o con email)
  };

  function loadDemo() {
    cache.overrides = read(KEYS.overrides, {});
    cache.reports = read(KEYS.reports, {});
    cache.payments = read(KEYS.payments, []);
    var s = read(KEYS.session, null);
    cache.manager = s && s.stationId ? { stationId: s.stationId, live: false } : null;
  }

  /* ---------- ajustes ---------- */
  function settings() {
    var s = read(KEYS.settings, {});
    // En producción no se simulan datos salvo que se active a propósito.
    return { simulate: LIVE ? s.simulate === true : s.simulate !== false };
  }
  function setSettings(patch) {
    var s = Object.assign(read(KEYS.settings, {}), patch);
    write(KEYS.settings, s);
    return settings();
  }

  /* ---------- estado simulado ---------- */
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
    var restock = anyFuel && r() < 0.18;
    var bank = BANKS[Math.floor(r() * BANKS.length)][0];
    var n = 1000 + Math.floor(r() * 8999);
    return {
      fuels: fuels, modality: modality, rate: DEFAULTS.rate,
      open: r() > 0.06,
      hours: r() < 0.35 ? "24 horas" : "6:00 a. m. – 8:00 p. m.",
      queue: queue,
      acceptsApp: r() < 0.7,
      pm: { bank: bank, phone: "0412555" + n, doc: "J-40" + n + "55-1", holder: st.name + " (demo)" },
      updatedAt: Date.now() - minutesAgo * 60000,
      restockedAt: restock ? Date.now() - minutesAgo * 60000 : null,
      updatedBy: "simulado",
      simulated: true
    };
  }

  function emptyState() {
    return {
      fuels: { g91: { status: null, price: null }, g95: { status: null, price: null }, diesel: { status: null, price: null } },
      modality: "intl", rate: DEFAULTS.rate, open: true, hours: "", queue: null, acceptsApp: false,
      pm: { bank: "", phone: "", doc: "", holder: "" },
      updatedAt: null, restockedAt: null, updatedBy: null, simulated: false, unknown: true
    };
  }

  function stateOf(st) {
    var base = settings().simulate ? simulated(st) : emptyState();
    var ov = cache.overrides[st.id];
    if (ov) {
      base = JSON.parse(JSON.stringify(base));
      Object.keys(ov).forEach(function (k) {
        if (k === "fuels") {
          FUELS.forEach(function (f) { if (ov.fuels && ov.fuels[f.key]) base.fuels[f.key] = Object.assign({}, base.fuels[f.key], ov.fuels[f.key]); });
        } else if (k === "pm") {
          base.pm = Object.assign({}, base.pm, ov.pm);
        } else { base[k] = ov[k]; }
      });
      base.simulated = false;
      base.unknown = false;
      base.registered = true;
    }
    var now = Date.now();
    var age = base.updatedAt ? now - base.updatedAt : null;
    // Lo que publicó el gerente caduca: un dato viejo es peor que no tener dato.
    if (ov && age != null) {
      base.stale = age > FRESH.stale;
      base.expired = age > FRESH.expire;
      if (base.stale) base.queue = null;
    }
    var reps = (cache.reports[st.id] || []).filter(function (x) { return now - x.at < FRESH.queue; });
    var last = reps[reps.length - 1];
    if (last && (!ov || !base.updatedAt || last.at >= base.updatedAt)) {
      base.queue = last.status;
      base.queueReportedAt = last.at;
      base.queueReports = reps.length;
      base.unknown = false;
    }
    var hasFuel = FUELS.some(function (f) { var s = base.fuels[f.key].status; return s === "ok" || s === "low"; });
    base.restocked = !!(base.restockedAt && now - base.restockedAt < FRESH.restock && hasFuel && base.open && !base.expired);
    return base;
  }

  function pmReady(state) { return !!(state.pm && state.pm.bank && state.pm.phone && state.pm.doc); }

  function overallTone(state) {
    if (state.unknown) return "na";
    if (state.expired) return state.queueReportedAt ? (state.queue === "empty" ? "out" : state.queue === "long" ? "warn" : "na") : "na";
    if (!state.open) return "out";
    var statuses = FUELS.map(function (f) { return state.fuels[f.key].status; });
    var any = statuses.some(function (s) { return s === "ok" || s === "low"; });
    if (!any || state.queue === "empty") return "out";
    if (state.queue === "long" || !statuses.some(function (s) { return s === "ok"; })) return "warn";
    return "ok";
  }

  /* =====================================================================
   * Supabase
   * =================================================================== */
  var sb = null;

  function loadScript(src) {
    return new Promise(function (ok, ko) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { ko(err("No se pudo cargar " + src)); };
      document.head.appendChild(s);
    });
  }

  function rowToOverride(r) {
    return {
      name: r.name, open: r.open, hours: r.hours, queue: r.queue, acceptsApp: r.accepts_app,
      modality: r.modality, rate: +r.rate, fuels: r.fuels || {},
      pm: { bank: r.pm_bank, phone: r.pm_phone, doc: r.pm_doc, holder: r.pm_holder },
      updatedAt: Date.parse(r.updated_at), restockedAt: r.restocked_at ? Date.parse(r.restocked_at) : null, updatedBy: "gerente"
    };
  }
  function rowToPayment(r) {
    return {
      id: r.id, code: r.code, stationId: r.station_id, stationName: r.station_name, fuel: r.fuel,
      liters: +r.liters, priceUsd: +r.price_usd, rate: +r.rate, totalUsd: +r.total_usd, totalBs: +r.total_bs,
      feeUsd: +r.fee_usd, payerBank: r.payer_bank, payerPhone: r.payer_phone, payerDoc: r.payer_doc,
      reference: r.reference, vehicle: r.vehicle || "", status: r.status, rejectReason: r.reject_reason,
      createdAt: Date.parse(r.created_at), verifiedAt: r.verified_at ? Date.parse(r.verified_at) : null,
      dispatchedAt: r.dispatched_at ? Date.parse(r.dispatched_at) : null,
      mine: cache.user ? r.driver_id === cache.user.id : false
    };
  }
  function sbErr(e) {
    var m = (e && (e.message || e.error_description)) || "Error de conexión";
    if (/payments_station_id_reference_key|duplicate key/.test(m)) m = "Esa referencia ya se usó en esta estación.";
    else if (/Invalid login credentials/i.test(m)) m = "Correo o contraseña incorrectos.";
    else if (/Email not confirmed/i.test(m)) m = "Confirma tu correo con el enlace que te enviamos y vuelve a entrar.";
    else if (/Anonymous sign-ins are disabled/i.test(m)) m = "El servidor no permite pagos sin cuenta todavía (activa los inicios anónimos en Supabase).";
    else if (/Failed to fetch|NetworkError/i.test(m)) m = "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
    return err(m);
  }

  function ensureUser() {
    if (cache.user) return Promise.resolve(cache.user);
    return sb.auth.signInAnonymously().then(function (res) {
      if (res.error) throw sbErr(res.error);
      cache.user = res.data.user;
      return cache.user;
    });
  }

  function liveLoadManager() {
    cache.manager = null;
    if (!cache.user || cache.user.is_anonymous) return Promise.resolve();
    return sb.from("station_managers").select("station_id").then(function (res) {
      if (res.error) throw sbErr(res.error);
      cache.manager = {
        stationId: res.data[0] ? res.data[0].station_id : null,
        email: cache.user.email, live: true
      };
    });
  }

  function liveRefresh() {
    var since = new Date(Date.now() - 3 * 3600000).toISOString();
    var jobs = [
      sb.from("stations").select("*").then(function (res) {
        if (res.error) throw sbErr(res.error);
        var o = {};
        res.data.forEach(function (r) { o[r.id] = rowToOverride(r); o[r.id].geo = { lat: r.lat, lng: r.lng, name: r.name, address: r.address, city: r.city }; });
        cache.overrides = o;
      }),
      sb.from("queue_reports").select("station_id,status,created_at").gte("created_at", since).order("created_at").limit(5000).then(function (res) {
        if (res.error) throw sbErr(res.error);
        var rep = {};
        res.data.forEach(function (r) { (rep[r.station_id] = rep[r.station_id] || []).push({ status: r.status, at: Date.parse(r.created_at) }); });
        cache.reports = rep;
      })
    ];
    if (cache.user) {
      jobs.push(sb.from("payments").select("*").order("created_at", { ascending: false }).limit(300).then(function (res) {
        if (res.error) throw sbErr(res.error);
        cache.payments = res.data.map(rowToPayment);
      }));
    }
    return Promise.all(jobs);
  }

  /* =====================================================================
   * API pública
   * =================================================================== */
  function init() {
    if (!LIVE) { loadDemo(); return Promise.resolve(); }
    return loadScript("vendor/supabase/supabase.js").then(function () {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return sb.auth.getSession();
    }).then(function (res) {
      cache.user = res.data && res.data.session ? res.data.session.user : null;
      return liveLoadManager();
    }).then(liveRefresh);
  }

  function refresh() {
    if (!LIVE) { loadDemo(); return Promise.resolve(); }
    return liveRefresh();
  }

  function saveStation(id, patch) {
    if (!LIVE) {
      var all = read(KEYS.overrides, {});
      all[id] = Object.assign({}, all[id] || {}, patch, { updatedAt: Date.now(), updatedBy: "gerente" });
      write(KEYS.overrides, all);
      cache.overrides = all;
      return Promise.resolve(all[id]);
    }
    var row = {
      open: patch.open, hours: patch.hours, queue: patch.queue, accepts_app: patch.acceptsApp,
      modality: patch.modality, rate: patch.rate, fuels: patch.fuels,
      pm_bank: patch.pm.bank, pm_phone: patch.pm.phone, pm_doc: patch.pm.doc, pm_holder: patch.pm.holder
    };
    if (patch.restockedAt) row.restocked_at = new Date(patch.restockedAt).toISOString();
    return sb.from("stations").update(row).eq("id", id).select().then(function (res) {
      if (res.error) throw sbErr(res.error);
      if (!res.data.length) throw err("No tienes permiso para editar esta estación.");
      var o = rowToOverride(res.data[0]);
      o.geo = (cache.overrides[id] || {}).geo;
      cache.overrides[id] = o;
      return o;
    });
  }

  function addReport(id, status) {
    if (!LIVE) {
      var all = read(KEYS.reports, {});
      var list = (all[id] || []).concat([{ status: status, at: Date.now() }]).slice(-20);
      all[id] = list;
      write(KEYS.reports, all);
      cache.reports = all;
      return Promise.resolve();
    }
    return ensureUser().then(function () {
      return sb.from("queue_reports").insert({ station_id: id, status: status });
    }).then(function (res) {
      if (res.error) throw sbErr(res.error);
      (cache.reports[id] = cache.reports[id] || []).push({ status: status, at: Date.now() });
    });
  }

  function payments() { return cache.payments.slice(); }

  function makeCode() {
    var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return "TY-" + s.slice(0, 3) + "-" + s.slice(3);
  }

  // p: {stationId, stationName, fuel, liters, payerBank, payerPhone, payerDoc, reference}
  function createPayment(p) {
    if (!LIVE) {
      var list = read(KEYS.payments, []);
      if (list.some(function (x) { return x.stationId === p.stationId && x.reference === p.reference; })) {
        return Promise.reject(err("Esa referencia ya se usó en esta estación."));
      }
      var st = p._state;
      var price = st.fuels[p.fuel].price, rate = st.rate || DEFAULTS.rate;
      var total = round2(p.liters * price);
      var pay = {
        id: "p" + Date.now().toString(36), code: makeCode(), stationId: p.stationId, stationName: p.stationName,
        fuel: p.fuel, liters: p.liters, priceUsd: price, rate: rate, totalUsd: total, totalBs: round2(p.liters * price * rate),
        feeUsd: round2(total * FEE), payerBank: p.payerBank, payerPhone: p.payerPhone, payerDoc: p.payerDoc,
        reference: p.reference, vehicle: p.vehicle || "", status: "por_verificar", createdAt: Date.now(), mine: true
      };
      list.unshift(pay);
      write(KEYS.payments, list.slice(0, 300));
      cache.payments = list;
      return Promise.resolve(pay);
    }
    return ensureUser().then(function () {
      return sb.from("payments").insert({
        station_id: p.stationId, fuel: p.fuel, liters: p.liters, payer_bank: p.payerBank,
        payer_phone: p.payerPhone, payer_doc: p.payerDoc, reference: p.reference, vehicle: p.vehicle || ""
      }).select().single();
    }).then(function (res) {
      if (res.error) throw sbErr(res.error);
      var pay = rowToPayment(res.data);
      pay.mine = true;
      cache.payments.unshift(pay);
      return pay;
    });
  }

  function setPaymentStatus(code, status, reason) {
    if (!LIVE) {
      var list = read(KEYS.payments, []), found = null;
      list.forEach(function (p) {
        if (p.code !== code) return;
        p.status = status;
        if (status === "rechazado") p.rejectReason = reason || "";
        if (status === "aprobado" || status === "rechazado") p.verifiedAt = Date.now();
        if (status === "despachado") p.dispatchedAt = Date.now();
        found = p;
      });
      write(KEYS.payments, list);
      cache.payments = list;
      return Promise.resolve(found);
    }
    var patch = { status: status };
    if (status === "rechazado") patch.reject_reason = reason || "";
    return sb.from("payments").update(patch).eq("code", code).select().single().then(function (res) {
      if (res.error) throw sbErr(res.error);
      var pay = rowToPayment(res.data);
      cache.payments = cache.payments.map(function (x) { return x.code === code ? Object.assign(pay, { mine: x.mine }) : x; });
      return pay;
    });
  }

  /* ---------- gerentes ---------- */
  function manager() { return cache.manager; }

  function demoLogin(stationId) {
    write(KEYS.session, { stationId: stationId, at: Date.now() });
    cache.manager = { stationId: stationId, live: false };
  }

  function signIn(email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw sbErr(res.error);
      cache.user = res.data.user;
      return liveLoadManager();
    }).then(liveRefresh).then(function () { return cache.manager; });
  }

  function signUp(email, password) {
    return sb.auth.signUp({ email: email, password: password }).then(function (res) {
      if (res.error) throw sbErr(res.error);
      if (res.data.session) { cache.user = res.data.user; return liveLoadManager().then(function () { return { confirmed: true }; }); }
      return { confirmed: false };
    });
  }

  function signOut() {
    if (!LIVE) { remove(KEYS.session); cache.manager = null; return Promise.resolve(); }
    return sb.auth.signOut().then(function () {
      cache.user = null; cache.manager = null; cache.payments = [];
    });
  }

  function requestStation(st, contact, rif) {
    if (!LIVE) return Promise.resolve();
    return sb.from("station_requests").insert({
      station_id: st.id, name: st.name, lat: st.lat, lng: st.lng, address: st.address || "", city: st.city || "",
      contact: contact, rif: rif
    }).then(function (res) { if (res.error) throw sbErr(res.error); });
  }

  function myRequests() {
    if (!LIVE || !cache.user) return Promise.resolve([]);
    return sb.from("station_requests").select("*").order("created_at", { ascending: false }).then(function (res) {
      if (res.error) throw sbErr(res.error);
      return res.data;
    });
  }

  // Estaciones activadas en la base de datos que no están en el listado del mapa.
  function registeredStations() {
    return Object.keys(cache.overrides).map(function (id) {
      var g = cache.overrides[id].geo;
      return g ? { id: id, name: g.name, lat: g.lat, lng: g.lng, address: g.address, city: g.city, brand: "", source: "db" } : null;
    }).filter(Boolean);
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
      if (i >= OVERPASS.length) return Promise.reject(err("Sin conexión con OpenStreetMap"));
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
    [KEYS.overrides, KEYS.reports, KEYS.payments, KEYS.session].forEach(remove);
    loadDemo();
  }

  window.TYStore = {
    LIVE: LIVE, FUELS: FUELS, AVAIL: AVAIL, QUEUE: QUEUE, MODALITY: MODALITY, STATUS: STATUS,
    BANKS: BANKS, bankName: bankName, DEFAULTS: DEFAULTS, FRESH: FRESH,
    init: init, refresh: refresh, settings: settings, setSettings: setSettings,
    stateOf: stateOf, pmReady: pmReady, overallTone: overallTone, saveStation: saveStation, addReport: addReport,
    payments: payments, createPayment: createPayment, setPaymentStatus: setPaymentStatus,
    manager: manager, demoLogin: demoLogin, signIn: signIn, signUp: signUp, signOut: signOut,
    requestStation: requestStation, myRequests: myRequests, registeredStations: registeredStations,
    cachedOsm: cachedOsm, fetchOsm: fetchOsm, resetDemo: resetDemo
  };
})();
