import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const services = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
const crm = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const publicBooking = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
const authGuard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')
const bookingV2 = readFileSync(new URL('../src/services/booking-v2-domain.ts', import.meta.url), 'utf8')
const optionsCatalog = readFileSync(new URL('../src/bot-options/infrastructure/prisma-catalog.ts', import.meta.url), 'utf8')
const professionals = readFileSync(new URL('../src/routes/professional.ts', import.meta.url), 'utf8')
const bookingConversation = readFileSync(new URL('../src/services/booking-conversation-flow.ts', import.meta.url), 'utf8')
const conversationService = readFileSync(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8')

const serviceModel = schema.slice(schema.indexOf('model Service {'), schema.indexOf('model ServiceCategory {'))
const professionalModel = schema.slice(schema.indexOf('model Professional {'), schema.indexOf('model Service {'))
assert.match(serviceModel, /isActive\s+Boolean\s+@default\(true\)/, 'un servicio debe poder desactivarse sin borrar su historial')
assert.match(serviceModel, /archivedAt\s+DateTime\?/, 'un servicio eliminado visualmente debe conservar su historial en la base')
assert.match(professionalModel, /archivedAt\s+DateTime\?/, 'un profesional eliminado visualmente debe conservar su historial en la base')
assert.match(services, /app\.patch\('\/services\/:id\/status'/, 'debe existir la acción separada para activar o desactivar')
assert.match(services, /app\.get\('\/services'[\s\S]*?archivedAt:\s*null/, 'el catálogo administrativo no debe devolver servicios archivados')
assert.match(professionals, /app\.get\('\/professionals'[\s\S]*?archivedAt:\s*null/, 'el listado administrativo no debe devolver profesionales archivados')
assert.match(services, /data:\s*\{\s*isActive:\s*false,\s*archivedAt:\s*new Date\(\)\s*\}/, 'un servicio con historial debe archivarse en lugar de quedar pausado y visible')
assert.match(services, /authorizedServiceWhere\(request\.auth!\.user, params\.id\), archivedAt:\s*null/, 'un servicio archivado no debe poder reactivarse desde una solicitud vieja')
assert.match(professionals, /authorizedProfessionalWhere\(request\.auth!\.user, params\.id\), archivedAt:\s*null/, 'un profesional archivado no debe poder reactivarse desde una solicitud vieja')
assert.match(professionals, /data:\s*\{\s*isActive:\s*false,\s*deactivatedAt:\s*new Date\(\),\s*archivedAt:\s*new Date\(\)\s*\}/, 'un profesional con historial debe archivarse en lugar de quedar pausado y visible')
assert.ok(authGuard.includes("/^\\/services\\/[^/]+(?:\\/status)?$/.test(path)"), 'cuentas administradoras deben poder cambiar el estado')
assert.match(crm, /data-toggle-service-active/, 'el CRM debe exponer una acción separada para activar o desactivar')
assert.match(crm, /showCrmToast\(message, 'success'\)/, 'la eliminación exitosa debe tener respuesta visible aun con el editor cerrado')
assert.match(publicBooking, /\.filter\(\(service\) => service\.isActive/, 'la reserva web no debe publicar servicios desactivados')
assert.match(publicBooking, /\.filter\(\(service\) => serviceLinks\.some\(/, 'la reserva web no debe publicar servicios sin profesionales activos')
assert.match(bookingV2, /isBookable: true,\s*isActive: true/, 'Booking V2 no debe cargar servicios desactivados')
assert.match(bookingV2, /services\.filter\(\(service\) =>\s*professionals\.some/, 'Booking V2 no debe ofrecer servicios sin profesionales habilitados para el bot')
assert.match(optionsCatalog, /professionalLinks: eligibleBotProfessionalLinks/, 'el catálogo del bot de opciones debe excluir servicios sin profesionales habilitados')

for (const [name, source] of [
  ['buildServicesReply', bookingConversation],
  ['tryHandleBookingIntent', bookingConversation],
  ['extractBookingDraft', bookingConversation],
  ['findServiceByMessage', bookingConversation],
  ['resolvePendingInformationServiceSelection', conversationService],
  ['informationSelectionServiceIds', conversationService],
  ['handlePendingDepositServiceAddition', conversationService]
] as const) {
  const start = source.indexOf(`  private async ${name}`)
  assert.notEqual(start, -1, `debe existir ${name}`)
  const nextMethod = source.indexOf('\n  private async ', start + 20)
  const method = source.slice(start, nextMethod === -1 ? source.length : nextMethod)
  assert.match(method, /isActive:\s*true/, `${name} no debe ofrecer ni seleccionar servicios pausados`)
  assert.match(method, /archivedAt:\s*null/, `${name} no debe ofrecer ni seleccionar servicios archivados`)
}

console.log('Service lifecycle contract: OK')
