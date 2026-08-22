import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  contextActionFromChoice,
  contextActionFromInteractiveReply,
  contextDecisionButtons,
  conversationContextWindow
} from '../src/services/conversation-service.js'
import { normalizeConversationContextSettings } from '../src/services/conversation-context-settings.js'
import { buildWhatsAppReplyButtonsPayload } from '../src/integrations/whatsapp-cloud-api.js'
import { WhatsAppWebhookService } from '../src/services/whatsapp-webhook-service.js'
import { createEmptyBookingV2State } from '../src/services/booking-v2-state.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import {
  interactivePromptConflictReply,
  parseVersionedInteractiveReplyId,
  versionInteractiveReplyId
} from '../src/services/conversation-interactive-prompt.js'

const now = new Date('2026-08-03T18:00:00.000Z')
const defaults = normalizeConversationContextSettings()
assert.deepEqual(defaults, { pauseAfterMinutes: 120, expireAfterMinutes: 1440 })
assert.deepEqual(
  normalizeConversationContextSettings({
    conversationPauseAfterMinutes: 30,
    conversationExpireAfterMinutes: 180
  }),
  { pauseAfterMinutes: 30, expireAfterMinutes: 180 }
)
assert.deepEqual(
  normalizeConversationContextSettings({
    conversationPauseAfterMinutes: 120,
    conversationExpireAfterMinutes: 60
  }),
  { pauseAfterMinutes: 120, expireAfterMinutes: 135 }
)

assert.equal(conversationContextWindow('ASK_TIME', minutesAgo(119), defaults, now), 'active')
assert.equal(conversationContextWindow('ASK_TIME', minutesAgo(120), defaults, now), 'paused')
assert.equal(conversationContextWindow('CONFIRM', minutesAgo(1439), defaults, now), 'paused')
assert.equal(conversationContextWindow('CONFIRM', minutesAgo(1440), defaults, now), 'expired')
assert.equal(conversationContextWindow('ASK_SERVICE', minutesAgo(30), { pauseAfterMinutes: 15, expireAfterMinutes: 60 }, now), 'paused')
assert.equal(conversationContextWindow('ASK_SERVICE', minutesAgo(60), { pauseAfterMinutes: 15, expireAfterMinutes: 60 }, now), 'expired')
for (const protectedStep of ['START', 'COMPLETED', 'HUMAN_HANDOFF']) {
  assert.equal(conversationContextWindow(protectedStep, minutesAgo(10080), defaults, now), 'active')
}

const buttons = contextDecisionButtons('conversation-1')
assert.equal(buttons.length, 3)
assert.equal(new Set(buttons.map((button) => button.id)).size, 3)
assert.ok(buttons.every((button) => button.title.length <= 20))
assert.equal(contextActionFromInteractiveReply(buttons[0]?.id, 'conversation-1'), 'continue')
assert.equal(contextActionFromInteractiveReply(buttons[1]?.id, 'conversation-1'), 'new')
assert.equal(contextActionFromInteractiveReply(buttons[2]?.id, 'conversation-1'), 'handoff')
assert.equal(contextActionFromInteractiveReply(buttons[0]?.id, 'otra-conversation'), null)
assert.equal(contextActionFromChoice({ choiceId: 'continue', confidence: 0.85 }), 'continue')
assert.equal(contextActionFromChoice({ choiceId: 'new', confidence: 0.99 }), 'new')
assert.equal(contextActionFromChoice({ choiceId: 'handoff', confidence: 0.9 }), 'handoff')
assert.equal(contextActionFromChoice({ choiceId: 'continue', confidence: 0.849 }), 'unclear')
assert.equal(contextActionFromChoice({ choiceId: null, confidence: 1 }), 'unclear')

const payload = buildWhatsAppReplyButtonsPayload({
  to: '5491112345678',
  text: '¿Cómo querés seguir?',
  buttons
})
assert.equal(payload.type, 'interactive')
assert.equal(payload.interactive.action.buttons.length, 3)
assert.equal(payload.interactive.action.buttons[0]?.reply.id, buttons[0]?.id)

const incoming = new WhatsAppWebhookService().extractIncomingMessages({
  entry: [{
    changes: [{
      value: {
        messages: [{
          id: 'wamid.button',
          from: '5491112345678',
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: { id: buttons[0]!.id, title: buttons[0]!.title }
          }
        }]
      }
    }]
  }]
})
assert.equal(incoming[0]?.text, 'Continuar reserva')
assert.equal(incoming[0]?.interactiveReplyId, buttons[0]?.id)

const promptToken = 'a'.repeat(32)
const versionedButtonId = versionInteractiveReplyId(buttons[0]!.id, promptToken)
assert.deepEqual(parseVersionedInteractiveReplyId(versionedButtonId), {
  token: promptToken,
  replyId: buttons[0]!.id
})
assert.equal(parseVersionedInteractiveReplyId(buttons[0]!.id), null)
const conflictReply = interactivePromptConflictReply([
  { id: 'confirm', title: 'Confirmar turno' },
  { id: 'change', title: 'Cambiar horario' }
])
assert.match(conflictReply.reply, /recibí más de una opción/i)
assert.match(conflictReply.reply, /Confirmar turno.*Cambiar horario/i)
assert.deepEqual(conflictReply.replyButtons.map((button) => button.id), ['confirm', 'change'])

const pausedState = {
  ...createEmptyBookingV2State(),
  draft: { ...createEmptyBookingV2State().draft, service: 'service-1' },
  contextPause: {
    pausedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  }
}
const patch = conversationPatchFromState(pausedState)
const restored = stateFromConversation({
  selectedCustomerName: patch.selectedCustomerName,
  selectedServiceId: patch.selectedServiceId,
  selectedProfessionalId: patch.selectedProfessionalId,
  selectedDate: patch.selectedDate,
  selectedTime: patch.selectedTime,
  bookingV2State: patch.bookingV2State,
  misunderstandingCount: patch.misunderstandingCount
})
assert.deepEqual(restored.contextPause, pausedState.contextPause)

const serviceSource = await readFile(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8')
assert.match(serviceSource, /choice\.confidence >= 0\.85/)
assert.match(serviceSource, /bookingV2ChoiceExtractor\.extract/)
assert.match(serviceSource, /previousActivityAt/)

const uiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.match(uiSource, /conversation-pause-hours/)
assert.match(uiSource, /conversation-expire-hours/)
assert.match(uiSource, /El reinicio debe ocurrir después de la pausa/)

console.log('conversation-context-contract-test: OK')

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60 * 1000)
}
