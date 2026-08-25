import assert from 'node:assert/strict'
import {
  buildWhatsAppReplyButtonsPayload,
  buildWhatsAppInteractiveListPayload,
  canSendWhatsAppInteractiveMessage
} from '../src/integrations/whatsapp-cloud-api.js'
import { canRecoverInteractiveReplyFromLatestPrompt } from '../src/services/conversation-interactive-prompt.js'

const longServiceButton = buildWhatsAppReplyButtonsPayload({
  to: '5491112345678',
  text: '¿Cuál querés cotizar?',
  buttons: [{
    id: 'service:highlights',
    title: 'Iluminación (baby lights, balayage, contouring, etc)'
  }]
})
const normalizedTitle = longServiceButton.interactive.action.buttons[0]?.reply.title ?? ''
assert.ok(normalizedTitle.length > 0 && normalizedTitle.length <= 20)
assert.equal(longServiceButton.interactive.action.buttons[0]?.reply.id, 'service:highlights')

const longServiceList = buildWhatsAppInteractiveListPayload({
  to: '5491112345678',
  text: '¿Cuál querés cotizar?',
  rows: [{
    id: 'service:highlights',
    title: 'Iluminación (baby lights, balayage, contouring, etc)',
    description: 'Una descripción deliberadamente larga que tampoco debe provocar el rechazo completo del mensaje interactivo.'
  }]
})
const normalizedRow = longServiceList.interactive.action.sections[0]?.rows[0]
assert.ok((normalizedRow?.title.length ?? 0) > 0 && (normalizedRow?.title.length ?? 0) <= 24)
assert.ok((normalizedRow?.description?.length ?? 0) <= 72)

assert.equal(canSendWhatsAppInteractiveMessage('a'.repeat(1024), [{ id: 'ok', title: 'Sí' }]), true)
assert.equal(canSendWhatsAppInteractiveMessage('a'.repeat(1025), [{ id: 'ok', title: 'Sí' }]), false)

assert.equal(
  canRecoverInteractiveReplyFromLatestPrompt({
    incomingToken: 'a'.repeat(32),
    latestPersistedPromptToken: 'a'.repeat(32),
    promptCreatedAt: new Date('2026-08-25T14:45:38.661Z'),
    interveningTextCreatedAt: new Date('2026-08-25T14:45:43.524Z'),
    receivedAt: new Date('2026-08-25T14:45:51.064Z')
  }),
  true,
  'un botón del último prompt persistido sigue siendo legítimo aunque el estado activo se haya limpiado mientras llegaba otro texto'
)
assert.equal(canRecoverInteractiveReplyFromLatestPrompt({
  incomingToken: 'a'.repeat(32),
  latestPersistedPromptToken: 'b'.repeat(32),
  promptCreatedAt: new Date('2026-08-25T14:45:38.661Z'),
  interveningTextCreatedAt: new Date('2026-08-25T14:45:43.524Z'),
  receivedAt: new Date('2026-08-25T14:45:51.064Z')
}), false)
assert.equal(canRecoverInteractiveReplyFromLatestPrompt({
  incomingToken: 'a'.repeat(32),
  latestPersistedPromptToken: 'a'.repeat(32),
  promptCreatedAt: new Date('2026-08-25T14:40:00.000Z'),
  interveningTextCreatedAt: new Date('2026-08-25T14:45:43.524Z'),
  receivedAt: new Date('2026-08-25T14:45:51.064Z')
}), false, 'un botón realmente viejo no debe reabrir un prompt consumido')

console.log('whatsapp-interactive-reliability-contract-test: OK')
