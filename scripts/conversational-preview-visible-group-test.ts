import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { storePreviewChoiceState, readPreviewChoiceState } from '../src/conversational-bot/preview-choice.js'
import { PreviewTurnGroupError, parsePreviewTurnGroupInput } from '../src/conversational-bot/preview-turn-group.js'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const source = (name: string) => {
  const match = ui.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n    \\}'))
  assert.ok(match); return match[0]
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)) }
const rows = new Map<string, any>(), messages: any[] = []
let failCommit = false
const lookup = ({ where }: any) => structuredClone(rows.get(where.id ?? where.businessId_phone.businessId + ':' + where.businessId_phone.phone) ?? null)
const client: any = {
  user: { findUnique: async () => ({ id: 'admin', role: 'SUPER_ADMIN', isActive: true }) },
  business: { findFirst: async () => ({ id: 'qa', isDemo: true, demoType: 'QA_SANDBOX' }) },
  conversation: { findUnique: async (args: any) => lookup(args) },
  async $transaction(work: any) {
    const before = structuredClone(rows), count = messages.length
    const tx = {
      conversation: {
        upsert: async ({ where, create }: any) => {
          const key = create.businessId + ':' + where.businessId_phone.phone
          if (!rows.has(key)) rows.set(key, { id: key, businessId: create.businessId, phone: where.businessId_phone.phone, supportBotKey: null, supportBotState: null })
          return rows.get(key)
        },
        findUnique: async (args: any) => lookup(args),
        update: async ({ where, data }: any) => { Object.assign(rows.get(where.id), data); if (failCommit) throw new Error('commit failed') }
      },
      message: { create: async ({ data }: any) => { messages.push(data) } },
      $queryRaw: async (query: any) => query.text.includes('FROM "User"') ? [{ id: 'admin', role: 'SUPER_ADMIN', isActive: true }] : query.text.includes('FROM "Business"') ? [{ id: 'qa', isDemo: true, demoType: 'QA_SANDBOX' }] : [{ id: 'locked' }]
    }
    try { return await work(tx) } catch (error) { rows.clear(); for (const [key, value] of before) rows.set(key, value); messages.splice(count); throw error }
  }
}
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z') }
const service = { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 27000, requiresConsultation: false }
const slot = { startAt: '2026-10-03T20:00:00.000Z', date: '2026-10-03', time: '17:00', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
const port = {
  catalog: async () => [service],
  identity: async () => ({ businessId: 'qa', businessName: 'Comercio configurado', assistantName: 'Ada', treatment: 'vos' as const }),
  availability: async () => ({ professionals: [{ id: 'cin', name: 'Cin', priority: 0 }], slots: [slot] })
}
const factory = async () => ({ context, port })
function harness(sandboxBooking = false, createPort: any = factory, provider: any = undefined) {
  const state: any = { demoChatMessages: [], demoChatSessionId: null }
  const els: any = { demoProfileSelect: { value: 'qa' }, demoPreviewModeRow: { hidden: false }, demoPreviewMode: { value: 'conversational-preview' }, demoChatInput: { value: '', focus() {} }, demoChatSend: { disabled: false } }
  const requests: any[] = []
  const getJson = (_url: string, options: any) => new Promise((resolve, reject) => requests.push({ body: JSON.parse(options.body), resolve, reject }))
  const chat = new Function('state', 'els', 'getJson', 'renderDemoChatMessages', 'setButtonLoading',
    [source('startNewDemoChat'), source('drainDemoPreviewMessages'), source('sendDemoChatMessage'), 'return { startNewDemoChat, sendDemoChatMessage }'].join('\n'))(
    state, els, getJson, () => {}, () => true)
  const send = async (text: string) => { els.demoChatInput.value = text; await chat.sendDemoChatMessage({ preventDefault() {} }) }
  const complete = async (index: number) => {
    const request = requests[index], body = request.body
    const result = await (runPrismaDemoPreview as any)(client, 'qa', 'admin', body.sessionId, body.message, createPort, provider, undefined, sandboxBooking ? { sandboxBooking: true } : undefined, body.interactiveReplyId, body.turnGroup)
    request.resolve(result); await settle(); return result
  }
  return { state, requests, chat, send, complete }
}
for (const final of ['quiero un turno', 'quiero Corte hombre']) {
  const h = harness()
  await h.send('hola'); await h.send('como estas'); await h.send(final)
  await h.complete(0)
  assert.equal(h.state.demoChatMessages.filter((m: any) => m.role === 'bot').length, 0)
  for (let index = 1; index < h.requests.length; index++) await h.complete(index)
  const visible = h.state.demoChatMessages.filter((m: any) => m.role === 'bot')
  assert.equal(visible.length, 1)
  assert.equal((visible[0].text.match(/Soy Ada, de Comercio configurado/g) ?? []).length, 1, 'actual queue must present configured identity in the effectively visible reply')
  const key = 'qa:demo:preview:admin:' + h.requests[0].body.sessionId
  assert.equal(rows.get(key).supportBotState.introduced, true)
  if (final.includes('Corte')) assert.equal(rows.get(key).supportBotState.serviceId, 'cut')
}
console.log('visible logical preview group: OK')

{
  const h = harness(true)
  h.chat.startNewDemoChat()
  const session = h.state.demoChatSessionId, key = 'qa:demo:preview:admin:' + session
  const ready = { ...initialDialogueState('qa'), serviceId: 'cut', date: slot.date, professional: { kind: 'specific' as const, id: 'cin' }, slot, customerName: 'Matias' }
  rows.set(key, { id: key, businessId: 'qa', phone: 'demo:preview:admin:' + session, supportBotKey: 'conversational-preview', supportBotState: storePreviewChoiceState(ready, '0', null) })
  await h.send('quiero reservar'); await h.send('si')
  const hidden = await h.complete(0)
  assert.ok(hidden.state.sandboxReservation?.presented)
  assert.equal(hidden.bookingConfirmed, false)
  const shown = await h.complete(1)
  assert.equal(shown.bookingConfirmed, false, 'queued yes cannot authorize a proposal which was never visible')
  assert.ok(shown.state.sandboxReservation?.presented, 'safe result presents a fresh proposal instead')
  assert.equal(shown.state.customerName, 'Matias')
  assert.equal(shown.state.date, slot.date)
  assert.equal(shown.state.professional?.id, 'cin')
  assert.equal(Object.hasOwn(shown.state, 'previewTurnGroup'), false, 'rollback snapshot stays private')
  const before = messages.length
  const body = h.requests[1].body
  await assert.rejects((runPrismaDemoPreview as any)(client, 'qa', 'admin', session, body.message, factory, undefined, undefined, { sandboxBooking: true }, undefined, body.turnGroup), PreviewTurnGroupError)
  assert.equal(messages.length, before, 'retry/stale revision cannot re-execute or duplicate the turn')
  const stored = rows.get(key).supportBotState
  assert.equal(readPreviewChoiceState(stored).revision, '2')
  const corrupt = structuredClone(stored); corrupt.previewTurnGroup.businessId = 'foreign'
  rows.get(key).supportBotState = corrupt
  await assert.rejects((runPrismaDemoPreview as any)(client, 'qa', 'admin', session, 'otra consulta', factory, undefined, undefined, { sandboxBooking: true }, undefined,
    { ...body.turnGroup, revision: '2', fragments: [...body.turnGroup.fragments, 'otra consulta'] }), PreviewTurnGroupError)
  rows.get(key).supportBotState = stored
}
{
  const h = harness()
  await h.send('hola'); await h.send('quiero Corte hombre')
  failCommit = true
  await assert.rejects(h.complete(0), /commit failed/)
  failCommit = false
  h.requests[0].reject(new Error('commit failed')); await settle()
  const recovery = await h.complete(1)
  assert.match(recovery.reply, /Soy Ada/)
  assert.equal(recovery.state.serviceId, 'cut', 'failed compute/commit preserves all uncommitted fragments')
}
for (const input of [
  { id: 'g', revision: '0', visibleRevision: '0', fragments: [] },
  { id: 'g', revision: '0', visibleRevision: '0', fragments: ['x'.repeat(2001)] },
  { id: 'g', revision: '0', visibleRevision: '0', fragments: Array(33).fill('hola') },
  { id: 'g', revision: '0', visibleRevision: '0', fragments: ['hola'], base: {} }
]) assert.throws(() => parsePreviewTurnGroupInput(input), PreviewTurnGroupError)
console.log('queued consent, retries, scope, rollback and bounds: OK')

{
  const wash = { ...service, id: 'wash', name: 'Lavado' }
  const professionals = [{ id: 'cin', name: 'Cin', priority: 0 }, { id: 'rama', name: 'Ramiro', priority: 1 }]
  const lateralFactory = async () => ({ context, port: {
    ...port, catalog: async () => [service, wash],
    information: async () => ({ businessId: 'qa', name: 'Comercio configurado', address: null, area: null, mapsUrl: null, hours: 'Viernes: 11:00 a 20:00', website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null }),
    availabilityBasket: async (services: any[], date: string) => ({ ok: true, services, professionals, slots: [], durationMinutes: 60, totalPrice: 54000 }),
    availability: async () => ({ professionals, slots: [] })
  } })
  const calls: any[] = []
  const provider = async (input: any) => {
    calls.push(structuredClone(input))
    return { intent: input.message.includes('mañana') ? 'booking' : 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
      turnPlan: { version: 1, operations: input.message.includes('mañana')
        ? [{ kind: 'date', expression: 'mañana', confidence: 1, evidence: 'mañana' }, { kind: 'professional', mode: 'specific', mention: 'Cin', confidence: 1, evidence: 'Cin' }]
        : [{ kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, confidence: 1, evidence: 'horarios' }] } }
  }
  const h = harness(false, lateralFactory, provider)
  h.chat.startNewDemoChat()
  const session = h.state.demoChatSessionId, key = 'qa:demo:preview:admin:' + session
  const draft = { ...initialDialogueState('qa'), introduced: true, serviceId: null, basket: { version: 1, nextMemberId: 3, members: [
    { memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: 'Corte hombre' }, { memberId: 'm2', mode: 'single', serviceIds: ['wash'], evidence: 'Lavado' }
  ] }, date: '2026-10-04', professional: { kind: 'specific', id: 'rama' }, customerName: 'Matias', pending: 'time' }
  rows.set(key, { id: key, businessId: 'qa', phone: 'demo:preview:admin:' + session, supportBotKey: 'conversational-preview', supportBotState: storePreviewChoiceState(draft, '0', null) })
  await h.send('que horarios tienen'); await h.send('mejor mañana con Cin')
  await h.complete(0)
  const result = await h.complete(1)
  assert.equal(calls[1].message, 'que horarios tienen mejor mañana con Cin', 'real interpreter sees the whole logical group')
  assert.deepEqual(calls[1].state.basket, draft.basket, 'model context uses the pre-group draft and preserves companions')
  assert.equal(calls[1].state.date, '2026-10-04')
  assert.equal(result.state.date, '2026-10-03')
  assert.deepEqual(result.state.professional, { kind: 'specific', id: 'cin' })
  assert.deepEqual(result.state.basket, draft.basket)
  assert.equal(result.state.customerName, 'Matias')
  assert.equal(h.state.demoChatMessages.filter((message: any) => message.role === 'bot').length, 1)
  assert.doesNotMatch(result.reply, /Soy Ada/, 'already-visible identity must not be repeated')
}
console.log('lateral context and date/professional correction preserve companions: OK')

// Exercise the actual visible queue with the semantic provider, not only lexical fallback.
{
  let calls = 0, agenda = 0
  const provider = Object.assign(async (input: any) => {
    calls++
    return { intent: input.message.includes('turno') ? 'booking' : 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
      turnPlan: { version: 1, operations: [] },
      firstReply: { opening: 'Bien, gracias por preguntar.', closing: null, factIds: input.firstReplyFacts.map((fact: any) => fact.id) } }
  }, { respond: async () => { calls++; throw new Error('prepared intake must not buy another style call') } })
  const h = harness(false, async () => ({ context, port: { ...port, availability: async () => { agenda++; return { professionals: [], slots: [] } } } }), provider)
  await h.send('hola muchachos'); await h.send('como estan'); await h.send('queria un turno')
  await h.complete(0); await h.complete(1)
  const result = await h.complete(2)
  const visible = h.state.demoChatMessages.filter((message: any) => message.role === 'bot')
  assert.equal(visible.length, 1); assert.equal(calls, 3); assert.equal(result.interpretation.aiCalls, 1)
  assert.equal(agenda, 0); assert.equal(result.state.serviceId, null); assert.equal(result.proposalReady, false)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.state.sandboxReservation, undefined)
  assert.equal(visible[0].text.match(/Soy Ada, de Comercio configurado/g)?.length, 1)
  assert.match(visible[0].text, /Bien, gracias por preguntar\./); assert.match(visible[0].text, /¿Qué servicio necesitás\?/)
  assert.doesNotMatch(visible[0].text, /No pude identificar/)
}
console.log('semantic empty-plan booking visible group: OK')
