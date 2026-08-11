import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { conversationPatchFromState, stateFromConversation } from '../src/services/booking-v2-conversation-state.js'
import { createEmptyBookingV2State } from '../src/services/booking-v2-state.js'
import { pendingRequestFromRouting } from '../src/services/conversation-service.js'
import type { BookingV2Extraction } from '../src/services/booking-v2-extractor.js'

const [conversationSource, routerSource, openAiClientSource] = await Promise.all([
  readFile(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/conversation-router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/integrations/openai-client.ts', import.meta.url), 'utf8')
])

assert.equal(
  occurrences(routerSource, "createTrackedOpenAiResponse(client, 'conversation_router', {"),
  1,
  'ConversationRouter debe realizar una sola llamada general de IA por mensaje'
)
assert.equal(
  occurrences(openAiClientSource, 'openAiClient.responses.create(input)'),
  1,
  'Las llamadas de Responses API deben centralizarse para registrar su consumo'
)
assert.equal(
  routerSource.includes('natural_mixed_booking_recovery'),
  false,
  'El router no debe ejecutar una segunda clasificación de mensajes mixtos'
)
assert.equal(
  conversationSource.includes('composeBookingV2Reply('),
  false,
  'Booking V2 no debe hacer otra llamada de IA sólo para anteponer una frase social'
)
assert.equal(
  occurrences(conversationSource, 'bookingV2Engine.process({'),
  occurrences(conversationSource, 'understandingExtraction:'),
  'Cada llamada productiva a BookingV2Engine.process debe cerrar explícitamente la extracción'
)
const prioritizedEstimateOptionBranch = conversationSource.match(
  /if \(shouldPrioritizeGuidedEstimateOptionReply[\s\S]*?const quoteOnlyRequest/
)?.[0] ?? ''
assert.match(
  prioritizedEstimateOptionBranch,
  /bookingCoordinationReplyButtons\(\{[\s\S]*?replyButtons/,
  'La selección rápida del estimativo debe conservar los botones de continuar o pedir presupuesto'
)

const deterministicContinuationIndex = conversationSource.indexOf(
  'bookingV2Engine.canProcessWithoutGeneralRouter({'
)
const generalRouterIndex = conversationSource.indexOf(
  'conversationRouter.route(await conversationRouterContextService.load({'
)
assert.ok(
  deterministicContinuationIndex >= 0 && deterministicContinuationIndex < generalRouterIndex,
  'Las continuaciones determinísticas deben resolverse antes del router general'
)
assert.match(
  conversationSource.slice(deterministicContinuationIndex, generalRouterIndex),
  /return this\.handleBookingV2\([\s\S]*?deterministicBookingRouting/,
  'El camino determinístico debe cerrar la respuesta sin invocar el router'
)

const extraction: BookingV2Extraction = {
  name: { value: null, confidence: 0, evidence: '' },
  service: { value: 'service-corte', confidence: 0.97, evidence: 'corte' },
  professional: { value: null, confidence: 0, evidence: '' },
  date: { value: '2026-08-10', confidence: 0.91, evidence: 'el lunes' },
  time: { value: null, confidence: 0, evidence: '' },
  additionalServices: [],
  correction: { field: null, newValue: null, confidence: 0, evidence: '' }
}
const pendingRequest = pendingRequestFromRouting({
  currentStep: 'START',
  state: createEmptyBookingV2State(),
  now: new Date('2026-08-08T12:00:00.000Z'),
  routing: {
    intents: [{
      type: 'book_appointment',
      topic: null,
      confidence: 0.98,
      evidence: 'quiero corte el lunes'
    }],
    bookingMessage: 'quiero corte el lunes',
    bookingExtraction: extraction,
    catalogQuery: null,
    source: 'ai'
  }
})
assert.ok(pendingRequest)
assert.deepEqual(pendingRequest.extraction, extraction)

const persisted = conversationPatchFromState({
  ...createEmptyBookingV2State(),
  pendingRequest
})
const restored = stateFromConversation(persisted)
assert.deepEqual(
  restored.pendingRequest?.extraction,
  extraction,
  'La extracción original debe sobrevivir mientras se espera el nombre del cliente'
)

console.log('booking-v2-ai-budget-contract-test: OK')

function occurrences(source: string, pattern: string) {
  return source.split(pattern).length - 1
}
