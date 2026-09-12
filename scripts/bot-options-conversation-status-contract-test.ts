import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { conversationStepForBotOptionsState } from '../src/bot-options/domain/conversation-status.js'

const state = createInitialBotOptionsState()

assert.equal(conversationStepForBotOptionsState(state), null, 'el menú inicial no debe pisar el estado visible')

const bookingFlows = [
  'DRAFT_RESUME', 'NAME_INPUT', 'NAME_CONFIRM', 'CATEGORY_SELECT', 'SERVICE_SELECT',
  'SERVICE_DETAIL', 'SERVICE_ESTIMATE', 'SERVICE_VALIDATION', 'SERVICE_PHOTOS',
  'RECOMMENDATION_SELECT', 'CART_REVIEW', 'INCOMPATIBLE_SERVICE_DECISION',
  'PROFESSIONAL_SELECT', 'DATE_SELECT', 'SLOT_SELECT', 'BOOKING_SUMMARY', 'DISCARD_CONFIRM'
] as const
for (const flow of bookingFlows) {
  assert.equal(
    conversationStepForBotOptionsState({ ...state, flow, catalogMode: 'BOOKING' }),
    'BOOKING_IN_PROGRESS',
    `${flow} debe verse como Reservando`
  )
}

assert.equal(
  conversationStepForBotOptionsState({ ...state, flow: 'CATEGORY_SELECT', catalogMode: 'BROWSING' }),
  null,
  'mirar el catálogo no debe iniciar una reserva visible'
)
assert.equal(
  conversationStepForBotOptionsState({ ...state, flow: 'DEPOSIT_INSTRUCTIONS', booking: 'HELD', deposit: 'PENDING_PROOF' }),
  'AWAITING_DEPOSIT'
)
assert.equal(
  conversationStepForBotOptionsState({ ...state, flow: 'APPOINTMENT_CANCEL_CONFIRM' }),
  'CANCEL_SELECT_APPOINTMENT'
)
assert.equal(
  conversationStepForBotOptionsState({ ...state, flow: 'APPOINTMENT_RESCHEDULE_DATE' }),
  'EDIT_SELECT_APPOINTMENT'
)

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const processor = readFileSync(new URL('../src/bot-options/application/process-session-job.ts', import.meta.url), 'utf8')
const contextWindow = readFileSync(new URL('../src/bot-options/application/lazy-context-window.ts', import.meta.url), 'utf8')

assert.match(schema, /enum ConversationStep[\s\S]*?BOOKING_IN_PROGRESS/)
assert.match(crmUi, /BOOKING_IN_PROGRESS: 'Reservando'/)
assert.match(processor, /conversationStepForBotOptionsState\(nextState\)[\s\S]*?projectBotOptionsConversationStepTx/)
assert.match(contextWindow, /lazy-context:reset-conversation[\s\S]*?"currentStep"='START'/)

console.log('bot-options-conversation-status-contract-test: OK')
