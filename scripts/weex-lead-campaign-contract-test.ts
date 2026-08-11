import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/routes/weex-lead-campaign.ts', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../src/assets/weex-campaign/landing.html', import.meta.url), 'utf8')
const thanks = readFileSync(new URL('../src/assets/weex-campaign/gracias.html', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const authGuard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')

assert.ok(route.includes("app.post('/public/weex/leads'"), 'debe exponer el alta pública de leads')
assert.ok(route.includes('prisma.weexLead.create'), 'debe persistir cada lead en PostgreSQL')
assert.ok(route.includes("app.get('/admin/weex-leads'"), 'debe ofrecer el listado simple de leads')
assert.ok(route.includes('requireSuperAdmin(request, reply)'), 'el listado debe limitarse al Súper Admin')
assert.ok(landing.includes("fetch('/public/weex/leads'"), 'la landing debe enviar el formulario al servidor')
assert.ok(landing.includes("window.location.href = '/promocion-weex-agosto-2026/gracias'"), 'la landing debe redirigir solo después de guardar')
assert.ok(thanks.includes('https://wa.me/5491158712877?text='), 'la página de gracias debe abrir el WhatsApp configurado')
assert.equal((thanks.match(/class="cta"/g) || []).length, 1, 'la página de gracias debe tener una sola acción principal')
assert.ok(schema.includes('model WeexLead {'), 'Prisma debe incluir el modelo de leads de Weex')
assert.ok(authGuard.includes("path === '/promocion-weex-agosto-2026/gracias'"), 'la página de gracias debe ser pública')

console.log('Weex lead campaign contract: OK (captura, persistencia, listado y WhatsApp)')
