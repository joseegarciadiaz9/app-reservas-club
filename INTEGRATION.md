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
- `app/api/fourvenues/bookings` — `POST` (la UI usa siempre `mode: "request"`; ver abajo).
- `app/lib/fourvenues-browser.ts` — helper de navegador para llamar a lo anterior.

## Configuración (secrets)

Copia `.env.example` a `.env` (o `.dev.vars` para Wrangler) y rellena:

| Variable | Descripción |
| --- | --- |
| `FOURVENUES_API_KEY` | Clave de **Channel Manager** (Developer Portal). No hay permiso "Booking": se pide con `all:read` + `all:write` (o permisos granulares). |
| `FOURVENUES_ENV` | `alpha` (pruebas) o `prod`. |
| `FOURVENUES_BASE_URL` | Opcional, sobreescribe la base URL. |
| `FOURVENUES_CHANNEL_ID` | Opcional, `external_channel_id` por defecto. |

En producción se define como *secret* del Worker (`wrangler secret put FOURVENUES_API_KEY`).
Para salir a PRO: pedir la clave de producción, poner `FOURVENUES_ENV=prod` y no tocar nada más.

## Control de acceso (obligatorio antes de desplegar)

La herramienta crea reservas reales, así que no puede quedar abierta en internet.
La puerta está en **`worker/access.ts`**, aplicada desde `worker/index.ts`, que es
el único punto de entrada: protege **páginas y Route Handlers** por igual (no se
puede colar nadie llamando directamente a `/api/fourvenues/bookings`).

- Contraseña compartida en `APP_ACCESS_PASSWORD`; sesión en cookie firmada
  (HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` en https) que dura 12 h.
- Rutas públicas: `/login`, `/api/auth/login` y los assets estáticos.
- Sin sesión: las páginas redirigen a `/login` y las rutas `/api/*` responden 401.
- **Fail-closed**: si hay `FOURVENUES_API_KEY` pero no `APP_ACCESS_PASSWORD`, la app
  devuelve 503 en todo en lugar de servirse sin protección. Sin clave y sin
  contraseña queda abierta, para poder enseñar la demo en modo simulación.

Al desplegar hay que definir **dos** secrets, no solo la clave:

```
wrangler secret put FOURVENUES_API_KEY
wrangler secret put APP_ACCESS_PASSWORD
```

## Lo que exige la API (verificado creando una reserva real en Alpha)

Cuatro reglas que no están claras en la documentación y que costaron un 400 cada una:

1. **Las zonas con "horarios" configurados NO se devuelven.** Si una zona tiene
   horas reservables definidas (pestaña *Horario* del panel), la Channel Manager
   API la excluye de `GET /bookings/zones/`. Confirmado por Inacio (Fourvenues):
   *"como estos horarios no son compatibles con channel manager, se excluyen esas
   zonas de la respuesta"*. Para vender por API hay que quitarles el horario.
2. **`zone_slug` y `normalized_zone_name` son excluyentes.** Enviar los dos da
   `400 "contains a conflict between exclusive peers"`. Se manda solo uno.
3. **La zona puede no traer `rates`**: entonces las tarifas cuelgan de cada mesa
   (`space.rates`) y hay que recolectarlas desde ahí.
4. **Los nombres de campo no son los esperados**: la zona expone `normalized_name`
   (no `normalized_zone_name`) y el adelanto viene en `deposit.value` (no `amount`).
5. **`end_date` es exclusivo en `GET /events`.** Pedir
   `start_date=2026-08-15&end_date=2026-08-15` devuelve **0 eventos** aunque haya
   uno esa noche (empieza a las 20:00 UTC); hay que cerrar el rango en el día
   siguiente. Por eso el handler de `?date=` calcula `end_date = date + 1 día`.

Reserva de prueba creada el 10-ago-2026 (`POST /bookings/request`, evento
`s6btul4wzawkojda76ckexccpo7v10ld`): responde **200** con
`status: "to-review"`, `table_id` aceptado y las observaciones completas. Es
justo el comportamiento que buscábamos para las reservas sin cobro: **queda
pendiente de que el local la confirme y no se cobra nada automáticamente**.

Sobre el descuadre de precio que nos preocupaba: las propias tarifas lo aclaran en
su campo `conditions` — *"El precio total que recibe es calculado por la aplicación
de manera automática como si el grupo llegara a las 22:00h… El precio total y final
se calculará en puerta por nuestro personal según la hora de llegada"*. O sea, el
precio de la API es orientativo por diseño del local.

## Reservas sin cobro (invitaciones / "a copas")

**El botón "Invitación" del panel no existe en la API.** `POST /bookings/request`
y `/checkout` no aceptan ningún campo de precio, adelanto ni importe: el importe
lo calcula Fourvenues a partir de la **tarifa**. El único campo económico del
payload es `discount_code` (y en las zonas de TØTEM los códigos están
desactivados: `has_discount_codes_enabled: false`).

La única vía para que una reserva nazca a 0 € es que **exista una tarifa a 0 €**.
El código ya la usa: si las notas del RRPP marcan "no cobrar / invitación / a
copas", `placementForZone({ preferNoCharge: true })` elige una tarifa que cumpla
**las dos** condiciones — precio 0 **y** nombre identificable (invitación,
a copas, cortesía…). Si no existe, se comporta como siempre: reserva normal en
modo `request` con el aviso en las notas, para que el local pulse "Invitación".

> ⚠️ **Hoy no hay forma segura de crear esa tarifa.** Comprobado en Alpha
> (11-ago-2026): **la Channel Manager API cuenta como "cliente"**. Al desactivar
> "Pueden reservar → Clientes" en una zona, la zona **se sigue devolviendo** en
> `GET /bookings/zones`, pero al reservar responde
> `400 "You are not authorized to reserve a table for this zone"`.
>
> Es decir: **todo lo que la app pueda reservar, un cliente también puede
> reservarlo desde la web**. Y como las tarifas heredan la visibilidad de la
> zona, una tarifa a 0 € quedaría expuesta al público. No se puede esconder.
>
> La única alternativa que queda sería un **código de descuento del 100 %**
> enviado en `discount_code` (habría que activar los códigos en la zona:
> ahora `has_discount_codes_enabled: false`). Es secreto por naturaleza, pero si
> se filtra cualquiera reservaría gratis. Mientras tanto, lo seguro es lo que ya
> hace la app: crear la reserva como `request` con el aviso en las notas y que el
> local pulse "Invitación" al confirmarla.

## Flujo de creación de una reserva

1. `GET /events?date=...` → localizar el `event_id` de la fecha.
2. `GET /bookings/zones?event_id=...` → zonas, mesas (`spaces`), tarifas y disponibilidad.
3. `POST /bookings/request` con la zona, tarifa e info del cliente.
4. La reserva queda "A revisar" en el panel; el local la confirma y gestiona el cobro.

### Por qué la app usa siempre `request` (verificado en producción, 12-ago-2026)

`POST /bookings/checkout` devuelve `payment_url` pero **no crea la reserva**. Se
generó un checkout real (26/08/2026, PINAR, 6 personas) y el panel siguió
marcando "0 reservas", también en el filtro "Pendientes de revisión o de pago".
La mesa solo nacía si el cliente pagaba: una reserva sin pagar no dejaba rastro
y el RRPP no podía ni consultarla.

`POST /bookings/request` sí la crea al momento, con estado **"A revisar"**,
precio y adelanto calculados por Fourvenues, y las observaciones visibles. Por
eso **todas** las reservas van por ahí, no solo las de "a copas".

### Cómo calcula Fourvenues el precio

Medido creando reservas reales con la tarifa "PRECIO EMBARCADERO" (`price` 80,
`included_persons` 3, `supplement_persons` 1, `supplement_price` 15,
`deposit` 50 %, `fee_quantity` 5 %):

| Personas | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|
| Precio | 80 | 95 | 160 | 160 | 175 |
| Adelanto | 40 | 47,5 | 80 | 80 | 87,5 |

La regla: cada bloque de tarifa cubre `included_persons` y admite como mucho
`supplement_persons` de más (3 + 1 = **4 por bloque**). A la quinta persona se
abre bloque nuevo aunque sobren asientos de suplemento.

```
bloques = ceil(personas / (included_persons + supplement_persons))
precio  = bloques × price + max(0, personas − bloques × included_persons) × supplement_price
```

Dos avisos:

- **`full_payment: true` NO significa cobrar el 100 %.** La tarifa lo tiene a
  true y Fourvenues aplicó igualmente el adelanto del 50 %.
- La pasarela suma la comisión al adelanto: 6 personas → 80 € × 1,05 = **84 €**,
  que es exactamente lo que pidió el enlace de pago real.

Está en `priceForRate()` y fijado con estos números en `tests/pricing.test.mjs`.

## Estructura REAL de zonas y tarifas en TØTEM

Verificado en el panel de **producción** de TØTEM Punta Umbría (10-ago-2026)
mirando un evento de fiesta ("Sábado 15 de Agosto") y uno de concierto
("UKIYØ | MANUEL CORTÉS"). Corrige varias suposiciones del modelo antiguo.

**Las zonas cambian según el tipo de evento:**

| | Evento de fiesta | Evento de concierto |
| --- | --- | --- |
| Zonas visibles | PISTA GENERAL (Escenario), EMBARCADERO DEL PINAR | PISTA (CONCIERTO), PINAR |
| Zonas ocultas | ARENAS | PISTA GENERAL (Escenario), ARENAS |

**Tarifas** (3 personas incluidas + 15 € por persona extra, 50 % de adelanto):
PRECIO FIESTA (100 € en fiesta / 90 € en concierto), PRECIO PINAR (80 €),
PRECIO CHILL (70 €), LATERAL ESCENARIO (100 €), FRONT STAGE (130 €).
Los precios **varían por evento**: hay que leerlos siempre de la API.

**Espacios (mesas)** — todos con capacidad **1–9** personas:

- PISTA GENERAL → `101`–`133` ("Mesa alta"), tarifa PRECIO FIESTA.
- PINAR → `J1`–`J4` ("**Sofá**") **y** `201`–`224` ("Mesa alta"), todos con PRECIO PINAR.

### Tres correcciones importantes

1. **"Jaima" no es una zona.** `J1`–`J4` son espacios dentro de la zona **PINAR**,
   con la misma tarifa que las mesas `201`–`224`.
2. **"Lateral escenario" y "Front Stage" no son zonas**: son **tarifas** dentro de
   la zona **PISTA (CONCIERTO)**.
3. **La tarifa no depende del nº de botellas.** Es el precio del reservado. El
   recargo por hora de llegada (antes/después de 18:30) **no está en las tarifas**;
   es una regla comercial del local.

El mapeo vive en `ZONE_MAPPINGS` (`app/lib/booking-payload.ts`): cada "zona" de la
UI es un par **(alias de zona, alias de tarifa)** más un filtro opcional de espacios.

## Mapeo del modelo de la app → campos de Fourvenues

| App | Fourvenues | Notas |
| --- | --- | --- |
| Zona (Pinar, Pista…) | `zone_slug` + `normalized_zone_name` | Vía `ZONE_MAPPINGS`; los nombres reales cambian entre fiesta y concierto. |
| Mesa (201, J1…) | `table_id` = `space._id` | **Solo** si la zona tiene `can_select_client: true`. En producción está **desactivado para clientes**, así que normalmente la mesa la asigna el local y va en notas. |
| Nº personas | `info.quantity` | — |
| Cliente | `info.full_name`, `info.email`, `info.phone`, `info.birthdate` | — |
| Observaciones internas | `observations_client` | El referral (`observations_referral`) no es asignable vía API. |
| Precio / tarifa | **tarifa (`rate_slug`)** | Se elige por **nombre** (PRECIO PINAR, FRONT STAGE…), no por botellas. Precio, adelanto e incluidos salen de `rate.price`, `rate.deposit`, `rate.included_persons`. |
| Nº de botellas | `observations_client` (notas) | La tarifa cubre el reservado; el nº de botellas se anota. Pendiente de confirmar con Fourvenues. |
| Referente / RRPP | canal de ventas | No hay campo de referente por reserva vía API; queda el canal. Alternativa: una clave/canal por RRPP. |
| Hora de llegada | `observations_client` (notas) | No hay campo específico. Ojo: cada zona define "Horas reservables" en el panel. |

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
- Las claves se piden desde el **Developer Portal** eligiendo el tipo (Integrations API /
  Channel manager API). El tipo es **inmutable** una vez creada la clave.
- **No hay un permiso "Booking"**: el alcance se define con permisos granulares (Auth,
  Event, List, Location, Organization, Ticket Rate, Ticket, Payment, Webhook…) o con los
  globales **Read: All / Write: All**.
- La clave **no se genera al instante**: se **solicita** y queda en estado "Solicitada"
  (valor "Pendiente") hasta que **Fourvenues la aprueba**.
- El **referente** no es asignable por reserva vía API (queda el canal de ventas).
- Hora de llegada y similares van en el campo de **notas**.

Solicitud en curso (Alpha):

- Clave **Channel Manager** "App Reservas TOTEM - RRPP (Alpha)", `all:read` + `all:write`,
  caducidad 06/08/2027, estado **Solicitada** (pendiente de aprobación de Fourvenues).

## Siguiente paso al recibir la API key

1. Poner `FOURVENUES_API_KEY` en `.env` / secret y `FOURVENUES_ENV=alpha`.
2. Verlo conectado: la UI mostrará "Conectado a Fourvenues (Alpha)".
3. Sustituir las zonas/mesas/precios hardcodeados de `app/page.tsx` por los datos reales
   de `GET /bookings/zones` y enganchar el botón de crear reserva a
   `createCheckout` / `requestBooking` de `app/lib/fourvenues-browser.ts`.
