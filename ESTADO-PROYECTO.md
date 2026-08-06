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
- Las claves se generan **uno mismo desde el Developer Portal** (eligiendo el tipo de clave).
- El **referente/RRPP no es asignable por reserva vía API**: queda el **canal de ventas** como referente (el campo referente por API solo existe en entradas).
- **Hora de llegada y similares** van en el campo **notas** (`observations_client`); no hay campo específico.

### Pendiente de respuesta (último correo enviado, sin contestar aún)

- Reservas especiales con **precio y adelanto de 0 €** vía API.
- **Bloqueo/fijación del precio** para que no se recalcule.
- `table_id`: confirmación del parámetro y de dónde consultar disponibles por zona.
- **Botellas**: ¿producto de la reserva (define precio) o en notas?
- **Condiciones comerciales** de la integración (Álvaro).

## 🚧 Bloqueo actual: permisos

La cuenta **joseegarciadiaz9** es **colaborador** de "Live Punta Umbría", NO admin.
Por eso el panel Alpha (`alpha.pro.fourvenues.com`) no muestra "Ajustes → Developer
Portal" (el menú de la organización solo ofrece "Dejar de colaborar").

**Para desbloquear**, una de dos:

1. Que el **propietario** de la organización (probablemente **LIVE COMPRAS /
   livepuntacompras@gmail.com**) dé **permisos de admin** a Jose. Entonces aparece
   el Developer Portal y se puede generar la clave.
2. O que ese propietario **genere la clave** directamente y la pase.

Al crear la clave: tipo **Channel Manager**, permisos **Booking**, entorno **Alpha**.

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

## Próximos pasos

1. Conseguir permisos de admin (o que el owner genere la clave) → **generar API key Channel Manager (Booking) en Alpha**.
2. Poner `FOURVENUES_API_KEY` en `.env` / secret del Worker; la UI mostrará "conectado".
3. Sustituir zonas/mesas/precios hardcodeados de `app/page.tsx` por datos reales de `GET /bookings/zones`.
4. Enganchar el botón de crear reserva a `createCheckout` / `requestBooking`.
5. Cerrar dudas pendientes (0 €, bloqueo de precio, botellas) con Inacio y aplicar.
6. Validar end-to-end en Alpha; luego pedir claves de producción.
