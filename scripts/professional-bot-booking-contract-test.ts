import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schema, migration, route, ui, legacyFlow, bookingV2Flow, routerContext, instagramContext, knowledge] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260805010000_add_professional_bot_booking_setting/migration.sql', 'utf8'),
  readFile('src/routes/professional.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8'),
  readFile('src/services/booking-conversation-flow.ts', 'utf8'),
  readFile('src/services/conversation-service.ts', 'utf8'),
  readFile('src/services/conversation-router-context-service.ts', 'utf8'),
  readFile('src/services/instagram-webhook-service.ts', 'utf8'),
  readFile('src/services/business-knowledge-service.ts', 'utf8')
])

assert.match(schema, /acceptsBotBookings\s+Boolean\s+@default\(true\)/)
assert.match(migration, /ADD COLUMN "acceptsBotBookings" BOOLEAN NOT NULL DEFAULT true/)
assert.match(route, /acceptsBotBookings: body\.acceptsBotBookings !== false/)
assert.match(route, /typeof body\.acceptsBotBookings === 'boolean'/)
assert.match(ui, /id="professional-bot-bookings" required/)
assert.match(ui, /No aceptar reservas desde el bot \(solo agenda manual\)/)
assert.match(ui, /acceptsBotBookings: els\.professionalBotBookings\.value === 'accept'/)
assert.match(ui, /professional\.acceptsBotBookings === false \? 'manual_only' : 'accept'/)

for (const source of [legacyFlow, bookingV2Flow, routerContext, instagramContext, knowledge]) {
  assert.match(source, /acceptsBotBookings:\s*true/)
}

assert.match(legacyFlow, /Ese profesional ya no recibe reservas automáticas/)
assert.match(bookingV2Flow, /Ese profesional ya no recibe reservas automáticas/)

assert.match(ui, /function activeProfessionals\(\)[\s\S]*?professional\.isActive !== false/)
assert.doesNotMatch(ui, /function activeProfessionals\(\)[\s\S]{0,250}acceptsBotBookings/)

console.log('Professional bot booking contract: OK (configuracion, filtro automatico y agenda manual preservada)')
