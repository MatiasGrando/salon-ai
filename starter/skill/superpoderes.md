---
name: superpoderes
description: Enciende y configura los 12 superpoderes de Forja+ en el bot del miembro (Blindaje, Vigilante, Handoff, Cazador, Oído y vista, Voz de marca, Reportes, Multi-idioma, Encuestas, Recupera no-shows, Reseñas, Cobros). Actívala cuando el usuario pegue un prompt de "enciende el superpoder X" o pida activar/ajustar una capacidad Forja+.
---

# /superpoderes — encender los superpoderes de Forja+

Enciendes y configuras los **12 superpoderes** de Forja+ en el bot del miembro. La
persona casi nunca ve la terminal: **tú corres los comandos y le haces las preguntas
en el chat, una por mensaje.** Al terminar, dile en simple qué quedó activo y qué va a
notar. Explica ANTES de tocar nada qué hace el superpoder.

## Reglas base (léelas antes de encender nada)

1. **La mayoría requieren Forja+ (Pro).** Casi todos los superpoderes de esta lista están
   gated a Pro — si el bot es free (`BOT_TIER = "free"` en `wrangler.toml` y sin
   `tier_override`), avísale que necesita Forja+ y no los enciendas. **Excepciones:** el
   handoff básico (ticket + aviso Telegram/email, #3) y la transcripción de notas de voz
   (#5) ya vienen en el tier free — ver la matriz en
   `skill/references/starter-vs-forja-plus.md`.
2. **Corre TODO dentro de la carpeta del bot** (donde está `wrangler.toml`). El bot ya
   debe estar desplegado (si no, primero `/configurar-mi-chatbot`).
3. **Los toggles viven en la tabla `settings` de D1 y toman efecto SIN redeploy** (el
   bot los lee en cada mensaje/cron). Para encender un toggle:
   ```bash
   wrangler d1 execute DB --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('<KEY>', '1', strftime('%s','now')*1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
   ```
   Para **apagar**, usa `'0'` en vez de `'1'`. Para guardar un texto (ej. un link), pon
   el texto en vez de `'1'` (cuidado con las comillas: si el valor trae `'`, escápalo).
   Usa el binding `DB` (no el nombre de la base) — wrangler lo resuelve del `wrangler.toml`.
4. **Secretos (API keys) NUNCA en el chat ni en archivos.** Van con
   `wrangler secret put <NOMBRE>` (pásalos por stdin). Si el usuario de todos modos te
   pega uno en el chat, adviértele en corto (mejor en la terminal) y tú lo guardas como
   secret — nunca lo imprimas de vuelta.
5. **Verifica al final.** Lee el valor de vuelta (`wrangler d1 execute DB --remote
   --command "SELECT value FROM settings WHERE key='<KEY>'"`) y dile al usuario que ya
   quedó + qué va a ver.

---

## Los 12 superpoderes

### 1. Blindaje anti-invento — `blindaje_enabled` · **ya viene ON**
Verifica cada respuesta con datos contra la info del negocio antes de mandarla; si no
está seguro, dice "déjame confirmarlo" y te lo pasa. **En Pro está encendido por
default.** No hay que instalarlo — confírmale que está activo:
`SELECT value FROM settings WHERE key='blindaje_enabled'` (vacío o `on` = activo; `off` = apagado).
Solo tócalo si quiere **apagarlo** (setea `blindaje_enabled='off'`).

### 2. Vigilante con IA — always-on Pro
Califica cada conversación y te alerta si un cliente se enojó o una venta está en riesgo.
**Corre solo en Pro, no hay toggle.** Nada que encender: explícale que ya está trabajando
y que las alertas le llegan por su canal de dueño (Telegram del dueño / correo). Verifica
que tenga configurado el canal de dueño (`OWNER_TELEGRAM_CHAT_ID` o `OWNER_EMAIL`); si no,
ofrécele configurarlo para que las alertas lleguen.

### 3. Handoff que sí atina — básico gratis, aviso por WhatsApp Pro (ajustable)
Detecta molestia, lead caliente o queja y te entrega el chat: crea el ticket y avisa al
dueño por Telegram/email. **El handoff básico ya viene en TODOS los tiers** (incluido
Starter). Lo único que es Forja+ es que el aviso llegue también por **WhatsApp** (plantilla
Twilio) — ver `skill/references/starter-vs-forja-plus.md`. Para afinar CUÁNDO te pasa el
chat, ajusta las palabras de escalación:
`INSERT ... ('escalation_keywords', 'factura,queja,gerente,reembolso', ...)`. Pregúntale
si hay temas que SIEMPRE quiere que le pasen a él.

### 4. Cazador de ventas — always-on Pro
Da seguimiento a los leads que se enfriaron: un mensaje en tu tono, entre 3 y 20h, sin
insistir. **Corre solo en Pro.** Explícale que ya persigue los leads tibios; verifica el
canal de dueño para que le avise de los cierres.

### 5. Oído y vista — oído (audio) gratis, vista (imágenes) Pro
Transcribe notas de voz de los clientes y, en Forja+, además lee imágenes (producto,
comprobante). **La transcripción de audio ya viene en TODOS los tiers** (incluido
Starter); **la Vista (leer imágenes) es solo Forja+** — ver
`skill/references/starter-vs-forja-plus.md`. Nada que encender: manda un audio de prueba
al bot (o, si es Pro, una foto) y muéstrale que lo entendió.

### 6. Voz de marca — vía skill `/voz-de-marca`
Aprende tu tono desde tu web y tus mensajes reales. **No es un toggle**: corre el skill
`/voz-de-marca` (en `skill/`), que entrevista/analiza y ajusta el tono del bot. Si el
usuario lo pide, cambia a ese skill.

### 7. Reportes automáticos — `daily_report` · **toggle**
Cada noche te llega un resumen del día por tu canal de dueño. Enciéndelo:
`INSERT ... ('daily_report', '1', ...)`. **Antes de encender, verifica el canal de dueño**
(`OWNER_TELEGRAM_CHAT_ID` o `OWNER_EMAIL`): si no está, entrevista al usuario y configúralo
(secret/var), si no el reporte no tiene a dónde llegar. Dile que el primer resumen llega
esta noche (~3am).

### 8. Multi-idioma — `multi_language` · **toggle**
Responde en el idioma del cliente (ES/EN/PT) en vez de forzar `BOT_LANGUAGE`. Enciéndelo:
`INSERT ... ('multi_language', '1', ...)`. Nada más que configurar.

### 9. Encuestas de satisfacción — `satisfaction_survey` · **toggle + elegir modo**
Tras atender, pide feedback; si la calificación es baja, te avisa al instante.
**Al activarla, PREGÚNTALE al dueño cómo quiere pedir la opinión** y guarda el modo
en `survey_mode`:
- `numerico` (default) — calificación 1-5 con un número.
- `abierto` — opinión en las palabras del cliente (texto libre).
- `ambos` — número + comentario en un solo mensaje.

Enciéndela y setea el modo:
`INSERT ... ('satisfaction_survey', '1', ...), ('survey_mode', 'abierto', ...)`.
Verifica el canal del dueño para las alertas de baja calificación (solo en modos
con número). Las respuestas (rating y/o comentario) se guardan y el dueño las lee
en la tab **Reseñas** de su panel — dile que ahí las verá.

### 10. Recupera no-shows — `reengage_cold_leads` (+ plantilla) · **toggle + entrevista si usa WhatsApp**
Reengancha leads calientes que se enfriaron por días (ventana 2-7 días). Enciéndelo:
`INSERT ... ('reengage_cold_leads', '1', ...)`.
- En **Telegram** funciona siempre.
- En **WhatsApp fuera de 24h** necesita una **plantilla HSM aprobada** (con `{{1}}` = nombre
  del cliente). **Entrevista**: pregúntale por qué método atiende WhatsApp — hay dos y la
  plantilla se configura distinto:
  - **Cloud API oficial de Meta** (canal `whatsapp`): la plantilla se referencia por
    **nombre + idioma**. Pídele el nombre de su plantilla aprobada en WhatsApp Manager y el
    idioma (`es`, `es_MX`, `en_US`…) y guárdalos:
    `INSERT ... ('reengage_template_name', 'reenganche_lead', ...), ('reengage_template_lang', 'es', ...)`.
  - **Twilio (BSP)** (canal `twilio`): la plantilla es un **Content SID** (`HX…`):
    `INSERT ... ('reengage_template_sid', 'HX...', ...)`.
  El dueño también configura esto sin comando en el panel → tab **Plantillas** (detecta su
  método y muestra el campo correcto). Si no usa WhatsApp o no tiene plantilla, déjalo así
  (solo reengancha dentro de la ventana / en Telegram).

### 11. Pide reseñas — `review_requests` + `review_url` · **toggle + entrevista OBLIGATORIA**
Tras una buena atención, invita a dejar reseña en Google (solo a quien quedó contento).
**Necesita el link de Google del negocio para activarse de verdad.** Flujo:
1. **Entrevista**: "¿Cuál es el link donde tus clientes te dejan reseña en Google?"
   (Google Business, se ve como `https://g.page/r/.../review`). Si no lo tiene, dile cómo
   sacarlo (Perfil de Empresa de Google → Reseñas → "Compartir formulario").
2. Guarda el link: `INSERT ... ('review_url', 'https://g.page/r/...', ...)`.
3. Enciende: `INSERT ... ('review_requests', '1', ...)`.
Sin `review_url`, NO lo enciendas (no serviría).

### 12. Cobros por WhatsApp — `payments_enabled` + secret `STRIPE_SECRET_KEY` · **toggle + entrevista OBLIGATORIA (Stripe)**
El bot manda un link de pago de Stripe y te avisa cuando pagan. **Necesita conectar el
Stripe del usuario.** Flujo:
1. **Entrevista**: "¿Ya tienes cuenta de Stripe? Voy a necesitar tu **llave secreta**
   (empieza con `sk_live_…` o `sk_test_…`, la sacas de dashboard.stripe.com →
   Desarrolladores → Claves API)." Recuérdale: **pégala en la terminal cuando yo te lo
   pida, no en el chat** (pero si la pega en el chat, adviértele y tú la guardas por stdin).
2. Guarda el secret: `wrangler secret put STRIPE_SECRET_KEY` (por stdin).
3. Enciende el cobro: `INSERT ... ('payments_enabled', '1', ...)`.
4. (Opcional) Para que Stripe confirme los pagos en automático, configura el webhook
   `STRIPE_WEBHOOK_SECRET` apuntando a `<tu-worker>/webhooks/stripe` — ofrécelo como
   siguiente paso.
5. Haz una **prueba**: pídele al bot que genere un link de cobro de $10 y confírmale que
   sale bien.

---

## Después de encender cualquiera
Dile al usuario, en simple: (1) qué quedó activo, (2) qué va a notar y cuándo, (3) que lo
puede prender/apagar cuando quiera desde su **panel del bot** (`<tu-worker>/admin` →
sección ⚡ Superpoderes). Si algo falló, `npx forjabot doctor` y repórtalo claro.
