import assert from 'node:assert/strict'
import { Prisma } from '../src/generated/prisma/client.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { initialDialogueState, parseDialogueState, finalizeRuntimeBooking, respond, respondConversationChoice, type DialogueContext, type DialogueDecision, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseRuntimePresentedBooking, runtimeBookingFingerprint, runtimeBookingRequestHash, runtimeBookingChildInput, runtimeBookingChildRequestHash, runtimeBookingSummary, type RuntimePresentedBooking, type RuntimeShownScope } from '../src/conversational-bot/prisma-conversational-booking.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { parseBotOptionsState } from '../src/bot-options/domain/state.js'

// All repositories are controlled local doubles. The real presentation builder is used;
// no provider, remote database, environment file, or booking writer is invoked here.
const scope: RuntimeShownScope = { businessId: 'b', sessionId: 'session', deploymentId: 'dep', generation: 2,
  revision: '5', configurationId: 'cfg', dispatchFenceEpoch: 3, handoffFenceEpoch: 4 }
const service = { id: 's1', name: 'Corte', durationMinutes: 30, professionalDurationMinutes: 30,
  customerDurationMinutes: 30, price: 1000, priceMode: 'FIXED' as const, requiresConsultation: false }
const rawService = { id: 's1', businessId: 'b', name: 'Corte', duration: 30, customerDurationMin: null,
  customerDurationMax: null, price: 1000, priceMode: 'FIXED', isActive: true, isBookable: true,
  attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false, estimateAllowsBooking: false,
  depositMode: 'NONE', depositValue: null }
const slot = { date: '2026-10-07', time: '10:00', startAt: '2026-10-07T13:00:00.000Z',
  professionalId: 'p1', professionalName: 'Elisa', band: 'MORNING' as const, occupiedMinutes: 30 }
type ReservationState = DialogueState & { bookingReservation?: { presented: RuntimePresentedBooking; receipt?: unknown } }
const ready: DialogueState = { ...initialDialogueState('b'), serviceId: 's1', date: slot.date,
  professional: { kind: 'specific', id: 'p1' }, slot, customerName: 'Ana', pending: 'proposal' }
const semantic = (evidence: string, confidence = 1): DialogueDecision => ({ serviceId: null, candidateIds: [], correction: false,
  turnPlan: { version: 1, operations: [{ kind: 'confirm_proposal', evidence, confidence }] } })

async function fixture(multiple = false) {
  const services = multiple ? [service, { ...service, id: 's2', name: 'Crema', price: 2000, customerDurationMinutes: 45 }] : [service]
  const records = multiple ? [rawService, { ...rawService, id: 's2', name: 'Crema', price: 2000, customerDurationMin: 45, customerDurationMax: 45 }] : [rawService]
  const queries: Prisma.Sql[] = []
  const client = { $queryRaw: async (q: Prisma.Sql) => {
    queries.push(q)
    if (q.text.includes('CURRENT_TIMESTAMP AS now')) return [{ timezone: 'America/Argentina/Buenos_Aires',
      bookingHorizonDays: 30, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: new Date('2026-10-06T15:00:00Z') }]
    if (q.text.includes('runtime-booking-presentation-scope')) return [{ phone: '5491112345678', timezone: 'America/Argentina/Buenos_Aires' }]
    if (q.text.includes('runtime-booking-presentation-services')) return records.filter(s => q.values.includes(s.id))
    if (q.text.includes('runtime-booking-presentation-professionals')) return records.filter(s => q.values.includes(s.id)).map(s => ({ serviceId: s.id, professionalId: 'p1', professionalName: 'Elisa' }))
    throw new Error('unexpected local read ' + q.text)
  } }
  const prepared = await createPrismaDialoguePort(client as unknown as Parameters<typeof createPrismaDialoguePort>[0], 'b')
  let preparations = 0, agenda = 0
  let currentSlot: NonNullable<DialogueState['slot']> = slot
  const port: DialoguePort & Pick<typeof prepared.port, 'prepareRuntimeBooking'> = {
    catalog: async () => services,
    availability: async () => { agenda++; return { professionals: [{ id: 'p1', name: 'Elisa', priority: 0 }], slots: [slot] } },
    availabilityBasket: async () => { agenda++; return { ok: true, services, durationMinutes: services.length * 30, totalPrice: services.reduce((sum, s) => sum + s.price, 0), customerDurationMinutes: multiple ? 75 : 30, professionals: [{ id: 'p1', name: 'Elisa', priority: 0 }], slots: [currentSlot] } },
    prepareRuntimeBooking: async (state, shownScope) => { preparations++; const result=await prepared.port.prepareRuntimeBooking(state, shownScope); if(result)currentSlot=result.slot; return result },
    information: async () => ({ businessId: 'b', name: 'Salón ficticio', address: 'Calle ficticia 123', area: null,
      mapsUrl: null, hours: null, website: null, bookingUrl: null, whatsapp: null, email: null,
      instagram: null, facebook: null, tiktok: null, description: null })
  }
  const context: DialogueContext & { serverRuntimeBookingScope: RuntimeShownScope } = { ...prepared.context, serverRuntimeBookingScope: scope }
  return { context, port, queries, counts: () => ({ preparations, agenda }) }
}

const fx = await fixture(), input = structuredClone(ready)
const proof = await fx.port.prepareRuntimeBooking(input, scope)
assert.ok(proof)
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered)
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reordered(v)]))
  return value
}
assert.deepEqual(parseRuntimePresentedBooking(reordered(proof.presented)), proof.presented, 'JSONB/reordered scope and terms preserve canonical proof')
const origin={kind:'RUNTIME' as const,...scope,revision:5n,canonicalPhone:'5491112345678',operationKey:'event',newBookingAllowed:true}
assert.equal(runtimeBookingRequestHash(origin,reordered(proof.presented) as RuntimePresentedBooking),runtimeBookingRequestHash(origin,proof.presented),'JSONB scope/terms order preserves durable parent request hash')
const maxParent='conversation-booking:'+'x'.repeat(128)+':'+proof.presented.nonce
const childProof=runtimeBookingChildInput(proof.presented,maxParent,0,true)
assert.equal(childProof.operationKey,maxParent+':segment:0')
assert.equal(runtimeBookingChildRequestHash(runtimeBookingChildInput(reordered(proof.presented) as RuntimePresentedBooking,maxParent,0,true)),runtimeBookingChildRequestHash(childProof),'child projection retains exact F7 legacy hash across JSONB')
assert.notEqual(runtimeBookingRequestHash({...origin,canonicalPhone:'5491198765432'},proof.presented),runtimeBookingRequestHash(origin,proof.presented),'different owner never shares authority hash')
assert.equal(runtimeBookingFingerprint(reordered(proof.presented.terms) as typeof proof.presented.terms), proof.presented.fingerprint)
assert.equal(parseRuntimePresentedBooking({...proof.presented,terms:{...proof.presented.terms,customerName:'Otra persona'}}),null, 'changed actual value never shares proof')
const estimated=structuredClone(proof.presented)
estimated.terms.segments[0]!.priceMode='STARTING_AT'
estimated.terms.segments[0]!.priceMinor=1500
estimated.terms.segments[0]!.estimate={optionId:'long',optionLabel:'Cabello largo',priceMin:1500,priceMax:2500}
estimated.terms.totalPriceMinor=null
estimated.fingerprint=runtimeBookingFingerprint(estimated.terms)
assert.ok(parseRuntimePresentedBooking(estimated))
assert.match(runtimeBookingSummary(estimated),/Cabello largo/)
assert.match(runtimeBookingSummary(estimated),/1[.,]500.*2[.,]500/)
assert.match(runtimeBookingSummary(estimated),/estimado/i)
assert.match(runtimeBookingSummary(estimated),/Total a consultar/)
const shown = await respond(fx.context, input, 'Quiero reservar este turno.', fx.port)
const reservation = (shown.state as ReservationState).bookingReservation
assert.ok(reservation, 'runtime proposal must persist the server-owned presented terms without enabling sandbox')
assert.equal(shown.state.sandboxReservation, undefined)
assert.equal(fx.context.sandboxBooking, undefined)
assert.equal(shown.bookingCommand, undefined, 'presentation never executes booking')
assert.deepEqual(input, ready, 'input draft remains immutable')
assert.deepEqual(reservation.presented.scope, scope)
assert.equal(reservation.presented.terms.segments.length, 1)
assert.equal(reservation.presented.terms.segments[0]!.serviceId, 's1')
assert.equal(reservation.presented.terms.totalPriceMinor, 1000)
assert.equal(shown.state.questionContext?.role, 'confirmation')
assert.match(shown.reply, /Corte/)
assert.match(shown.reply, /Elisa/)
assert.match(shown.reply, /30/)
assert.match(shown.reply, /1[.,]?000/)
assert.match(shown.reply, /confirm/i)
assert.doesNotMatch(shown.reply, /turno de prueba|reserva fue confirmada|te esperamos/i)
assert.ok(fx.queries.every(q => !/INSERT|UPDATE|DELETE/.test(q.text)), 'presentation is read-only')
parseDialogueState(shown.state, 'b', fx.context.timezone)

const nextContext = { ...fx.context, serverRuntimeBookingScope: { ...scope, revision: '6' } }
const beforeConfirm = fx.counts()
const confirmed = await respond(nextContext, shown.state, 'Confirmo el turno.', fx.port, semantic('Confirmo el turno.'))
assert.deepEqual(confirmed.bookingCommand, { kind: 'CONFIRM_BOOKING', presented: reservation.presented })
assert.equal(fx.counts().preparations, beforeConfirm.preparations, 'consent uses the ORIGINAL shown envelope, not a new nonce')
assert.equal(fx.counts().agenda, beforeConfirm.agenda, 'the TX adapter, not dialogue, revalidates booking')
assert.deepEqual((confirmed.state as ReservationState).bookingReservation, reservation)
assert.doesNotMatch(confirmed.reply, /reserva fue confirmada|te esperamos|turno de prueba/i)

for (const phrase of ['No confirmes.', 'Sí, pero mejor mañana.', '¿Podés confirmar?', 'Confirmo si el precio no cambia.']) {
  const response = await respond(nextContext, shown.state, phrase, fx.port, semantic(phrase))
  assert.equal(response.bookingCommand, undefined, 'contrary, conditional and interrogative consent has no effects: ' + phrase)
}
assert.equal((await respond(nextContext, shown.state, 'Confirmo.', fx.port, semantic('Confirmo.', 0.7))).bookingCommand, undefined)
assert.equal((await respond(fx.context, ready, 'Confirmo.', fx.port, semantic('Confirmo.'))).bookingCommand, undefined, 'no previously shown terms')
for (const changed of [{ revision: '7' }, { sessionId: 'other' }, { businessId: 'other' }, { handoffFenceEpoch: 5 }, { generation: 3 }]) {
  const context = { ...nextContext, serverRuntimeBookingScope: { ...nextContext.serverRuntimeBookingScope, ...changed } }
  assert.equal((await respond(context, shown.state, 'Confirmo.', fx.port, semantic('Confirmo.'))).bookingCommand, undefined, 'stale/foreign current scope cannot confirm')
}
const noCapability = { ...fx.port }
delete (noCapability as Partial<typeof fx.port>).prepareRuntimeBooking
assert.equal((await respond(nextContext, shown.state, 'Confirmo.', noCapability, semantic('Confirmo.'))).bookingCommand, undefined, 'server capability is required')
const { serverRuntimeBookingScope: _scope, ...unscoped } = nextContext
assert.equal((await respond(unscoped, shown.state, 'Confirmo.', fx.port, semantic('Confirmo.'))).bookingCommand, undefined)

// Lateral queries must either re-present the complete current terms or revoke confirmation;
// keeping an old nonce while silently rebinding its revision is never accepted.
const lateral = await respond(nextContext, shown.state, '¿Dónde queda el salón?', fx.port, { serviceId: null, candidateIds: [], correction: false,
  turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, evidence: 'Dónde queda el salón', confidence: 1 }] } })
assert.equal(lateral.bookingCommand, undefined)
assert.deepEqual(lateral.state.slot, shown.state.slot)
assert.equal(lateral.state.serviceId, shown.state.serviceId)
const refreshed = (lateral.state as ReservationState).bookingReservation
if (refreshed) {
  assert.notEqual(refreshed.presented.nonce, reservation.presented.nonce)
  assert.equal(refreshed.presented.scope.revision, '6')
  assert.match(lateral.reply, /Corte/)
  assert.match(lateral.reply, /Elisa/)
  assert.match(lateral.reply, /confirm/i)
} else assert.notEqual(lateral.state.questionContext?.role, 'confirmation')

const foreignEnvelope = structuredClone(shown.state) as ReservationState
foreignEnvelope.bookingReservation!.presented.scope.businessId = 'foreign'
assert.throws(() => parseDialogueState(foreignEnvelope, 'b', fx.context.timezone))
const mismatched = structuredClone(shown.state) as ReservationState
mismatched.bookingReservation!.presented.fingerprint = 'a'.repeat(64)
assert.throws(() => parseDialogueState(mismatched, 'b', fx.context.timezone))
const unknown = structuredClone(shown.state) as ReservationState
Object.assign(unknown.bookingReservation!, { invented: true })
assert.throws(() => parseDialogueState(unknown, 'b', fx.context.timezone))

// If a button is exposed, it must be the existing real confirm operation and proof.
if (shown.choicePresentation) {
  const choice = shown.choicePresentation.choices.find(c => c.operation.kind === 'confirm')
  assert.ok(choice)
  assert.deepEqual(choice.operation, { kind: 'confirm', nonce: reservation.presented.nonce })
  const chosen = await respondConversationChoice(nextContext, shown.state, choice.operation, fx.port)
  assert.deepEqual(chosen.bookingCommand, confirmed.bookingCommand)
  await assert.rejects(() => respondConversationChoice(nextContext, shown.state, { kind: 'confirm', nonce: 'foreign' }, fx.port))
}
// ALL receipt membership is bounded even before the persisted projection is used.
const receipt = { kind: 'COMMITTED' as const, coordinationGroupId: 'group', proposalNonce: reservation.presented.nonce,
  fingerprint: reservation.presented.fingerprint, appointments: [{ segmentIndex: 0, appointmentId: 'appointment1', visitId: 'visit1' }] }
const committed=finalizeRuntimeBooking(confirmed,{...receipt,businessAddress:'Calle ficticia 123'})
assert.match(committed.reply,/La reserva fue confirmada/)
assert.match(committed.reply,/Te esperamos en Calle ficticia 123/)
assert.doesNotMatch(committed.reply,/Propuesta|otra vez al confirmar|Confirmás/i,'confirmed delivery never asks for another confirmation')
assert.equal(committed.bookingCommand,undefined)
assert.throws(()=>finalizeRuntimeBooking(confirmed,{...receipt,proposalNonce:'foreign'}))
for(const result of [{kind:'REQUOTE' as const},{kind:'BLOCKED' as const,reason:'SCOPE_REJECTED' as const}]) {
  const failed=finalizeRuntimeBooking(confirmed,result)
  assert.equal(failed.state.bookingReservation,undefined)
  assert.equal(failed.state.slot,null)
  assert.equal(failed.state.customerName,'Ana')
  assert.equal(failed.state.serviceId,'s1')
  assert.doesNotMatch(failed.reply,/La reserva fue confirmada|Te esperamos/)
}
const completed: ReservationState = structuredClone(shown.state)
completed.bookingReservation!.receipt = receipt
parseDialogueState(completed, 'b', fx.context.timezone)
const policy = resolveConversationPolicy({ businessId: 'b', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 2,
  configurationId: 'cfg', configurationBusinessId: 'b', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' }, serviceContent: { version: 1, businessId: 'b', services: [] } } })!
assert.ok(policy)
const projection = projectConversationDraft(completed, policy)
assert.equal(projection.booking, 'CONFIRMED')
assert.equal(projection.flow, 'BOOKING_CONFIRMED')
assert.equal(parseBotOptionsState(projection).ok, true)
for (const bad of [{ ...receipt, proposalNonce: 'foreign' }, { ...receipt, fingerprint: 'a'.repeat(64) },
  { ...receipt, appointments: [] }, { ...receipt, appointments: [{ ...receipt.appointments[0]!, segmentIndex: 1 }] },
  { ...receipt, unknown: true }]) {
  const malformed = structuredClone(completed)
  malformed.bookingReservation!.receipt = bad
  assert.throws(() => parseDialogueState(malformed, 'b', fx.context.timezone), 'malformed ALL receipt cannot become confirmed state')
}

const manyFx = await fixture(true)
const manyReady: DialogueState = { ...ready, serviceId: null, slot: { ...slot, occupiedMinutes: 60 },
  basket: { version: 1, nextMemberId: 3, members: [
    { memberId: 'm1', mode: 'single', serviceIds: ['s1'], evidence: 'Corte' },
    { memberId: 'm2', mode: 'single', serviceIds: ['s2'], evidence: 'Crema' }] } }
const normalized = await manyFx.port.prepareRuntimeBooking(manyReady, scope)
assert.ok(normalized, 'production builder normalizes a real common-professional multi-service assignment')
manyReady.slot = normalized.slot
const manyShown = await respond(manyFx.context, manyReady, 'Quiero reservar ambos servicios.', manyFx.port)
const manyReservation = (manyShown.state as ReservationState).bookingReservation
assert.ok(manyReservation)
assert.equal(manyReservation.presented.terms.segments.length, 2)
assert.deepEqual(manyReservation.presented.terms.segments.map(s => s.serviceId), ['s1', 's2'])
assert.match(manyShown.reply, /Corte/)
assert.match(manyShown.reply, /Crema/)
assert.equal(manyShown.bookingCommand, undefined)
const manyComplete = structuredClone(manyShown.state) as ReservationState
const manyReceipt = { ...receipt, proposalNonce: manyReservation.presented.nonce, fingerprint: manyReservation.presented.fingerprint,
  appointments: [{ segmentIndex: 0, appointmentId: 'appointment1', visitId: 'visit1' },
    { segmentIndex: 1, appointmentId: 'appointment2', visitId: 'visit2' }] }
manyComplete.bookingReservation!.receipt = manyReceipt
parseDialogueState(manyComplete, 'b', manyFx.context.timezone)
for (const appointments of [manyReceipt.appointments.slice(0, 1),
  [manyReceipt.appointments[1]!, manyReceipt.appointments[0]!],
  [manyReceipt.appointments[0]!, { ...manyReceipt.appointments[1]!, appointmentId: 'appointment1' }],
  [manyReceipt.appointments[0]!, { ...manyReceipt.appointments[1]!, visitId: 'visit1' }],
  [...manyReceipt.appointments, { segmentIndex: 2, appointmentId: 'rogue', visitId: 'rogueVisit' }]]) {
  const malformed = structuredClone(manyComplete)
  malformed.bookingReservation!.receipt = { ...manyReceipt, appointments }
  assert.throws(() => parseDialogueState(malformed, 'b', manyFx.context.timezone), 'partial, reordered, duplicate or extra receipt rejected')
}
assert.equal(projectConversationDraft(manyComplete, policy).booking, 'CONFIRMED')
console.log('runtime presentation/consent/current scope/lateral/parser/ALL receipt/projection: OK')
