/*
 * Estaciones de DEMOSTRACIÓN.
 * Se usan solo si no se puede descargar el listado real de OpenStreetMap
 * (por ejemplo, sin internet). Las posiciones son aproximadas alrededor de
 * cada ciudad y los nombres son genéricos: no corresponden a estaciones reales.
 */
(function () {
  var cities = [
    ["Caracas", "Distrito Capital", 10.4806, -66.9036, 9],
    ["Maracaibo", "Zulia", 10.6545, -71.6406, 6],
    ["Valencia", "Carabobo", 10.162, -68.0077, 6],
    ["Barquisimeto", "Lara", 10.0678, -69.3474, 5],
    ["Maracay", "Aragua", 10.2469, -67.5958, 4],
    ["Ciudad Guayana", "Bolívar", 8.353, -62.641, 4],
    ["Barcelona", "Anzoátegui", 10.1333, -64.6833, 3],
    ["Maturín", "Monagas", 9.7457, -63.1832, 3],
    ["Mérida", "Mérida", 8.5897, -71.1561, 3],
    ["San Cristóbal", "Táchira", 7.7669, -72.225, 3],
    ["Barinas", "Barinas", 8.6226, -70.2075, 3],
    ["Cumaná", "Sucre", 10.4564, -64.1675, 2],
    ["Ciudad Bolívar", "Bolívar", 8.1292, -63.5408, 2],
    ["Punto Fijo", "Falcón", 11.6956, -70.1997, 2],
    ["Coro", "Falcón", 11.4045, -69.6734, 2],
    ["Los Teques", "Miranda", 10.3442, -67.0433, 2],
    ["Guarenas", "Miranda", 10.4667, -66.6167, 2],
    ["San Fernando de Apure", "Apure", 7.8878, -67.4724, 2],
    ["Valera", "Trujillo", 9.3178, -70.6036, 2],
    ["Acarigua", "Portuguesa", 9.5597, -69.2019, 2],
    ["El Tigre", "Anzoátegui", 8.8875, -64.2453, 2],
    ["Cabimas", "Zulia", 10.396, -71.446, 2],
    ["Porlamar", "Nueva Esparta", 10.9577, -63.8697, 2],
    ["San Juan de los Morros", "Guárico", 9.9119, -67.354, 1],
    ["San Carlos", "Cojedes", 9.6612, -68.5827, 1],
    ["Puerto Ayacucho", "Amazonas", 5.6639, -67.6236, 1],
    ["Tucupita", "Delta Amacuro", 9.0622, -62.051, 1],
    ["Guanare", "Portuguesa", 9.0418, -69.7421, 1],
    ["Puerto Cabello", "Carabobo", 10.4731, -68.0125, 1],
    ["San Felipe", "Yaracuy", 10.3399, -68.7425, 1],
    ["Carúpano", "Sucre", 10.6681, -63.2585, 1]
  ];
  var streets = ["Av. Principal", "Av. Bolívar", "Carretera Nacional", "Av. Intercomunal",
    "Autopista, km 3", "Av. Universidad", "Calle Comercio", "Av. Las Américas", "Redoma de entrada"];

  var seed = 20261102;
  function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

  var out = [];
  cities.forEach(function (c) {
    for (var i = 0; i < c[4]; i++) {
      var street = streets[Math.floor(rnd() * streets.length)];
      out.push({
        id: "demo-" + c[0].toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-") + "-" + (i + 1),
        name: "Estación " + c[0] + " " + (i + 1),
        brand: "",
        lat: +(c[2] + (rnd() - 0.5) * 0.05).toFixed(5),
        lng: +(c[3] + (rnd() - 0.5) * 0.05).toFixed(5),
        address: street,
        city: c[0] + ", " + c[1],
        source: "demo"
      });
    }
  });
  window.DEMO_STATIONS = out;
})();
