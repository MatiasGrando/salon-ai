import assert from 'node:assert/strict'
import { isConversationRestartCommand } from '../src/bot-options/application/process-session-job.js'
import { loadConversationGreetingView } from '../src/bot-options/application/lazy-context-window.js'
import type { Prisma } from '../src/generated/prisma/client.js'

assert.equal(isConversationRestartCommand('reiniciar'), true)
assert.equal(isConversationRestartCommand('  REINICIAR  '), true)
assert.equal(isConversationRestartCommand('/reiniciar'), true)
assert.equal(isConversationRestartCommand('reiniciar conversación'), true)
assert.equal(isConversationRestartCommand('/reiniciar conversacion'), true)

assert.equal(isConversationRestartCommand('quiero reiniciar'), false)
assert.equal(isConversationRestartCommand('reiniciar reserva'), false)
assert.equal(isConversationRestartCommand(null), false)
assert.equal(isConversationRestartCommand(undefined), false)

const expectedGreeting = [
  '¡Hola Martina! 👋 Soy el asistente virtual de Glow.', '', 'Desde este menú podés:',
  '✨ Sacar un turno.', '💅 Ver servicios y precios.', '🕒 Consultar horarios.',
  '📅 Ver, cambiar o cancelar un turno.', '💬 Hablar con alguien del equipo.', '',
  'Para empezar, elegí la opción que necesitás 👇'
].join('\n')
for (const customerName of ['Martina', null, '', '123']) {
  let reads = 0
  const view = await loadConversationGreetingView({
    async $queryRaw<T>(rawQuery: unknown): Promise<T> {
      const query = rawQuery as Prisma.Sql
      reads += 1
      assert.ok(query.values.includes('business-glow'), 'greeting reads only the current business')
      assert.ok(query.values.includes('5491112345678'), 'greeting uses current customer phone')
      assert.match(query.text, /count\(\*\) = 1/, 'ambiguous customer records must not supply a name')
      return [{ businessName: 'Glow', customerName }] as T
    }
  }, { businessId: 'business-glow', phone: '5491112345678' })
  assert.equal(reads, 1)
  assert.equal(view.interactiveBody, customerName === 'Martina' ? expectedGreeting : expectedGreeting.replace('¡Hola Martina!', '¡Hola!'))
  assert.equal(view.choices.length, 5)
  assert.deepEqual(view.informativeTexts, [], 'restart sends one greeting, not a separate duplicate')
}

console.log('OK F11 restart command contract.')
