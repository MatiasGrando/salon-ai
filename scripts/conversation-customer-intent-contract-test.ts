import { strict as assert } from 'node:assert'
import {
  extractExplicitCustomerIntroduction,
  extractMisaddressedAssistantGreeting,
  extractPlainCustomerName,
  isPureSocialGreeting
} from '../src/services/conversation-customer-intent.js'
import { createEmptyBookingV2State } from '../src/services/booking-v2-state.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'

const compoundIntroduction = extractExplicitCustomerIntroduction(
  'hola soy mati, quiero un corte de hombre'
)
assert.deepEqual(compoundIntroduction, {
  name: 'Mati',
  remainingMessage: 'quiero un corte de hombre'
})

assert.deepEqual(extractExplicitCustomerIntroduction('Hola, me llamo Matías'), {
  name: 'Matías',
  remainingMessage: null
})
assert.deepEqual(extractExplicitCustomerIntroduction('mi nombre es ANA MARIA y quiero reservar'), {
  name: 'Ana Maria',
  remainingMessage: 'quiero reservar'
})
assert.deepEqual(extractExplicitCustomerIntroduction('Hola Tami te habla Santi'), {
  name: 'Santi',
  remainingMessage: null
})
assert.deepEqual(extractExplicitCustomerIntroduction('Te habla Santiago, quiero reservar un corte'), {
  name: 'Santiago',
  remainingMessage: 'quiero reservar un corte'
})
assert.deepEqual(extractExplicitCustomerIntroduction('Habla Santi'), {
  name: 'Santi',
  remainingMessage: null
})
assert.deepEqual(extractExplicitCustomerIntroduction('Santi por acá, quiero un turno'), {
  name: 'Santi',
  remainingMessage: 'quiero un turno'
})
assert.deepEqual(extractExplicitCustomerIntroduction('Buenas, Santiago de este lado'), {
  name: 'Santiago',
  remainingMessage: null
})
assert.equal(extractExplicitCustomerIntroduction('Habla con Santi'), null)
assert.equal(extractExplicitCustomerIntroduction('Te habla por el turno de Santi'), null)

assert.deepEqual(extractMisaddressedAssistantGreeting('hola Juan'), {
  addressedName: 'Juan',
  remainingMessage: null
})
assert.deepEqual(extractMisaddressedAssistantGreeting('holi Manola, quiero un turno'), {
  addressedName: 'Manola',
  remainingMessage: 'quiero un turno'
})
assert.deepEqual(extractMisaddressedAssistantGreeting('Hola Manu queria un turno'), {
  addressedName: 'Manu',
  remainingMessage: 'queria un turno'
})
assert.equal(extractMisaddressedAssistantGreeting('hola quiero un turno'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola queria un turno para ordenador molecular'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola quisiera reservar ordenador molecular'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola necesito un turno'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola busco un turno'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola que tal'), null)
assert.equal(extractMisaddressedAssistantGreeting('hola Cami'), null)

assert.equal(isPureSocialGreeting('hola que tal'), true)
assert.equal(isPureSocialGreeting('¡Holi!'), true)
assert.equal(isPureSocialGreeting('hola, buenas tardes!'), true)
assert.equal(isPureSocialGreeting('Hola, buen día. ¿Cómo estás?'), true)
assert.equal(isPureSocialGreeting('hola, buenas tardes, quiero un turno'), false)
assert.equal(isPureSocialGreeting('hola, buenas tardes, ¿hasta qué hora están abiertos?'), false)
assert.equal(isPureSocialGreeting('quiero un turno'), false)

assert.equal(extractPlainCustomerName('Matías Grando'), 'Matías Grando')
assert.equal(extractPlainCustomerName('quiero saber los horarios'), null)
assert.equal(extractPlainCustomerName('horarios'), null)

const state = {
  ...createEmptyBookingV2State(),
  optionalNamePrompt: {
    promptedAt: '2026-08-14T20:00:00.000Z',
    resumeMessage: 'quiero un turno'
  }
}
const patch = conversationPatchFromState(state)
assert.deepEqual(stateFromConversation({
  selectedCustomerName: patch.selectedCustomerName,
  selectedServiceId: patch.selectedServiceId,
  selectedProfessionalId: patch.selectedProfessionalId,
  selectedDate: patch.selectedDate,
  selectedTime: patch.selectedTime,
  misunderstandingCount: patch.misunderstandingCount,
  bookingV2State: patch.bookingV2State
}).optionalNamePrompt, state.optionalNamePrompt)

console.log('OK conversation customer intent contract')
