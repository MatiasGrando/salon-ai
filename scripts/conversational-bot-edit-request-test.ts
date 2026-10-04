import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, respondConversationChoice, type DialogueContext, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { expectedDialogueAnswer } from '../src/conversational-bot/dialogue-context.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import type { ConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
const context: DialogueContext = { businessId: 'qa-edit-private', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T12:00:00Z'), sandboxBooking: true }
const services: DialogueService[] = [
  { id: 'cut', name: 'Corte hombre', price: 27000, durationMinutes: 30, requiresConsultation: false },
  { id: 'woman', name: 'Corte mujer', price: 37000, durationMinutes: 30, requiresConsultation: false },
  { id: 'combo', name: 'Corte y barba', price: 32000, durationMinutes: 45, requiresConsultation: false },
  { id: 'smooth', name: 'Alisado', price: 85000, durationMinutes: 90, requiresConsultation: false }
]
for (const service of services) service.bookingPolicy = { id: service.id, name: service.name, price: service.price, priceMode: 'FIXED', attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: false, estimateQuestion: null, estimateOptions: [], estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }, { id: 'cin', name: 'Cin', priority: 0 }]
const slot = (date: string, id = 'ramiro') => ({ date, time: '17:00', startAt: date + 'T20:00:00.000Z', professionalId: id, professionalName: id === 'ramiro' ? 'Ramiro' : 'Cin', band: 'AFTERNOON' as const, occupiedMinutes: 0 })
let queries = 0
const port: DialoguePort = { catalog: async () => services,
  availability: async (_service, date, id) => { queries++; return { professionals, slots: [slot(date, id)] } },
  availabilityBasket: async (selected, date, id) => { queries++; return { ok: true, services: selected, durationMinutes: selected.reduce((sum, s) => sum + s.durationMinutes!, 0), totalPrice: selected.reduce((sum, s) => sum + s.price!, 0), professionals, slots: [slot(date, id)] } },
  information: async () => ({ businessId: context.businessId, name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, hours: 'Martes 11:00 a 20:00', website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null }) }
const initial = () => initialDialogueState(context.businessId)
const base: DialogueState = { ...initial(), serviceId: 'cut', date: '2026-10-02', professional: { kind: 'specific', id: 'ramiro' }, requestedTime: '17:00', slot: slot('2026-10-02'), customerName: 'Matías', pending: 'proposal' }
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const edit = (field: string, evidence: string) => ({ kind: 'request_change', field, ...ev(evidence) })
const say = (state: DialogueState, message: string, operations: object[], selectedPort = port) => respond(context, state, message, selectedPort, { serviceId: null, candidateIds: [], correction: false, turnPlan: parseTurnPlan({ version: 1, operations }, message, services.map(s => s.id)) })
const snapshot = (state: DialogueState) => ({ basket: state.basket, serviceId: state.serviceId, date: state.date, professional: state.professional, requestedTime: state.requestedTime, slot: state.slot, customerName: state.customerName })
const shown = await respond(context, base, 'Matías', port)
assert.ok(shown.state.sandboxReservation)
for (const [field, phrase] of [['service', 'quiero cambiar el servicio'], ['date', 'quiero cambiar el día'], ['professional', 'quiero cambiar el profesional'], ['time', 'quiero cambiar el horario'], ['name', 'quiero cambiar el nombre']] as const) {
  const before = queries
  const asked = await say(shown.state, phrase, [edit(field, phrase)])
  assert.equal(queries, before, 'requesting an edit without a value does not consult agenda')
  assert.deepEqual(snapshot(asked.state), snapshot(shown.state), 'requesting an edit preserves every draft value')
  assert.equal(asked.state.pending, field)
  assert.deepEqual((asked.state as any).editRequest, { fields: [field] })
  assert.equal(expectedDialogueAnswer(asked.state).field, field)
  assert.equal(asked.state.sandboxReservation, undefined)
  assert.equal(asked.proposal, null); assert.equal(asked.bookingCommand, undefined)
  parseDialogueState(asked.state, context.businessId, context.timezone)
  const attempted = await say(asked.state, 'sí', [{ kind: 'confirm_proposal', ...ev('sí') }])
  assert.equal(attempted.bookingCommand, undefined); assert.equal(attempted.proposal, null)
  await assert.rejects(() => respondConversationChoice(context, asked.state, { kind: 'confirm', nonce: shown.state.sandboxReservation!.presented.nonce }, port), /choice|opción|operation|unavailable/i)
}
for (const [field, message, operation] of [
  ['professional', 'Cin', { kind: 'professional', mode: 'specific', mention: 'Cin', ...ev('Cin') }],
  ['time', '17:00', { kind: 'time', value: '17:00', ...ev('17:00') }],
  ['name', 'Lucía', { kind: 'name', value: 'Lucía', ...ev('Lucía') }]
] as const) {
  const editing = await say(shown.state, 'cambiar ' + field, [edit(field, 'cambiar ' + field)])
  const resolved = await say(editing.state, message, [operation])
  assert.equal(resolved.state.editRequest, undefined, 'an actual value resolves the requested edit regardless of the old proposal step')
  assert.equal(resolved.state.date, base.date); assert.equal(resolved.state.serviceId, base.serviceId)
  if (field === 'professional') assert.deepEqual(resolved.state.professional, { kind: 'specific', id: 'cin' })
  if (field === 'name') assert.equal(resolved.state.customerName, 'Lucía')
}
const aiEdit = await respondWithAiInterpreter(context, shown.state, 'quiero cambiar el servicio', port,
  async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [edit('service', 'quiero cambiar el servicio')] } }))
assert.equal(aiEdit.interpretation.validation!.outcome, 'accepted')
assert.deepEqual(snapshot(aiEdit.state), snapshot(shown.state))
assert.deepEqual(aiEdit.interpretation.turnOutcome!.requestedChanges, ['service'])
const asked = await say(shown.state, 'cambiar servicio y fecha', [edit('service', 'servicio'), edit('date', 'fecha')])
assert.deepEqual((asked.state as any).editRequest.fields, ['service', 'date'])
const typedChanged = await respondConversationChoice(context, asked.state, { kind: 'service', serviceId: 'woman' }, port)
assert.equal(typedChanged.state.serviceId, 'woman'); assert.equal(typedChanged.state.pending, 'date')
assert.deepEqual((typedChanged.state as any).editRequest.fields, ['date'])
parseDialogueState(typedChanged.state, context.businessId, context.timezone)
const changed = await say(asked.state, 'Corte mujer', [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'single', serviceIds: ['woman'], ...ev('Corte mujer') }], ...ev('Corte mujer') }])
assert.equal(changed.state.serviceId, 'woman'); assert.equal(changed.state.date, base.date)
assert.equal(changed.state.slot, null); assert.equal(changed.state.customerName, 'Matías')
assert.deepEqual((changed.state as any).editRequest.fields, ['date']); assert.equal(changed.state.pending, 'date')
assert.deepEqual((changed as any).turnOutcome.changedFields, ['service', 'time'])
assert.deepEqual(changed.turnOutcome!.appliedFields, ['service'], 'dependency invalidation is not an explicit change of time')
const dated = await say(changed.state, 'mejor el sábado', [{ kind: 'date', expression: 'el sábado', ...ev('el sábado') }])
assert.deepEqual(dated.turnOutcome!.appliedFields, ['date']); assert.equal(dated.state.date, '2026-10-03'); assert.equal((dated.state as any).editRequest, undefined)
const lateral = await say(asked.state, 'dónde están', [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dónde están') }])
assert.deepEqual((lateral.state as any).editRequest, (asked.state as any).editRequest)
assert.deepEqual(snapshot(lateral.state), snapshot(asked.state)); assert.match(lateral.reply, /Calle 123/)
assert.throws(() => parseTurnPlan({ version: 1, operations: [edit('proposal', 'cambiar')] }, 'cambiar'), /turn plan/)
assert.throws(() => parseTurnPlan({ version: 1, operations: [edit('date', 'día'), { kind: 'date', expression: 'mañana', ...ev('mañana') }] }, 'día mañana'), /turn plan/)
assert.throws(() => parseDialogueState({ ...base, editRequest: { fields: ['unknown'] } }, context.businessId), /edit/)
const policy: ConversationPolicy = { businessId: context.businessId, generation: 1, deploymentId: 'edit-test', configurationId: 'edit-test-config' }
assert.deepEqual((readConversationDraft(projectConversationDraft(asked.state, policy), policy, context.timezone) as any).editRequest, (asked.state as any).editRequest)
const multiple = { ...base, serviceId: null, basket: { version: 1 as const, nextMemberId: 3, members: [{ memberId: 'm1', mode: 'single' as const, serviceIds: ['woman'], evidence: 'Corte mujer' }, { memberId: 'm2', mode: 'single' as const, serviceIds: ['smooth'], evidence: 'Alisado' }] } }
const only = await say(multiple, 'mejor solamente alisado', [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'single', serviceIds: ['smooth'], ...ev('alisado') }], ...ev('solamente alisado') }])
assert.deepEqual(basketServiceIds(only.state), ['smooth']); assert.equal(only.state.customerName, base.customerName)
const preferredPort: DialoguePort = { ...port, availabilityBasket: async (selected, date, id) => id === 'ramiro' ? { ok: false, reason: 'PREFERRED_PROFESSIONAL_INCOMPATIBLE', professionals: [professionals[1]!] } as any : { ok: true, services: selected, durationMinutes: 30, totalPrice: 37000, professionals: [professionals[1]!], slots: [slot(date, 'cin')] } }
const mismatch = await say(shown.state, 'mejor Corte mujer', [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'single', serviceIds: ['woman'], ...ev('Corte mujer') }], ...ev('Corte mujer') }], preferredPort)
assert.equal(mismatch.state.serviceId, 'woman'); assert.equal(mismatch.state.date, base.date); assert.equal(mismatch.state.customerName, base.customerName)
assert.deepEqual(mismatch.state.professional,{kind:'specific',id:'ramiro'},'preserve requested preference without replacing it'); assert.equal(mismatch.state.pending, 'professional'); assert.match(mismatch.reply, /Cin/)
assert.equal(mismatch.availability?.reason, 'PREFERRED_PROFESSIONAL_INCOMPATIBLE')
assert.equal((mismatch as any).turnOutcome.rejectedProfessionalPreference, true)
const provider = (async (input: any) => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'alternatives', serviceIds: ['cut', 'woman'], ...ev(input.message) }], ...ev(input.message) }] } })) as AiInterpretationProvider
const ambiguous = await respondWithAiInterpreter(context, initial(), 'corte de pelo', port, provider)
assert.deepEqual(ambiguous.state.basket!.members[0]!.serviceIds, ['cut', 'woman', 'combo'])
const precise = await respondWithAiInterpreter(context, initial(), 'corte hombre', port, async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'single', serviceIds: ['cut'], ...ev('corte hombre') }], ...ev('corte hombre') }] } }))
assert.deepEqual(precise.state.basket!.members[0]!.serviceIds, ['cut'])
const vehicleServices = ['Revisión básica', 'Revisión completa', 'Revisión y filtros'].map((name, index) => ({ ...services[0]!, id: 'v' + index, name }))
const vehicle = await respondWithAiInterpreter(context, initial(), 'revisión del vehículo', { ...port, catalog: async () => vehicleServices },
  async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [],
      members: [{ mode: 'alternatives', serviceIds: ['v0', 'v1'], ...ev('revisión del vehículo') }], ...ev('revisión del vehículo') }] } }))
assert.deepEqual(vehicle.state.basket!.members[0]!.serviceIds, ['v0', 'v1', 'v2'], 'catalog ambiguity is neutral across business categories')
const preciseAlternatives = await respondWithAiInterpreter(context, initial(), 'corte hombre o corte mujer', port, provider)
assert.deepEqual(preciseAlternatives.state.basket!.members[0]!.serviceIds, ['cut', 'woman'], 'explicit alternatives do not broaden to another service')
assert.deepEqual(ambiguous.interpretation.turnOutcome, ambiguous.turnOutcome)
assert.equal(JSON.stringify(ambiguous.interpretation.turnOutcome).includes('cut'), false, 'turn outcome carries enum fields, never catalog IDs')
let request: any
const http = createOpenAiInterpretationProvider({ apiKey: 'fake', fetchImpl: async (_url, init) => { request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [] } }) }] }] }), { status: 200 }) } })
await http({ message: 'cambiar', state: asked.state, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request.input).editRequest, (asked.state as any).editRequest)
assert.match(request.instructions, /request_change/)
const receiptState = structuredClone(shown.state)
receiptState.sandboxReservation!.receipt = { appointmentId: 'simqa_appointment_test', proposalNonce: receiptState.sandboxReservation!.presented.nonce, fingerprint: receiptState.sandboxReservation!.presented.fingerprint }
const confirmed = await say(receiptState, 'cambiar servicio', [edit('service', 'cambiar servicio')])
assert.deepEqual(confirmed.state, receiptState); assert.equal((confirmed.state as any).editRequest, undefined)
assert.match(confirmed.reply, /ya reservado/)
console.log('conversational edit request: draft preservation, queued edits, consent, compatibility, grounding and boundaries PASS')