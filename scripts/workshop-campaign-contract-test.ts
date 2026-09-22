import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildWorkshopDueAudience, buildWorkshopInactiveAudience } from '../src/services/workshop-campaign-audience.js'

const now = new Date('2026-09-22T12:00:00.000Z')
const rows = [
  {
    customerId: 'customer-1', customerName: 'Ana', customerPhone: '5491112345678',
    vehicleId: 'vehicle-1', plate: 'AA123BB', currentMileage: 70_000,
    serviceName: 'Cambio de aceite', nextDueDate: '2026-09-20', nextDueMileage: 71_000,
    lastPerformedDate: '2026-03-20', lastVisitDate: '2026-08-15', publicSiteUrl: 'https://taller.example.com'
  },
  {
    customerId: 'customer-1', customerName: 'Ana', customerPhone: '5491112345678',
    vehicleId: 'vehicle-1', plate: 'AA123BB', currentMileage: 70_000,
    serviceName: 'Líquido refrigerante', nextDueDate: '2026-09-21', nextDueMileage: null,
    lastPerformedDate: '2025-09-21', lastVisitDate: '2026-08-15', publicSiteUrl: 'https://taller.example.com'
  },
  {
    customerId: 'customer-1', customerName: 'Ana', customerPhone: '5491112345678',
    vehicleId: 'vehicle-2', plate: 'AC456CD', currentMileage: 95_000,
    serviceName: 'Correa de distribución', nextDueDate: '2027-01-10', nextDueMileage: 90_000,
    lastPerformedDate: '2024-01-10', lastVisitDate: '2026-06-10', publicSiteUrl: 'https://taller.example.com'
  },
  {
    customerId: 'customer-2', customerName: 'Beto', customerPhone: '',
    vehicleId: 'vehicle-3', plate: 'AD789EF', currentMileage: 20_000,
    serviceName: 'Cambio de aceite', nextDueDate: '2026-09-01', nextDueMileage: null,
    lastPerformedDate: '2026-03-01', lastVisitDate: '2026-03-01', publicSiteUrl: 'https://taller.example.com'
  },
  {
    customerId: 'customer-3', customerName: 'Carla', customerPhone: '5491198765432',
    vehicleId: 'vehicle-4', plate: 'AE321FG', currentMileage: 15_000,
    serviceName: 'Filtro de aire', nextDueDate: '2026-12-01', nextDueMileage: 25_000,
    lastPerformedDate: '2026-06-01', lastVisitDate: '2026-06-01', publicSiteUrl: 'https://taller.example.com'
  }
]

const audience = buildWorkshopDueAudience(rows, now)
assert.equal(audience.total, 2, 'debe crear un destinatario por vehículo vencido con teléfono')
assert.equal(audience.excluded.missingPhone, 1)
assert.deepEqual(audience.included.map(item => item.recipientKey), ['workshop:vehicle-1', 'workshop:vehicle-2'])
assert.deepEqual(audience.included[0]?.overdueServices, ['Cambio de aceite', 'Líquido refrigerante'])
assert.equal(audience.included[0]?.plate, 'AA123BB')
assert.equal(audience.included[0]?.lastVisitAt, '2026-08-15T00:00:00.000Z')
assert.equal(audience.included[0]?.publicUrl, 'https://taller.example.com/?patente=AA123BB#consulta-patente')
assert.equal(audience.included[1]?.overdueServicesText, 'Correa de distribución')


const inactiveAudience = buildWorkshopInactiveAudience([
  {
    customerId: 'customer-1', customerName: 'Ana', customerPhone: '5491112345678',
    vehicleId: 'vehicle-1', plate: 'AA123BB', lastVisitDate: '2026-01-01',
    publicSiteUrl: 'https://taller.example.com'
  },
  {
    customerId: 'customer-1', customerName: 'Ana', customerPhone: '5491112345678',
    vehicleId: 'vehicle-2', plate: 'AC456CD', lastVisitDate: '2026-09-01',
    publicSiteUrl: 'https://taller.example.com'
  }
], 180, now)
assert.equal(inactiveAudience.total, 1, 'el filtro de inactividad debe evaluar cada vehículo')
assert.equal(inactiveAudience.included[0]?.plate, 'AA123BB')
assert.equal(inactiveAudience.included[0]?.lastVisitAt, '2026-01-01T00:00:00.000Z')

const campaignRoute = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const communications = readFileSync(new URL('../src/application/communications/communication-service.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260922010000_add_communication_recipient_key/migration.sql', import.meta.url), 'utf8')

assert.match(campaignRoute, /'WORKSHOP_MAINTENANCE_DUE'/)
assert.match(campaignRoute, /'WORKSHOP_INACTIVE'/)
assert.match(campaignRoute, /loadWorkshopMaintenanceDueAudience/)
assert.match(campaignRoute, /loadWorkshopInactiveAudience/)
assert.match(campaignRoute, /'patente', 'servicios_vencidos', 'enlace_historial'/)
assert.match(campaignRoute, /workshopContextForAudienceRecipient\(customer\)/)
assert.match(campaignRoute, /business\.businessType !== 'WORKSHOP'/)
assert.match(campaignRoute, /recipientKey: customer\.recipientKey/)
assert.match(crmUi, /value="WORKSHOP_MAINTENANCE_DUE">Mantenimientos vencidos/)
assert.match(crmUi, /value="WORKSHOP_INACTIVE">Veh&iacute;culos sin visitar/)
assert.match(crmUi, /Mantenimientos vencidos/)
assert.match(crmUi, /servicios_vencidos/)
assert.match(crmUi, /manualCurrent\?\.metadata\?\.plate/)
assert.match(crmUi, /option\.hidden = !workshopBusiness/)
assert.match(crmUi, /\[\.\.\.workshopSections, 'campaigns'\]/)
assert.match(schema, /recipientKey\s+String/)
assert.match(schema, /@@unique\(\[executionId, recipientKey\]\)/)
assert.match(communications, /recipientKey\?: string/)
assert.match(communications, /recipient\.recipientKey \|\| recipient\.customerId/)
assert.match(migration, /UPDATE "CommunicationRecipient"\s+SET "recipientKey" = "customerId"/)
assert.match(migration, /CREATE UNIQUE INDEX "CommunicationRecipient_executionId_recipientKey_key"/)

console.log('Workshop campaign contract: OK')
