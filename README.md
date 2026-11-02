# Tanque ya

Demo web para Venezuela con:

- **Mapa de estaciones de servicio** con las estaciones reales de OpenStreetMap, en colores según si tienen combustible.
- **Ficha de cada estación**: combustible disponible (91, 95 y diésel), precio en $ y en Bs, horario y cola.
- **Reportes de cola** hechos por los conductores.
- **Panel para gerentes**: abrir o cerrar, disponibilidad por combustible, precio por litro, tasa del día, cola y horario.
- **Pago desde la app** (simulado): Pago Móvil, tarjeta o saldo. Genera un código QR que el gerente valida antes de despachar.
- **Mis pagos**: historial con los códigos QR.
- **Inversionistas**: resumen del problema, la solución, el modelo de negocio y las cifras de la propia demo.
- **Instalable** como app (PWA) cuando se publica con HTTPS.

## Cómo abrirla

Es una página estática, sin compilar nada:

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

Para enseñarla desde el móvil, publícala con **GitHub Pages**: en el repositorio, *Settings → Pages → Deploy from a branch*, elige la rama y la carpeta `/ (root)`.

## Datos de prueba

- PIN de gerente para todas las estaciones: **1234**.
- Las estaciones sin datos muestran valores **simulados**, marcados así en su ficha. Se pueden desactivar desde el botón de estaciones de la barra superior, donde también se reinicia la demo.
- Si no hay conexión con OpenStreetMap, aparecen unas 80 estaciones de ejemplo con nombres genéricos.
- La tasa de Bs por $ (230) es un valor de **ejemplo**. Cada gerente pone la suya.

## Límites de esta versión

| Qué | Estado | Qué hace falta para producción |
|---|---|---|
| Pagos | Simulados, no se cobra nada | Un procesador de pagos autorizado en Venezuela (Pago Móvil o tarjetas) y su API |
| Datos compartidos | Se guardan en el navegador | Un servidor con base de datos (por ejemplo Supabase o Firebase). Toda la lectura y escritura pasa por `assets/js/store.js`, así que solo cambia ese archivo |
| Acceso de gerentes | PIN fijo de demo | Cuentas reales y verificación de cada estación |
| Estaciones | OpenStreetMap, sin validar | Depurar el listado y permitir que cada estación reclame la suya |

## Estructura

```
index.html                 la app
assets/css/app.css         estilos (claro y oscuro, móvil y escritorio)
assets/js/store.js         capa de datos: estado, reportes, pagos, OpenStreetMap
assets/js/app.js           interfaz: mapa, ficha, pago, panel de gerentes
data/                      contorno de Venezuela y estaciones de ejemplo
vendor/                    Leaflet, Leaflet.markercluster y qrcode-generator (MIT)
sw.js, manifest.webmanifest  instalación como app
```

Mapa: © colaboradores de OpenStreetMap (ODbL), teselas de © CARTO. Contorno del país: Natural Earth (dominio público).
