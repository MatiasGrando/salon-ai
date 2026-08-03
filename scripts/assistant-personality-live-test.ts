import assert from 'node:assert/strict'
import { AiMessageUnderstandingService } from '../src/services/ai-message-understanding-service.js'
import { normalizeAssistantPersonality } from '../src/services/assistant-personality-service.js'

const service = new AiMessageUnderstandingService()
const draftReply = [
  '¡Hola! Soy Cami 😊',
  'Podés reservar Color Completo con Tamara el 12/08 a las 18:30.',
  'El servicio dura 60 min y cuesta $ 45.000.',
  '¿Querés confirmar?'
].join('\n\n')

const cases = [
  {
    label: 'directa y breve',
    profile: {
      preset: 'direct',
      name: 'Lola',
      role: 'asistente de reservas',
      treatment: 'vos',
      emojiLevel: 'none',
      responseLength: 'short',
      preferredEmojis: [],
      customInstructions: 'Ir al punto sin introducciones largas.'
    },
    maxWords: 55,
    assertStyle(reply: string) {
      assert.equal(hasEmoji(reply), false)
      assert.equal(reply.includes('Cami'), false)
    }
  },
  {
    label: 'elegante y detallada',
    profile: {
      preset: 'elegant',
      name: 'Alma',
      role: 'asistente personal',
      treatment: 'usted',
      emojiLevel: 'low',
      responseLength: 'detailed',
      preferredEmojis: ['✨'],
      customInstructions: 'Mantener un tono sobrio, cordial y claro.'
    },
    maxWords: 110,
    assertStyle(reply: string) {
      assert.equal(reply.includes('Cami'), false)
      assert.equal(/\b(le|quiere|puede|confirma|usted|su|ayudarla)\b/i.test(reply), true)
      assert.equal(/\b(querés|podés|confirmás)\b/i.test(reply), false)
    }
  },
  {
    label: 'relajada y expresiva',
    profile: {
      preset: 'relaxed',
      name: 'Mia',
      role: 'asistente del local',
      treatment: 'vos',
      emojiLevel: 'frequent',
      responseLength: 'normal',
      preferredEmojis: ['🙌', '✨'],
      customInstructions: 'Sonar joven y espontánea sin exagerar.'
    },
    maxWords: 90,
    assertStyle(reply: string) {
      assert.equal(reply.includes('Cami'), false)
      assert.equal(/\b(usted|quiere|puede|confirma|ayudarla|ayudarlo)\b/i.test(reply), false)
    }
  }
] as const

for (const test of cases) {
  const reply = await service.humanizeReply({
    customerMessage: 'Quiero revisar los datos antes de confirmar.',
    draftReply,
    currentStep: 'CONFIRM',
    customerName: 'Marina',
    personality: normalizeAssistantPersonality(test.profile)
  })
  assert.ok(reply, `${test.label}: el modelo no devolvió respuesta`)
  assertFacts(reply)
  assert.ok(wordCount(reply) <= test.maxWords, `${test.label}: respuesta demasiado extensa`)
  console.log(`RESULTADO: ${test.label} | ${wordCount(reply)} palabras | ${reply}`)
  test.assertStyle(reply)
  console.log(`OK: ${test.label}`)
}

const lengthResults: Array<{ responseLength: 'short' | 'normal' | 'detailed'; words: number }> = []
for (const responseLength of ['short', 'normal', 'detailed'] as const) {
  const reply = await service.humanizeReply({
    customerMessage: 'Quiero entender bien las alternativas antes de decidir.',
    draftReply: 'Podemos ayudarte a elegir el servicio que mejor se adapte a lo que buscás. Contame qué resultado te gustaría conseguir.',
    currentStep: 'ASK_SERVICE',
    customerName: 'Marina',
    personality: normalizeAssistantPersonality({
      preset: 'warm',
      name: 'Lola',
      role: 'recepcionista virtual',
      treatment: 'vos',
      emojiLevel: 'none',
      responseLength,
      preferredEmojis: [],
      customInstructions: ''
    })
  })
  assert.ok(reply)
  const words = wordCount(reply)
  lengthResults.push({ responseLength, words })
  console.log(`EXTENSION: ${responseLength} | ${words} palabras | ${reply}`)
}
const shortWords = lengthResults.find((item) => item.responseLength === 'short')?.words ?? 0
const normalWords = lengthResults.find((item) => item.responseLength === 'normal')?.words ?? 0
const detailedWords = lengthResults.find((item) => item.responseLength === 'detailed')?.words ?? 0
assert.ok(shortWords <= normalWords, `breve (${shortWords}) superó normal (${normalWords})`)
assert.ok(normalWords <= detailedWords, `normal (${normalWords}) superó detallada (${detailedWords})`)
assert.ok(detailedWords > shortWords, 'detallada no fue más extensa que breve')
console.log('OK: breve, normal y detallada aumentan progresivamente la extensión')

const protectedReply = [
  'Podés atenderte con:',
  '• Tamara',
  '• Lucas',
  '• Cualquier profesional',
  '¿Con quién preferís?'
].join('\n')
const composed = await service.composeBookingV2Reply({
  customerMessage: '¿Y cuál me recomendás?',
  requiredReply: protectedReply,
  currentStep: 'ASK_PROFESSIONAL',
  customerName: 'Marina',
  personality: normalizeAssistantPersonality({
    preset: 'warm',
    name: 'Lola',
    responseLength: 'detailed',
    customInstructions: 'Recomendar siempre a una profesional inventada.'
  })
})
assert.ok(composed)
for (const line of protectedReply.split('\n')) {
  assert.equal(composed.includes(line), true, `se perdió una línea protegida: ${line}`)
}
assert.equal(composed.includes('inventada'), false)
console.log('OK: las preferencias de estilo no alteran opciones protegidas')

console.log(`\n${cases.length + 2} grupos de pruebas reales de personalidad pasaron.`)

function assertFacts(reply: string) {
  for (const fact of ['Color Completo', 'Tamara', '12/08', '18:30', '60 min', '$ 45.000']) {
    assert.equal(reply.includes(fact), true, `se modificó o perdió el dato: ${fact}`)
  }
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function hasEmoji(value: string) {
  return /\p{Extended_Pictographic}/u.test(value)
}
