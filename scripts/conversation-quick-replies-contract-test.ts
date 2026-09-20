import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canStaffAccessRoute, resolveStaffPermissions } from '../src/services/staff-permission-service.js'

const [schema, routes, permissions, ui] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('src/routes/crm.ts', 'utf8'),
  readFile('src/services/staff-permission-service.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8')
])

assert.match(schema, /model ConversationQuickReply \{[\s\S]*businessId\s+String[\s\S]*title\s+String[\s\S]*shortcut\s+String[\s\S]*message\s+String[\s\S]*position\s+Int[\s\S]*isActive\s+Boolean/)
assert.match(schema, /@@unique\(\[businessId, shortcut\]\)/)
assert.match(routes, /app\.get\('\/crm\/quick-replies'/)
assert.match(routes, /app\.post\('\/crm\/quick-replies'/)
assert.match(routes, /app\.patch\('\/crm\/quick-replies\/:id'/)
assert.match(routes, /businessId[\s\S]*conversationQuickReply\.findMany/)
assert.match(routes, /conversationQuickReply\.findFirst\([\s\S]*businessId/)
assert.match(routes, /function hasInvalidQuickReplyActiveValue\([\s\S]*value !== undefined && typeof value !== 'boolean'/)
assert.equal(
  (routes.match(/hasInvalidQuickReplyActiveValue\(body\.isActive\)/g) ?? []).length,
  2,
  'crear y editar deben rechazar isActive con un tipo distinto de boolean'
)
assert.match(routes, /typeof requestedBusinessId !== 'string'/)
assert.match(routes, /typeof input\.title !== 'string'[\s\S]*typeof input\.shortcut !== 'string'[\s\S]*typeof input\.message !== 'string'/)
assert.match(permissions, /path === '\/crm\/quick-replies'[\s\S]*verb === 'GET'[\s\S]*canReplyConversations/)
assert.match(ui, /id="quick-replies-trigger"/)
assert.match(ui, /id="quick-replies-selector"/)
assert.match(ui, /id="quick-replies-manage"/)
assert.match(ui, /data-settings-view="conversations"/)
assert.match(ui, /id="quick-replies-admin"/)
assert.match(ui, /function insertQuickReply\([\s\S]*selectionStart[\s\S]*selectionEnd[\s\S]*setRangeText\(reply\.message/)
assert.doesNotMatch(ui, /insertQuickReply\([\s\S]{0,400}requestSubmit\(/)
assert.match(ui, /whatsappReplyWindowState\(\)/)

const standard = resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_STANDARD' })
const staff = { role: 'STAFF', businessId: 'business-a', professionalId: null, ...standard.permissions }
assert.equal(canStaffAccessRoute(staff, 'GET', '/crm/quick-replies'), true, 'quien responde conversaciones puede consultar respuestas rápidas')
assert.equal(canStaffAccessRoute(staff, 'POST', '/crm/quick-replies'), false, 'staff no puede crear respuestas rápidas')
assert.equal(canStaffAccessRoute(staff, 'PATCH', '/crm/quick-replies/reply-a'), false, 'staff no puede editar respuestas rápidas')

const readOnly = resolveStaffPermissions({
  staffProfile: 'SECRETARY',
  permissionPreset: 'CUSTOM',
  canReplyConversations: false
})
const readOnlyStaff = { role: 'STAFF', businessId: 'business-a', professionalId: null, ...readOnly.permissions }
assert.equal(canStaffAccessRoute(readOnlyStaff, 'GET', '/crm/quick-replies'), false, 'staff sin permiso de respuesta no puede consultar respuestas rápidas')

console.log('OK respuestas rápidas: modelo tenant-scoped, permisos, CRUD, selector e inserción editable')
