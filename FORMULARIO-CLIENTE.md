# Formulario de reserva (RRPP → cliente)

Mensaje que el RRPP envía al cliente por WhatsApp. El cliente lo devuelve
relleno y el RRPP lo pega tal cual en la app, que lo interpreta solo.

## 1. Mensaje para enviar al cliente

Copia desde aquí (los asteriscos son la negrita de WhatsApp, no los quites):

```
*TØTEM · FORMULARIO DE RESERVA*
Rellena este mensaje y envíamelo tal cual, sin borrar los títulos 🙏

*Fecha:*
*Nombre y apellidos:*
*Nº de personas:*
*Teléfono:*
*Correo electrónico:*
*Zona preferida:*
*Hora de llegada:*
*Nº de botellas:*
*Observaciones:*

ℹ️ El correo es obligatorio: sin un correo válido no se puede emitir la reserva.
ℹ️ Zona: Pinar, Pista, Jaimas… o escribe "la que haya".
ℹ️ Botellas: pon un número, o "A copas" si es mesa sin botella.
ℹ️ La hora de llegada afecta al precio final (se ajusta en puerta).
```

## 2. Ejemplo relleno

```
*TØTEM · FORMULARIO DE RESERVA*

*Fecha:* 15/08/2026
*Nombre y apellidos:* Rafael Márquez Sánchez
*Nº de personas:* 8
*Teléfono:* 617882780
*Correo electrónico:* rafamarsan1996@gmail.com
*Zona preferida:* Pinar
*Hora de llegada:* 18:00
*Nº de botellas:* 3
*Observaciones:* Cumpleaños, si puede ser mesa junta
```

## 3. Antes de pegarlo en la app (RRPP)

Cuatro comprobaciones rápidas, que son las que fallan en la práctica:

1. **Que cada dato esté en su línea**, justo detrás de su título. Si WhatsApp
   junta dos líneas, la app puede leer un campo dentro de otro (nos pasó: el
   correo acabó conteniendo "Zona preferida…" y Fourvenues rechazó la reserva).
2. **Correo válido de verdad** (con `@` y dominio). Es el único campo que
   Fourvenues rechaza de plano. La app avisa en rojo y bloquea el envío.
3. **Ningún título borrado.** Si el cliente quita "*Nº de botellas:*", ese dato
   se pierde y la app conserva el de la reserva anterior.
4. **Fecha con evento.** Si ese día no hay evento en Fourvenues, la app lo dice
   y no deja crear la reserva.

## 4. Qué hace la app con cada campo

| Campo | Destino en Fourvenues |
| --- | --- |
| Fecha | Localiza el evento de ese día |
| Nombre y apellidos | `info.full_name` |
| Nº de personas | `info.quantity` (y con ello el precio) |
| Teléfono | `info.phone` |
| Correo electrónico | `info.email` — **obligatorio y validado** |
| Zona preferida | Se traduce a la zona real del evento |
| Hora de llegada | Observaciones (no hay campo propio en la API) |
| Nº de botellas | Observaciones. Si pone "A copas", la reserva queda **A revisar** |
| Observaciones | Observaciones. Si dice "invitación", "no cobrar" o similar, queda **A revisar** sin cobro |

El **referente (RRPP)** no lo pone el cliente: lo elige el RRPP en la app y
viaja en las observaciones, porque Fourvenues no permite asignarlo por API.
