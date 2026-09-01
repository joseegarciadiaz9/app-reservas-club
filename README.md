# App de reservas para club de ocio nocturno

Herramienta interna que convierte una solicitud de reserva recibida por WhatsApp en una reserva validada y lista para crear en Fourvenues, la plataforma de ticketing que usa el club.

## El problema

Las reservas de mesa llegan por WhatsApp: el cliente rellena una plantilla y la envía al relaciones públicas, que la teclea a mano en el panel de Fourvenues. Eso significa releer el mensaje, buscar la zona, comprobar si esa mesa admite el número de personas, mirar la tarifa y el adelanto, y escribirlo todo. En fin de semana, con volumen, aparecen errores de aforo y de precio.

## Qué hace

1. El relaciones públicas pega el mensaje del cliente en la app.
2. La app interpreta los datos: fecha, nombre, personas, teléfono, email, zona, hora de llegada y botellas.
3. Valida contra los datos reales del evento: que la zona exista, que la mesa admita ese número de personas, y qué tarifa y adelanto corresponden.
4. Deja la reserva lista para crearla en Fourvenues.

No sustituye a Fourvenues. El pago, la confirmación y el QR siguen viviendo allí; esto es una vía más rápida y con menos errores de entrada.

## Stack

- **Next.js 16** (App Router) sobre **vinext** / **Cloudflare Workers**
- **React 19**, **TypeScript**, **Tailwind**
- **Drizzle ORM** sobre Cloudflare D1
- Integración con la **Channel Manager API** de Fourvenues

## Lo que costó averiguar

Fourvenues expone tres APIs y solo una sirve para esto:

- **Channel Manager API** — la única que permite crear reservados. Es la que usa la app.
- **Integrations API** — solo lectura, check-in y cambio de estado. No crea reservas.
- **Reseller API** — reventa de terceros.

El flujo real es: localizar el evento, pedir las zonas para obtener mesas, tarifas, aforo y disponibilidad, y solo entonces crear la reserva, que devuelve una URL de pago y se confirma cuando el cliente paga.

Ese mapeo no estaba resumido en ningún sitio; salió de leer la documentación y probar contra el entorno alpha. Está escrito en `INTEGRATION.md` y `ESTADO-PROYECTO.md`.

## Ejecutar

```bash
npm install
npm run dev
```

Requiere Node >= 22.13. La clave de API va en `.env` (ver `.env.example`); no se incluye en el repositorio.

## Estado

En uso interno. El esquema de base de datos está preparado pero aún vacío: la persistencia local no hacía falta mientras Fourvenues siguiera siendo la fuente de verdad.
