# Estado del proyecto — App Reservas TØTEM

Documento de contexto que reúne todo lo investigado y decidido sobre la
integración con Fourvenues. Complementa a `INTEGRATION.md` (detalle técnico).

Última actualización: agosto 2026.

## Qué es la app

Herramienta interna para los RRPP de **TØTEM Punta Umbría**. El cliente envía sus
datos por WhatsApp con un formulario (fecha, nombre, personas, teléfono, email,
zona, hora de llegada, botellas); el RRPP pega ese mensaje en la app, que:

1. Interpreta los datos (parser en `app/page.tsx`).
2. Valida zona, mesa, capacidad y precio.
3. Deja la reserva lista para crearla en **Fourvenues**.

No sustituye a Fourvenues: es una vía más rápida y con menos errores para
introducir reservas. Fourvenues sigue gestionando pago, adelanto, confirmación y QR.

Stack: Next 16 (app router) sobre **vinext / Cloudflare Workers**, Drizzle/D1
preparado (schema aún vacío).

## TØTEM y Fourvenues

- TØTEM Punta Umbría ya opera sobre Fourvenues (entradas, listas y reservados VIP con botella).
- Fourvenues: software all-in-one de ocio nocturno (ticketing, reservados, control de accesos, TPV, CRM). Mapa interactivo único de reservas.

## La API de Fourvenues (lo importante)

Docs: https://docs.fourvenues.com — hay tres APIs:

- **Channel Manager API** → la que necesitamos. Es la ÚNICA que permite **crear reservados** (bookings).
- **Integrations API** → solo lectura + check-in + actualizar estado; NO crea reservas.
- **Reseller API** → reventa de terceros.

### Endpoints clave (Channel Manager)

- Base Alpha: `https://channels-service-alpha.fourvenues.com`
- Base Prod: `https://channels-service.fourvenues.com`
- Auth: cabecera `X-Api-Key`.
- `GET /events` (filtros start_date/end_date/organization_id/location_id) → localizar `event_id`.
- `GET /bookings/zones?event_id=...` → zonas + mesas (`spaces`, cuyo `_id` es el `table_id`) + tarifas (precio, adelanto, personas incluidas) + disponibilidad + `can_select_client`.
- `POST /bookings/checkout` → crea reserva y devuelve `payment_url` (se confirma al pagar).
- `POST /bookings/request` → crea solicitud; el venue la acepta desde el panel.

## Hilo con Fourvenues (Inacio Baldovino, Product Manager)

Asunto: "Integración interna para automatizar reservas de TØTEM".
Participantes: Jose (joseegarciadiaz9), LIVE COMPRAS (livepuntacompras@gmail.com),
Inacio (inacio.baldovino@fourvenues.com), Álvaro (alvaro.aviles@fourvenues.com).

### Confirmado por Fourvenues

- Vía correcta: **Channel Manager API con permisos de Booking** (`/bookings/checkout` y `/bookings/request`).
- Usar la organización **existente "Live Punta Umbría"** en Alpha. Para producción: pedir claves PRO y cambiar endpoints.
- Las claves se **solicitan** desde el Developer Portal (eligiendo el tipo, que es
  inmutable). **No hay permiso "Booking"**: el alcance es granular o `Read: All / Write: All`.
  La solicitud queda **pendiente de aprobación de Fourvenues** antes de activarse.
- El **referente/RRPP no es asignable por reserva vía API**: queda el **canal de ventas** como referente (el campo referente por API solo existe en entradas).
- **Hora de llegada y similares** van en el campo **notas** (`observations_client`); no hay campo específico.

### Pendiente de respuesta (último correo enviado, sin contestar aún)

- Reservas especiales con **precio y adelanto de 0 €** vía API.
- **Bloqueo/fijación del precio** para que no se recalcule.
- `table_id`: confirmación del parámetro y de dónde consultar disponibles por zona.
- **Botellas**: ¿producto de la reserva (define precio) o en notas?
- **Condiciones comerciales** de la integración (Álvaro).

## ✅ Bloqueo de permisos resuelto — clave solicitada (pendiente de aprobación)

**joseegarciadiaz9 ya es admin** de "Live Punta Umbría" en Alpha, así que en
`alpha.pro.fourvenues.com` aparece **Ajustes → Developer Portal**. Desde ahí se ha
**solicitado** la clave.

Hallazgos al pedir la clave (corrigen lo que creíamos):

- **No existe un permiso "Booking"**. La Channel Manager API ofrece permisos granulares
  (Auth, Event, List Rate, List, Location, Organization, Ticket Rate, Ticket, Payment,
  Webhook, Preregister…) o los globales **Read: All / Write: All**.
- La clave se pidió con **`all:read` + `all:write`** (amplio, válido para Alpha; **acotar
  en producción**). Ventaja: al tener todos los permisos, a futuro se pueden implementar
  más funciones (CRM, entradas, pagos, webhooks) sin volver a pedir clave.
- El **tipo de API es inmutable** una vez creada; los permisos sí se pueden ajustar.
- La clave **no se genera al instante**: queda en estado **"Solicitada"** (valor
  "Pendiente") hasta que **Fourvenues la aprueba**.

Solicitud enviada: clave **Channel Manager** "App Reservas TOTEM - RRPP (Alpha)",
`all:read` + `all:write`, caducidad **06/08/2027**, estado **Solicitada**.

> Nota: la clave que llegó por email el 3-ago ("Tu clave API de Integración",
> descripción "Medición de ventas Meta Ads – Live", termina en `CsOuUc`) es de la
> **Integrations API** y para otro uso. **No sirve** para esta herramienta.

## Integración ya construida en el repo

Ver `INTEGRATION.md` para el detalle. Resumen:

- `app/lib/fourvenues.ts` — cliente server-side tipado (Channel Manager).
- `app/api/fourvenues/{status,events,zones,bookings}` — Route Handlers.
- `app/lib/fourvenues-browser.ts` — helper de navegador.
- `app/page.tsx` — consulta `/status` y muestra "Conectado a Fourvenues (Alpha)" cuando hay clave.
- `.env.example` — variables (`FOURVENUES_API_KEY`, `FOURVENUES_ENV`, ...).

Todo compila (los únicos avisos de `tsc` son ambientales: `cloudflare:workers`,
`Fetcher`, `D1Database`, iguales a los preexistentes en `db/` y `worker/`).

## Clave activa: qué funciona y qué falta en Alpha (10-ago-2026)

La clave llegó por email ("Tu clave API de Channel Manager está lista", enlace de
**un solo uso**) y está en `.env`. Estado verificado:

- ✅ **Autenticación OK**. `GET /organizations` devuelve "Live Punta Umbría"
  (`lktvr06j406ty01ks4h2t1c0hzDOo8S9`) y `GET /locations` la ubicación real.
- ✅ La app muestra **"Conectado a Fourvenues (Alpha)"**.
- ⚠️ **No hay datos vendibles en Alpha.** Alpha solo tenía eventos pasados
  (2022-2023). Se copió uno ("Closing Party POWER" → **15-ago-2026**,
  `s6btul4wzawkojda76ckexccpo7v10ld`) y **sí aparece** en `GET /events`, pero
  `GET /bookings/zones` devuelve **0 zonas** aunque el evento tiene 139 mesas.

Qué se probó para desbloquear las zonas (sin éxito todavía):

- Activar en la zona **"Pueden reservar → Clientes"** y **"Pueden seleccionar
  espacios → Clientes"** (este último es el `can_select_client` de la API).
- El evento **no tiene canales de venta** asignados ("Canales de venta" vacío) y
  viene con **`is_preregistered: true`** (modo prerregistro, ventas sin abrir):
  son las dos hipótesis principales para que no haya zonas vendibles.

**Resuelto (10-ago, respuesta de Inacio):** la causa eran los **horarios de las
zonas**. Una zona con horas reservables configuradas no es compatible con la
Channel Manager y se excluye de la respuesta. Inacio quitó los horarios a la zona
del evento de prueba y las zonas empezaron a devolverse.

Con eso se completó la primera **reserva real end-to-end** en Alpha
(`POST /bookings/request` → `200`, `status: "to-review"`, mesa J1 asignada y
observaciones correctas), visible en el panel como "Pendiente 65,00 €".

✅ **Riesgo descartado.** Comprobado en el panel de producción de TØTEM: sus zonas
**no usan horarios**. Las tres revisadas —PISTA GENERAL y EMBARCADERO DEL PINAR
(evento de fiesta) y PINAR (evento de concierto)— tienen *"No usar horas en las
reservas"* y ninguna rejilla de horas reservables. Encaja con cómo trabajan: el
recargo por hora de llegada se cobra en taquilla, no se modela en Fourvenues.
Es decir, **las zonas de TØTEM deberían verse por API sin tocar su operativa**.
(El horario que bloqueaba el evento de Alpha venía de la copia de un evento de
Live Punta Umbría de 2022, no de TØTEM.)

Sigue **sin respuesta** la segunda pregunta del correo: si la clave de producción
debe generarse desde la organización **TØTEM Punta Umbría** (la de Alpha es de
"Live Punta Umbría") y qué proceso hay para obtenerla.

## Producción conectada (11-ago-2026)

Inacio confirmó que la clave queda **vinculada a la organización desde la que se
genera**, y que no hace falta más validación que tener la cuenta Pro activa. Se
solicitó desde el Developer Portal de **TØTEM Punta Umbría** y la aprobaron el
mismo día ("App Reservas TOTEM - RRPP (Produccion)", `all:read` + `all:write`,
caduca 10/08/2027). Ya está en `.env` con `FOURVENUES_ENV=prod`.

Verificado contra producción (solo lectura, **sin crear ninguna reserva**):

- `GET /organizations` → TØTEM Punta Umbría (`Lmaws6h1d000t01f11c8s8a5oMsnOw5V`).
- `GET /events` → 18 eventos reales.
- `GET /bookings/zones/` devuelve las zonas reales y **coinciden con el mapeo**:
  - Fiesta: PISTA GENERAL (Escenario) · PRECIO FIESTA 100 € · mesas 101–133.
  - Fiesta: EMBARCADERO DEL PINAR · PRECIO PINAR 80 € · mesas J1–J4 + 201–224.
  - Concierto: PINAR · PRECIO PINAR 80 €.
- Precio y adelanto calculados desde la tarifa real (8 pax en Pinar → 155 €, 78 € de adelanto).

Dos límites reales de producción:

- **`can_select_client: false` en todas las zonas**: la mesa **no se puede fijar
  por API**, la asigna el local. La app la sigue mostrando y la manda en las notas.
- La zona **PISTA (CONCIERTO)** (tarifas LATERAL ESCENARIO y FRONT STAGE) no se
  devuelve porque en el panel está marcada como *Zona completa*.

## Próximos pasos

1. ✅ Admin conseguido y **clave Channel Manager solicitada** en Alpha (`all:read`/`all:write`).
2. ⏳ **Esperar aprobación de Fourvenues** (estado "Solicitada" → activa). Opcional: escribir a
   Inacio para pedir que la aprueben cuanto antes.
3. Cuando la clave esté activa, copiar su valor a `FOURVENUES_API_KEY` en `.env` /
   secret del Worker y `FOURVENUES_ENV=alpha`; la UI mostrará "Conectado a Fourvenues (Alpha)".
4. Sustituir zonas/mesas/precios hardcodeados de `app/page.tsx` por datos reales de `GET /bookings/zones`.
5. Enganchar el botón de crear reserva a `createCheckout` / `requestBooking`. Para reservas
   "no cobrar / 0 €": adjuntar las notas del RRPP a `observations_client` y usar el flujo
   **`request`** (lo confirma el venue), así se omiten las dudas de precio con Fourvenues.
6. Validar end-to-end en Alpha; luego pedir claves de producción y **acotar los permisos**.
7. ✅ **Control de acceso hecho** (`worker/access.ts`): contraseña + cookie firmada,
   cubre páginas y `/api/*`, con fail-closed si hay clave y no hay contraseña.
   Al desplegar: `wrangler secret put FOURVENUES_API_KEY` **y** `APP_ACCESS_PASSWORD`.
