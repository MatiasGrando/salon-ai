import assert from 'node:assert/strict'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { serviceConfigurationKey } from '../src/bot-options/domain/service-booking.js'
import { initialDialogueState, respond, type DialogueService } from '../src/conversational-bot/engine.js'

const dbNow = new Date('2026-10-01T12:00:00Z')
const settings = { timezone: 'America/Argentina/Buenos_Aires', bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: dbNow }
const options = [{ id: 'short', label: 'Short', priceMin: 85, priceMax: 95, note: null }, { id: 'long', label: 'Long', priceMin: 95, priceMax: 110, note: null }]
const row = (id: string, duration: number, extra: Record<string, unknown> = {}) => ({
  id, businessId: 'tenant', catalogCategoryId: null, parentServiceId: null, name: id, description: null,
  duration, customerDurationMin: null, customerDurationMax: null, price: 27, priceMode: 'FIXED', isBookable: true, isActive: true,
  attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false, estimateAllowsBooking: false,
  estimateQuestion: null, estimateOptions: null, estimateExplanation: null, estimateDisclaimer: null, validationMessage: null, validationQuestion: null, ...extra
})
function fixture() {
  const rows = new Map<string, any>([['cut', row('cut', 30)], ['guided', row('guided', 90, {
    customerDurationMin: 90, customerDurationMax: 150, price: 85, priceMode: 'STARTING_AT', attentionMode: 'GUIDED_ESTIMATE',
    estimateAllowsBooking: true, estimateQuestion: 'Which size?', estimateOptions: options, estimateExplanation: 'Depends on size', estimateDisclaimer: 'An estimate'
  })]])
  let revision = 1, catalogLoads = 0
  const queries: any[] = [], serviceQueries: any[] = []
  function source(snapshotRows?: Map<string, any>, snapshotRevision?: number): any {
    const data = () => snapshotRows ?? rows
    return {
      business: { findFirst: async () => ({ id: 'tenant' }) }, serviceCategory: { findMany: async () => [] },
      service: {
        findFirst: async (args: any) => {
          if (!args.select.name) return { id: 'cut' }
          serviceQueries.push(args)
          assert.equal(args.where.businessId, 'tenant'); assert.equal(args.where.isActive, true); assert.equal(args.where.isBookable, true)
          const current = data().get(args.where.id)
          return current?.isActive && current.businessId === 'tenant' ? structuredClone(current) : null
        },
        findMany: async () => { catalogLoads++; return structuredClone([...data().values()]) }
      },
      $executeRaw: async (query: any) => { assert.match(query.strings.join(' '), /SET TRANSACTION READ ONLY/); return 0 },
      $queryRaw: async (query: any) => {
        queries.push(query)
        const sql = query.strings.join(' ')
        if (sql.includes('conversational-public-source-stamp')) return [{ businessId: 'tenant', timezone: settings.timezone, stamp: (snapshotRevision ?? revision).toString(16).padStart(64, '0') }]
        if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [settings]
        if (sql.includes('FROM "ServiceCombinationRule"')) return []
        if (sql.includes('FROM "Professional"')) return [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
        if (sql.includes('FROM "BusinessHours"')) return [{ ownerId: 'tenant', dayOfWeek: 5, startTime: '10:00', endTime: '14:00' }]
        if (sql.includes('FROM "ProfessionalHours"')) return [{ ownerId: 'ramiro', dayOfWeek: 5, startTime: '10:00', endTime: '14:00' }]
        if (sql.includes('FROM "ScheduleBlock"') || sql.includes('FROM "Appointment"')) return []
        throw new Error('unexpected query: ' + sql)
      }
    }
  }
  const client = source()
  client.$transaction = async (body: any, opts: any) => {
    assert.equal(opts.isolationLevel, 'RepeatableRead')
    return body(source(structuredClone(rows), revision))
  }
  return { client, rows, queries, serviceQueries, revise: () => { revision++ }, catalogLoads: () => catalogLoads,
    agendaReads: () => queries.filter(query => !query.strings.join(' ').includes('conversational-public-source-stamp') && query.strings.join(' ').includes('FROM "BusinessHours"')).length }
}
const f = fixture()
const built = await createPrismaDialoguePort(f.client, 'tenant')
const services = await built.port.catalog()
assert.equal(services[1]!.requiresConsultation, false, 'guided estimates allowed by business are not human-consultation services')
assert.equal(services[1]!.bookingPolicy?.attentionMode, 'GUIDED_ESTIMATE', 'commercial metadata transports configured guide')
assert.equal(services[1]!.customerDurationMinutes, 150)
const choice = (service: DialogueService, optionId: string | null) => ({ configurationKey: serviceConfigurationKey(service.bookingPolicy!), optionId })
const request = (selected = services, estimates: any = {}) => built.port.availabilityBasket!(selected, '2026-10-02', 'ramiro', estimates)
const pending = await request()
assert.equal(pending.ok, false)
if (pending.ok || pending.reason !== 'GUIDANCE_REQUIRED') throw new Error('pending guide not returned')
assert.deepEqual(pending.services.map(service => service.id), ['cut', 'guided'])
assert.equal(f.agendaReads(), 0, 'pending guide queries no agenda nor partial basket')
assert.equal(f.queries.some(query => query.strings.join(' ').includes('FROM "ServiceCombinationRule"')), false, 'guidance is checked before combination/professional queries')
const estimates = { guided: choice(services[1]!, 'short') }
const accepted = await request(services, estimates)
assert.equal(accepted.ok, true)
if (!accepted.ok) throw new Error('current guided choice rejected')
assert.equal(accepted.durationMinutes, 120); assert.equal(accepted.customerDurationMinutes, 180)
assert.equal(accepted.totalPrice, null, 'estimated range never becomes fixed total')
assert.equal(accepted.slots.at(-1)?.time, '11:00', 'whole customer interval180 fits business closing')
assert.deepEqual(accepted.services.map(service => [service.professionalDurationMinutes, service.customerDurationMinutes]), [[30, 30], [90, 150]])
const singular = await request([services[1]!], estimates)
assert.equal(singular.ok, true)
if (singular.ok) { assert.equal(singular.durationMinutes, 90); assert.equal(singular.customerDurationMinutes, 150); assert.equal(singular.slots.at(-1)?.time, '11:30') }
for (const selection of [{ configurationKey: 'forged', optionId: 'short' }, choice(services[1]!, 'foreign')]) {
  const before = f.agendaReads()
  const rejected = await request(services, { guided: selection })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.equal(rejected.reason, 'GUIDANCE_REQUIRED')
  assert.equal(f.agendaReads(), before, 'invalid or stale choice never queries agenda')
}
for (const [extra, reason] of [
  [{ requiresPhoto: true }, 'PHOTO_REQUIRED'], [{ validationEnabled: true }, 'VALIDATION_REQUIRED'],
  [{ estimateAllowsBooking: false }, 'ESTIMATE_NOT_BOOKABLE'], [{ attentionMode: 'ADVISOR' }, 'DOMAIN_REVIEW'],
  [{ estimateOptions: 'bad' }, 'INVALID_CONFIGURATION'], [{ estimateQuestion: null }, 'INVALID_CONFIGURATION']
] as const) {
  const g = fixture(); Object.assign(g.rows.get('guided')!, extra)
  const port = (await createPrismaDialoguePort(g.client, 'tenant')).port
  assert.deepEqual(await port.availabilityBasket!(services, '2026-10-02', undefined, estimates), { ok: false, reason })
  assert.equal(g.agendaReads(), 0)
}
const originalPolicy = structuredClone(f.rows.get('guided')!)
Object.assign(f.rows.get('guided')!, { priceMode: 'FIXED' })
f.revise()
const fixedGuided = await built.port.catalog()
const range = await request(fixedGuided, { guided: choice(fixedGuided[1]!, 'long') })
assert.equal(range.ok, true)
if (range.ok) assert.equal(range.totalPrice, null, 'even FIXED base cannot turn a guided range into fixed basket total')
Object.assign(f.rows.get('guided')!, originalPolicy, { estimateOptions: [], estimateQuestion: null, price: 96 })
f.revise()
const automatic = await request(services, estimates)
assert.equal(automatic.ok, true, 'no-option starting-at is rederived from fresh policy without extra guidance')
if (automatic.ok) assert.equal(automatic.services[1]!.price, 96)
Object.assign(f.rows.get('guided')!, originalPolicy)
f.rows.set('cut', row('cut', 30, { price: 40, priceMode: 'STARTING_AT', attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: true,
  estimateQuestion: 'Which style?', estimateOptions: [{ id: 'style', label: 'Style', priceMin: 40, priceMax: null, note: null }] }))
f.revise()
const twoGuides = await built.port.catalog()
const incomplete = await request(twoGuides, { guided: choice(twoGuides[1]!, 'short') })
assert.equal(incomplete.ok, false)
if (!incomplete.ok) assert.equal(incomplete.reason, 'GUIDANCE_REQUIRED')
assert.equal((await request(twoGuides, { guided: choice(twoGuides[1]!, 'short'), cut: choice(twoGuides[0]!, 'style') })).ok, true)
// A catalogue read at turn start can race an editor; fresh guide returned now must persist through the next standard stamp read.
const c = fixture(), prepared = await createPrismaDialoguePort(c.client, 'tenant')
const old = await prepared.port.catalog(), oldChoice = { guided: choice(old[1]!, 'short') }
Object.assign(c.rows.get('guided')!, { estimateQuestion: 'New question?', estimateOptions: [{ id: 'new', label: 'New option', priceMin: 100, priceMax: 120, note: null }] })
c.revise()
const before = c.agendaReads(), loads = c.catalogLoads()
const changed = await prepared.port.availabilityBasket!(old, '2026-10-02', 'ramiro', oldChoice)
assert.equal(changed.ok, false)
if (changed.ok || changed.reason !== 'GUIDANCE_REQUIRED') throw new Error('fresh guide missing')
assert.equal(changed.services[1]!.bookingPolicy?.estimateQuestion, 'New question?')
assert.equal(c.agendaReads(), before); assert.equal(c.catalogLoads(), loads, 'fresh guide returns loaded descriptors without extra catalog load')
const current = await prepared.port.catalog()
assert.equal(current[1]!.bookingPolicy?.estimateQuestion, 'New question?', 'same prepared port invalidates old commercial policy immediately')
const next = await createPrismaDialoguePort(c.client, 'tenant'), nextCatalog = await next.port.catalog()
assert.equal(nextCatalog[1]!.bookingPolicy?.estimateOptions?.[0]?.id, 'new', 'next-turn IA receives current choices, not stale cache')
assert.equal(c.catalogLoads(), loads + 1, 'next-turn reload occurs once, then shared cache is reused')
assert.equal((await next.port.availabilityBasket!(nextCatalog, '2026-10-02', 'ramiro', { guided: choice(nextCatalog[1]!, 'new') })).ok, true)
const e = (evidence: string) => ({ evidence, confidence: .99 })
const reopened = await respond(prepared.context, initialDialogueState('tenant'), 'cut guided short mañana Ramiro Matias 11:00',
  { ...prepared.port, catalog: async () => old }, { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
    { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [
      { mode: 'single', serviceIds: ['cut'], ...e('cut') }, { mode: 'single', serviceIds: ['guided'], ...e('guided') }
    ], ...e('cut guided') },
    { kind: 'estimate', serviceId: 'guided', optionId: 'short', ...e('short') },
    { kind: 'date', expression: 'mañana', ...e('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...e('Ramiro') },
    { kind: 'time', value: '11:00', ...e('11:00') }, { kind: 'name', value: 'Matias', ...e('Matias') }
  ] } })
assert.equal(reopened.state.pending, 'estimate'); assert.equal(reopened.state.date, '2026-10-02'); assert.equal(reopened.state.customerName, 'Matias')
assert.match(reopened.reply, /New question/); assert.equal(reopened.proposal, null)
const continued = await respond(next.context, reopened.state, 'New option', next.port, { serviceId: null, candidateIds: [], correction: false,
  turnPlan: { version: 1, operations: [{ kind: 'estimate', serviceId: 'guided', optionId: 'new', ...e('New option') }] } })
assert.equal(continued.state.pending, 'time', 'new next-turn choice resumes complete agenda without reverting to old guide')
assert.equal(continued.state.date, '2026-10-02'); assert.equal(continued.state.customerName, 'Matias')
assert.match(continued.reply, /Horarios disponibles/)
console.log('guided Prisma port fresh policy/choice, singular/basket dual occupancy and cache continuity: PASS')