# Dar acceso y cambiar la contraseña

La app está en **https://totem-reservas.joseegarciadiaz9.workers.dev** y se entra
con **una única contraseña compartida** por todo el equipo de RRPP.

## Dar acceso a alguien

Basta con pasarle dos cosas:

1. La dirección: `https://totem-reservas.joseegarciadiaz9.workers.dev`
2. La contraseña del equipo

No hay que crear ningún usuario ni instalar nada: funciona desde el navegador del
móvil. La sesión dura **12 horas**, así que en una noche no se pide de nuevo.

> ⚠️ Recuérdales que **las reservas que creen son reales**, no pruebas.

## Cambiar la contraseña

### Opción fácil: desde el panel de Cloudflare

1. Entrar en
   [Ajustes del Worker](https://dash.cloudflare.com/d9d21e99584103ffcb54905ba2004b50/workers/services/view/totem-reservas/production/settings)
2. Sección **Variables and secrets**
3. En `APP_ACCESS_PASSWORD`, escribir el valor nuevo y guardar

Tarda unos segundos en aplicarse. No hace falta volver a desplegar.

### Opción por terminal

```bash
npx wrangler secret put APP_ACCESS_PASSWORD
```

## Qué pasa al cambiarla

**Se cierran todas las sesiones abiertas**, las de todo el mundo. La cookie va
firmada con la contraseña, así que al cambiarla las que había dejan de valer.

Eso es justo lo que se quiere para **sacar a alguien** que ya no deba entrar: se
cambia la contraseña y se reparte la nueva al resto.

## Límite que conviene tener claro

Al ser **una contraseña para todos**:

- **No queda registro de quién hace cada reserva.** El único rastro es el
  referente que el RRPP elige en el desplegable, y lo elige él mismo.
- **Para quitar acceso a una persona hay que cambiar la contraseña a todos.**

Para un equipo pequeño y de confianza es razonable. Si algún día hacen falta
usuarios individuales (saber quién hizo qué, dar y quitar accesos uno a uno),
habría que montar cuentas de verdad; con lo que hay hoy no se puede.
