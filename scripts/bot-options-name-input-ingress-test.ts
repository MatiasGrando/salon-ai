import assert from 'node:assert/strict'
import { classifyFreeTextInput } from '../src/bot-options/infrastructure/prisma-admission.js'

assert.deepEqual(classifyFreeTextInput('NAME_INPUT', 'text', '  Matías Grando  '), {
  actionType: 'name.submit',
  payload: { name: 'Matías Grando' }
})
assert.equal(classifyFreeTextInput('MAIN_MENU', 'text', 'Matías Grando'), null)
assert.equal(classifyFreeTextInput('NAME_INPUT', 'image', 'Matías Grando'), null)
assert.equal(classifyFreeTextInput('NAME_INPUT', 'text', null), null)
assert.equal(classifyFreeTextInput('NAME_INPUT', 'text', 'reiniciar'), null, 'el comando de reinicio no puede guardarse como nombre ni confirmar un turno')
assert.deepEqual(classifyFreeTextInput('NAME_CONFIRM', 'text', 'Ana María'), {
  actionType: 'name.submit',
  payload: { name: 'Ana María' }
}, 'sesiones legacy NAME_CONFIRM aceptan texto y no quedan trabadas')

console.log('Name input ingress contract: OK')
