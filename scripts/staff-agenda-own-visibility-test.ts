import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'

process.env.DOTENV_CONFIG_PATH = '__offline_staff_agenda_own_visibility__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_staff_agenda_own_visibility'

const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').find((source) => source.includes('function renderAgendaFilters'))
assert.ok(script, 'production Agenda script exists')

function source(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(script)
  assert.ok(match, 'production handler exists: ' + name)
  const tail = script.slice(match.index + 4).search(/\n    (?:(?:async )?function |const |let |els\.)/)
  return script.slice(match.index, tail < 0 ? undefined : match.index + 4 + tail)
}

function select() {
  let value = ''
  let markup = ''
  let options: string[] = []
  return Object.defineProperties({ dataset: {}, querySelectorAll: () => [], addEventListener() {} }, {
    value: { get: () => value, set: (next: string) => { value = options.includes(next) ? next : '' } },
    innerHTML: { get: () => markup, set: (next: string) => {
      markup = next
      options = [...next.matchAll(/<option value="([^"]*)"/g)].map((match) => {
        const optionValue = match[1]
        assert.ok(optionValue !== undefined, 'option value capture exists')
        return optionValue
      })
      value = options[0] || ''
    } }
  }) as any
}

const professionals = [
  { id: 'own', name: 'Gaspar', businessId: 'business-a', isActive: true },
  { id: 'other', name: 'Carolina', businessId: 'business-a', isActive: true }
]

function user(overrides: Record<string, unknown> = {}) {
  return { id: 'staff-1', role: 'STAFF', staffProfile: 'PROFESSIONAL', agendaScope: 'OWN', professionalId: 'own', ...overrides }
}

function agendaContext(currentUser = user()) {
  const els: any = { agendaProfessional: select(), agendaService: select(), agendaProfessionalTabs: { innerHTML: '', querySelectorAll: () => [] }, agendaLegend: { innerHTML: '' } }
  const state: any = { currentUser, businessId: 'business-a', business: { id: 'business-a' }, professionals: professionals.map((professional) => ({ ...professional })), agendaProfessionalCatalogScope: null, agendaProfessionalPreferenceScope: null,
    agendaAppointments: ['own', 'other'].map((professionalId) => ({ id: 'appointment-' + professionalId, professionalId, status: 'CONFIRMED', startAt: '2026-10-28T12:00:00Z' })),
    agendaBlocks: ['own', 'other', null].map((professionalId) => ({ id: 'block-' + professionalId, professionalId, startAt: '2026-10-28T12:00:00Z', endAt: '2026-10-28T13:00:00Z' })) }
  const context: any = {
    state,
    els,
    escapeHtml: (value: string) => value,
    bookableServices: () => [],
    localStorage: { getItem: () => null, setItem() {} }
  }
  const handlers = ['activeProfessionals', 'isOwnAgendaScope', 'agendaOwnProfessionalId', 'agendaVisibleProfessionals', 'agendaProfessionalColor', 'validAgendaProfessionalFilter', 'agendaProfessionalPreferenceKey', 'restoreAgendaProfessionalFilter', 'renderAgendaFilters', 'renderAgendaProfessionalControls', 'renderAgendaMobileFilterPanel', 'filteredAgendaAppointmentsForRange', 'filteredAgendaBlocksForRange']
  runInNewContext(handlers.map(source).join('\n'), context)
  state.agendaProfessionalCatalogScope = context.agendaProfessionalPreferenceKey()
  return context
}

function mobileContext(currentUser = user()) {
  const context = agendaContext(currentUser)
  const gridWrap: any = { innerHTML: '', classList: { toggle() {} }, querySelector: () => null, querySelectorAll: () => [] }
  Object.assign(context.els, { agendaGridWrap: gridWrap, agendaRange: { textContent: '' }, agendaToday: { textContent: '' }, agendaProfessionalTabs: { innerHTML: '', querySelectorAll: () => [] }, agendaLegend: { innerHTML: '' } })
  Object.assign(context.state, { agendaViewDays: 1, agendaSelectedDate: new Date('2026-10-28T12:00:00Z'), agendaProfessionalResizeObserver: null, agendaMobileMonthOpen: false, agendaMobileFiltersOpen: false, agendaDragLocked: true })
  Object.assign(context, {
    syncAgendaDragLockControl() {},
    startOfDay: (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
    formatAgendaMobileTitle: () => 'Octubre',
    renderAgendaMobileMonthPanel: () => '',
    addDays: (date: Date, days: number) => new Date(date.getTime() + days * 86400000),
    getAgendaDisplayRange: () => ({ start: 8 * 60, end: 20 * 60 }),
    formatAgendaRange: () => '28 de octubre',
    dateKey: (date: Date) => date.toISOString().slice(0, 10),
    canManageScheduleBlocks: () => false,
    canCreateAppointments: () => false,
    canDragAgendaAppointments: () => false,
    canEditAppointments: () => false,
    renderAgendaProfessionalDateCorner: () => '<corner>',
    renderAgendaProfessionalDayHeader: (professional: any) => '<header>' + professional.id + '</header>',
    isClosedAgendaSlotForProfessional: () => false,
    isClosedAgendaSlot: () => false,
    buildAgendaEventLayout: () => new Map(),
    renderAgendaMobileEvent: (appointment: any) => '<event>' + appointment.id + '</event>',
    renderAgendaMobileBlock: (block: any) => '<block>' + block.id + '</block>',
    renderAgendaMobileDayHeader: () => '<day>',
    bindAgendaMobileControls() {},
    scrollAgendaMobileToWorkingTime() {}
  })
  runInNewContext(['renderAgendaProfessionalDayColumn', 'renderAgendaMobileDayColumn', 'renderAgendaMobileThreeDay'].map(source).join('\n'), context)
  return context
}

for (const [name, subject, expected] of [
  ['professional staff', user(), 'Profesional'],
  ['secretary staff', user({ staffProfile: 'SECRETARY', agendaScope: 'ALL', professionalId: null }), 'Secretaría'],
  ['business administrator', user({ role: 'BUSINESS_ADMIN' }), 'Administrador'],
  ['account administrator', user({ role: 'ACCOUNT_ADMIN' }), 'Administrador de cuentas'],
  ['super administrator', user({ role: 'SUPER_ADMIN' }), 'Super admin']
] as const) {
  const context: any = { user: subject }
  runInNewContext(source('workspaceRoleLabel'), context)
  assert.equal(context.workspaceRoleLabel(context.user), expected, name)
}

const own = agendaContext()
own.renderAgendaFilters()
assert.match(own.els.agendaProfessional.innerHTML, /Gaspar/)
assert.doesNotMatch(own.els.agendaProfessional.innerHTML, /Carolina/)
assert.equal(own.els.agendaProfessional.value, 'own')
assert.deepEqual([...own.agendaVisibleProfessionals()].map((professional: any) => professional.id), ['own'])
assert.doesNotMatch(own.els.agendaProfessional.innerHTML, /Todos/)
assert.doesNotMatch(own.els.agendaProfessionalTabs.innerHTML, /Carolina|Todos/)
assert.doesNotMatch(own.els.agendaLegend.innerHTML, /Carolina/)
assert.doesNotMatch(own.renderAgendaMobileFilterPanel(), /Carolina|Todos los profesionales/)

const secretary = agendaContext(user({ staffProfile: 'SECRETARY', agendaScope: 'ALL', professionalId: null }))
secretary.renderAgendaFilters()
assert.match(secretary.els.agendaProfessional.innerHTML, /Gaspar/)
assert.match(secretary.els.agendaProfessional.innerHTML, /Carolina/)
assert.match(secretary.els.agendaProfessionalTabs.innerHTML, /Carolina/)
assert.deepEqual([...secretary.agendaVisibleProfessionals()].map((professional: any) => professional.id), ['other', 'own'])

const from = new Date('2026-10-28T00:00:00Z'), to = new Date('2026-10-29T00:00:00Z')
assert.deepEqual([...own.filteredAgendaAppointmentsForRange(from, to)].map((appointment: any) => appointment.id), ['appointment-own'])
assert.deepEqual([...secretary.filteredAgendaAppointmentsForRange(from, to)].map((appointment: any) => appointment.id), ['appointment-own', 'appointment-other'])
assert.deepEqual([...own.filteredAgendaBlocksForRange(from, to)].map((block: any) => block.id), ['block-own', 'block-null'])
own.els.agendaProfessional = { value: 'other' }
assert.deepEqual([...own.filteredAgendaAppointmentsForRange(from, to)].map((appointment: any) => appointment.id), ['appointment-own'], 'a stale or forged selection never changes own scope')

for (const malformed of [user({ professionalId: null }), user({ professionalId: 'other-business' })]) {
  const denied = agendaContext(malformed)
  denied.renderAgendaFilters()
  assert.doesNotMatch(denied.els.agendaProfessional.innerHTML, /Gaspar|Carolina/)
  assert.equal(denied.els.agendaProfessional.value, '')
  assert.deepEqual([...denied.agendaVisibleProfessionals()], [])
  assert.deepEqual([...denied.filteredAgendaAppointmentsForRange(from, to)], [])
  assert.deepEqual([...denied.filteredAgendaBlocksForRange(from, to)], [])
}

for (const invalid of ['inactive', 'foreign']) {
  const denied = agendaContext()
  if (invalid === 'inactive') denied.state.professionals[0].isActive = false
  else denied.state.professionals[0].businessId = 'business-foreign'
  denied.renderAgendaFilters()
  assert.deepEqual([...denied.agendaVisibleProfessionals()], [], invalid)
  assert.deepEqual([...denied.filteredAgendaAppointmentsForRange(from, to)], [], invalid)
}

const mobileOwn = mobileContext()
mobileOwn.renderAgendaFilters()
mobileOwn.renderAgendaMobileThreeDay()
assert.match(mobileOwn.els.agendaGridWrap.innerHTML, /<header>own<\/header>/)
assert.match(mobileOwn.els.agendaGridWrap.innerHTML, /<event>appointment-own<\/event>/)
assert.doesNotMatch(mobileOwn.els.agendaGridWrap.innerHTML, /other/)

const mobileSecretary = mobileContext(user({ staffProfile: 'SECRETARY', agendaScope: 'ALL', professionalId: null }))
mobileSecretary.renderAgendaMobileThreeDay()
assert.match(mobileSecretary.els.agendaGridWrap.innerHTML, /<header>other<\/header><header>own<\/header>/)
assert.match(mobileSecretary.els.agendaGridWrap.innerHTML, /appointment-other/)
assert.match(mobileSecretary.els.agendaGridWrap.innerHTML, /appointment-own/)

for (const viewDays of [3, 7]) {
  const ownDays = mobileContext()
  ownDays.state.agendaViewDays = viewDays
  ownDays.renderAgendaMobileThreeDay()
  assert.match(ownDays.els.agendaGridWrap.innerHTML, /appointment-own/)
  assert.doesNotMatch(ownDays.els.agendaGridWrap.innerHTML, /appointment-other/)
  const allDays = mobileContext(user({ staffProfile: 'SECRETARY', agendaScope: 'ALL', professionalId: null }))
  allDays.state.agendaViewDays = viewDays
  allDays.renderAgendaMobileThreeDay()
  assert.match(allDays.els.agendaGridWrap.innerHTML, /appointment-own/)
  assert.match(allDays.els.agendaGridWrap.innerHTML, /appointment-other/)
}

console.log('OK staff Agenda own visibility: labels, selectors, tabs, mobile filters, real 1/3/7-day events and invalid-link denial')
