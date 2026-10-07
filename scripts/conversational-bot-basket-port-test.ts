import assert from 'node:assert/strict'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { initialDialogueState, respond, type DialogueService } from '../src/conversational-bot/engine.js'
import type { TurnOperation } from '../src/conversational-bot/turn-plan.js'

const dbNow = new Date('2026-10-01T12:00:00Z')
const settings = { timezone: 'America/Argentina/Buenos_Aires', bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: dbNow }
const row = (id: string, duration: number, extra: Record<string, unknown> = {}) => ({
  id, businessId: 'tenant', catalogCategoryId: null, parentServiceId: null, name: id,
  duration, customerDurationMin: null, customerDurationMax: null, price: 10, priceMode: 'FIXED',
  isBookable: true, isActive: true, attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false,
  estimateAllowsBooking: false, estimateQuestion: null, estimateOptions: null, estimateExplanation: null, estimateDisclaimer: null, validationMessage: null, validationQuestion: null, ...extra
})
const professional = { id: 'ramiro', name: 'Ramiro', priority: 0 }
const selected = (id: string): DialogueService => ({ id, name: 'stale name', durationMinutes: 1, price: 1, requiresConsultation: false })
function fixture() {
  const rows = new Map<string, any>([['cut', row('cut', 30)], ['straightening', row('straightening', 90)]])
  const rules: Array<{ serviceAId: string; serviceBId: string; policy: string }> = []
  const queries: any[] = [], catalogQueries: any[] = []
  let professionals = [professional], busy: any[] = []
  const client: any = {
    business: { findFirst: async () => ({ id: 'tenant' }) },
    service: { findFirst: async (query: any) => {
      catalogQueries.push(query)
      assert.equal(query.where.businessId, 'tenant')
      assert.equal(query.where.isActive, true)
      assert.equal(query.where.isBookable, true)
      assert.deepEqual(query.where.professionalLinks.some.professional, { businessId: 'tenant', isActive: true, acceptsBotBookings: true })
      assert.deepEqual(query.where.OR[1], { catalogCategory: { is: { businessId: 'tenant', isActive: true } } })
      const service = rows.get(query.where.id)
      return service?.isActive && service.businessId === 'tenant' ? structuredClone(service) : null
    } },
    $queryRaw: async (query: any) => {
      queries.push(query)
      const sql = query.strings.join(' ')
      if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [settings]
      if (sql.includes('FROM "ServiceCombinationRule"')) {
        assert.ok(query.values.includes('tenant'))
        assert.match(sql, /"businessId" = /)
        assert.match(sql, /"serviceAId" IN /)
        assert.match(sql, /"serviceBId" IN /)
        return structuredClone(rules)
      }
      if (sql.includes('FROM "Professional"')) {
        const expectedIds = query.values.includes('cut') && query.values.includes('straightening') ? 2 : 1
        assert.ok(query.values.includes(expectedIds), 'eligibility HAVING checks the complete requested set')
        return structuredClone(professionals).map(p => sql.includes('AS "serviceIds"') ? {...p,isActive:true,acceptsBotBookings:true,serviceIds:['cut','straightening']} : p)
      }
      if (sql.includes('FROM "BusinessHours"')) return [4, 5].map(dayOfWeek => ({ ownerId: 'tenant', dayOfWeek, startTime: '10:00', endTime: '14:00' }))
      if (sql.includes('FROM "ProfessionalHours"')) return [4, 5].map(dayOfWeek => ({ ownerId: professional.id, dayOfWeek, startTime: '10:00', endTime: '14:00' }))
      if (sql.includes('FROM "ScheduleBlock"')) return []
      if (sql.includes('FROM "Appointment"')) return structuredClone(busy)
      throw new Error('unexpected query: ' + sql)
    }
  }
  return { client, rows, rules, queries, catalogQueries, setProfessionals: (value: typeof professionals) => { professionals = value }, setBusy: (value: any[]) => { busy = value } }
}
const f = fixture()
const { port } = await createPrismaDialoguePort(f.client, 'tenant')
assert.equal(typeof port.availabilityBasket, 'function', 'Prisma port must implement whole-basket availability')
const request = () => port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
const result = await request()
assert.equal(result.ok, true)
if (!result.ok) throw new Error('complete basket rejected')
assert.equal(result.durationMinutes, 120)
assert.equal(result.totalPrice, 20)
assert.deepEqual(result.services.map(service => service.id), ['cut', 'straightening'])
assert.deepEqual(result.services.map(service => service.name), ['cut', 'straightening'], 'fresh database names replace commercial snapshot')
assert.equal(result.slots.at(-1)?.time, '12:00', 'last slot must fit all 120 minutes before closing')
assert.deepEqual(result.services.map(service => [service.professionalDurationMinutes, service.customerDurationMinutes]), [[30, 30], [90, 90]])
const queryCounts = ['FROM "Professional"', 'FROM "BusinessHours"', 'FROM "ProfessionalHours"', 'FROM "ScheduleBlock"', 'FROM "Appointment"'].map(fragment => f.queries.filter(query => query.strings.join(' ').includes(fragment)).length)
assert.deepEqual(queryCounts, [1, 1, 1, 1, 1], 'the whole compatible basket shares one fresh agenda read')
assert.ok((result as any).explanation, 'fixed-date basket exposes scoped reasons from the same read')
console.log('basket port guards and continuous duration: PASS')

// Every failure leaves the complete requested set untouched and performs no partial agenda search.
async function rejects(reason: string, change: (testFixture: ReturnType<typeof fixture>) => void) {
  const test = fixture(); change(test)
  const { port: candidate } = await createPrismaDialoguePort(test.client, 'tenant')
  const outcome = await candidate.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
  assert.deepEqual(outcome, { ok: false, reason })
  assert.equal(test.queries.some(query => query.strings.join(' ').includes('FROM "BusinessHours"')), false, 'rejected basket cannot search a subset')
}
await rejects('SERVICE_UNAVAILABLE', test => { test.rows.get('straightening')!.isActive = false })
await rejects('SERVICE_UNAVAILABLE', test => { test.rows.get('straightening')!.businessId = 'foreign' })
await rejects('PHOTO_REQUIRED', test => { test.rows.get('straightening')!.requiresPhoto = true })
await rejects('VALIDATION_REQUIRED', test => { test.rows.get('straightening')!.validationEnabled = true })
await rejects('DOMAIN_REVIEW', test => { test.rows.get('straightening')!.attentionMode = 'ADVISOR' })
await rejects('INVALID_CONFIGURATION', test => { test.rows.get('straightening')!.attentionMode = 'GUIDED_ESTIMATE'; test.rows.get('straightening')!.estimateAllowsBooking = true })
for (const duration of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
  await rejects('INVALID_DURATION', test => { test.rows.get('straightening')!.duration = duration })
}
const dual = fixture()
Object.assign(dual.rows.get('straightening')!, { customerDurationMin: 90, customerDurationMax: 120 })
const dualPort = await createPrismaDialoguePort(dual.client, 'tenant')
const dualResult = await dualPort.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
assert.equal(dualResult.ok, true, 'customer occupancy is now represented without bypassing professional agenda')
if (dualResult.ok) { assert.equal(dualResult.customerDurationMinutes, 150); assert.equal(dualResult.slots.at(-1)?.time, '11:30') }
for (const range of [{ customerDurationMin: 0 }, { customerDurationMax: 120 }, { customerDurationMin: 90, customerDurationMax: 60 }, { customerDurationMin: 90.5 }, { customerDurationMin: 90, customerDurationMax: Number.NaN }]) {
  await rejects('INVALID_DURATION', test => { Object.assign(test.rows.get('straightening')!, range) })
}
await rejects('COMBINATION_BLOCKED', test => { test.rules.push({ serviceAId: 'straightening', serviceBId: 'cut', policy: 'BLOCKED' }) })
await rejects('COMBINATION_REVIEW', test => { test.rules.push({ serviceAId: 'cut', serviceBId: 'straightening', policy: 'REVIEW_REQUIRED' }) })
await rejects('COMBINATION_BLOCKED', test => { test.rules.push({ serviceAId: 'cut', serviceBId: 'straightening', policy: 'BLOCKED' }, { serviceAId: 'straightening', serviceBId: 'cut', policy: 'ALLOWED' }) })
await rejects('NO_COMMON_PROFESSIONAL', test => { test.setProfessionals([]) })
assert.deepEqual(await port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02', 'not-common'), { ok: false, reason: 'PREFERRED_PROFESSIONAL_INCOMPATIBLE', professionals: [professional] }, 'a preferred mismatch does not erase verified alternatives')
assert.deepEqual(await port.availabilityBasket!([selected('cut'), selected('cut')], '2026-10-02'), { ok: false, reason: 'SERVICE_UNAVAILABLE' })
assert.deepEqual(await port.availabilityBasket!([], '2026-10-02'), { ok: false, reason: 'SERVICE_UNAVAILABLE' })
assert.deepEqual(await port.availabilityBasket!(Array.from({ length: 11 }, (_, n) => selected('s' + n)), '2026-10-02'), { ok: false, reason: 'SERVICE_UNAVAILABLE' })

f.rows.get('straightening')!.priceMode = 'STARTING_AT'
assert.equal((await request()).ok && (await request() as any).totalPrice, null, 'estimated price is never added as a fixed total')
f.rows.get('straightening')!.price = null
assert.equal((await request() as any).totalPrice, null, 'private price cannot become a fixed total')
f.rows.get('straightening')!.priceMode = 'FIXED'
f.rows.get('straightening')!.price = Number.MAX_SAFE_INTEGER
assert.equal((await request() as any).totalPrice, null, 'unsafe total is not invented')
f.rows.get('straightening')!.price = 10
f.setBusy([{ professionalId: 'ramiro', startAt: new Date('2026-10-02T14:00:00Z'), duration: 30 }])
const withBusy = await request()
assert.equal(withBusy.ok, true)
if (!withBusy.ok) throw new Error('busy fixture rejected')
assert.equal(withBusy.slots.some(slot => slot.time === '10:00' || slot.time === '10:30' || slot.time === '11:00'), false, 'appointment in the last 90 minutes blocks the whole interval')
assert.equal(withBusy.slots.some(slot => slot.time === '11:30'), true, 'exact busy end remains available')
const beforeAgenda = f.queries.filter(query => query.strings.join(' ').includes('FROM "BusinessHours"')).length
for (const date of ['2026-09-30', '2026-10-03']) {
  const outside = await port.availabilityBasket!([selected('cut'), selected('straightening')], date)
  assert.equal(outside.ok, true)
  if (outside.ok) assert.deepEqual(outside.slots, [])
}
assert.equal(f.queries.filter(query => query.strings.join(' ').includes('FROM "BusinessHours"')).length, beforeAgenda, 'outside horizon does not query agenda')
await assert.rejects(() => port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-02-30'), /date/)

const transactional = fixture()
let snapshots = 0, readOnly = 0
transactional.client.$transaction = async (body: any, options: any) => {
  snapshots++
  assert.equal(options.isolationLevel, 'RepeatableRead')
  const source = { ...transactional.client, $transaction: undefined, $executeRaw: async (query: any) => { assert.match(query.strings.join(' '), /SET TRANSACTION READ ONLY/); readOnly++; return 0 } }
  return body(source)
}
const inSnapshot = await createPrismaDialoguePort(transactional.client, 'tenant')
assert.equal((await inSnapshot.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')).ok, true)
assert.equal(snapshots, 1)
assert.equal(readOnly, 1, 'basket rules and fresh availability share the existing read-only snapshot')
console.log('basket port fail-closed policy, tenancy, rules, occupancy and snapshot: PASS')

for (const price of [-1, 10.5, Number.NaN]) {
  const invalid = fixture(); invalid.rows.get('straightening')!.price = price
  const { port: candidate } = await createPrismaDialoguePort(invalid.client, 'tenant')
  await assert.rejects(() => candidate.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02'), /price/)
  assert.equal(invalid.queries.some(query => query.strings.join(' ').includes('FROM "BusinessHours"')), false)
}
const invalidRule = fixture()
invalidRule.rules.push({ serviceAId: 'cut', serviceBId: 'straightening', policy: 'toString' })
const rulePort = await createPrismaDialoguePort(invalidRule.client, 'tenant')
await assert.rejects(() => rulePort.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02'), /rule/)
console.log('basket source integrity guards: PASS')

const integration = fixture()
const built = await createPrismaDialoguePort(integration.client, 'tenant')
const commercial: DialogueService[] = ['cut', 'straightening'].map(id => ({ ...selected(id), name: id }))
const integratedPort = { ...built.port, catalog: async () => commercial }
const evidence = (text: string) => ({ evidence: text, confidence: .99 })
const operations: TurnOperation[] = [
  { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [
    { mode: 'single', serviceIds: ['cut'], ...evidence('cut') },
    { mode: 'single', serviceIds: ['straightening'], ...evidence('straightening') }
  ], ...evidence('cut y straightening') },
  { kind: 'date', expression: 'mañana', ...evidence('mañana') },
  { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...evidence('Ramiro') },
  { kind: 'time', value: '12:00', ...evidence('12:00') },
  { kind: 'name', value: 'Matias', ...evidence('Matias') }
]
const decision = { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1 as const, operations } }
const text = 'soy Matias cut y straightening mañana con Ramiro a las 12:00'
const proposal = await respond(built.context, initialDialogueState('tenant'), text, integratedPort, decision)
assert.deepEqual(proposal.proposal?.serviceIds, ['cut', 'straightening'])
assert.equal(proposal.proposal?.durationMinutes, 120)
assert.equal(proposal.proposal?.totalPrice, 20, 'fresh whole-basket price replaces stale commercial descriptors')
assert.equal(proposal.proposal?.customerName, 'Matias')
assert.match(proposal.reply, /Todavía no está reservado/)
integration.rows.get('straightening')!.price = Number.MAX_SAFE_INTEGER
const overflow = await respond(built.context, initialDialogueState('tenant'), text, integratedPort, decision)
assert.equal(overflow.proposal?.totalPrice, null, 'motor and adapter agree on an unsafe sum without dropping either service')
integration.rows.get('straightening')!.requiresPhoto = true
const rejected = await respond(built.context, initialDialogueState('tenant'), text, integratedPort, decision)
assert.equal(rejected.proposal, null)
assert.deepEqual(rejected.state.basket?.members.flatMap(member => member.serviceIds), ['cut', 'straightening'])
assert.equal(rejected.state.customerName, 'Matias')
assert.equal(rejected.state.date, '2026-10-02')
assert.equal(rejected.state.slot, null)
console.log('basket Prisma adapter and motor complete proposal integration: PASS')

const ordered = await port.availabilityBasket!([selected('straightening'), selected('cut')], '2026-10-02')
assert.equal(ordered.ok, true)
if (ordered.ok) assert.deepEqual(ordered.services.map(service => service.id), ['straightening', 'cut'], 'requested order is preserved rather than sorted or balanced away')
const shorter = fixture()
Object.assign(shorter.rows.get('straightening')!, { customerDurationMin: 60, customerDurationMax: 75 })
const shorterPort = await createPrismaDialoguePort(shorter.client, 'tenant')
const shorterResult = await shorterPort.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
assert.equal(shorterResult.ok, true, 'customer occupancy already covered by professional interval is representable')
if (shorterResult.ok) assert.equal(shorterResult.durationMinutes, 120)
console.log('basket order and representable occupancy: PASS')

// Different professionals must preserve the complete basket, not drop a service.
const coordinatedFixture = fixture()
const originalQuery = coordinatedFixture.client.$queryRaw
coordinatedFixture.client.$queryRaw = async (query: any) => {
  const sql = query.strings.join(' ')
  if (sql.includes('FROM "Professional"')) {
    if (query.values.includes('cut') && query.values.includes('straightening')) return []
    return query.values.includes('cut') ? [professional] : [{ id: 'cin', name: 'Cin', priority: 1 }]
  }
  if (sql.includes('FROM "ProfessionalHours"')) {
    return ['ramiro', 'cin'].flatMap(ownerId => [4, 5].map(dayOfWeek => ({ ownerId, dayOfWeek, startTime: '10:00', endTime: '14:00' })))
  }
  return originalQuery(query)
}
const coordinatedPort = await createPrismaDialoguePort(coordinatedFixture.client, 'tenant')
const coordinatedResult = await coordinatedPort.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
assert.equal(coordinatedResult.ok, true, 'P3-A must search a complete coordinated assignment when no common professional exists')
if (!coordinatedResult.ok) throw new Error('coordinated assignment unavailable')
const coordinatedSlot = coordinatedResult.slots[0] as any
assert.deepEqual(coordinatedSlot.coordination.segments.map((segment: any) => [segment.serviceId, segment.professionalId]), [['cut', 'ramiro'], ['straightening', 'cin']])
assert.equal(coordinatedSlot.coordination.segments[0].endAt, coordinatedSlot.coordination.segments[1].startAt)
assert.match(coordinatedSlot.coordination.key, /^[a-f0-9]{64}$/)
console.log('P3-A complete coordinated availability: PASS')

const { respondConversationChoice: chooseCoordinated, parseDialogueState: parseCoordinatedState } = await import('../src/conversational-bot/engine.js')
const { adaptChoicePresentation: coordinatedPresentation } = await import('../src/conversational-bot/dialogue-choice-presentation.js')
const { coordinationKey: assignmentKey, validateCoordinatedSlot: validateAssignment } = await import('../src/conversational-bot/coordinated-booking.js')
const coordinatedContext = {...coordinatedPort.context,sandboxBooking:true}
const coordinatedState = {...proposal.state,date:'2026-10-02',pending:'time' as const,professional:{kind:'any' as const},requestedTime:null,slot:null}
delete coordinatedState.sandboxReservation
let freshCoordinatedResult = coordinatedResult
const controlledCoordinatedPort = {...coordinatedPort.port,catalog:async () => [...coordinatedResult.services],availabilityBasket:async () => freshCoordinatedResult}
const offeredCoordinated = await respond(coordinatedContext,coordinatedState,'stored choice',controlledCoordinatedPort)
assert.equal(offeredCoordinated.state.slot,null,'offering a coordinated assignment never selects it')
assert.equal(offeredCoordinated.bookingCommand,undefined)
assert.match(offeredCoordinated.reply,/cut.*Ramiro/)
assert.match(offeredCoordinated.reply,/straightening.*Cin/)
const assignmentOperation = offeredCoordinated.choicePresentation!.choices[0]!.operation
assert.equal(assignmentOperation.kind,'slot')
const acceptedAssignment = await chooseCoordinated(coordinatedContext,offeredCoordinated.state,assignmentOperation,controlledCoordinatedPort)
assert.deepEqual(acceptedAssignment.state.slot?.coordination,coordinatedSlot.coordination)
assert.deepEqual(acceptedAssignment.proposal?.segments,coordinatedSlot.coordination.segments)
assert.equal(acceptedAssignment.bookingCommand,undefined,'selecting an assignment never executes confirmation without consent')
assert.ok(acceptedAssignment.state.sandboxReservation,'B presents the full assignment for explicit confirmation')
assert.deepEqual(acceptedAssignment.state.sandboxReservation.presented.terms.coordination,coordinatedSlot.coordination)
assert.deepEqual(parseCoordinatedState(acceptedAssignment.state,'tenant',coordinatedContext.timezone).slot,acceptedAssignment.state.slot,'complete assignment survives state round-trip')
const corruptedAssignment = structuredClone(acceptedAssignment.state)
corruptedAssignment.slot!.coordination!.segments[1]!.professionalId = 'foreign'
assert.throws(() => parseCoordinatedState(corruptedAssignment,'tenant',coordinatedContext.timezone),/coordinated/)
const wrongCoverage = structuredClone(coordinatedSlot)
wrongCoverage.coordination.segments.reverse()
assert.throws(() => validateAssignment(wrongCoverage,{businessId:'tenant',serviceIds:['cut','straightening']}),/coverage/)
const wrongTenant = structuredClone(coordinatedSlot)
assert.throws(() => validateAssignment(wrongTenant,{businessId:'foreign',serviceIds:['cut','straightening']}),/key/)
const discontinuous = structuredClone(coordinatedSlot)
discontinuous.coordination.segments[1].startAt = new Date(Date.parse(discontinuous.coordination.segments[1].startAt)+60000).toISOString()
assert.throws(() => validateAssignment(discontinuous,{businessId:'tenant',serviceIds:['cut','straightening']}),/segment/)
const shiftedAssignment = structuredClone(coordinatedResult)
for (const slot of shiftedAssignment.slots) {
  slot.coordination!.segments[1]!.professionalId = 'new-cin'
  slot.coordination!.segments[1]!.professionalName = 'Nueva Cin'
  slot.coordination!.key = assignmentKey('tenant',slot.coordination!.segments)
}
shiftedAssignment.professionals = [...shiftedAssignment.professionals,{id:'new-cin',name:'Nueva Cin',priority:2}]
freshCoordinatedResult = shiftedAssignment
await assert.rejects(() => chooseCoordinated(coordinatedContext,offeredCoordinated.state,assignmentOperation,controlledCoordinatedPort),/choice/i,'same anchor with changed second assignment must not authorize the old choice')
assert.equal(offeredCoordinated.state.slot,null,'rejecting a stale choice cannot mutate the original draft')
console.log('P3-A selection, assignment freshness, roundtrip and no effects: PASS')

freshCoordinatedResult = coordinatedResult
if (assignmentOperation.kind !== 'slot') throw new Error('coordinated choice must be a slot')
const {coordinationKey: omittedAssignmentKey, ...anchorOnlyOperation} = assignmentOperation
await assert.rejects(() => chooseCoordinated(coordinatedContext,offeredCoordinated.state,anchorOnlyOperation,controlledCoordinatedPort),/choice/i,'an anchor alone cannot select the full assignment')
assert.ok(omittedAssignmentKey)
const explicitPreferred = await coordinatedPort.port.availabilityBasket!([selected('cut'),selected('straightening')],'2026-10-02','ramiro')
assert.equal(explicitPreferred.ok,false,'an incompatible requested professional is not silently replaced by coordination')
if (!explicitPreferred.ok) assert.equal(explicitPreferred.reason,'PREFERRED_PROFESSIONAL_INCOMPATIBLE')
coordinatedFixture.rules.push({serviceAId:'cut',serviceBId:'straightening',policy:'BLOCKED'})
const blockedCoordination = await coordinatedPort.port.availabilityBasket!([selected('cut'),selected('straightening')],'2026-10-02')
assert.deepEqual(blockedCoordination,{ok:false,reason:'COMBINATION_BLOCKED'})
console.log('P3-A no anchor-only authorization, silent preference override or policy bypass: PASS')
