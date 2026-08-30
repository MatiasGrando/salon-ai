import assert from 'node:assert/strict'
import { isConversationRestartCommand } from '../src/bot-options/application/process-session-job.js'

assert.equal(isConversationRestartCommand('reiniciar'), true)
assert.equal(isConversationRestartCommand('  REINICIAR  '), true)
assert.equal(isConversationRestartCommand('/reiniciar'), true)
assert.equal(isConversationRestartCommand('reiniciar conversación'), true)
assert.equal(isConversationRestartCommand('/reiniciar conversacion'), true)

assert.equal(isConversationRestartCommand('quiero reiniciar'), false)
assert.equal(isConversationRestartCommand('reiniciar reserva'), false)
assert.equal(isConversationRestartCommand(null), false)
assert.equal(isConversationRestartCommand(undefined), false)

console.log('OK F11 restart command contract.')
