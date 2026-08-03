import assert from 'node:assert/strict'
import { AiMessageUnderstandingService } from '../src/services/ai-message-understanding-service.js'
import { shouldApplyMarketingOptOut } from '../src/services/marketing-preference-service.js'

const service = new AiMessageUnderstandingService()
const cases = [
  { message: 'Me gustaria que no me contacten mas por estas cosas', expected: true },
  { message: 'Saquenme de esa lista, por favor', expected: true },
  { message: 'Quiero cancelar mi turno de manana', expected: false },
  { message: 'No, gracias', expected: false },
  { message: 'Que promociones tienen esta semana?', expected: false }
]

for (const testCase of cases) {
  const understanding = await service.understandMarketingPreference(testCase.message)
  assert.ok(understanding, `No hubo comprension para: ${testCase.message}`)
  assert.equal(
    shouldApplyMarketingOptOut(testCase.message, understanding),
    testCase.expected,
    `${testCase.message}: ${JSON.stringify(understanding)}`
  )
  console.log(`OK: ${testCase.message} -> ${understanding.action} (${understanding.confidence})`)
}

console.log(`\n${cases.length} pruebas reales de comprension de bajas pasaron.`)
