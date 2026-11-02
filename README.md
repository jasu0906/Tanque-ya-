# Tanque ya

Demo web para Venezuela con:

- **Mapa de estaciones de servicio** con las estaciones reales de OpenStreetMap, en colores según si tienen combustible.
- **Ficha de cada estación**: combustible disponible (91, 95 y diésel), precio en $ y en Bs, horario y cola.
- **Reportes de cola** hechos por los conductores.
- **Panel para gerentes**: abrir o cerrar, disponibilidad por combustible, precio por litro, tasa del día, cola y horario.
- **Pago con Pago Móvil directo a la estación**: el conductor paga desde la app de su banco con los datos de la estación, escribe la referencia y el gerente lo confirma al verlo en su cuenta. Luego el conductor recibe un código QR para la bomba.
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

## Dos modos

| | Modo demostración | Modo real |
|---|---|---|
| Cuándo | `assets/js/config.js` vacío (como viene) | Con los datos de tu proyecto de Supabase en `config.js` |
| Datos | En cada navegador | Compartidos entre todos los teléfonos |
| Gerentes | PIN **1234** en cualquier estación | Cuenta con correo y contraseña, y estación verificada por ti |
| Pagos | Datos de Pago Móvil de ejemplo, no se mueve dinero | Pago Móvil real a la cuenta de cada estación |
| Estaciones sin datos | Valores simulados (marcados) | Aparecen como «Sin reportar» |

## Activar los pagos reales (Supabase)

Es gratis para empezar y no hace falta ningún servidor propio.

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo. Guarda la contraseña de la base de datos.
2. En **SQL Editor**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Crea las tablas y las reglas de seguridad. Se puede volver a ejecutar sin perder datos.
3. En **Authentication → Sign In / Providers**:
   - Activa **Allow anonymous sign-ins**. Los conductores pagan sin crear cuenta.
   - Deja **Email** activado. Los gerentes entran con correo y contraseña.
4. En **Authentication → URL Configuration**, pon como *Site URL* la dirección de la app (por ejemplo `https://jasu0906.github.io/Tanque-ya-/`). Ahí lleva el enlace del correo de confirmación.
5. En **Project Settings → API**, copia la **Project URL** y la clave **anon public** en `assets/js/config.js`. La clave *anon* está hecha para ir en la página. **Nunca** pongas la clave `service_role`.
6. Publica (haz *commit* y *push*) y abre la app.

### Activar una estación

1. El gerente entra en **Gerentes → Crea tu cuenta**, confirma el correo y envía la solicitud con su estación, su RIF y su teléfono.
2. Tú compruebas que de verdad es el gerente: llámale, pide el RIF o visita la estación.
3. En **SQL Editor**:
   ```sql
   select id, name, rif, contact, created_at from station_requests where status = 'pendiente';
   select approve_station_request(1);   -- el id de la solicitud
   ```
4. El gerente sale y vuelve a entrar. Rellena sus datos de Pago Móvil, la tasa y los precios, marca «Acepto pagos» y publica.

### Cómo funciona un pago

1. El conductor elige combustible y litros. La app calcula el monto en Bs con la tasa de la estación.
2. Ve el banco, el teléfono y el RIF de la estación, con botones para copiarlos, y paga desde la app de su banco.
3. Escribe la referencia, su banco, su teléfono y su cédula. El pago queda **por confirmar**.
4. Al gerente le aparece en **Pagos por confirmar** (se actualiza cada 10 segundos). Lo compara con su banco y pulsa **Llegó, confirmar** o **No llegó**.
5. El conductor ve el resultado al momento. Si se confirmó, recibe el código QR, y el despachador lo valida en **Despachar**.

El servidor, y no el teléfono del conductor, calcula el precio y el total a partir de los datos de la estación. Además, la misma referencia no se puede usar dos veces en una estación, un conductor solo ve sus pagos, el gerente solo los de su estación, y un pago solo avanza en orden: por confirmar → confirmado → despachado.

### Cobrar la comisión

El dinero va directo a cada estación. La comisión (1 %, en `fee_usd`) se le factura a la estación, por ejemplo cada mes:

```sql
select station_id, station_name, count(*) as pagos, sum(total_usd) as ventas_usd, sum(fee_usd) as comision_usd
from payments
where status in ('aprobado', 'despachado') and created_at >= date_trunc('month', now())
group by 1, 2 order by comision_usd desc;
```

Si cambias el porcentaje, cámbialo en `supabase/schema.sql` (función `prepare_payment`) y en `config.js`.

### Antes de cobrar de verdad

- **Legal:** que el dinero vaya directo a la estación evita que Tanque ya custodie fondos. Aun así, revisa con un abogado en Venezuela el contrato con las estaciones, la facturación de la comisión y la protección de datos. Esto no es asesoría legal.
- **Verificación manual:** depende de que el gerente mire bien su banco. El siguiente paso es la verificación automática con la conexión de cada banco.
- **Abuso:** cualquiera puede crear una sesión anónima y enviar referencias falsas, que el gerente rechazará. Si pasa a menudo, activa el CAPTCHA de Supabase (*Authentication → Attack Protection*).
- **Plan gratuito de Supabase:** el proyecto se pausa tras unos días sin uso. Para producción, usa un plan de pago.
- Revisa la lista de códigos de banco en `assets/js/store.js` (`BANKS`).
- Las estaciones del mapa vienen de OpenStreetMap y no están verificadas. Solo las que actives tú aceptan pagos.

## Estructura

```
index.html                 la app
assets/css/app.css         estilos (claro y oscuro, móvil y escritorio)
assets/js/config.js        conexión con Supabase (vacío = modo demostración)
assets/js/store.js         capa de datos: demo o Supabase, OpenStreetMap
supabase/schema.sql        tablas, reglas de seguridad y funciones del servidor
assets/js/app.js           interfaz: mapa, ficha, pago, panel de gerentes
data/                      contorno de Venezuela y estaciones de ejemplo
vendor/                    Leaflet, Leaflet.markercluster, qrcode-generator y supabase-js (MIT)
sw.js, manifest.webmanifest  instalación como app
```

Mapa: © colaboradores de OpenStreetMap (ODbL), teselas de © CARTO. Contorno del país: Natural Earth (dominio público).
