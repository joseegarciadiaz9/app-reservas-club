# Integración con Fourvenues (Channel Manager API)

Capa server-side para crear reservas de TØTEM en Fourvenues desde la herramienta
interna de RRPP. La API key **solo vive en el servidor**; el cliente nunca la ve.

## Arquitectura

```
UI (app/page.tsx, "use client")
  └─ app/lib/fourvenues-browser.ts   ← fetch a nuestros Route Handlers
       └─ app/api/fourvenues/*        ← Route Handlers (servidor)
            └─ app/lib/fourvenues.ts  ← cliente Channel Manager (usa X-Api-Key)
                 └─ channels-service(-alpha).fourvenues.com
```

- `app/lib/fourvenues.ts` — cliente tipado de la Channel Manager API.
- `app/api/fourvenues/status` — ¿hay API key? (la UI pasa de "simulación" a "conectado").
- `app/api/fourvenues/events` — `GET ?date=YYYY-MM-DD`.
- `app/api/fourvenues/zones` — `GET ?event_id=...` (zonas + mesas + tarifas + disponibilidad).
- `app/api/fourvenues/bookings` — `POST` (`mode: "checkout" | "request"`).
- `app/lib/fourvenues-browser.ts` — helper de navegador para llamar a lo anterior.

## Configuración (secrets)

Copia `.env.example` a `.env` (o `.dev.vars` para Wrangler) y rellena:

| Variable | Descripción |
| --- | --- |
| `FOURVENUES_API_KEY` | Clave de **Channel Manager con permisos de Booking** (Developer Portal). |
| `FOURVENUES_ENV` | `alpha` (pruebas) o `prod`. |
| `FOURVENUES_BASE_URL` | Opcional, sobreescribe la base URL. |
| `FOURVENUES_CHANNEL_ID` | Opcional, `external_channel_id` por defecto. |

En producción se define como *secret* del Worker (`wrangler secret put FOURVENUES_API_KEY`).
Para salir a PRO: pedir la clave de producción, poner `FOURVENUES_ENV=prod` y no tocar nada más.

## Flujo de creación de una reserva

1. `GET /events?date=...` → localizar el `event_id` de la fecha.
2. `GET /bookings/zones?event_id=...` → zonas, mesas (`spaces`), tarifas y disponibilidad.
3. `POST /bookings/checkout` (o `/request`) con la zona, tarifa, mesa e info del cliente.
4. Fourvenues devuelve `payment_url` (checkout) y gestiona pago, confirmación y QR.

## Mapeo del modelo de la app → campos de Fourvenues

| App | Fourvenues | Notas |
| --- | --- | --- |
| Zona (Pinar, Pista…) | `zone_slug` + `normalized_zone_name` | Vienen de `GET /bookings/zones`. Sustituir las zonas hardcodeadas. |
| Mesa (201, J1…) | `table_id` = `space._id` | **Solo** si la zona tiene `can_select_client: true`. |
| Nº personas | `info.quantity` | — |
| Cliente | `info.full_name`, `info.email`, `info.phone`, `info.birthdate` | — |
| Observaciones internas | `observations_client` | El referral (`observations_referral`) no es asignable vía API. |
| Nº de botellas / precio | **tarifa (`rate_slug`)** | El precio, adelanto e incluidos salen de la tarifa (`rate.price`, `rate.deposit`, `rate.included_persons`). Confirmar con Fourvenues si las botellas son tarifa o producto. |
| Referente / RRPP | canal de ventas | No hay campo de referente por reserva vía API; queda el canal. Alternativa: una clave/canal por RRPP. |
| Hora de llegada | `observations_client` (notas) | No hay campo específico; va en notas. |

## Pendiente (a la espera de respuesta de Fourvenues)

Preguntado por email a Inacio (Fourvenues), sin respuesta aún:

- Reservas especiales con **precio y adelanto de 0 €** vía API.
- **Bloqueo/fijación del precio** para que no se recalcule.
- `table_id`: confirmación del parámetro y de dónde consultar los disponibles por zona.
- **Botellas**: si van como producto de la reserva o dentro de notas.
- Condiciones **comerciales** de la integración (Álvaro).

Confirmado por Fourvenues:

- Usar la organización existente "Live Punta Umbría" en Alpha; para producción, cambiar
  endpoints y clave.
- Las claves se generan desde el **Developer Portal** eligiendo el tipo (Channel Manager / Booking).
- El **referente** no es asignable por reserva vía API (queda el canal de ventas).
- Hora de llegada y similares van en el campo de **notas**.

## Siguiente paso al recibir la API key

1. Poner `FOURVENUES_API_KEY` en `.env` / secret y `FOURVENUES_ENV=alpha`.
2. Verlo conectado: la UI mostrará "Conectado a Fourvenues (Alpha)".
3. Sustituir las zonas/mesas/precios hardcodeados de `app/page.tsx` por los datos reales
   de `GET /bookings/zones` y enganchar el botón de crear reserva a
   `createCheckout` / `requestBooking` de `app/lib/fourvenues-browser.ts`.
