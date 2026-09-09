import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { parseBusinessType } from '../src/services/business-type.js'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const workshopJobsUi = readFileSync('src/routes/workshop-jobs-ui.ts', 'utf8')
const schema = readFileSync('prisma/schema.prisma', 'utf8')
assert.match(schema, /businessType\s+BusinessType\s+@default\(SALON\)/)
assert.match(ui, /id="account-business-type"/)
assert.match(ui, /businessType: els.accountBusinessType.value/)
assert.match(ui, /data-mobile-section="autos"/)
assert.match(ui, /data-mobile-section="workshop-jobs"/)
assert.equal(parseBusinessType(undefined), 'SALON')
assert.equal(parseBusinessType('WORKSHOP'), 'WORKSHOP')
for (const bad of [null, '', 'OTHER', {}, ['WORKSHOP']]) assert.equal(parseBusinessType(bad), null)
assert.match(ui, /id="workshop-vehicle-search"[^>]+placeholder="Buscar por patente"/)
assert.doesNotMatch(ui, /Todav&iacute;a no hay autos registrados/)
assert.match(workshopJobsUi, /No hay trabajos registrados para esta consulta/)
for (const path of ['account-management', 'auth', 'business']) {
  assert.match(readFileSync('src/routes/' + path + '.ts', 'utf8'), /parseBusinessType\(body.businessType\)/)
}

function fn(name: string) {
  const start = ui.search(new RegExp('    (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0, name)
  const tail = ui.slice(start)
  const end = tail.slice(5).search(/\n    (?:async )?function /)
  return tail.slice(0, end + 5).replace(/\$\{cashRegisterEnabled \? [^\n]*? : [^\n]*?\}/g, '')
}
const state: any = { currentUser: { role: 'BUSINESS_ADMIN' }, businessId: 'taller', business: { businessType: 'WORKSHOP' } }
const sandbox: any = { state }
vm.createContext(sandbox)
vm.runInContext(fn('isWorkshopBusiness') + fn('staffVisibleSections'), sandbox)
assert.deepEqual(Array.from(sandbox.staffVisibleSections()), ['autos', 'workshop-jobs', 'workshop-personnel'])
state.currentUser.role = 'ACCOUNT_ADMIN'
assert.deepEqual(Array.from(sandbox.staffVisibleSections()), ['accounts', 'autos', 'workshop-jobs', 'workshop-personnel'])
state.business = { businessType: 'SALON' }
assert.ok(sandbox.staffVisibleSections().includes('services'))
assert.ok(!sandbox.staffVisibleSections().includes('autos'))
state.businessId = null
assert.deepEqual(Array.from(sandbox.staffVisibleSections()), ['accounts'])

// The workshop startup must never fetch salon catalog, agenda or conversations.
state.businessId = 'taller'
state.business = { businessType: 'WORKSHOP' }
const calls: string[] = []
Object.assign(sandbox, {
  loadBasics: async () => calls.push('basics'),
  setSection: (section: string) => calls.push(section),
  loadConversations: () => { throw new Error('Salon data must not be requested') }
})
vm.runInContext(fn('startCrm'), sandbox)
await sandbox.startCrm()
assert.deepEqual(calls, ['basics', 'autos'])
vm.runInContext(fn('loadBusinessScopedBasics'), sandbox)
await sandbox.loadBusinessScopedBasics()

// Resolve the owner's business from the authenticated session on initial load.
state.currentUser.role = 'BUSINESS_ADMIN'
state.currentSessionBusiness = { id: 'taller', businessType: 'WORKSHOP' }
Object.assign(sandbox, {
  hydrateWorkspaceNav: () => {}, loadAccountAdmins: async () => {},
  getJson: async (url: string) => { assert.equal(url, '/businesses?includeImages=false'); return [state.currentSessionBusiness] },
  loadDemoProfiles: async () => {}, renderAuthUi: () => {}
})
vm.runInContext(fn('loadBasics'), sandbox)
await sandbox.loadBasics()
assert.equal(state.businessId, 'taller')
assert.equal(state.business.businessType, 'WORKSHOP')

// Exercise the actual support-switch implementation in both directions.
const workshop = { id: 'taller', name: 'Taller', businessType: 'WORKSHOP' }
const salon = { id: 'salon', name: 'Salon', businessType: 'SALON' }
Object.assign(state, {
  currentUser: { role: 'ACCOUNT_ADMIN' }, business: salon, businessId: salon.id,
  businesses: [salon, workshop], conversationLoadRequest: 0, conversationTabRequest: 0, agendaLoadRequest: 0,
  conversationCache: new Map(), conversationMarketingCache: new Map(), conversationViewCache: new Map(), knownInboundMessageIds: new Set()
})
const shell = { dataset: { section: 'conversations' } }
let scopedLoads = 0
let conversationLoads = 0
Object.assign(sandbox, {
  els: { appShell: shell, list: { innerHTML: '' } },
  setSection: (section: string) => { shell.dataset.section = section },
  stopCrmRealtimeEvents: () => {}, startCrmRealtimeEvents: () => {},
  escapeHtml: (text: string) => text, showCrmToast: (message: string, type: string) => { assert.notEqual(type, 'error', message) },
  loadBusinessScopedBasics: async () => { scopedLoads++ },
  loadConversations: async () => { conversationLoads++ }, loadAgenda: async () => {}
})
for (const name of ['renderSupportBusinessSwitcher', 'renderBusinessSettings', 'renderWhatsappSettings', 'applyProfessionalBusinessHourLimits', 'renderAiControls', 'renderProfessionals', 'renderStaffUsers', 'renderServices', 'renderAgendaFilters', 'renderAppointmentFormOptions']) sandbox[name] = () => {}
vm.runInContext(fn('switchSupportBusiness'), sandbox)
await sandbox.switchSupportBusiness('taller')
assert.equal(state.businessId, 'taller')
assert.equal(shell.dataset.section, 'autos')
assert.equal(scopedLoads, 0)
assert.equal(conversationLoads, 0)
shell.dataset.section = 'workshop-jobs'
await sandbox.switchSupportBusiness('salon')
assert.equal(state.businessId, 'salon')
assert.equal(shell.dataset.section, 'conversations')
assert.equal(scopedLoads, 1)
assert.equal(conversationLoads, 1)
await sandbox.switchSupportBusiness('unauthorized-unknown')
assert.equal(state.businessId, 'salon')

const db = new PGlite()
await db.exec('CREATE TABLE "Business" (id TEXT PRIMARY KEY); INSERT INTO "Business" VALUES (\'existing\');')
await db.exec(readFileSync('prisma/migrations/20260907193000_add_business_type/migration.sql', 'utf8'))
assert.equal((await db.query<any>('SELECT "businessType" FROM "Business"')).rows[0].businessType, 'SALON')
await db.exec('INSERT INTO "Business" (id, "businessType") VALUES (\'taller\', \'WORKSHOP\')')
await assert.rejects(db.exec('INSERT INTO "Business" (id, "businessType") VALUES (\'bad\', \'OTHER\')'))
await db.close()
console.log('Workshop entry contracts passed (UI navigation + isolated migration)')
