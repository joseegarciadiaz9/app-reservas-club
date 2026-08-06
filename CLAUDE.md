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

## Bloqueo actual

La cuenta **joseegarciadiaz9** es **colaborador** (no admin) de "Live Punta Umbría" en el
panel Alpha, por lo que no ve el **Developer Portal** para generar la API key. Hace falta
que el **propietario** (probablemente livepuntacompras@gmail.com) suba a Jose a admin o
genere la clave: tipo **Channel Manager**, permisos **Booking**, entorno **Alpha**.

## Reglas al trabajar aquí

- No exponer la API key en código cliente ni en el repo.
- No dar por buenos datos hardcodeados de zonas/mesas/precios: deben venir de `GET /bookings/zones`.
- El referente/RRPP no se puede fijar por reserva vía API (queda el canal de ventas); hora de llegada y extras van en notas.
