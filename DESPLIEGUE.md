# Desplegar la app

La app corre en **Cloudflare Workers**. El despliegue lo tiene que lanzar una
persona con la cuenta de Cloudflare: hace falta iniciar sesión, y eso solo puede
hacerlo el titular.

## 1. Entrar en Cloudflare (una sola vez)

```bash
npx wrangler login
```

Abre el navegador y pide autorizar Wrangler. Para comprobar que quedó hecho:

```bash
npx wrangler whoami
```

## 2. Desplegar

```bash
npm run build
npx vinext deploy
```

## 3. Configurar los DOS secretos

`.env` **no se sube**: en producción los valores viven como secretos del Worker.
Hay que poner los dos, y el orden importa poco pero ninguno es opcional:

```bash
npx wrangler secret put FOURVENUES_API_KEY
npx wrangler secret put APP_ACCESS_PASSWORD
```

- `FOURVENUES_API_KEY` → la clave de producción de TØTEM, la que llegó por correo
  desde el Developer Portal de esa organización (la de Alpha **no** vale).
- `APP_ACCESS_PASSWORD` → la contraseña que comparten los RRPP.

Añade también el entorno, que no es secreto:

```bash
npx wrangler secret put FOURVENUES_ENV   # valor: prod
```

> **Red de seguridad:** si se despliega con la clave de Fourvenues pero sin
> contraseña, la app **no se sirve**: devuelve 503 en todo. Es a propósito, para
> que no pueda quedar abierta en internet por un descuido (`worker/access.ts`).

## 4. Comprobar que quedó bien

Con la URL que devuelva el despliegue:

1. Abrirla → debe redirigir a `/login`.
2. Entrar con la contraseña → debe verse "Conectado a Fourvenues (Producción)".
3. Poner una fecha con evento → deben cargarse las zonas reales.

Y una comprobación que conviene hacer siempre, desde otro navegador **sin
sesión**: pedir `/api/fourvenues/status` debe responder **401**, no datos.

## Cambiar la contraseña más adelante

```bash
npx wrangler secret put APP_ACCESS_PASSWORD
```

Cambiarla **cierra todas las sesiones abiertas**, porque la cookie va firmada
con ella. Es la forma de echar a alguien que ya no deba entrar.
