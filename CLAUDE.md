# App Reservas TØTEM — memoria del proyecto

Herramienta interna para RRPP de **TØTEM Punta Umbría**: convierte un formulario de
reserva de WhatsApp en un reservado en **Fourvenues**. No sustituye a Fourvenues;
solo agiliza la introducción de reservas. Stack: Next 16 + vinext (Cloudflare Workers).

## Documentos de contexto (leer primero)

- **`ESTADO-PROYECTO.md`** — estado completo: investigación, hilo con Fourvenues, bloqueos y próximos pasos.
- **`INTEGRATION.md`** — detalle técnico de la integración y mapeo de campos.

## Claves rápidas

- La creación de reservas SOLO es posible con la **Channel Manager API** de Fourvenues
  (`POST /bookings/checkout` y `/bookings/request`). La Integrations API no crea reservas.
- Base URLs: Alpha `https://channels-service-alpha.fourvenues.com`, Prod `https://channels-service.fourvenues.com`. Auth por cabecera `X-Api-Key`.
- El código de integración vive en `app/lib/fourvenues.ts` (cliente server-side),
  `app/api/fourvenues/*` (Route Handlers) y `app/lib/fourvenues-browser.ts` (helper de navegador).
- La **API key es un secreto**: solo servidor, nunca en el cliente. Config vía `.env` (ver `.env.example`).

## Estado actual (clave solicitada, pendiente de aprobación)

Resuelto el bloqueo de permisos: **joseegarciadiaz9 ya es admin** de "Live Punta Umbría"
en Alpha y ve el **Developer Portal**. Desde ahí se ha **solicitado** una clave
**Channel Manager** (descripción "App Reservas TOTEM - RRPP (Alpha)", caducidad 06/08/2027).

Dos hallazgos que corrigen lo que creíamos:
- **No existe un permiso "Booking"**. Los permisos de la Channel Manager API son
  granulares (Auth, Event, List, Location, Organization, Ticket, Payment, Webhook…) o los
  globales **Read: All / Write: All**. La clave se pidió con **`all:read` + `all:write`**
  (amplio para Alpha; acotar en producción). Bonus: al tener todos los permisos, a futuro
  se pueden implementar más cosas (CRM, entradas, pagos, webhooks).
- La clave **no se genera al instante**: el botón es **"Solicitar clave"** y queda en estado
  **"Solicitada"** (valor "Pendiente") hasta que **Fourvenues la aprueba**. Hasta entonces
  no hay valor de clave que meter en `.env`.

Siguiente paso: esperar aprobación de Fourvenues; cuando el estado pase a activa, copiar el
valor a `FOURVENUES_API_KEY` en `.env` y `FOURVENUES_ENV=alpha`.

## Reglas al trabajar aquí

- No exponer la API key en código cliente ni en el repo.
- No dar por buenos datos hardcodeados de zonas/mesas/precios: deben venir de `GET /bookings/zones`.
- El referente/RRPP no se puede fijar por reserva vía API (queda el canal de ventas); hora de llegada y extras van en notas.
