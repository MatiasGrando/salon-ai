import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STAFF_PRESET_DEFINITIONS,
  canStaffAccessRoute,
  resolveStaffPermissions,
  staffAuditAction,
  staffCanUseProfessional,
  staffProfileRequiresProfessional,
  staffVisibleSections,
  type StaffAuthorizationUser
} from '../src/services/staff-permission-service.js'

function user(preset: Parameters<typeof resolveStaffPermissions>[0]): StaffAuthorizationUser {
  const resolved = resolveStaffPermissions(preset)
  return {
    role: 'STAFF',
    professionalId: resolved.staffProfile === 'PROFESSIONAL' ? 'professional-1' : null,
    staffProfile: resolved.staffProfile,
    ...resolved.permissions
  }
}

function access(subject: StaffAuthorizationUser, method: string, path: string, expected: boolean, task: string) {
  assert.equal(canStaffAccessRoute(subject, method, path), expected, task)
}

for (const [id, preset] of Object.entries(STAFF_PRESET_DEFINITIONS)) {
  assert.ok(preset.label.length >= 5, `${id}: el preset debe tener nombre claro`)
  assert.ok(preset.description.length >= 70, `${id}: el dueño necesita una descripción detallada`)
}

const professional = user({ staffProfile: 'PROFESSIONAL', permissionPreset: 'PROFESSIONAL_DEFAULT' })
assert.equal(professional.agendaScope, 'OWN')
assert.equal(staffProfileRequiresProfessional('PROFESSIONAL'), true)
assert.equal(staffProfileRequiresProfessional('SECRETARY'), false)
assert.equal(staffCanUseProfessional(professional, 'professional-1'), true)
assert.equal(staffCanUseProfessional(professional, 'professional-2'), false)

const readOnly = user({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_READ_ONLY' })
assert.equal(readOnly.agendaScope, 'ALL')
assert.equal(staffCanUseProfessional(readOnly, 'any-professional'), true)
access(readOnly, 'GET', '/appointments', true, 'solo lectura ve agenda completa')
access(readOnly, 'POST', '/appointments', false, 'solo lectura no crea turnos')
access(readOnly, 'PATCH', '/appointments/a1', false, 'solo lectura no reprograma')
access(readOnly, 'DELETE', '/appointments/a1', false, 'solo lectura no cancela')
access(readOnly, 'GET', '/customers/overview', true, 'solo lectura ve clientes')
access(readOnly, 'PATCH', '/customers/c1', false, 'solo lectura no edita clientes')

const standard = user({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_STANDARD' })
for (const [method, path, task] of [
  ['POST', '/appointments', 'crear turno'],
  ['PATCH', '/appointments/a1', 'reprogramar turno'],
  ['DELETE', '/appointments/a1', 'cancelar turno'],
  ['PATCH', '/appointments/a1/status', 'cambiar estado'],
  ['GET', '/customers/overview', 'ver clientes'],
  ['POST', '/customers', 'crear cliente'],
  ['PATCH', '/customers/c1', 'editar cliente'],
  ['GET', '/customers/c1/notes', 'ver notas'],
  ['POST', '/customers/c1/notes', 'crear nota'],
  ['PATCH', '/customers/c1/marketing-preference', 'preferencia comercial'],
  ['GET', '/crm/conversations', 'ver conversaciones'],
  ['POST', '/crm/conversations/x/manual-replies', 'responder conversación']
] as const) access(standard, method, path, true, `estándar: ${task}`)
access(standard, 'DELETE', '/customers/c1', false, 'ninguna secretaria elimina clientes')
access(standard, 'POST', '/schedule-blocks', false, 'estándar no bloquea agenda')
access(standard, 'POST', '/crm/conversations/x/deposit/approve', false, 'estándar no aprueba señas')
access(standard, 'GET', '/reports/overview', false, 'estándar no ve reportes')
access(standard, 'POST', '/professionals', false, 'staff no crea profesionales')
access(standard, 'PATCH', '/services/s1', false, 'staff no cambia servicios')
access(standard, 'POST', '/campaigns', false, 'staff no hace marketing masivo')
access(standard, 'GET', '/staff-users', false, 'staff no administra cuentas')
access(standard, 'PATCH', '/crm/ai-settings', false, 'staff no cambia el bot')
access(standard, 'POST', '/crm/maintenance/delete-qa-data', false, 'staff no ejecuta mantenimiento')
access(standard, 'PATCH', '/businesses/b1', false, 'staff no cambia el negocio')
access(standard, 'GET', '/businesses/b1/whatsapp-embedded-signup-config', false, 'staff no ve credenciales de integraciones')

const operations = user({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_OPERATIONS' })
access(operations, 'POST', '/schedule-blocks', true, 'operaciones crea bloqueos')
access(operations, 'DELETE', '/schedule-blocks/b1', true, 'operaciones elimina bloqueos')
access(operations, 'GET', '/reports/overview', true, 'operaciones ve reportes')
assert.equal(operations.canViewFinancialAmounts, false, 'operaciones no ve importes')

const cashier = user({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_CASHIER' })
access(cashier, 'POST', '/crm/conversations/x/deposit/approve', true, 'caja aprueba señas')
access(cashier, 'POST', '/crm/conversations/x/deposit/reject', true, 'caja rechaza señas')
assert.equal(cashier.canViewFinancialAmounts, true, 'caja ve importes')

const custom = user({
  staffProfile: 'SECRETARY', permissionPreset: 'CUSTOM', canReplyConversations: true,
  canManageDeposits: true, canCreateCustomers: true, canViewFinancialAmounts: true
})
assert.equal(custom.canReplyConversations, false, 'responder requiere ver conversaciones')
assert.equal(custom.canManageDeposits, false, 'señas requieren ver conversaciones')
assert.equal(custom.canCreateCustomers, false, 'crear clientes requiere ver clientes')
assert.equal(custom.canViewFinancialAmounts, false, 'importes requieren reportes')

assert.deepEqual(staffVisibleSections(readOnly), ['agenda', 'customers'])
assert.deepEqual(staffVisibleSections(standard), ['conversations', 'agenda', 'customers'])
assert.deepEqual(staffVisibleSections(operations), ['conversations', 'agenda', 'customers', 'reports'])
assert.equal(staffAuditAction('patch', '/customers/c1'), 'PATCH_CUSTOMERS')

const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
for (const id of [
  'staff-user-profile', 'staff-user-preset', 'staff-preset-description', 'staff-can-force-appointments',
  'staff-can-view-customers', 'staff-can-manage-notes', 'staff-can-view-conversations',
  'staff-can-manage-deposits', 'staff-can-view-reports', 'staff-can-view-financial'
]) assert.ok(ui.includes(`id="${id}"`), `la interfaz debe incluir ${id}`)
assert.equal((ui.match(/<label data-staff-permission-scope="SECRETARY">/g) || []).length, 10, 'los permisos exclusivos de secretaría deben estar identificados')
assert.ok(ui.includes("field.hidden = !isSecretary"), 'los permisos de secretaría deben ocultarse para profesionales')
assert.ok(ui.includes("els.staffProfessionalField.hidden = isSecretary"), 'el profesional asignado debe ocultarse para secretaría')
assert.ok(ui.includes("'Permisos de secretaría' : 'Permisos de agenda'"), 'el título debe explicar el conjunto visible')
assert.ok(ui.includes("state.currentUser?.canViewConversations"), 'la UI no debe cargar conversaciones sin permiso')

const guard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')
assert.ok(guard.includes('canStaffAccessRoute'), 'el servidor debe autorizar cada ruta')
assert.ok(guard.includes('staffAuditLog.create'), 'las mutaciones del staff deben auditarse')
assert.ok(guard.includes("'/schedule-blocks'"), 'la agenda propia también limita bloqueos')

const appointmentRoute = readFileSync(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
assert.ok(appointmentRoute.includes("omitKey(appointment.customer, 'phone')"), 'la API de agenda no debe entregar teléfonos al profesional')
assert.ok(appointmentRoute.includes('quotedPrice: _quotedPrice'), 'la API de agenda no debe entregar el importe cotizado sin permiso financiero')
assert.ok(appointmentRoute.includes('manualDepositAmount: _manualDepositAmount'), 'la API de agenda no debe entregar el importe de la seña sin permiso financiero')
assert.ok(ui.includes('canViewAppointmentCustomerData()'), 'la agenda debe ocultar los datos del cliente según permisos')
assert.ok(ui.includes('canOpenAppointmentConversations()'), 'la agenda debe ocultar el acceso al chat según permisos')
assert.ok(ui.includes('canMessageAppointmentCustomer()'), 'la agenda debe ocultar WhatsApp cuando el staff no puede responder conversaciones')

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
for (const field of ['staffProfile', 'permissionPreset', 'agendaScope', 'canViewCustomers', 'canViewConversations', 'canViewOperationalReports', 'StaffAuditLog']) {
  assert.ok(schema.includes(field), `el modelo debe persistir ${field}`)
}

console.log('Staff/secretaria contract: OK (presets, tareas, seguridad, navegación y auditoría)')
