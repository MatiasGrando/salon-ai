import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  ACTION_ID_PREFIX,
  CHOICE_TOKEN_LENGTH,
  MAX_ACTION_ID_BYTES,
  PROMPT_TOKEN_LENGTH,
  buildInteractiveActionId,
  generateChoiceToken,
  generatePromptToken,
  isValidChoiceToken,
  isValidPromptToken,
  parseInteractiveActionId
} from '../src/bot-options/domain/prompt-tokens.js'

// Formato y entropía básica.
const promptToken = generatePromptToken()
const choiceToken = generateChoiceToken()

assert.equal(promptToken.length, PROMPT_TOKEN_LENGTH)
assert.equal(choiceToken.length, CHOICE_TOKEN_LENGTH)
assert.notEqual(promptToken, generatePromptToken())
assert.notEqual(choiceToken, generateChoiceToken(randomBytes))

// Alfabeto base64url sin padding.
for (const token of [promptToken, choiceToken]) {
  assert.doesNotMatch(token, /[+/=]/)
}

// ID compuesto dentro del presupuesto y round-trip exacto.
const actionId = buildInteractiveActionId(promptToken, choiceToken)
assert.ok(actionId.startsWith(`${ACTION_ID_PREFIX}.`))
assert.ok(Buffer.byteLength(actionId, 'ascii') <= MAX_ACTION_ID_BYTES)

const parsed = parseInteractiveActionId(actionId)
assert.deepEqual(parsed, { ok: true, prefix: ACTION_ID_PREFIX, promptToken, choiceToken })

// Rechazos estrictos.
assert.equal(parseInteractiveActionId('a1.x.y').ok, false, 'prefijo distinto')
assert.equal(parseInteractiveActionId('b1.prompt-only').ok, false, 'faltan partes')
assert.equal(parseInteractiveActionId(`b1.${promptToken}.${choiceToken}.extra`).ok, false, 'sobra una parte')
assert.equal(parseInteractiveActionId(`b1.${promptToken}A.${choiceToken}`).ok, false, 'longitud de prompt')
assert.equal(parseInteractiveActionId(`b1.${promptToken.slice(0, -1)}.${choiceToken}`).ok, false, 'longitud corta')
assert.equal(parseInteractiveActionId(`b1.${promptToken}.${'+' + choiceToken.slice(1)}`).ok, false, 'alfabeto inválido')
assert.equal(parseInteractiveActionId(null).ok, false)
assert.equal(parseInteractiveActionId(42).ok, false)

assert.equal(isValidPromptToken(promptToken), true)
assert.equal(isValidPromptToken('corto'), false)
assert.equal(isValidChoiceToken(choiceToken), true)
assert.equal(isValidChoiceToken('con espacios!'), false)

// Constructores rechazan entradas inválidas.
assert.throws(() => buildInteractiveActionId('mal', choiceToken))
assert.throws(() => buildInteractiveActionId(promptToken, 'mal'))

// Fuente de aleatoriedad inyectable: misma semilla, mismo token.
const seededBytes = () => new Uint8Array(12).fill(7)
assert.equal(generatePromptToken(seededBytes), generatePromptToken(seededBytes))
assert.equal(
  generateChoiceToken(() => new Uint8Array(8).fill(9)).length,
  CHOICE_TOKEN_LENGTH
)

console.log('OK bot-options prompt-tokens: formato, presupuesto de bytes y round-trip cumplen el contrato.')
