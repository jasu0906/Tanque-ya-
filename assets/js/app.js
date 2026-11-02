/* Tanque ya: interfaz. Depende de Leaflet, Leaflet.markercluster, qrcode-generator y TYStore. */
(function () {
  "use strict";

  var S = window.TYStore;
  // Modo vista previa: sin teselas externas ni descarga de OpenStreetMap.
  var EMBED = !!window.TY_EMBED;
  var FUELS = S.FUELS;

  /* =========================================================
   * Utilidades
   * ======================================================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var nf2 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf0 = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });
  function usd(n) { return n == null || isNaN(n) ? "—" : "$" + nf2.format(n); }
  function bs(n) { return n == null || isNaN(n) ? "—" : "Bs " + nf2.format(n); }
  function ago(ts) {
    if (!ts) return "sin datos";
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "ahora mismo";
    if (m < 60) return "hace " + m + " min";
    var h = Math.round(m / 60);
    if (h < 24) return "hace " + h + " h";
    return "hace " + Math.round(h / 24) + " d";
  }
  function km(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtKm(d) { return d < 1 ? nf0.format(d * 1000) + " m" : nf1.format(d) + " km"; }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function isMobile() { return window.matchMedia("(max-width: 899px)").matches; }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  var PUMP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6h1a2 2 0 0 1 2 2v4a1 1 0 0 0 2 0V9.4l-2.7-2.7 1.4-1.4L22 8.6V17a3 3 0 0 1-6 0v-4h-1v8H4Zm2-16v5h7V5H6Z"/></svg>';
  var TONE_LABEL = { ok: "Hay combustible", warn: "Poco o cola larga", out: "Sin combustible", na: "Sin reportar" };

  /* =========================================================
   * Estado de la app
   * ======================================================= */
  var app = {
    stations: [],
    byId: {},
    source: "demo",
    userLoc: null,
    filters: {},
    search: "",
    selected: null,
    markers: {},
    map: null,
    cluster: null,
    userMarker: null
  };

  function setStations(list, source) {
    var ids = {};
    list.forEach(function (s) { ids[s.id] = true; });
    list = list.concat(S.registeredStations().filter(function (s) { return !ids[s.id]; }));
    app.stations = list;
    app.source = source;
    app.byId = {};
    list.forEach(function (s) { app.byId[s.id] = s; s._search = norm([s.name, s.brand, s.address, s.city].join(" ")); });
    updateDataChip();
  }

  function updateDataChip() {
    var dot = $("#dataDot"), label = $("#dataLabel");
    var n = nf0.format(app.stations.length);
    if (app.source === "osm") { dot.className = "dot dot--ok"; label.textContent = n + " estaciones"; }
    else if (app.source === "loading") { dot.className = "dot dot--warn"; label.textContent = "Cargando estaciones…"; }
    else if (S.LIVE) { dot.className = "dot dot--warn"; label.textContent = n + " estaciones"; }
    else { dot.className = "dot dot--warn"; label.textContent = n + " estaciones demo"; }
  }

  // Confirmación en dos toques (los diálogos del navegador no siempre se muestran).
  function armed(btn, msg) {
    if (btn.getAttribute("data-armed") === "1") return true;
    var old = btn.textContent;
    btn.setAttribute("data-armed", "1"); btn.textContent = msg; btn.classList.add("is-armed");
    setTimeout(function () { btn.removeAttribute("data-armed"); btn.textContent = old; btn.classList.remove("is-armed"); }, 4000);
    return false;
  }

  /* =========================================================
   * Toast y modal
   * ======================================================= */
  var toastTimer;
  function toast(msg, tone) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (tone ? " toast--" + tone : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  var modalOnClose = null;
  function openModal(html, opts) {
    opts = opts || {};
    $("#modalBody").innerHTML = html;
    var m = $("#modal");
    m.hidden = false;
    m.className = "modal" + (opts.wide ? " modal--wide" : "");
    document.body.classList.add("no-scroll");
    modalOnClose = opts.onClose || null;
    var f = $("#modalBody [autofocus]") || $("#modalBody button, #modalBody input");
    if (f && !isMobile()) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() {
    $("#modal").hidden = true;
    document.body.classList.remove("no-scroll");
    var cb = modalOnClose; modalOnClose = null;
    if (cb) cb();
  }
  document.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  /* =========================================================
   * Mapa
   * ======================================================= */
  var VE_BOUNDS = L.latLngBounds([0.4, -74.5], [13.2, -59.0]);

  function initMap() {
    var map = L.map("map", {
      zoomControl: false, minZoom: 5, maxZoom: 19,
      maxBounds: VE_BOUNDS.pad(0.3), maxBoundsViscosity: 0.8, worldCopyJump: false
    }).fitBounds([[0.8, -73.4], [12.4, -59.8]]);
    L.control.zoom({ position: "bottomright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(map);
    map.attributionControl.setPrefix(false);
    if (isMobile()) map.attributionControl.setPosition("topleft");

    var tileErrors = 0, fallbackOn = false;
    var carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
    });
    carto.on("tileerror", function () {
      tileErrors++;
      if (tileErrors > 8 && !fallbackOn) {
        fallbackOn = true;
        map.removeLayer(carto);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);
      }
    });
    if (EMBED) { map.getContainer().classList.add("map--offline"); map.attributionControl.addAttribution("Contorno: Natural Earth"); }
    else carto.addTo(map);

    // Resalta Venezuela y oscurece lo de fuera.
    if (window.VE_OUTLINE) {
      var g = window.VE_OUTLINE.geometry;
      var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      var holes = polys.map(function (p) { return p[0].map(function (c) { return [c[1], c[0]]; }); });
      var world = [[-60, -140], [-60, 20], [40, 20], [40, -140]];
      L.polygon([world].concat(holes), {
        stroke: false, fillColor: "#0b1f24", fillOpacity: 0.16, interactive: false, className: "ve-mask"
      }).addTo(map);
      L.polygon(holes, { color: "#0f766e", weight: 1.5, opacity: 0.8, fill: EMBED, fillColor: "var(--land)", fillOpacity: 1, interactive: false, className: "ve-land" }).addTo(map);
      if (EMBED && window.DEMO_CITIES) {
        var labels = L.layerGroup(window.DEMO_CITIES.map(function (c) {
          return L.marker([c[2], c[3]], { interactive: false, keyboard: false,
            icon: L.divIcon({ className: "city-label", html: "<span>" + esc(c[0]) + "</span>", iconSize: [0, 0] }) });
        }));
        var syncLabels = function () { if (map.getZoom() >= 7) labels.addTo(map); else map.removeLayer(labels); };
        map.on("zoomend", syncLabels); syncLabels();
      }
    }

    app.cluster = L.markerClusterGroup({
      chunkedLoading: true, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
      maxClusterRadius: function (z) { return z < 9 ? 55 : 38; },
      disableClusteringAtZoom: 16,
      iconCreateFunction: function (cluster) {
        var ms = cluster.getAllChildMarkers(), ok = 0, known = 0;
        ms.forEach(function (m) { var t = m.options.tone; if (t !== "na") known++; if (t === "ok") ok++; });
        var share = known ? ok / known : -1;
        var tone = share < 0 ? "na" : share >= 0.6 ? "ok" : share >= 0.3 ? "warn" : "out";
        var n = cluster.getChildCount();
        var size = n < 10 ? 36 : n < 100 ? 42 : 50;
        return L.divIcon({
          html: '<span class="cl cl--' + tone + '"><b>' + nf0.format(n) + "</b></span>",
          className: "cl-wrap", iconSize: [size, size]
        });
      }
    });
    map.addLayer(app.cluster);

    map.on("moveend", function () { if (!app.search) renderList(); });
    app.map = map;
  }

  function markerIcon(tone, selected) {
    return L.divIcon({
      className: "pin-wrap",
      html: '<span class="pin pin--' + tone + (selected ? " is-selected" : "") + '">' + PUMP + "</span>",
      iconSize: [32, 32], iconAnchor: [16, 30]
    });
  }

  function passes(st, state) {
    var f = app.filters;
    var has = function (k) { var s = state.fuels[k].status; return s === "ok" || s === "low"; };
    if (f.gas && !(state.open && (has("g91") || has("g95")))) return false;
    if (f.diesel && !(state.open && has("diesel"))) return false;
    if (f.noqueue && !(state.queue === "none" || state.queue === "short")) return false;
    if (f.pay && !(state.acceptsApp && state.open)) return false;
    return true;
  }

  function renderMarkers() {
    app.cluster.clearLayers();
    app.markers = {};
    var batch = [];
    app.stations.forEach(function (st) {
      var state = S.stateOf(st);
      st._state = state;
      st._tone = S.overallTone(state);
      if (!passes(st, state)) return;
      var m = L.marker([st.lat, st.lng], {
        icon: markerIcon(st._tone, app.selected === st.id), tone: st._tone,
        title: st.name, keyboard: true, riseOnHover: true
      });
      m.on("click", function () { openStation(st.id, { fly: false }); });
      app.markers[st.id] = m;
      batch.push(m);
    });
    app.cluster.addLayers(batch);
  }

  function refreshStation(id) {
    var st = app.byId[id];
    if (!st) return;
    st._state = S.stateOf(st);
    st._tone = S.overallTone(st._state);
    var m = app.markers[id];
    if (m) { m.options.tone = st._tone; m.setIcon(markerIcon(st._tone, app.selected === id)); app.cluster.refreshClusters(m); }
  }

  /* =========================================================
   * Lista lateral
   * ======================================================= */
  function stationCard(st) {
    var state = st._state || S.stateOf(st);
    var tone = st._tone || S.overallTone(state);
    var dist = app.userLoc ? '<span class="dist">' + fmtKm(km(app.userLoc, st)) + "</span>" : "";
    var fuels = FUELS.map(function (f) {
      var fs = state.fuels[f.key];
      if (!fs.status || fs.status === "none") return "";
      return '<span class="fpill fpill--' + S.AVAIL[fs.status].tone + '" title="' + esc(f.label + ": " + S.AVAIL[fs.status].label) + '">' + esc(f.short) + "</span>";
    }).join("");
    var price = state.fuels.g91.price != null ? usd(state.fuels.g91.price) + "<small>/L</small>" : "";
    var q = state.queue ? '<span class="qtag qtag--' + S.QUEUE[state.queue].tone + '">' + esc(S.QUEUE[state.queue].label) + "</span>" : "";
    return '<li><button type="button" class="scard" data-id="' + esc(st.id) + '">' +
      '<span class="scard__pin pin pin--' + tone + '">' + PUMP + "</span>" +
      '<span class="scard__body">' +
      '<span class="scard__row"><strong class="scard__name">' + esc(st.name) + "</strong>" + dist + "</span>" +
      '<span class="scard__addr">' + esc([st.address, st.city].filter(Boolean).join(" · ") || (st.brand || "Venezuela")) + "</span>" +
      '<span class="scard__row scard__meta">' +
      (state.unknown ? '<span class="muted">Sin reportes todavía</span>' : (state.open ? "" : '<span class="qtag qtag--out">Cerrada</span>') + fuels + q) +
      '<span class="scard__price">' + price + "</span></span>" +
      "</span></button></li>";
  }

  function renderList() {
    var list = $("#stationList");
    var items, title;
    if (app.search) {
      var q = norm(app.search);
      items = app.stations.filter(function (s) { return s._search.indexOf(q) !== -1; });
      title = "Resultados";
    } else {
      var b = app.map.getBounds();
      items = app.stations.filter(function (s) { return b.contains([s.lat, s.lng]); });
      title = app.map.getZoom() <= 6 ? "Toda Venezuela" : "Estaciones en esta zona";
    }
    items = items.filter(function (s) { s._state = s._state || S.stateOf(s); return passes(s, s._state); });
    var rank = { ok: 0, warn: 1, na: 2, out: 3 };
    items.sort(function (a, b) {
      if (app.userLoc) return km(app.userLoc, a) - km(app.userLoc, b);
      return (rank[a._tone] - rank[b._tone]) || a.name.localeCompare(b.name, "es");
    });
    var total = items.length;
    var shown = items.slice(0, 60);
    $("#listTitle").textContent = title;
    $("#listCount").textContent = nf0.format(total) + (total === 1 ? " estación" : " estaciones");
    if (!total) {
      list.innerHTML = '<li class="empty">No hay estaciones que coincidan.' +
        (Object.keys(app.filters).some(function (k) { return app.filters[k]; }) ? " Prueba a quitar algún filtro." : " Mueve o aleja el mapa.") + "</li>";
      return;
    }
    list.innerHTML = shown.map(stationCard).join("") +
      (total > shown.length ? '<li class="more muted">Y ' + nf0.format(total - shown.length) + " más. Acerca el mapa o busca por nombre.</li>" : "");
  }

  /* =========================================================
   * Ficha de estación
   * ======================================================= */
  function openStation(id, opts) {
    opts = opts || {};
    var st = app.byId[id];
    if (!st) return;
    var prev = app.selected;
    app.selected = id;
    if (prev) refreshStation(prev);
    refreshStation(id);
    if (opts.fly !== false) {
      app.map.flyTo([st.lat, st.lng], Math.max(app.map.getZoom(), 15), { duration: 0.6 });
    } else if (isMobile()) {
      app.map.panTo([st.lat, st.lng]);
    }
    renderDetail();
    if (location.hash !== "#estacion-" + id) history.replaceState(null, "", "#estacion-" + id);
  }

  function closeStation() {
    var prev = app.selected;
    app.selected = null;
    if (prev) refreshStation(prev);
    $("#detailPane").hidden = true;
    $("#listPane").hidden = false;
    $("#panel").classList.remove("panel--detail");
    history.replaceState(null, "", "#mapa");
    renderList();
  }

  function renderDetail() {
    var st = app.byId[app.selected];
    if (!st) return;
    var state = S.stateOf(st);
    var tone = S.overallTone(state);
    var dist = app.userLoc ? " · a " + fmtKm(km(app.userLoc, st)) : "";
    var rate = state.rate || S.DEFAULTS.rate;
    var source = state.unknown ? "Esta estación todavía no tiene reportes."
      : state.simulated ? "Datos simulados para la demostración · " + ago(state.updatedAt)
      : "Actualizado por el gerente " + ago(state.updatedAt);

    var fuelRows = FUELS.map(function (f) {
      var fs = state.fuels[f.key];
      if (fs.status === "none") return "";
      var a = fs.status ? S.AVAIL[fs.status] : null;
      return '<div class="frow">' +
        '<div><strong>' + esc(f.label) + "</strong>" +
        (a ? '<span class="badge badge--' + a.tone + '">' + esc(a.label) + "</span>" : '<span class="badge badge--na">Sin dato</span>') + "</div>" +
        '<div class="frow__price"><strong>' + (fs.price != null ? usd(fs.price) : "—") + '</strong><small>por litro</small>' +
        (fs.price != null ? "<span>" + bs(fs.price * rate) + "</span>" : "") + "</div></div>";
    }).join("");

    var q = state.queue ? S.QUEUE[state.queue] : null;
    var queueBlock = '<div class="card card--soft">' +
      '<div class="card__head"><h3>Cola ahora</h3>' +
      (q ? '<span class="badge badge--' + q.tone + '">' + esc(q.label) + (q.mins ? " · " + q.mins : "") + "</span>" : '<span class="badge badge--na">Sin reportes</span>') + "</div>" +
      (state.queueReportedAt ? '<p class="muted small">Último reporte de un conductor ' + ago(state.queueReportedAt) +
        (state.queueReports > 1 ? " · " + state.queueReports + " reportes en 3 h" : "") + "</p>" : "") +
      '<p class="small">¿Estás aquí? Cuéntale a los demás cómo está:</p>' +
      '<div class="seg seg--4" role="group" aria-label="Reportar cola">' +
      ["none", "short", "long", "empty"].map(function (k) {
        return '<button type="button" class="seg__btn" data-report="' + k + '">' + esc(S.QUEUE[k].label) + "</button>";
      }).join("") + "</div></div>";

    var canPay = state.acceptsApp && state.open && S.pmReady(state) && FUELS.some(function (f) {
      var s = state.fuels[f.key].status; return (s === "ok" || s === "low") && state.fuels[f.key].price != null;
    });
    var payNote = !state.acceptsApp || !S.pmReady(state) ? "Esta estación todavía no acepta pagos con Tanque ya."
      : !state.open ? "La estación está cerrada ahora."
      : !canPay ? "No hay combustible disponible para pagar." : "Pagas con Pago Móvil directo a la estación y te damos un código para la bomba.";

    var gmaps = "https://www.google.com/maps/dir/?api=1&destination=" + st.lat + "," + st.lng;

    $("#detailPane").innerHTML =
      '<div class="detail">' +
      '<button type="button" class="back" id="backBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10.8 12 5.6 5.6L15 19l-7-7 7-7 1.4 1.4-5.6 5.6Z"/></svg>Volver a la lista</button>' +
      '<div class="detail__head">' +
      '<span class="pin pin--' + tone + ' pin--lg">' + PUMP + "</span>" +
      '<div><h2>' + esc(st.name) + "</h2>" +
      '<p class="muted">' + esc([st.brand, st.address, st.city].filter(Boolean).join(" · ") || "Venezuela") + esc(dist) + "</p>" +
      '<div class="chips-row">' +
      '<span class="badge badge--' + (state.open ? "ok" : "out") + '">' + (state.open ? "Abierta" : "Cerrada") + "</span>" +
      (state.hours ? '<span class="badge badge--na">' + esc(state.hours) + "</span>" : "") +
      '<span class="badge badge--na">' + esc(S.MODALITY[state.modality] || "") + "</span>" +
      "</div></div></div>" +
      '<p class="source ' + (state.simulated ? "source--sim" : "") + '">' + esc(source) + "</p>" +
      '<div class="card"><div class="card__head"><h3>Combustible y precio</h3><span class="muted small">Tasa: ' + bs(rate) + " por $</span></div>" +
      (fuelRows || '<p class="muted">Sin datos de combustible.</p>') + "</div>" +
      queueBlock +
      '<div class="detail__actions">' +
      '<button type="button" class="btn btn--primary btn--lg" id="payBtn"' + (canPay ? "" : " disabled") + ">" +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm2 3v9h14V9H5Zm0-3v1h14V6H5Z"/></svg>Pagar combustible</button>' +
      '<a class="btn btn--ghost btn--lg" href="' + gmaps + '" target="_blank" rel="noopener">Cómo llegar</a>' +
      "</div>" +
      '<p class="muted small center">' + esc(payNote) + "</p>" +
      '<a class="manage-link" href="#gerentes" data-manage="' + esc(st.id) + '">¿Eres el gerente de esta estación? Actualiza sus datos</a>' +
      "</div>";

    $("#listPane").hidden = true;
    $("#detailPane").hidden = false;
    $("#detailPane").scrollTop = 0;
    $("#panel").classList.add("panel--detail", "panel--open");

    $("#backBtn").onclick = closeStation;
    $("#payBtn").onclick = function () { openPayment(st.id); };
    $all("[data-report]", $("#detailPane")).forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        S.addReport(st.id, b.getAttribute("data-report")).then(function () {
          refreshStation(st.id);
          renderDetail();
          toast("Gracias, tu reporte ya lo ven los demás conductores.", "ok");
        }).catch(function (e) { b.disabled = false; toast(e.userMessage || "No se pudo enviar el reporte.", "err"); });
      };
    });
    $("[data-manage]", $("#detailPane")).onclick = function () { managerPrefill = st.id; };
  }

  /* =========================================================
   * Pago con Pago Móvil (directo a la estación)
   * ======================================================= */
  var pay = null;
  var openReceiptCode = null;
  var PAYER_KEY = "ty.payer.v1";

  function fuelLabel(key) { var f = FUELS.filter(function (x) { return x.key === key; })[0]; return f ? f.label : key; }
  function fmtPhone(p) { p = String(p || "").replace(/\D/g, ""); return p.length === 11 ? p.slice(0, 4) + "-" + p.slice(4, 7) + "-" + p.slice(7) : p; }
  function bankLabel(code) { return code ? code + " · " + S.bankName(code) : "—"; }

  function savedPayer() {
    try { return JSON.parse(window.localStorage.getItem(PAYER_KEY)) || {}; } catch (e) { return {}; }
  }
  function rememberPayer(p) {
    try { window.localStorage.setItem(PAYER_KEY, JSON.stringify({ bank: p.bank, phone: p.phone, doc: p.doc })); } catch (e) {}
  }

  function openPayment(id) {
    var st = app.byId[id], state = S.stateOf(st);
    var first = FUELS.filter(function (f) { var s = state.fuels[f.key].status; return s === "ok" || s === "low"; })[0];
    var saved = savedPayer();
    var demoPayer = S.LIVE ? {} : { bank: "0134", phone: "04145550101", doc: "V-12345678", reference: String(Date.now()).slice(-8) };
    pay = {
      st: st, state: state, step: 1, fuel: first && first.key, mode: "liters", amount: 20,
      payer: Object.assign({ bank: "", phone: "", doc: "", reference: "" }, demoPayer, saved, { reference: demoPayer.reference || "" })
    };
    renderPayment();
  }

  function payTotals() {
    var price = pay.state.fuels[pay.fuel].price;
    var rate = pay.state.rate || S.DEFAULTS.rate;
    var amt = Math.max(0, +pay.amount || 0);
    var liters = pay.mode === "liters" ? amt : (price && rate ? amt / (price * rate) : 0);
    liters = Math.floor(liters * 100) / 100;
    var usdTotal = Math.round(liters * price * 100) / 100;
    return { price: price, rate: rate, liters: liters, totalUsd: usdTotal, totalBs: Math.round(liters * price * rate * 100) / 100 };
  }

  function steps(n) {
    return '<ol class="steps">' + ["Cuánto", "Pago Móvil", "Referencia"].map(function (s, i) {
      return '<li class="' + (i + 1 < n ? "done" : i + 1 === n ? "now" : "") + '"><span>' + (i + 1) + "</span>" + s + "</li>";
    }).join("") + "</ol>";
  }

  function copyRow(label, value, shown) {
    return '<div class="pmrow"><dt>' + esc(label) + "</dt><dd><strong>" + esc(shown || value) + "</strong>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-copy="' + esc(value) + '">Copiar</button></dd></div>';
  }

  function renderPayment() {
    var st = pay.st, state = pay.state;
    var t = payTotals();
    var html;
    if (pay.step === 1) {
      html = '<h2 id="modalTitle">Pagar en ' + esc(st.name) + "</h2>" + steps(1) +
        '<p class="label">Combustible</p><div class="opts">' +
        FUELS.map(function (f) {
          var fs = state.fuels[f.key];
          if (fs.status === "none" || !fs.status) return "";
          var dis = !(fs.status === "ok" || fs.status === "low");
          return '<label class="opt' + (dis ? " is-disabled" : "") + '"><input type="radio" name="fuel" value="' + f.key + '"' +
            (pay.fuel === f.key ? " checked" : "") + (dis ? " disabled" : "") + ">" +
            "<span><strong>" + esc(f.label) + "</strong><small>" + usd(fs.price) + " · " + bs(fs.price * t.rate) + " por litro · " + esc(S.AVAIL[fs.status].label) + "</small></span></label>";
        }).join("") + "</div>" +
        '<p class="label">¿Cuánto?</p>' +
        '<div class="seg seg--2" role="group" aria-label="Unidad"><button type="button" class="seg__btn' + (pay.mode === "liters" ? " is-on" : "") + '" data-mode="liters">Litros</button>' +
        '<button type="button" class="seg__btn' + (pay.mode === "bs" ? " is-on" : "") + '" data-mode="bs">Monto en Bs</button></div>' +
        '<div class="amount"><input id="amountInput" type="number" inputmode="decimal" min="1" step="1" value="' + esc(pay.amount) + '" aria-label="Cantidad">' +
        "<span>" + (pay.mode === "liters" ? "litros" : "bolívares") + "</span></div>" +
        '<div class="quick">' + quickChips(t).map(function (v) {
          return '<button type="button" class="chip" data-quick="' + v + '">' + (pay.mode === "liters" ? v + " L" : "Bs " + nf0.format(v)) + "</button>";
        }).join("") + "</div>" +
        summary(t) +
        '<div class="modal__actions"><button type="button" class="btn btn--primary btn--lg btn--block" id="nextBtn"' + (t.liters > 0 ? "" : " disabled") + ">Continuar</button></div>";
    } else if (pay.step === 2) {
      var pm = state.pm;
      var amountStr = t.totalBs.toFixed(2).replace(".", ",");
      html = '<h2 id="modalTitle">Haz el Pago Móvil</h2>' + steps(2) +
        '<p class="muted">Abre la app de tu banco, entra en <b>Pago Móvil</b> y paga exactamente este monto a la estación:</p>' +
        '<dl class="pmbox">' +
        '<div class="pmrow pmrow--amount"><dt>Monto</dt><dd><strong>' + bs(t.totalBs) + "</strong>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-copy="' + amountStr + '">Copiar</button></dd></div>' +
        copyRow("Banco", pm.bank, bankLabel(pm.bank)) +
        copyRow("Teléfono", pm.phone, fmtPhone(pm.phone)) +
        copyRow("RIF o cédula", pm.doc) +
        (pm.holder ? '<div class="pmrow"><dt>Titular</dt><dd><strong>' + esc(pm.holder) + "</strong></dd></div>" : "") +
        "</dl>" +
        '<p class="muted small">El dinero va directo a la cuenta de la estación. Tanque ya no lo toca.</p>' +
        (S.LIVE ? "" : '<p class="demo-note">Demostración: son datos de ejemplo. No hagas ningún pago real.</p>') +
        '<div class="modal__actions modal__actions--2"><button type="button" class="btn btn--ghost btn--lg" id="prevBtn">Atrás</button>' +
        '<button type="button" class="btn btn--primary btn--lg" id="nextBtn">Ya pagué</button></div>';
    } else if (pay.step === 3) {
      var p = pay.payer;
      html = '<h2 id="modalTitle">Datos de tu pago</h2>' + steps(3) +
        '<p class="muted">Copia la referencia del comprobante de tu banco. Con ella la estación encuentra tu pago.</p>' +
        '<form id="payerForm" class="form-grid" novalidate>' +
        '<label class="field field--full"><span>Número de referencia</span><input id="pfRef" inputmode="numeric" autocomplete="off" placeholder="Ej.: 004512345678" value="' + esc(p.reference) + '" required></label>' +
        '<label class="field field--full"><span>Tu banco</span><select id="pfBank" required><option value="">Elige tu banco</option>' +
        S.BANKS.map(function (b) { return '<option value="' + b[0] + '"' + (p.bank === b[0] ? " selected" : "") + ">" + b[0] + " · " + esc(b[1]) + "</option>"; }).join("") +
        "</select></label>" +
        '<label class="field"><span>Tu teléfono</span><input id="pfPhone" inputmode="tel" autocomplete="tel" placeholder="0414 555 0101" value="' + esc(fmtPhone(p.phone)) + '" required></label>' +
        '<label class="field"><span>Tu cédula</span><input id="pfDoc" autocomplete="off" placeholder="V-12345678" value="' + esc(p.doc) + '" required></label>' +
        '<p class="form-error field--full" id="pfError" hidden></p>' +
        "</form>" +
        summary(t, true) +
        '<div class="modal__actions modal__actions--2"><button type="button" class="btn btn--ghost btn--lg" id="prevBtn">Atrás</button>' +
        '<button type="button" class="btn btn--primary btn--lg" id="sendBtn">Enviar a la estación</button></div>';
    } else if (pay.step === 4) {
      html = '<div class="processing"><span class="spinner"></span><h2 id="modalTitle">Enviando…</h2><p class="muted">Avisando a la estación de tu pago</p></div>';
    }
    openModal(html, { onClose: function () { pay = null; } });
    bindPayment();
  }

  function quickChips(t) {
    if (pay.mode === "liters") return [10, 20, 30, 40, 60];
    var per = t.price * t.rate;
    return [10, 20, 40].map(function (l) { var v = l * per; var r = v > 1000 ? 100 : v > 100 ? 10 : 1; return Math.max(1, Math.round(v / r) * r); });
  }

  function summary(t, compact) {
    return '<dl class="summary' + (compact ? " summary--compact" : "") + '">' +
      "<div><dt>" + nf1.format(t.liters) + " L × " + usd(t.price) + "</dt><dd>" + usd(t.totalUsd) + "</dd></div>" +
      "<div><dt>Tasa de la estación</dt><dd>" + bs(t.rate) + " por $</dd></div>" +
      '<div class="total"><dt>A pagar por Pago Móvil</dt><dd>' + bs(t.totalBs) + "<small>" + usd(t.totalUsd) + "</small></dd></div></dl>";
  }

  function copyText(text, btn) {
    function done() { if (btn) { var o = btn.textContent; btn.textContent = "Copiado"; setTimeout(function () { btn.textContent = o; }, 1400); } }
    try {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } catch (e) { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function bindPayment() {
    var body = $("#modalBody");
    $all("[data-copy]", body).forEach(function (b) { b.onclick = function () { copyText(b.getAttribute("data-copy"), b); }; });
    var prev = $("#prevBtn");
    if (prev) prev.onclick = function () { pay.step -= 1; renderPayment(); };
    if (pay.step === 1) {
      $all('input[name="fuel"]', body).forEach(function (r) { r.onchange = function () { pay.fuel = r.value; renderPayment(); }; });
      $all("[data-mode]", body).forEach(function (b) {
        b.onclick = function () {
          var t = payTotals();
          pay.mode = b.getAttribute("data-mode");
          pay.amount = pay.mode === "bs" ? Math.max(1, Math.round(t.totalBs)) : Math.max(1, Math.round(t.liters));
          renderPayment();
        };
      });
      $all("[data-quick]", body).forEach(function (b) { b.onclick = function () { pay.amount = +b.getAttribute("data-quick"); renderPayment(); }; });
      var inp = $("#amountInput");
      inp.oninput = function () {
        pay.amount = +inp.value || 0;
        var t = payTotals();
        if (t.liters > 500) { pay.amount = pay.mode === "liters" ? 500 : Math.floor(500 * t.price * t.rate); t = payTotals(); }
        $(".summary", body).outerHTML = summary(t);
        $("#nextBtn").disabled = !(t.liters > 0);
      };
      $("#nextBtn").onclick = function () { if (payTotals().liters > 0) { pay.step = 2; renderPayment(); } };
    } else if (pay.step === 2) {
      $("#nextBtn").onclick = function () { pay.step = 3; renderPayment(); };
    } else if (pay.step === 3) {
      var keep = function () {
        pay.payer = {
          reference: ($("#pfRef").value || "").replace(/\D/g, ""),
          bank: $("#pfBank").value,
          phone: ($("#pfPhone").value || "").replace(/\D/g, ""),
          doc: ($("#pfDoc").value || "").toUpperCase().replace(/\s+/g, "")
        };
      };
      $all("#payerForm input, #payerForm select", body).forEach(function (el) { el.addEventListener("input", keep); el.addEventListener("change", keep); });
      $("#payerForm").onsubmit = function (e) { e.preventDefault(); $("#sendBtn").click(); };
      $("#sendBtn").onclick = function () {
        keep();
        var p = pay.payer, msg = "";
        if (p.doc && /^[VEJPG]\d/.test(p.doc)) p.doc = p.doc[0] + "-" + p.doc.slice(1);
        if (!/^\d{4,20}$/.test(p.reference)) msg = "Escribe el número de referencia que te dio tu banco (solo números).";
        else if (!p.bank) msg = "Elige el banco desde el que pagaste.";
        else if (!/^0\d{10}$/.test(p.phone)) msg = "Escribe tu teléfono con 11 dígitos, por ejemplo 0414 555 0101.";
        else if (!/^[VEJPG]-?\d{5,10}$/.test(p.doc)) msg = "Escribe tu cédula así: V-12345678.";
        var errBox = $("#pfError");
        if (msg) { errBox.textContent = msg; errBox.hidden = false; return; }
        var t = payTotals();
        rememberPayer(p);
        var snapshot = pay;
        pay.step = 4; renderPayment();
        S.createPayment({
          stationId: snapshot.st.id, stationName: snapshot.st.name, fuel: snapshot.fuel, liters: t.liters,
          payerBank: p.bank, payerPhone: p.phone, payerDoc: p.doc, reference: p.reference, _state: snapshot.state
        }).then(function (result) {
          pay = null;
          renderReceipts();
          showReceipt(result.code, true);
        }).catch(function (e) {
          pay = snapshot; pay.step = 3; renderPayment();
          var box = $("#pfError"); box.textContent = e.userMessage || "No se pudo enviar. Inténtalo de nuevo."; box.hidden = false;
        });
      };
    }
  }

  function qrSvg(text, cell) {
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text); qr.make();
      return qr.createSvgTag({ cellSize: cell || 5, margin: 2, scalable: true });
    } catch (e) { return ""; }
  }

  var ICON_CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v4.6l3.2 3.2-1.4 1.4-3.8-3.8V7h2Z"/></svg>';
  var ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.6 15.6-3.5-3.5-1.4 1.4 4.9 4.9 10-10-1.4-1.4-8.6 8.6Z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/></svg>';

  function receiptHtml(p, fresh) {
    var st = S.STATUS[p.status] || { label: p.status, tone: "na" };
    var head;
    if (p.status === "por_verificar") {
      head = '<div class="receipt__icon receipt__icon--warn">' + ICON_CLOCK + "</div>" +
        '<h2 id="modalTitle">' + (fresh ? "Pago enviado" : "Esperando confirmación") + "</h2>" +
        '<p class="muted center">La estación está comprobando que tu Pago Móvil llegó. Esta pantalla se actualiza sola; cuando lo confirme, aparecerá tu código para la bomba.</p>' +
        (S.LIVE ? "" : '<p class="demo-note">En la demo, confírmalo tú: entra en <b>Gerentes</b> con esta estación y el PIN 1234.</p>');
    } else if (p.status === "rechazado") {
      head = '<div class="receipt__icon receipt__icon--out">' + ICON_X + "</div>" +
        '<h2 id="modalTitle">La estación no encontró tu pago</h2>' +
        '<p class="muted center">' + esc(p.rejectReason || "Revisa los datos.") + " Si pagaste, habla con la estación y enséñale la referencia de tu banco.</p>";
    } else {
      head = (p.status === "aprobado" ? '<div class="receipt__icon">' + ICON_OK + '</div><h2 id="modalTitle">¡Pago confirmado!</h2><p class="muted center">Muestra este código al despachador.</p>'
        : '<h2 id="modalTitle">Combustible despachado</h2>') +
        '<div class="receipt__qr">' + qrSvg("TANQUEYA:" + p.code) + "</div>" +
        '<p class="receipt__code">' + esc(p.code) + "</p>";
    }
    return '<div class="receipt receipt--' + p.status + '" data-code="' + esc(p.code) + '">' + head +
      '<span class="badge badge--' + st.tone + '">' + esc(st.label) + "</span>" +
      '<dl class="summary summary--compact">' +
      "<div><dt>Estación</dt><dd>" + esc(p.stationName) + "</dd></div>" +
      "<div><dt>Combustible</dt><dd>" + esc(fuelLabel(p.fuel)) + " · " + nf1.format(p.liters) + " L</dd></div>" +
      "<div><dt>Pagado desde</dt><dd>" + esc(S.bankName(p.payerBank)) + " · " + esc(fmtPhone(p.payerPhone)) + "</dd></div>" +
      "<div><dt>Referencia</dt><dd>" + esc(p.reference) + "</dd></div>" +
      "<div><dt>Fecha</dt><dd>" + new Date(p.createdAt).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" }) + "</dd></div>" +
      '<div class="total"><dt>Total</dt><dd>' + bs(p.totalBs) + "<small>" + usd(p.totalUsd) + "</small></dd></div></dl>" +
      (fresh ? '<div class="modal__actions"><button type="button" class="btn btn--primary btn--lg btn--block" id="goReceipts">Ver mis pagos</button></div>' : "") +
      "</div>";
  }

  function findPayment(code) { return S.payments().filter(function (x) { return x.code === code; })[0]; }

  function showReceipt(code, fresh) {
    var p = findPayment(code);
    if (!p) return;
    openReceiptCode = code;
    openModal(receiptHtml(p, fresh), { onClose: function () { openReceiptCode = null; } });
    var go = $("#goReceipts");
    if (go) go.onclick = function () { closeModal(); location.hash = "#pagos"; };
  }

  // Si el recibo abierto cambió de estado (lo confirmó la estación), se repinta.
  function refreshOpenReceipt() {
    if (!openReceiptCode || $("#modal").hidden) return;
    var p = findPayment(openReceiptCode);
    var shown = $("#modalBody .receipt");
    if (p && shown && !shown.classList.contains("receipt--" + p.status)) {
      var fresh = !!$("#goReceipts");
      showReceipt(p.code, fresh);
      if (p.status === "aprobado") toast("La estación confirmó tu pago.", "ok");
      if (p.status === "rechazado") toast("La estación no encontró tu pago.", "err");
    }
  }

  /* =========================================================
   * Mis pagos
   * ======================================================= */
  function renderReceipts() {
    var list = S.payments().filter(function (p) { return p.mine; });
    var root = $("#receiptList");
    if (!list.length) {
      root.innerHTML = '<div class="empty-state"><div class="empty-state__icon">' + PUMP + "</div><h2>Todavía no has pagado combustible</h2>" +
        '<p class="muted">Busca una estación en el mapa, elige cuánto quieres y paga con Pago Móvil. Cuando la estación lo confirme, te daremos un código para la bomba.</p>' +
        '<a class="btn btn--primary" href="#mapa">Ir al mapa</a></div>';
      return;
    }
    root.innerHTML = list.map(function (p) {
      var st = S.STATUS[p.status];
      var showQr = p.status === "aprobado" || p.status === "despachado";
      return '<button type="button" class="rcard rcard--' + p.status + '" data-code="' + esc(p.code) + '">' +
        '<span class="rcard__qr">' + (showQr ? qrSvg("TANQUEYA:" + p.code, 2) : '<span class="rcard__wait rcard__wait--' + st.tone + '">' + (p.status === "rechazado" ? ICON_X : ICON_CLOCK) + "</span>") + "</span>" +
        '<span class="rcard__body"><strong>' + esc(p.stationName) + "</strong>" +
        '<span class="muted">' + esc(fuelLabel(p.fuel)) + " · " + nf1.format(p.liters) + " L · " + ago(p.createdAt) + "</span>" +
        '<span class="rcard__code">' + (showQr ? esc(p.code) : "Ref. " + esc(p.reference)) + "</span></span>" +
        '<span class="rcard__right"><strong>' + bs(p.totalBs) + "</strong>" +
        '<span class="badge badge--' + st.tone + '">' + esc(st.label) + "</span></span></button>";
    }).join("");
    $all(".rcard", root).forEach(function (b) { b.onclick = function () { showReceipt(b.getAttribute("data-code"), false); }; });
  }

  /* =========================================================
   * Panel de gerentes
   * ======================================================= */
  var DEMO_PIN = "1234";
  var managerPrefill = null;
  var draft = null;
  var REJECT_REASONS = ["El pago no llegó a la cuenta", "El monto no coincide", "La referencia no coincide"];

  function managerStation(m) {
    if (!m || !m.stationId) return null;
    var st = app.byId[m.stationId];
    if (st) return st;
    var reg = S.registeredStations().filter(function (s) { return s.id === m.stationId; })[0];
    if (reg) { app.stations.push(reg); app.byId[reg.id] = reg; reg._search = norm(reg.name + " " + reg.city); }
    return reg || null;
  }

  function renderManager() {
    var m = S.manager();
    if (!m) return renderLogin();
    if (!m.stationId) return renderNoStation();
    var st = managerStation(m);
    if (!st) {
      if (!m.live && app.source !== "loading") { S.signOut(); return renderLogin(); }
      $("#managerRoot").innerHTML = '<div class="empty-state"><span class="spinner"></span><p class="muted">Cargando tu estación…</p></div>';
      return;
    }
    renderDashboard(st);
  }

  function stationPicker(pre) {
    return '<label class="field field--full"><span>Tu estación</span>' +
      '<input id="stSearch" placeholder="Escribe el nombre o la ciudad" autocomplete="off" value="' + (pre ? esc(pre.name) : "") + '"></label>' +
      '<ul class="suggest" id="stSuggest" hidden></ul>' +
      '<p class="picked" id="stPicked">' + (pre ? pickedHtml(pre) : '<span class="muted small">Elige tu estación de la lista.</span>') + "</p>";
  }

  function bindPicker(onPick) {
    var input = $("#stSearch"), sug = $("#stSuggest");
    input.oninput = function () {
      var q = norm(input.value);
      onPick(null);
      $("#stPicked").innerHTML = '<span class="muted small">Elige tu estación de la lista.</span>';
      if (q.length < 2) { sug.hidden = true; return; }
      var res = app.stations.filter(function (s) { return s._search.indexOf(q) !== -1; }).slice(0, 8);
      sug.innerHTML = res.length ? res.map(function (s) {
        return '<li><button type="button" data-pick="' + esc(s.id) + '"><strong>' + esc(s.name) + "</strong><small>" + esc([s.address, s.city].filter(Boolean).join(" · ")) + "</small></button></li>";
      }).join("") : '<li class="muted small">Sin resultados</li>';
      sug.hidden = false;
      $all("[data-pick]", sug).forEach(function (b) {
        b.onclick = function () {
          var s = app.byId[b.getAttribute("data-pick")];
          input.value = s.name; sug.hidden = true;
          $("#stPicked").innerHTML = pickedHtml(s);
          onPick(s);
        };
      });
    };
  }

  function loginIntro() {
    return '<div class="login__intro">' +
      "<h1>Panel para estaciones</h1>" +
      '<p class="lead">Publica en segundos qué combustible tienes, a qué precio y cuánta cola hay. Recibe los Pago Móvil directo en tu cuenta y confírmalos desde aquí.</p>' +
      '<ul class="ticks"><li>Actualiza disponibilidad y precios en un toque</li><li>El dinero llega directo a tu cuenta, sin intermediarios</li><li>Confirma cada pago con la referencia de tu banco</li><li>Valida el código QR antes de despachar</li></ul>' +
      "</div>";
  }

  function renderLogin() {
    var root = $("#managerRoot");
    if (S.LIVE) return renderLiveLogin(false);
    var pre = managerPrefill && app.byId[managerPrefill];
    root.innerHTML = '<div class="login">' + loginIntro() +
      '<form class="card login__card" id="loginForm" autocomplete="off">' +
      "<h2>Entrar</h2>" + stationPicker(pre) +
      '<label class="field field--full"><span>PIN de acceso</span><input id="pinInput" type="password" inputmode="numeric" maxlength="6" placeholder="••••"></label>' +
      '<p class="muted small">Demostración: el PIN de todas las estaciones es <b>1234</b>.</p>' +
      '<button class="btn btn--primary btn--lg btn--block" type="submit">Entrar al panel</button>' +
      "</form></div>";
    var chosen = pre ? pre.id : null;
    bindPicker(function (s) { chosen = s ? s.id : null; if (s) $("#pinInput").focus(); });
    $("#loginForm").onsubmit = function (e) {
      e.preventDefault();
      if (!chosen) { toast("Primero elige tu estación de la lista.", "err"); $("#stSearch").focus(); return; }
      if ($("#pinInput").value !== DEMO_PIN) { toast("PIN incorrecto. En la demo es 1234.", "err"); return; }
      S.demoLogin(chosen);
      managerPrefill = null; draft = null;
      renderManager();
      toast("Bienvenido al panel de tu estación.", "ok");
    };
  }

  function renderLiveLogin(signup) {
    $("#managerRoot").innerHTML = '<div class="login">' + loginIntro() +
      '<form class="card login__card" id="authForm">' +
      "<h2>" + (signup ? "Crear cuenta de gerente" : "Entrar") + "</h2>" +
      '<label class="field field--full"><span>Correo</span><input id="authEmail" type="email" autocomplete="email" required></label>' +
      '<label class="field field--full"><span>Contraseña</span><input id="authPass" type="password" autocomplete="' + (signup ? "new-password" : "current-password") + '" minlength="8" required></label>' +
      '<p class="form-error" id="authError" hidden></p>' +
      '<button class="btn btn--primary btn--lg btn--block" type="submit" id="authBtn">' + (signup ? "Crear cuenta" : "Entrar al panel") + "</button>" +
      '<button class="btn btn--link" type="button" id="authSwitch">' + (signup ? "Ya tengo cuenta" : "¿Primera vez? Crea tu cuenta") + "</button>" +
      "</form></div>";
    $("#authSwitch").onclick = function () { renderLiveLogin(!signup); };
    $("#authForm").onsubmit = function (e) {
      e.preventDefault();
      var email = $("#authEmail").value.trim(), pass = $("#authPass").value, box = $("#authError"), btn = $("#authBtn");
      if (pass.length < 8) { box.textContent = "La contraseña debe tener al menos 8 caracteres."; box.hidden = false; return; }
      btn.disabled = true; box.hidden = true;
      var job = signup ? S.signUp(email, pass) : S.signIn(email, pass);
      job.then(function (res) {
        btn.disabled = false;
        if (signup && res && !res.confirmed) {
          $("#managerRoot").innerHTML = '<div class="empty-state"><h2>Revisa tu correo</h2><p class="muted">Te enviamos un enlace a <b>' + esc(email) +
            '</b>. Ábrelo para confirmar la cuenta y luego vuelve a entrar.</p><button class="btn btn--primary" type="button" id="backLogin">Ir a entrar</button></div>';
          $("#backLogin").onclick = function () { renderLiveLogin(false); };
          return;
        }
        draft = null;
        afterDataChange();
        renderManager();
      }).catch(function (e2) { btn.disabled = false; box.textContent = e2.userMessage || "No se pudo entrar."; box.hidden = false; });
    };
  }

  function renderNoStation() {
    var root = $("#managerRoot");
    root.innerHTML = '<div class="login">' +
      '<div class="login__intro"><h1>Activa tu estación</h1><p class="lead">Tu cuenta (' + esc(S.manager().email || "") + ') todavía no está vinculada a ninguna estación. ' +
      "Envíanos la solicitud: verificamos que eres el gerente y la activamos.</p>" +
      '<div id="reqList" class="muted small">Cargando tus solicitudes…</div></div>' +
      '<form class="card login__card" id="reqForm">' +
      "<h2>Solicitar activación</h2>" + stationPicker(managerPrefill && app.byId[managerPrefill]) +
      '<label class="field field--full"><span>RIF de la estación</span><input id="reqRif" placeholder="J-12345678-9" required></label>' +
      '<label class="field field--full"><span>Teléfono de contacto</span><input id="reqPhone" inputmode="tel" placeholder="0412 555 0101" required></label>' +
      '<p class="form-error" id="reqError" hidden></p>' +
      '<button class="btn btn--primary btn--lg btn--block" type="submit">Enviar solicitud</button>' +
      '<button class="btn btn--link" type="button" id="logoutBtn">Salir</button>' +
      "</form></div>";
    var chosen = managerPrefill && app.byId[managerPrefill] || null;
    bindPicker(function (s) { chosen = s; });
    S.myRequests().then(function (reqs) {
      var box = $("#reqList"); if (!box) return;
      box.innerHTML = reqs.length ? "<p><b>Tus solicitudes</b></p>" + reqs.map(function (r) {
        return "<p>" + esc(r.name) + ' · <span class="badge badge--' + (r.status === "aprobada" ? "ok" : r.status === "rechazada" ? "out" : "warn") + '">' + esc(r.status) + "</span></p>";
      }).join("") + (reqs.some(function (r) { return r.status === "aprobada"; }) ? '<p>Si ya está aprobada, sal y vuelve a entrar.</p>' : "") : "";
    }).catch(function () {});
    $("#logoutBtn").onclick = function () { S.signOut().then(renderManager); };
    $("#reqForm").onsubmit = function (e) {
      e.preventDefault();
      var box = $("#reqError"), rif = $("#reqRif").value.trim().toUpperCase(), phone = $("#reqPhone").value.replace(/\D/g, "");
      if (!chosen) { box.textContent = "Elige tu estación de la lista."; box.hidden = false; return; }
      if (!/^[VEJPG]-?\d{5,10}(-?\d)?$/.test(rif)) { box.textContent = "Escribe el RIF así: J-12345678-9."; box.hidden = false; return; }
      if (phone.length !== 11) { box.textContent = "Escribe un teléfono de 11 dígitos."; box.hidden = false; return; }
      S.requestStation(chosen, phone, rif).then(function () {
        toast("Solicitud enviada. Te avisaremos cuando esté activa.", "ok");
        renderNoStation();
      }).catch(function (e2) { box.textContent = e2.userMessage || "No se pudo enviar."; box.hidden = false; });
    };
  }

  function pickedHtml(s) {
    return '<span class="picked__ok">✓</span> <strong>' + esc(s.name) + "</strong> <span class=\"muted small\">" + esc([s.address, s.city].filter(Boolean).join(" · ")) + "</span>";
  }

  function stationDraft(st) {
    var s = S.stateOf(st);
    var def = s.modality === "subs" ? S.DEFAULTS.priceSubs : S.DEFAULTS.priceIntl;
    function fd(k, fallbackStatus) {
      return { status: s.fuels[k].status || fallbackStatus, price: s.fuels[k].price != null ? s.fuels[k].price : def };
    }
    return {
      open: s.open, queue: s.queue || "none", acceptsApp: s.acceptsApp, hours: s.hours || "",
      modality: s.modality, rate: s.rate || S.DEFAULTS.rate,
      fuels: { g91: fd("g91", "ok"), g95: fd("g95", "ok"), diesel: fd("diesel", "none") },
      pm: Object.assign({ bank: "", phone: "", doc: "", holder: "" }, s.pm)
    };
  }

  function stationPayments(st) { return S.payments().filter(function (p) { return p.stationId === st.id; }); }

  function renderDashboard(st) {
    if (!draft || draft.id !== st.id) { draft = stationDraft(st); draft.id = st.id; draft.dirty = false; }
    var state = S.stateOf(st);

    function seg(name, value, options) {
      return '<div class="seg seg--' + options.length + '" role="group">' + options.map(function (o) {
        return '<button type="button" class="seg__btn seg__btn--' + (o[2] || "") + (value === o[0] ? " is-on" : "") + '" data-set="' + name + '" data-val="' + o[0] + '">' + esc(o[1]) + "</button>";
      }).join("") + "</div>";
    }

    var fuelCards = FUELS.map(function (f) {
      var d = draft.fuels[f.key];
      return '<div class="mfuel">' +
        '<div class="mfuel__head"><strong>' + esc(f.label) + "</strong>" +
        '<span class="muted small">' + bs(d.price * draft.rate) + " /L</span></div>" +
        seg("fuel." + f.key + ".status", d.status, [["ok", "Disponible", "ok"], ["low", "Queda poco", "warn"], ["out", "Agotado", "out"], ["none", "No vende", "na"]]) +
        '<label class="field field--inline"><span>Precio por litro</span><span class="money"><i>$</i><input type="number" step="0.01" min="0" inputmode="decimal" data-price="' + f.key + '" value="' + d.price + '"' + (d.status === "none" ? " disabled" : "") + "></span></label>" +
        "</div>";
    }).join("");

    var pm = draft.pm;
    $("#managerRoot").innerHTML =
      '<div class="dash">' +
      '<div class="dash__head"><div>' +
      '<p class="eyebrow">Panel de estación' + (S.LIVE ? "" : " · demostración") + "</p><h1>" + esc(st.name) + "</h1>" +
      '<p class="muted">' + esc([st.address, st.city].filter(Boolean).join(" · ")) + " · Última actualización " + esc(ago(state.updatedAt)) + (state.simulated ? " (simulada)" : "") + "</p></div>" +
      '<div class="dash__head-actions"><button type="button" class="btn btn--ghost" id="viewOnMap">Ver en el mapa</button>' +
      '<button type="button" class="btn btn--ghost" id="logoutBtn">Salir</button></div></div>' +

      '<div class="kpis" id="kpiBox"></div>' +

      '<section class="card card--span card--attention" id="pendingCard"><div class="card__head"><h2>Pagos por confirmar</h2>' +
      '<span class="muted small">Compara con los movimientos de tu banco: monto en Bs, referencia y teléfono.</span></div><div id="pendingBox"></div></section>' +

      '<div class="dash__grid">' +
      '<section class="card">' +
      '<div class="card__head"><h2>Estado de la estación</h2></div>' +
      '<p class="label">La estación está</p>' + seg("open", draft.open ? "1" : "0", [["1", "Abierta", "ok"], ["0", "Cerrada", "out"]]) +
      '<p class="label">Cola ahora</p>' + seg("queue", draft.queue, [["none", "Sin cola", "ok"], ["short", "Corta", "ok"], ["long", "Larga", "warn"], ["empty", "Sin combustible", "out"]]) +
      '<p class="label">Pagos con Tanque ya</p>' + seg("acceptsApp", draft.acceptsApp ? "1" : "0", [["1", "Acepto pagos", "ok"], ["0", "No por ahora", "na"]]) +
      '<label class="field field--full"><span>Horario</span><input id="hoursInput" value="' + esc(draft.hours) + '" placeholder="Ej.: 24 horas, o 6:00 a. m. – 8:00 p. m."></label>' +
      "</section>" +

      '<section class="card">' +
      '<div class="card__head"><h2>Combustible y precios</h2></div>' +
      '<div class="form-grid">' +
      '<label class="field"><span>Modalidad</span><select id="modalitySel">' +
      Object.keys(S.MODALITY).map(function (k) { return '<option value="' + k + '"' + (draft.modality === k ? " selected" : "") + ">" + esc(S.MODALITY[k]) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="field"><span>Tasa del día (Bs por $)</span><input id="rateInput" type="number" step="0.01" min="0" inputmode="decimal" value="' + draft.rate + '"></label>' +
      "</div>" + fuelCards +
      "</section>" +

      '<section class="card card--span">' +
      '<div class="card__head"><h2>Tus datos de Pago Móvil</h2><span class="muted small">Los conductores te pagan aquí. El dinero llega directo a tu cuenta.</span></div>' +
      '<div class="form-grid form-grid--4">' +
      '<label class="field"><span>Banco</span><select id="pmBank"><option value="">Elige el banco</option>' +
      S.BANKS.map(function (b) { return '<option value="' + b[0] + '"' + (pm.bank === b[0] ? " selected" : "") + ">" + b[0] + " · " + esc(b[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span>Teléfono afiliado</span><input id="pmPhone" inputmode="tel" placeholder="0412 555 0101" value="' + esc(fmtPhone(pm.phone)) + '"></label>' +
      '<label class="field"><span>RIF o cédula</span><input id="pmDoc" placeholder="J-12345678-9" value="' + esc(pm.doc) + '"></label>' +
      '<label class="field"><span>Titular</span><input id="pmHolder" placeholder="Nombre de la empresa" value="' + esc(pm.holder) + '"></label>' +
      "</div></section>" +

      '<section class="card card--span">' +
      '<div class="card__head"><h2>Despachar</h2><span class="muted small">Escribe o escanea el código del conductor</span></div>' +
      '<form class="validate" id="validateForm"><input id="codeInput" placeholder="TY-ABC-123" autocapitalize="characters" aria-label="Código de pago">' +
      '<button class="btn btn--primary" type="submit">Validar</button></form>' +
      '<div id="validateResult"></div>' +
      '<h3 class="mt">Todos los pagos</h3><div id="paysBox"></div>' +
      "</section>" +
      "</div>" +

      '<div class="savebar' + (draft.dirty ? " is-dirty" : "") + '" id="savebar">' +
      '<span id="saveMsg">' + (draft.dirty ? "Tienes cambios sin publicar" : "Todo publicado") + "</span>" +
      '<button type="button" class="btn btn--primary btn--lg" id="saveBtn"' + (draft.dirty ? "" : " disabled") + ">Publicar cambios</button></div>" +
      "</div>";

    renderDashPayments(st);
    bindDashboard(st);
  }

  // Partes del panel que cambian cuando llegan pagos (se repintan sin tocar el formulario).
  function renderDashPayments(st) {
    if (!$("#kpiBox")) return;
    var pays = stationPayments(st);
    var t0 = startOfToday();
    var m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    var good = function (p) { return p.status === "aprobado" || p.status === "despachado"; };
    var today = pays.filter(function (p) { return good(p) && p.createdAt >= t0; });
    var month = pays.filter(function (p) { return good(p) && p.createdAt >= m0.getTime(); });
    var pending = pays.filter(function (p) { return p.status === "por_verificar"; });
    var toDispatch = pays.filter(function (p) { return p.status === "aprobado"; });
    $("#kpiBox").innerHTML =
      kpi("Ventas hoy", bs(today.reduce(function (a, p) { return a + p.totalBs; }, 0)), "", today.length + " pagos · " + nf1.format(today.reduce(function (a, p) { return a + p.liters; }, 0)) + " L") +
      kpi("Por confirmar", nf0.format(pending.length), pending.length ? "warn" : "") +
      kpi("Por despachar", nf0.format(toDispatch.length), toDispatch.length ? "ok" : "") +
      kpi("Comisión del mes", usd(month.reduce(function (a, p) { return a + (p.feeUsd || 0); }, 0)), "", (S.DEFAULTS.fee * 100) + " % de las ventas");

    $("#pendingCard").classList.toggle("card--quiet", !pending.length);
    $("#pendingBox").innerHTML = pending.length ? pending.map(function (p) {
      return '<div class="vrow" data-row="' + esc(p.code) + '">' +
        '<div class="vrow__amount"><strong>' + bs(p.totalBs) + "</strong><small>" + nf1.format(p.liters) + " L " + esc(fuelLabel(p.fuel)) + " · " + ago(p.createdAt) + "</small></div>" +
        '<dl class="vrow__data"><div><dt>Referencia</dt><dd>' + esc(p.reference) + "</dd></div>" +
        "<div><dt>Desde</dt><dd>" + esc(bankLabel(p.payerBank)) + "</dd></div>" +
        "<div><dt>Teléfono</dt><dd>" + esc(fmtPhone(p.payerPhone)) + "</dd></div>" +
        "<div><dt>Cédula</dt><dd>" + esc(p.payerDoc) + "</dd></div></dl>" +
        '<div class="vrow__actions"><button type="button" class="btn btn--primary" data-approve="' + esc(p.code) + '">Llegó, confirmar</button>' +
        '<button type="button" class="btn btn--ghost" data-reject="' + esc(p.code) + '">No llegó</button></div></div>';
    }).join("") : '<p class="muted">No hay pagos esperando. Cuando un conductor pague, aparecerá aquí al momento.</p>';

    $("#paysBox").innerHTML = paymentsTable(pays);
    bindPaymentActions(st);
  }

  function kpi(label, value, tone, sub) {
    return '<div class="kpi' + (tone ? " kpi--" + tone : "") + '"><span>' + esc(label) + "</span><strong>" + value + "</strong>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  }

  function paymentsTable(pays) {
    if (!pays.length) return '<p class="muted">Aún no hay pagos en esta estación.' + (S.LIVE ? "" : " Haz uno desde el mapa para probar el flujo completo.") + "</p>";
    return '<div class="table-wrap"><table class="table"><thead><tr><th>Hora</th><th>Monto</th><th>Combustible</th><th>Referencia</th><th>Código</th><th>Estado</th></tr></thead><tbody>' +
      pays.slice(0, 80).map(function (p) {
        var st = S.STATUS[p.status];
        var action = p.status === "aprobado" ? '<button type="button" class="btn btn--sm btn--primary" data-dispatch="' + esc(p.code) + '">Despachar</button>'
          : '<span class="badge badge--' + st.tone + '">' + esc(st.label) + "</span>";
        return "<tr><td>" + new Date(p.createdAt).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) +
          "</td><td><b>" + bs(p.totalBs) + "</b></td><td>" + esc(fuelLabel(p.fuel)) + " · " + nf1.format(p.liters) + " L</td><td>" + esc(p.reference) +
          "</td><td><code>" + (p.status === "aprobado" || p.status === "despachado" ? esc(p.code) : "—") + "</code></td><td>" + action + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function markDirty() {
    draft.dirty = true;
    $("#savebar").classList.add("is-dirty");
    $("#saveMsg").textContent = "Tienes cambios sin publicar";
    $("#saveBtn").disabled = false;
  }

  function bindDashboard(st) {
    var root = $("#managerRoot");
    $all("[data-set]", root).forEach(function (b) {
      b.onclick = function () {
        var key = b.getAttribute("data-set"), val = b.getAttribute("data-val");
        if (key === "open" || key === "acceptsApp") draft[key] = val === "1";
        else if (key === "queue") draft.queue = val;
        else { var parts = key.split("."); draft.fuels[parts[1]].status = val; }
        draft.dirty = true;
        var y = window.scrollY;
        renderDashboard(st);
        window.scrollTo(0, y);
      };
    });
    $all("[data-price]", root).forEach(function (inp) {
      inp.oninput = function () {
        var k = inp.getAttribute("data-price");
        draft.fuels[k].price = Math.max(0, +inp.value || 0);
        inp.closest(".mfuel").querySelector(".mfuel__head .small").textContent = bs(draft.fuels[k].price * draft.rate) + " /L";
        markDirty();
      };
    });
    $("#rateInput").oninput = function () {
      draft.rate = Math.max(0, +this.value || 0);
      $all(".mfuel", root).forEach(function (el, i) {
        el.querySelector(".mfuel__head .small").textContent = bs(draft.fuels[FUELS[i].key].price * draft.rate) + " /L";
      });
      markDirty();
    };
    $("#modalitySel").onchange = function () {
      draft.modality = this.value;
      var p = draft.modality === "subs" ? S.DEFAULTS.priceSubs : S.DEFAULTS.priceIntl;
      FUELS.forEach(function (f) { draft.fuels[f.key].price = p; });
      draft.dirty = true;
      renderDashboard(st);
      toast("Precios ajustados a la modalidad. Revísalos antes de publicar.");
    };
    $("#hoursInput").oninput = function () { draft.hours = this.value; markDirty(); };
    $("#pmBank").onchange = function () { draft.pm.bank = this.value; markDirty(); };
    $("#pmPhone").oninput = function () { draft.pm.phone = this.value.replace(/\D/g, ""); markDirty(); };
    $("#pmDoc").oninput = function () { draft.pm.doc = this.value.trim().toUpperCase(); markDirty(); };
    $("#pmHolder").oninput = function () { draft.pm.holder = this.value; markDirty(); };

    $("#saveBtn").onclick = function () {
      var btn = this;
      if (draft.acceptsApp && !(draft.pm.bank && /^0\d{10}$/.test(draft.pm.phone) && draft.pm.doc)) {
        toast("Para aceptar pagos, completa tus datos de Pago Móvil (banco, teléfono de 11 dígitos y RIF).", "err");
        $("#pmBank").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (draft.rate <= 0) { toast("Escribe la tasa del día.", "err"); return; }
      btn.disabled = true;
      S.saveStation(st.id, {
        open: draft.open, queue: draft.queue, acceptsApp: draft.acceptsApp, hours: draft.hours.trim(),
        modality: draft.modality, rate: draft.rate,
        fuels: JSON.parse(JSON.stringify(draft.fuels)), pm: Object.assign({}, draft.pm)
      }).then(function () {
        draft.dirty = false;
        refreshStation(st.id);
        renderDashboard(st);
        toast("Publicado. Los conductores ya ven los cambios en el mapa.", "ok");
      }).catch(function (e) { btn.disabled = false; toast(e.userMessage || "No se pudo publicar.", "err"); });
    };
    $("#logoutBtn").onclick = function () {
      if (draft.dirty && !armed(this, "¿Salir sin publicar? Toca otra vez")) return;
      S.signOut().then(function () { draft = null; renderManager(); });
    };
    $("#viewOnMap").onclick = function () { location.hash = "#estacion-" + st.id; };

    $("#validateForm").onsubmit = function (e) {
      e.preventDefault();
      var raw = ($("#codeInput").value || "").toUpperCase().replace(/^TANQUEYA:/, "").replace(/\s+/g, "");
      var c = raw.replace(/-/g, "");
      if (/^TY[A-Z0-9]{6}$/.test(c)) raw = "TY-" + c.slice(2, 5) + "-" + c.slice(5);
      var p = findPayment(raw);
      var out = $("#validateResult");
      if (!p) { out.innerHTML = '<div class="alert alert--err">No existe ningún pago con el código <b>' + esc(raw || "vacío") + "</b>.</div>"; return; }
      if (p.stationId !== st.id) { out.innerHTML = '<div class="alert alert--err">Este pago es de otra estación (' + esc(p.stationName) + "). No despaches.</div>"; return; }
      if (p.status === "despachado") { out.innerHTML = '<div class="alert alert--warn">Este código ya se usó ' + esc(ago(p.dispatchedAt)) + ". No despaches de nuevo.</div>"; return; }
      if (p.status === "por_verificar") { out.innerHTML = '<div class="alert alert--warn">Este pago aún no está confirmado. Búscalo arriba en «Pagos por confirmar».</div>'; return; }
      if (p.status === "rechazado") { out.innerHTML = '<div class="alert alert--err">Este pago fue rechazado. No despaches.</div>'; return; }
      out.innerHTML = '<div class="alert alert--ok"><div><b>Pago válido.</b> Despacha ' + nf1.format(p.liters) + " L de " + esc(fuelLabel(p.fuel)) + " · " + bs(p.totalBs) + "</div>" +
        '<button type="button" class="btn btn--primary" data-dispatch="' + esc(p.code) + '">Marcar como despachado</button></div>';
      bindPaymentActions(st);
    };
  }

  function changeStatus(st, code, status, reason, okMsg) {
    return S.setPaymentStatus(code, status, reason).then(function () {
      renderDashPayments(st);
      renderReceipts();
      if (status === "despachado") $("#validateResult").innerHTML = "";
      toast(okMsg, "ok");
    }).catch(function (e) { toast(e.userMessage || "No se pudo guardar. Inténtalo de nuevo.", "err"); renderDashPayments(st); });
  }

  function bindPaymentActions(st) {
    var root = $("#managerRoot");
    $all("[data-approve]", root).forEach(function (b) {
      b.onclick = function () { b.disabled = true; changeStatus(st, b.getAttribute("data-approve"), "aprobado", null, "Pago confirmado. El conductor ya tiene su código."); };
    });
    $all("[data-reject]", root).forEach(function (b) {
      b.onclick = function () {
        var code = b.getAttribute("data-reject");
        var actions = b.parentNode;
        actions.innerHTML = '<span class="small muted">¿Por qué?</span>' + REJECT_REASONS.map(function (r, i) {
          return '<button type="button" class="btn btn--ghost btn--sm" data-reason="' + i + '">' + esc(r) + "</button>";
        }).join("") + '<button type="button" class="btn btn--link btn--sm" data-cancel>Cancelar</button>';
        $all("[data-reason]", actions).forEach(function (rb) {
          rb.onclick = function () { changeStatus(st, code, "rechazado", REJECT_REASONS[+rb.getAttribute("data-reason")], "Pago rechazado. Le avisamos al conductor."); };
        });
        $("[data-cancel]", actions).onclick = function () { renderDashPayments(st); };
      };
    });
    $all("[data-dispatch]", root).forEach(function (b) {
      b.onclick = function () { b.disabled = true; changeStatus(st, b.getAttribute("data-dispatch"), "despachado", null, "Despacho registrado."); };
    });
  }

  /* =========================================================
   * Inversionistas y origen de datos
   * ======================================================= */
  function openAbout() {
    var states = app.stations.map(function (s) { return s._state || S.stateOf(s); });
    var known = states.filter(function (s) { return !s.unknown; });
    var withFuel = known.filter(function (s) { return S.overallTone(s) !== "out"; }).length;
    var pays = S.payments().filter(function (p) { return p.status === "aprobado" || p.status === "despachado"; });
    var vol = pays.reduce(function (a, p) { return a + p.totalUsd; }, 0);
    var fees = pays.reduce(function (a, p) { return a + (p.feeUsd || 0); }, 0);
    openModal(
      '<p class="eyebrow">Para inversionistas</p><h2 id="modalTitle">Tanque ya</h2>' +
      '<p class="lead">El mapa en vivo del combustible en Venezuela: dónde hay, a qué precio, cuánta cola, y el pago desde el teléfono.</p>' +
      '<div class="kpis kpis--3">' +
      kpi("Estaciones en el mapa", nf0.format(app.stations.length)) +
      kpi("Con combustible ahora", known.length ? nf0.format(Math.round(withFuel / known.length * 100)) + " %" : "—") +
      kpi(S.LIVE ? "Pagos confirmados que ves" : "Pagos confirmados en esta demo", nf0.format(pays.length) + " · " + usd(vol)) +
      "</div>" +
      '<div class="about-grid">' +
      '<div><h3>El problema</h3><p>Los conductores no saben qué estación tiene combustible ni a qué precio, porque conviven estaciones subsidiadas en bolívares y estaciones con precio internacional en dólares. Pierden horas en colas y viajes inútiles.</p></div>' +
      '<div><h3>La solución</h3><p>Los gerentes publican disponibilidad, precio y tasa del día en un toque. Los conductores reportan la cola como en un mapa de tráfico. Se paga con Pago Móvil directo a la estación, el gerente lo confirma y se despacha con un código QR.</p></div>' +
      '<div><h3>Cómo gana dinero</h3><p>Comisión baja que paga la estación por cada venta cobrada con la app (' + (S.DEFAULTS.fee * 100) + " %; " + usd(fees) + ' en los pagos que ves). El dinero del conductor va directo a la estación, así que Tanque ya no custodia fondos. Plan para cadenas con varias estaciones. Datos agregados de precios y abastecimiento para flotas y empresas.</p></div>' +
      '<div><h3>Siguientes pasos</h3><p>Piloto con estaciones reales en una ciudad. Verificación automática de Pago Móvil con los bancos. App en las tiendas.</p></div>' +
      "</div>" +
      '<p class="demo-note">Esta demo no inventa cifras de mercado: los números de arriba salen de los datos que estás viendo en la propia demo.</p>',
      { wide: true });
  }

  function openDataInfo() {
    var set = S.settings();
    var osm = app.source === "osm";
    openModal(
      '<h2 id="modalTitle">De dónde salen los datos</h2>' +
      '<div class="alert ' + (osm ? "alert--ok" : "alert--warn") + '">' +
      (osm ? "<div><b>Estaciones reales:</b> " + nf0.format(app.stations.length) + " estaciones de servicio de Venezuela tomadas de OpenStreetMap, un mapa abierto que hace la comunidad.</div>"
        : app.source === "loading" ? "<div>Descargando el listado real de estaciones desde OpenStreetMap…</div>"
        : EMBED ? "<div><b>Vista previa:</b> aquí se muestran " + nf0.format(app.stations.length) + " estaciones de ejemplo con nombres genéricos. La versión publicada en tu dominio carga las estaciones reales de OpenStreetMap y el mapa completo.</div>"
        : "<div><b>Estaciones de demostración:</b> no se pudo descargar el listado real de OpenStreetMap (¿sin internet?). Se muestran " + nf0.format(app.stations.length) + " estaciones de ejemplo con nombres genéricos.</div>") +
      "</div>" +
      "<p><b>Disponibilidad, precio y cola:</b> los publica el gerente desde su panel y los conductores reportan la cola.</p>" +
      (S.LIVE ? "" : "<p>Para que la demo no se vea vacía, las estaciones sin datos muestran valores <b>simulados</b>, marcados como tales en cada ficha.</p>" +
        '<label class="switch"><input type="checkbox" id="simToggle"' + (set.simulate ? " checked" : "") + "><span></span>Mostrar datos simulados en las estaciones sin reportes</label>") +
      (S.LIVE
        ? "<p><b>Pagos:</b> Pago Móvil directo a la cuenta de cada estación. El gerente confirma cada pago con la referencia de su banco.</p><p><b>Dónde se guarda:</b> en el servidor de Tanque ya, compartido entre todos los teléfonos.</p>"
        : "<p><b>Pagos:</b> de demostración. No se mueve dinero.</p><p><b>Dónde se guarda:</b> en este navegador. Con el servidor activado (ver README), se comparte entre todos los teléfonos.</p>") +
      '<div class="modal__actions modal__actions--2">' +
      (osm || EMBED ? "" : '<button type="button" class="btn btn--ghost" id="retryOsm">Reintentar descarga</button>') +
      (S.LIVE ? "" : '<button type="button" class="btn btn--ghost" id="resetDemo">Reiniciar la demo</button>') + "</div>");
    if ($("#simToggle")) $("#simToggle").onchange = function () {
      S.setSettings({ simulate: this.checked });
      renderMarkers(); renderList(); if (app.selected) renderDetail();
    };
    if ($("#resetDemo")) $("#resetDemo").onclick = function () {
      if (!armed(this, "Toca otra vez para borrar todo")) return;
      S.resetDemo(); draft = null; closeModal();
      renderMarkers(); renderList(); renderReceipts(); renderManager();
      if (app.selected) renderDetail();
      toast("Demo reiniciada.", "ok");
    };
    var r = $("#retryOsm");
    if (r) r.onclick = function () { closeModal(); loadOsm(true); };
  }

  $("#aboutBtn").onclick = openAbout;
  $("#dataChip").onclick = openDataInfo;

  /* =========================================================
   * Carga de estaciones
   * ======================================================= */
  function loadOsm(force) {
    var prevSource = app.source;
    if (force) { app.source = "loading"; updateDataChip(); }
    S.fetchOsm().then(function (res) {
      setStations(res.stations, "osm");
      renderMarkers(); renderList();
      if (location.hash.indexOf("#gerentes") === 0) renderManager();
      toast(nf0.format(res.stations.length) + " estaciones reales cargadas desde OpenStreetMap.", "ok");
    }).catch(function () {
      app.source = prevSource === "loading" ? "demo" : prevSource;
      updateDataChip();
      if (force) toast("No se pudo conectar con OpenStreetMap. Seguimos con estaciones de demostración.", "err");
    });
  }

  /* =========================================================
   * Navegación
   * ======================================================= */
  function route() {
    var h = location.hash || "#mapa";
    var view = "mapa";
    if (h.indexOf("#pagos") === 0) view = "pagos";
    else if (h.indexOf("#gerentes") === 0) view = "gerentes";
    $all(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== view; });
    $all(".tab").forEach(function (t) { t.classList.toggle("is-active", t.getAttribute("data-tab") === view); t.setAttribute("aria-current", t.getAttribute("data-tab") === view ? "page" : "false"); });
    document.body.setAttribute("data-view", view);
    if (view === "mapa") {
      app.map.invalidateSize({ pan: false });
      var m = h.match(/^#estacion-(.+)$/);
      var id = m && decodeURIComponent(m[1]);
      if (id && app.byId[id]) {
        if (app.selected !== id) openStation(id);
        else { refreshStation(id); renderDetail(); }
      } else if (app.selected) {
        renderDetail();
      }
    } else if (view === "pagos") { renderReceipts(); }
    else { renderManager(); }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* =========================================================
   * Controles del mapa
   * ======================================================= */
  var searchTimer;
  $("#searchInput").addEventListener("input", function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      app.search = e.target.value.trim();
      renderList();
      if (isMobile() && app.search) $("#panel").classList.add("panel--open");
    }, 150);
  });

  $all("[data-filter]").forEach(function (b) {
    b.onclick = function () {
      var k = b.getAttribute("data-filter");
      app.filters[k] = !app.filters[k];
      b.setAttribute("aria-pressed", app.filters[k] ? "true" : "false");
      renderMarkers(); renderList();
    };
  });

  $("#stationList").addEventListener("click", function (e) {
    var b = e.target.closest(".scard");
    if (b) openStation(b.getAttribute("data-id"));
  });

  $("#panelHandle").onclick = function () { $("#panel").classList.toggle("panel--open"); };

  if (EMBED) $("#locateBtn").hidden = true;
  $("#locateBtn").onclick = function () {
    if (!navigator.geolocation) { toast("Tu navegador no permite ubicarte.", "err"); return; }
    var btn = this;
    btn.classList.add("is-busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.classList.remove("is-busy");
      app.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (app.userMarker) app.map.removeLayer(app.userMarker);
      app.userMarker = L.circleMarker([app.userLoc.lat, app.userLoc.lng], {
        radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1
      }).addTo(app.map).bindTooltip("Estás aquí");
      app.map.flyTo([app.userLoc.lat, app.userLoc.lng], 13, { duration: 0.8 });
      app.search = ""; $("#searchInput").value = "";
      if (isMobile()) $("#panel").classList.add("panel--open");
      setTimeout(renderList, 900);
    }, function () {
      btn.classList.remove("is-busy");
      toast("No pudimos obtener tu ubicación. Revisa los permisos.", "err");
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  /* =========================================================
   * Instalación (PWA)
   * ======================================================= */
  var deferredInstall = null;
  var installBtn = $("#installBtn");
  var standalone = EMBED || window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (!standalone) installBtn.hidden = false;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
  installBtn.onclick = function () {
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(function () { deferredInstall = null; });
      return;
    }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal('<h2 id="modalTitle">Instalar Tanque ya</h2>' +
      (ios ? "<ol class=\"howto\"><li>Abre esta página en <b>Safari</b>.</li><li>Toca el botón <b>Compartir</b>.</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li></ol>"
        : "<ol class=\"howto\"><li>Abre el menú del navegador (⋮).</li><li>Elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.</li></ol>") +
      '<p class="muted small">La instalación funciona cuando la página está publicada en un dominio con HTTPS.</p>');
  };
  window.addEventListener("appinstalled", function () { installBtn.hidden = true; toast("Tanque ya instalada.", "ok"); });

  if (!EMBED && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  /* =========================================================
   * Arranque
   * ======================================================= */
  // Cuando llegan datos nuevos (de otro teléfono o de otra pestaña), se repinta lo necesario.
  var lastSig = "";
  function afterDataChange() {
    var sig = JSON.stringify([S.payments().map(function (p) { return p.code + p.status; }), S.manager()]);
    var changed = {}, any = false;
    app.stations.forEach(function (st) {
      var state = S.stateOf(st);
      var sigS = JSON.stringify(state);
      if (st._sig === sigS) return;
      var first = st._sig === undefined;
      st._sig = sigS;
      if (first) return;
      changed[st.id] = true; any = true;
      refreshStation(st.id);
    });
    if (any && !app.search) renderList();
    if (app.selected && changed[app.selected] && !$("#detailPane").hidden) {
      var y = $("#detailPane").scrollTop; renderDetail(); $("#detailPane").scrollTop = y;
    }
    if (sig !== lastSig) {
      lastSig = sig;
      renderReceipts();
      refreshOpenReceipt();
      var m = S.manager(), st = m && managerStation(m);
      if (st && document.body.getAttribute("data-view") === "gerentes") renderDashPayments(st);
    }
  }
  function poll() {
    if (document.hidden) return;
    S.refresh().then(afterDataChange).catch(function () {});
  }
  window.addEventListener("storage", function () { if (!S.LIVE) poll(); });
  document.addEventListener("visibilitychange", poll);

  if (!S.LIVE) $("#demoRibbon").textContent = "Demostración · no se mueve dinero";
  else $("#demoRibbon").hidden = true;

  initMap();
  var cache = EMBED ? null : S.cachedOsm();
  function start() {
    if (cache) setStations(cache.stations, "osm");
    else { setStations(S.LIVE ? [] : (window.DEMO_STATIONS || []), "demo"); if (!EMBED) { app.source = "loading"; updateDataChip(); } }
    renderMarkers();
    renderList();
    renderReceipts();
    route();
    lastSig = JSON.stringify([S.payments().map(function (p) { return p.code + p.status; }), S.manager()]);
    if (!cache && !EMBED) loadOsm(false);
    setInterval(poll, S.LIVE ? 10000 : 4000);
  }
  S.init().then(start).catch(function (e) {
    start();
    toast((e && e.userMessage) || "No se pudo conectar con el servidor. Revisa tu conexión.", "err");
  });
})();
