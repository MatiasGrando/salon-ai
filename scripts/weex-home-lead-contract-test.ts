import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const landingRoute = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')
const leadRoute = readFileSync(new URL('../src/routes/weex-lead-campaign.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const homeUrl = new URL('../src/assets/weex-home/index.html', import.meta.url)
const migrationUrl = new URL('../prisma/migrations/20260830120000_add_weex_lead_message/migration.sql', import.meta.url)

assert.ok(existsSync(homeUrl), 'la landing central debe vivir en un asset versionado')
assert.ok(existsSync(migrationUrl), 'el mensaje del lead debe tener una migración')

const home = readFileSync(homeUrl, 'utf8')
const migration = readFileSync(migrationUrl, 'utf8')

assert.ok(landingRoute.includes("'weex-home', 'index.html'"), 'la ruta central debe leer el asset versionado')
assert.ok(landingRoute.includes('serveWeexHome(reply)'), 'solo la home central debe servir el nuevo asset')
assert.ok(home.includes("fetch('/public/weex/leads'"), 'el formulario debe persistir el lead antes de confirmar')
assert.ok(home.includes("email: ''"), 'la home debe enviar email vacío de forma explícita')
assert.ok(home.includes('message,'), 'la home debe enviar la consulta opcional')
assert.ok(home.includes("campaign: 'weex-home'"), 'la home debe identificar su propia campaña')
for (const utm of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
  assert.ok(home.includes(utm), `la home debe capturar ${utm}`)
}
assert.ok(home.includes('pageUrl: window.location.href'), 'la home debe informar la URL de origen')
assert.ok(home.includes('referrer: document.referrer'), 'la home debe informar el referrer')
assert.ok(home.includes('Nos comunicaremos a la brevedad'), 'el éxito debe mostrar el texto acordado')
assert.ok(!home.includes('window.open('), 'el éxito no debe abrir WhatsApp automáticamente')
assert.ok(!home.includes('id="waDirectBtn"'), 'el éxito no debe ofrecer un botón de WhatsApp')
assert.ok(home.includes('href="/politicas"'), 'el footer debe enlazar la política de privacidad')
assert.ok(home.includes('href="/terminos"'), 'el footer debe enlazar las condiciones de uso')
assert.ok(home.includes('https://wa.me/5491158712877'), 'los CTA deben usar el WhatsApp vigente')
assert.ok(!home.includes('5491164312742'), 'no debe quedar el número anterior')
assert.ok(!home.includes('name="email"'), 'el formulario no debe pedir email')
assert.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(home), 'la landing no debe usar cuadros nativos')

assert.ok(leadRoute.includes("email && !isValidEmail(email)"), 'la API debe aceptar email vacío y validar uno presente')
assert.ok(leadRoute.includes('message: optionalText(body?.message'), 'la API debe guardar el mensaje opcional')
assert.ok(leadRoute.includes("lead.email ? `<a href=\"mailto:"), 'el admin debe representar correctamente un email ausente')
assert.ok(leadRoute.includes('<th>Consulta</th>'), 'el admin debe mostrar la consulta')
assert.ok(leadRoute.includes('Formularios recibidos desde las landings de Weex.'), 'el admin debe describir todos los orígenes vigentes')
assert.ok(schema.includes('message         String?'), 'Prisma debe declarar el mensaje opcional')
assert.ok(migration.includes('ADD COLUMN "message" TEXT'), 'la migración debe agregar el mensaje opcional')

console.log('Weex home lead contract: OK')
