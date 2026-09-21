import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canStaffAccessRoute } from '../src/services/staff-permission-service.js'

const [ui, customerRoute, permissions, schema, migration] = await Promise.all([
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/customer.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/staff-permission-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260919130000_add_customer_technical_profile/migration.sql', import.meta.url), 'utf8')
])

assert.match(schema, /model Customer \{[\s\S]*technicalProfile\s+String\?/)
assert.match(migration, /ALTER TABLE "Customer" ADD COLUMN "technicalProfile" TEXT/)

assert.match(customerRoute, /app\.get\('\/customers\/:id\/technical-profile'/)
assert.match(customerRoute, /app\.patch\('\/customers\/:id\/technical-profile'/)
assert.match(customerRoute, /loadAuthorizedCustomer\([^)]*authUser, params\.id\)/)
assert.match(customerRoute, /profile\.length > 1000/)
assert.match(permissions, /path\.endsWith\('\/technical-profile'\)[\s\S]*verb === 'GET' \? user\.canViewCustomers : user\.canManageCustomerNotes/)
const readOnlyStaff = { role: 'STAFF', canViewCustomers: true, canManageCustomerNotes: false } as any
assert.equal(canStaffAccessRoute(readOnlyStaff, 'GET', '/customers/customer-1/technical-profile'), true)
assert.equal(canStaffAccessRoute(readOnlyStaff, 'PATCH', '/customers/customer-1/technical-profile'), false)
assert.equal(canStaffAccessRoute({ ...readOnlyStaff, canManageCustomerNotes: true }, 'PATCH', '/customers/customer-1/technical-profile'), true)

assert.match(ui, /id="appointment-customer-technical-profile"/)
assert.match(ui, />Ficha t&eacute;cnica del cliente</)
assert.match(ui, /id="appointment-customer-technical-profile-edit"[^>]*>Editar</)
assert.match(ui, /id="appointment-customer-technical-profile-add"[^>]*>\+ Agregar dato importante</)
assert.match(ui, /id="appointment-customer-technical-profile-input"[^>]*maxlength="1000"/)
assert.match(ui, /for="appointment-notes">Observaci&oacute;n de este turno</)
assert.match(ui, /function loadAppointmentCustomerTechnicalProfile\(/)
assert.match(ui, /function saveAppointmentCustomerTechnicalProfile\(/)
assert.match(ui, /canManageAppointmentCustomerTechnicalProfile\(\)/)
assert.match(ui, /getJson\('\/customers\/' \+ customerId \+ '\/technical-profile'/)
assert.match(ui, /method: 'PATCH'/)
assert.match(ui, /showCrmToast\('Ficha técnica actualizada\.'/)
assert.doesNotMatch(ui, /(?:alert|confirm|prompt)\([^)]*Ficha t[eé]cnica/)

// Layout contract: the card reflows horizontally, participates in vertical scroll,
// survives combined resize, resets on reopen and collapses cleanly on mobile.
assert.match(ui, /\.appointment-customer-technical-profile\s*\{[^}]*container-type:\s*inline-size/s)
assert.match(ui, /\.appointment-technical-profile-header\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/s)
assert.match(ui, /\.appointment-technical-profile-display\s*\{[^}]*overflow-wrap:\s*anywhere/s)
assert.match(ui, /\.appointment-customer-technical-profile\s*\{[^}]*font-size:\s*clamp\(/s)
assert.match(ui, /\.appointment-modal-body\s*\{[^}]*overflow-y:\s*auto/s)
assert.match(ui, /@media \(max-width: 620px\)[\s\S]*\.appointment-customer-technical-profile/s)
assert.match(ui, /resetAppointmentCustomerTechnicalProfile\(\)/)
assert.match(ui, /closeAppointmentDialog\(\)[\s\S]*resetAppointmentCustomerTechnicalProfile\(\)/)


// Customer profile contract: the same technical profile is visible and editable from Clientes.
assert.match(customerRoute, /select:\s*\{[\s\S]*technicalProfile:\s*true/)
assert.match(ui, /class="customer-profile-technical"/)
assert.match(ui, /data-customer-technical-profile-edit/)
assert.match(ui, /data-customer-technical-profile-form/)
assert.match(ui, /data-customer-technical-profile-input[^>]*maxlength="1000"/)
assert.match(ui, /function saveOverviewCustomerTechnicalProfile\(/)
assert.match(ui, /customer\.technicalProfile = result\.technicalProfile \|\| ''/)
assert.match(ui, /\.customer-profile-technical\s*\{[^}]*border:/s)
assert.match(ui, /@media \(max-width: 620px\)[\s\S]*\.customer-profile-technical/s)

console.log('Appointment customer technical profile contract: OK')
