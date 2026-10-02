import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialogueDecision, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA, type TurnOperation, type TurnPlan } from '../src/conversational-bot/turn-plan.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

const context = { businessId: 'trusted-tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T15:00:00Z') }
const services: DialogueService[] = [
  { id: 'cut', name: 'Corte Hombre', durationMinutes: 30, requiresConsultation: false, price: 5000 },
  { id: 'color', name: 'Color', durationMinutes: 60, requiresConsultation: false, price: 8000 }
]
const professionals = [{ id: 'ana', name: 'Ana', priority: 0 }, { id: 'luz', name: 'Luz', priority: 1 }]
const facts: BusinessFacts = { businessId: context.businessId, name: 'Local', address: 'Calle Uno 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Lunes a viernes de 9 a 20' }
let calls = { availability: 0, information: 0 }
const slot = (date: string, id = 'ana', time = '17:00') => ({ startAt: `${date}T${String(Number(time.slice(0, 2)) + 3).padStart(2, '0')}:${time.slice(3)}:00.000Z`, date, time, professionalId: id, professionalName: id === 'ana' ? 'Ana' : 'Luz', band: 'AFTERNOON' as const, occupiedMinutes: 0 })
const port: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date, id) => { calls.availability++; return { professionals, slots: professionals.flatMap(p => ['17:00', '18:00'].map(time => slot(date, p.id, time))).filter(s => !id || s.professionalId === id) } },
  information: async () => { calls.information++; return facts }
}
const ev = (evidence: string) => ({ evidence, confidence: 0.99 })
const date = (expression: string, value?: string): TurnOperation => ({ kind: 'date', expression, ...ev(expression), ...(value ? { value } : {}) })
const time = (evidence = '17hs', value = '17:00'): TurnOperation => ({ kind: 'time', value, ...ev(evidence) })
const prof = (mention = 'Ana'): TurnOperation => ({ kind: 'professional', mode: 'specific', mention, ...ev(mention) })
const info = (evidence = 'dirección', action: 'ADDRESS' | 'HOURS' = 'ADDRESS'): TurnOperation => ({ kind: 'information', target: { kind: 'business', actions: [action] }, ...ev(evidence) })
const name = (value = 'Matias'): TurnOperation => ({ kind: 'name', value, ...ev(value) })
const service = (mode: 'single' | 'alternatives' | 'multiple' = 'single'): Extract<TurnOperation, { kind: 'service' }> => ({ kind: 'service', mode, serviceIds: mode === 'single' ? ['cut'] : ['cut', 'color'], correction: false, ...ev(mode === 'single' ? 'Corte' : 'Corte y Color') })
const decision = (operations: readonly TurnOperation[], intent: DialogueDecision['intent'] = 'other'): DialogueDecision => ({ serviceId: null, candidateIds: [], correction: false, intent, turnPlan: { version: 1, operations } })
const initial = () => initialDialogueState(context.businessId)
const base = (pending: DialogueState['pending'] = 'time'): DialogueState => ({ ...initial(), serviceId: 'cut', date: '2026-10-01', professional: { kind: 'specific', id: 'ana' }, pending, ...(pending === 'name' || pending === 'proposal' ? { slot: slot('2026-10-01'), requestedTime: '17:00' } : {}), ...(pending === 'proposal' ? { customerName: 'Matias' } : {}) })
async function say(state: DialogueState, message: string, operations: readonly TurnOperation[], selectedPort = port) { return respond(context, state, message, selectedPort, decision(operations)) }

// Query targets refer to the pre-turn evidence; repeated unchanged preferences are not corrections.
const edgeChecks = await Promise.allSettled([
  (async () => {
    const saturdayShown: DialogueState = { ...base('name'), date: '2026-10-03', slot: slot('2026-10-03'), dialogueContext: { lastQuestion: '¿A nombre de quién sería el turno?', presentedOffer: { businessId: context.businessId, serviceId: 'cut', date: '2026-10-03', professionalId: 'ana' } } }
    const changed = await say(saturdayShown, 'esos horarios, mejor el viernes', [{ kind: 'information', target: { kind: 'presented_offer', actions: [] }, ...ev('esos horarios') }, date('el viernes')])
    assert.match(changed.reply, /corresponden a sábado 03\/10/, 'reference facts describe the actually shown pre-turn offer')
    assert.match(changed.reply, /Horarios disponibles para viernes 02\/10/)
    assert.equal(changed.state.date, '2026-10-02'); assert.equal(changed.state.slot, null); assert.equal(changed.state.requestedTime, null)
    assert.equal(changed.state.dialogueContext?.presentedOffer?.date, '2026-10-02')
    assert.equal(changed.proposal, null)
  })(),
  (async () => {
    const ramiro = { id: 'ramiro', name: 'Ramiro', priority: 0 }
    const ramiroSlot = { ...slot('2026-10-01'), professionalId: ramiro.id, professionalName: ramiro.name }
    const ramiroPort: DialoguePort = { ...port, availability: async () => ({ professionals: [ramiro], slots: [ramiroSlot] }) }
    for (const hint of [null, 'ramiro']) {
      const previous: DialogueState = { ...base('name'), professional: { kind: 'specific', id: ramiro.id }, professionalNameHint: hint, slot: ramiroSlot }
      const completed = await say(previous, 'con Ramiro, soy Matias', [prof('Ramiro'), name()], ramiroPort)
      assert.equal(completed.proposal?.startAt, ramiroSlot.startAt, 'repeated same preference preserves the verified chosen time')
      assert.equal(completed.proposal?.customerName, 'Matias'); assert.equal(completed.state.pending, 'proposal'); assert.equal(completed.state.requestedTime, '17:00')
    }
  })()
])
assert.deepEqual(edgeChecks.map(result => result.status), ['fulfilled', 'fulfilled'], edgeChecks.map(result => result.status === 'rejected' ? String(result.reason) : 'PASS').join('\n'))

// Semantic fields are independently applied before deciding which booking field is still missing.
for (const pending of ['service', 'date', 'professional', 'time', 'name', 'proposal'] as const) {
  const previous = pending === 'service' ? initial() : pending === 'date' ? { ...base(), date: null, pending } : pending === 'professional' ? { ...base(), professional: null, pending } : base(pending)
  const message = 'dirección, Corte mañana 17hs con Luz, soy Matias'
  const r = await say(previous, message, [info(), service(), date('mañana'), time(), prof('Luz'), name()])
  assert.equal(r.state.date, '2026-10-02', pending)
  assert.equal(r.state.requestedTime, '17:00', pending)
  assert.equal(r.state.professional?.kind === 'specific' ? r.state.professional.id : null, 'luz', pending)
  assert.equal(r.state.customerName, 'Matias', pending)
  assert.equal(r.state.pending, 'proposal', pending)
  assert.equal(r.proposal?.startAt, slot('2026-10-02', 'luz').startAt, pending)
  assert.match(r.reply, /Calle Uno 123/, pending)
  assert.match(r.reply, /Todavía no está reservado/, pending)
}
const hours = await say(base('name'), 'horario de atención mañana con Ana', [info('horario de atención', 'HOURS'), date('mañana'), prof()])
assert.match(hours.reply, /Lunes a viernes/)
assert.equal(hours.state.date, '2026-10-02')
assert.equal(hours.state.slot, null, 'old selected time must not silently carry into a correction')
assert.equal(hours.state.requestedTime, null)
assert.equal(hours.state.pending, 'time')
assert.match(hours.reply, /Horarios disponibles/)
assert.equal(hours.state.dialogueContext?.presentedOffer?.date, '2026-10-02')

const chosen = await say(base(), '17:00', [time('17:00')])
assert.equal(chosen.state.pending, 'name')
const named = await say(chosen.state, 'Matias', [name()])
assert.equal(named.state.pending, 'proposal', 'bare identity bypasses global other-intent gate')
assert.equal(named.proposal?.customerName, 'Matias', 'the name is supplied exactly once')
const semanticTime = await say(base(), 'cinco de la tarde', [time('cinco de la tarde')])
assert.equal(semanticTime.state.pending, 'name', 'semantic canonical time is not tied to an enumerated numeric phrase regex')

// Do not discard independent preferences when the service is unresolved or not selected yet.
let early = (await say(initial(), 'mañana 17hs con Ana, soy Matias', [date('mañana'), time(), prof(), name()])).state
assert.equal(early.pending, 'service'); assert.equal(early.requestedTime, '17:00'); assert.equal(early.professionalNameHint, 'ana'); assert.equal(early.customerName, 'Matias')
early = (await say(early, 'Corte', [service()])).state
assert.equal(early.pending, 'proposal', 'filling the missing service preserves earlier explicit preferences')
let anyEarly = (await say(initial(), 'mañana 17hs sin preferencia, soy Matias', [date('mañana'), time(), { kind: 'professional', mode: 'any', ...ev('sin preferencia') }, name()])).state
assert.equal(anyEarly.professional?.kind, 'any'); assert.equal(anyEarly.serviceId, null)
anyEarly = (await say(anyEarly, 'Corte', [service()])).state
assert.equal(anyEarly.pending, 'proposal', 'early any preference survives first service fill without trusting a specific ID')
const alternative = await say(initial(), 'Corte y Color mañana 17hs con Ana, soy Matias', [service('alternatives'), date('mañana'), time(), prof(), name()])
assert.equal(alternative.state.pending, 'service'); assert.equal(alternative.state.serviceId, null)
assert.equal(alternative.state.requestedTime, '17:00'); assert.equal(alternative.state.customerName, 'Matias'); assert.equal(alternative.state.professionalNameHint, 'ana')
assert.match(alternative.reply, /Cuál de estos servicios/)
const multiple = await say(initial(), 'Corte y Color mañana 17hs con Ana, soy Matias', [service('multiple'), date('mañana'), time(), prof(), name()])
assert.equal(multiple.state.serviceId, null, 'a multiple-service request never silently books only one')
assert.equal(multiple.proposal, null); assert.match(multiple.reply, /No pude verificar.*conjunta/i)
assert.equal(multiple.state.date, '2026-10-02'); assert.equal(multiple.state.customerName, 'Matias')

const longMention = (await say(initial(), 'con Juan Manuel de la Cruz 17hs', [prof('Juan Manuel de la Cruz'), time()])).state
assert.equal(longMention.professionalNameHint, 'juan manuel de la cruz')
assert.equal(parseDialogueState(longMention, context.businessId).requestedTime, '17:00', 'semantic multi-word hints fit the unchanged v1 snapshot')
const onlyTime = (await say(initial(), '17hs', [time()])).state
assert.match((await say(onlyTime, 'dirección', [info()])).reply, /Qué servicio/, 'information resumes an early time preference too')

// Unknown requested services are represented explicitly, without fabricating a catalog ID.
const unresolved = (correction: boolean): TurnOperation => ({ kind: 'service', mode: 'unresolved', serviceIds: [], correction, ...ev('masaje') })
for (const previous of [initial(), base('proposal')]) {
  const unknown = await say(previous, 'dirección, masaje mañana 17hs con Luz, soy Matias', [info(), unresolved(true), date('mañana'), time(), prof('Luz'), name()])
  assert.equal(unknown.state.serviceId, null); assert.equal(unknown.state.slot, null); assert.equal(unknown.state.pending, 'service'); assert.equal(unknown.proposal, null)
  assert.equal(unknown.state.date, '2026-10-02'); assert.equal(unknown.state.requestedTime, '17:00'); assert.equal(unknown.state.professionalNameHint, 'luz'); assert.equal(unknown.state.customerName, 'Matias')
  assert.match(unknown.reply, /No pude identificar ese servicio/); assert.match(unknown.reply, /Calle Uno 123/); assert.doesNotMatch(unknown.reply, /no ofrecemos|Propuesta:/i)
}
const priorAgendaReads = calls.availability
const unresolvedNoCorrection = await say(base('proposal'), 'masaje', [unresolved(false)])
assert.equal(unresolvedNoCorrection.state.serviceId, 'cut', 'an unresolved mention alone is not authority to replace a valid selection')
assert.equal(unresolvedNoCorrection.state.pending, 'service'); assert.equal(unresolvedNoCorrection.proposal, null); assert.equal(calls.availability, priorAgendaReads)
assert.match(unresolvedNoCorrection.reply, /No pude identificar ese servicio/); assert.doesNotMatch(unresolvedNoCorrection.reply, /Propuesta:|Horarios disponibles/)

// Read-only operations never query agenda or publish an old proposal.
calls = { availability: 0, information: 0 }
const isolated = await say(initial(), 'dirección', [info()])
assert.equal(calls.availability, 0); assert.equal(isolated.proposal, null); assert.doesNotMatch(isolated.reply, /Qué servicio/)
const activeInfo = await say(base('proposal'), 'dirección', [info()])
assert.equal(calls.availability, 0); assert.equal(activeInfo.proposal, null); assert.match(activeInfo.reply, /propuesta sigue pendiente/i)
const shown = { ...base(), dialogueContext: { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: context.businessId, serviceId: 'cut', date: '2026-10-01', professionalId: 'ana' } } }
const reference = await say(shown, '¿Esos horarios eran para mañana?', [{ kind: 'information', target: { kind: 'presented_offer', actions: [] }, ...ev('Esos horarios') }])
assert.equal(reference.state.date, '2026-10-01', 'reference question cannot reparse mañana as a date correction')
assert.equal(calls.availability, 0); assert.equal(reference.proposal, null); assert.match(reference.reply, /jueves 01\/10/)
const mixedReference = await say(shown, 'Esos horarios, mejor mañana 18:00', [{ kind: 'information', target: { kind: 'presented_offer', actions: [] }, ...ev('Esos horarios') }, date('mañana'), time('18:00', '18:00')])
assert.equal(mixedReference.state.date, '2026-10-02'); assert.match(mixedReference.reply, /corresponden a jueves 01\/10/)

const failedInfo = await say(base('name'), 'dirección mañana 17hs con Luz', [info(), date('mañana'), time(), prof('Luz')], { ...port, information: async () => { throw new Error('offline') } })
assert.equal(failedInfo.state.date, '2026-10-02'); assert.equal(failedInfo.state.slot?.professionalId, 'luz'); assert.match(failedInfo.reply, /No pude consultar/)
for (const action of ['CANCEL', 'RESCHEDULE', 'HUMAN_HANDOFF'] as const) {
  const unavailable = await say(base('proposal'), 'solicitud al equipo', [{ kind: 'unsupported_action', action, ...ev('solicitud') }])
  assert.deepEqual(unavailable.state, base('proposal')); assert.equal(unavailable.proposal, null); assert.match(unavailable.reply, /todavía no está disponible/)
}
const combinedReads = await say(shown, 'dirección, esos horarios, cancelar y reprogramar', [info(), { kind: 'information', target: { kind: 'presented_offer', actions: [] }, ...ev('esos horarios') }, { kind: 'unsupported_action', action: 'CANCEL', ...ev('cancelar') }, { kind: 'unsupported_action', action: 'RESCHEDULE', ...ev('reprogramar') }])
assert.match(combinedReads.reply, /Calle Uno 123/); assert.match(combinedReads.reply, /jueves 01\/10/); assert.equal(combinedReads.proposal, null)
const mixedUnsupported = await say(base('name'), 'Matias, cancelar y dirección', [name(), { kind: 'unsupported_action', action: 'CANCEL', ...ev('cancelar') }, info()])
assert.equal(mixedUnsupported.proposal?.customerName, 'Matias'); assert.match(mixedUnsupported.reply, /todavía no está disponible/); assert.match(mixedUnsupported.reply, /Calle Uno 123/)
const unavailableTime = await say(base(), '23hs', [time('23hs', '23:00')])
assert.equal(unavailableTime.state.slot, null); assert.equal(unavailableTime.state.pending, 'time'); assert.equal(unavailableTime.proposal, null)
const unknownProfessional = await say(base(), 'con Extranjero 17hs', [prof('Extranjero'), time()])
assert.equal(unknownProfessional.state.professional, null); assert.equal(unknownProfessional.state.pending, 'professional'); assert.equal(unknownProfessional.state.requestedTime, '17:00')

// Invalid present plans fail closed, never fall back to lexical service or old slot/proposal.
const plan = (operations: unknown[]) => ({ version: 1, operations })
const expectBad = (value: unknown, message = 'Corte mañana 17hs Matias') => assert.throws(() => parseTurnPlan(value, message), /turn plan/i)
expectBad({ version: 2, operations: [] }); expectBad({ ...plan([]), tenant: 'foreign' })
expectBad(plan([{ ...time(), extra: 'unsafe' }])); expectBad(plan([time(), time()]))
expectBad(plan([{ ...time(), value: '24:00' }])); expectBad(plan([{ ...time(), value: '17:60' }]))
expectBad(plan([{ ...name(), value: 'Mat' }])); expectBad(plan([prof()]), 'mañana'); expectBad(plan([{ ...name(), evidence: 'absent' }])); expectBad(plan([{ ...name(), value: 'Foreign' }]))
expectBad(plan([{ ...service(), mode: 'unresolved' }])); expectBad(plan([{ ...service(), confidence: 1.1 }])); expectBad(plan([{ ...service(), serviceIds: ['cut', 'cut'] }]))
expectBad(plan([{ kind: 'unsupported_action', action: 'CREATE_BOOKING', ...ev('Corte') }]))
expectBad(plan([{ kind: 'information', target: { kind: 'business', actions: ['CREATE_BOOKING'] }, ...ev('Corte') }]))
expectBad(plan([date('mañana', '2026-02-31')])); expectBad(plan(Array.from({ length: 9 }, () => time())))
await assert.rejects(() => respond(context, base('proposal'), 'Corte', port, { ...decision([]), turnPlan: { version: 1, operations: [{ ...service(), serviceIds: ['foreign'] }] } }), /turn plan.*catalog/i)
await assert.rejects(() => respond(context, base('proposal'), 'Matias', port, { ...decision([]), turnPlan: { version: 1, operations: [{ ...name(), bad: true }] } } as unknown as DialogueDecision), /turn plan/i)
for (const expression of ['31/02/2027', 'hoy mañana', 'el martes que viene']) {
  const uncertain = await say(base('name'), expression, [date(expression)])
  assert.equal(uncertain.state.date, null); assert.equal(uncertain.state.slot, null); assert.equal(uncertain.proposal, null); assert.equal(uncertain.state.pending, 'date')
}
const conflictingCanonical = await say(base('name'), 'mañana', [date('mañana', '2026-10-03')])
assert.equal(conflictingCanonical.state.date, null, 'authoritative clock/date resolver rejects canonical contradiction')
const semanticDate = await say(base(), 'en dos días 17hs', [date('en dos días', '2026-10-03'), time()])
assert.equal(semanticDate.state.date, '2026-10-03', 'unrecognized semantic expression can carry a validated canonical calendar date')
const pastCanonical = await say(base('name'), 'en septiembre', [date('en septiembre', '2026-09-30')])
assert.equal(pastCanonical.state.date, null); assert.equal(pastCanonical.proposal, null)
const lowConfidence = await say(initial(), 'Corte', [{ ...service(), confidence: 0.4 }])
assert.equal(lowConfidence.state.serviceId, 'cut', 'confidence metadata does not introduce an arbitrary threshold')
assert.deepEqual(parseTurnPlan({ version: 1, operations: [{ ...date('mañana'), value: null }] }, 'mañana'), { version: 1, operations: [date('mañana')] })
assert.equal((TURN_PLAN_JSON_SCHEMA as any).additionalProperties, false)
assert.deepEqual(parseTurnPlan({ version: 1, operations: [] }, 'hola'), { version: 1, operations: [] } satisfies TurnPlan)
console.log('conversational bot turn plan: validation, modular updates, read-only facts and capability boundaries PASS')
