import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const services = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
const crm = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const publicBooking = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
const authGuard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')
const bookingV2 = readFileSync(new URL('../src/services/booking-v2-domain.ts', import.meta.url), 'utf8')
const optionsCatalog = readFileSync(new URL('../src/bot-options/infrastructure/prisma-catalog.ts', import.meta.url), 'utf8')

const serviceModel = schema.slice(schema.indexOf('model Service {'), schema.indexOf('model ServiceCategory {'))
assert.match(serviceModel, /isActive\s+Boolean\s+@default\(true\)/, 'un servicio debe poder desactivarse sin borrar su historial')
assert.match(services, /app\.patch\('\/services\/:id\/status'/, 'debe existir la acción separada para activar o desactivar')
assert.match(services, /code:\s*'SERVICE_HAS_HISTORY'/, 'el borrado protegido debe informar un código estable a la interfaz')
assert.ok(authGuard.includes("/^\\/services\\/[^/]+(?:\\/status)?$/.test(path)"), 'cuentas administradoras deben poder cambiar el estado')
assert.match(crm, /data-toggle-service-active/, 'el CRM debe exponer una acción separada para activar o desactivar')
assert.match(crm, /showCrmToast\(.*Servicio eliminado/, 'la eliminación exitosa debe tener respuesta visible aun con el editor cerrado')
assert.match(publicBooking, /\.filter\(\(service\) => service\.isActive/, 'la reserva web no debe publicar servicios desactivados')
assert.match(publicBooking, /\.filter\(\(service\) => serviceLinks\.some\(/, 'la reserva web no debe publicar servicios sin profesionales activos')
assert.match(bookingV2, /isBookable: true,\s*isActive: true/, 'Booking V2 no debe cargar servicios desactivados')
assert.match(bookingV2, /services\.filter\(\(service\) =>\s*professionals\.some/, 'Booking V2 no debe ofrecer servicios sin profesionales habilitados para el bot')
assert.match(optionsCatalog, /professionalLinks: eligibleBotProfessionalLinks/, 'el catálogo del bot de opciones debe excluir servicios sin profesionales habilitados')

console.log('Service lifecycle contract: OK')
