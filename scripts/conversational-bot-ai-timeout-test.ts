import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { resolveQaPreviewAiTimeoutMs } from '../src/conversational-bot/qa-preview-ai.js'
import { resolveWhatsAppConversationAi } from '../src/conversational-bot/whatsapp-ai.js'

const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T15:00:00Z') }
const port: DialoguePort = { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) }
const candidate = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
const bookingCandidate = { ...candidate, intent: 'booking', serviceId: 'consultation', serviceEvidence: 'Consulta', serviceConfidence: 'certain' }
const bookingPort: DialoguePort = { ...port, catalog: async () => [{ id: 'consultation', name: 'Consulta', durationMinutes: 30, price: 100, requiresConsultation: false }] }
const groundedReply = 'Hola\nPerfecto 😊 ¿Para qué día y horario querés reservar tu Consulta?'
const draft = { opening: 'Hola', factIds: [], closing: null }

// Only the production deadline and fake provider delays use timers. No wall-clock waits or network calls.
class ControlledClock {
  now = 0
  readonly pending = new Map<unknown, { at: number; fire: () => void }>()
  readonly originalSetTimeout = globalThis.setTimeout
  readonly originalClearTimeout = globalThis.clearTimeout

  install() {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
      const handle = {}
      this.pending.set(handle, { at: this.now + delay, fire: () => callback(...args) })
      return handle
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((handle: unknown) => { this.pending.delete(handle) }) as typeof clearTimeout
  }

  restore() {
    globalThis.setTimeout = this.originalSetTimeout
    globalThis.clearTimeout = this.originalClearTimeout
  }

  async flush() { for (let i = 0; i < 30; i++) await Promise.resolve() }

  async advance(duration: number) {
    await this.flush()
    const target = this.now + duration
    while (true) {
      const next = [...this.pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.now = next[1].at
      this.pending.delete(next[0])
      next[1].fire()
      await this.flush()
    }
    this.now = target
    await this.flush()
  }

  async use(work: () => Promise<void>) {
    this.install()
    try { await work(); assert.equal(this.pending.size, 0, 'successful/aborted calls clear deadline timers') }
    finally { this.restore() }
  }
}

function delayedProvider(interpretationDelay: number, responseDelay: number, signals: AbortSignal[], interpretation: unknown = bookingCandidate): AiInterpretationProvider {
  const delay = (duration: number, result: unknown, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise(resolve => { setTimeout(() => resolve(result), duration) })
  }
  const provider: AiInterpretationProvider = (_input, signal) => delay(interpretationDelay, interpretation, signal)
  provider.respond = (input, signal) => delay(responseDelay, { ...draft, factIds: input.facts.map(fact => fact.id) }, signal)
  return provider
}

const defaults = new ControlledClock()
await defaults.use(async () => {
  const signals: AbortSignal[] = []
  let settled = false
  const result = respondWithAiInterpreter(context, initialDialogueState('qa'), 'Consulta', bookingPort, delayedProvider(6000, 14000, signals))
  void result.then(() => { settled = true })
  await defaults.advance(5000)
  assert.equal(settled, false, 'default interpretation must not fall back at the old 2.5/5 second deadline')
  assert.equal(signals[0]?.aborted, false)
  await defaults.advance(1000)
  assert.equal(signals.length, 2, 'valid interpretation starts grounded composer')
  await defaults.advance(13000)
  assert.equal(settled, false, 'composer has its own full deadline, not the remaining interpretation budget')
  assert.equal(signals[1]?.aborted, false)
  await defaults.advance(1000)
  const response = await result
  assert.equal(response.interpretation.mode, 'ai')
  assert.equal(response.interpretation.copyMode, 'ai')
  assert.equal(response.interpretation.aiCalls, 2)
  assert.equal(response.reply, groundedReply)
  assert.ok(signals.every(signal => !signal.aborted))
})

const social = new ControlledClock()
await social.use(async () => {
  const signals: AbortSignal[] = []
  const result = respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
    delayedProvider(6000, 14000, signals, candidate))
  await social.advance(6000)
  const response = await result
  assert.equal(signals.length, 1, 'stable greeting never starts the composer just for missing style')
  assert.equal(response.interpretation.aiCalls, 1)
  assert.equal(response.interpretation.copyMode, 'fallback')
  assert.equal(response.reply, '¿En qué te puedo ayudar con el local?')
  assert.equal(signals[0]?.aborted, false)
})

const override = new ControlledClock()
await override.use(async () => {
  const signals: AbortSignal[] = []
  const result = respondWithAiInterpreter(context, initialDialogueState('qa'), 'Consulta', bookingPort, delayedProvider(6000, 8000, signals), { timeoutMs: 9500 })
  await override.advance(14000)
  assert.equal((await result).interpretation.copyMode, 'ai', 'a valid explicit deadline above 5000 reaches both providers')
  assert.ok(signals.every(signal => !signal.aborted))
})

for (const [configured, expected] of [[60000, 15000], [Number.NaN, 15000], [Number.POSITIVE_INFINITY, 15000], [Number.NEGATIVE_INFINITY, 15000], [1500.5, 15000], [20, 20], [0, 1], [-4, 1]] as const) {
  const clock = new ControlledClock()
  await clock.use(async () => {
    let signal: AbortSignal | undefined
    let settled = false
    const result = respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
      (_input, providerSignal) => { signal = providerSignal; return new Promise(() => {}) }, { timeoutMs: configured })
    void result.then(() => { settled = true })
    await clock.advance(expected - 1)
    assert.equal(settled, false, `deadline ${String(configured)} does not abort early`)
    assert.equal(signal?.aborted, false)
    await clock.advance(1)
    assert.equal(signal?.aborted, true, `deadline ${String(configured)} aborts at ${expected}`)
    const response = await result
    assert.equal(response.interpretation.reason, 'timeout')
    assert.equal(response.interpretation.interpretationProviderError?.code, 'timeout')
  })
}

const composerTimeout = new ControlledClock()
await composerTimeout.use(async () => {
  let signal: AbortSignal | undefined
  const provider: AiInterpretationProvider = async () => bookingCandidate
  provider.respond = (_input, providerSignal) => { signal = providerSignal; return new Promise(() => {}) }
  const result = respondWithAiInterpreter(context, initialDialogueState('qa'), 'Consulta', bookingPort, provider)
  await composerTimeout.advance(14999)
  assert.equal(signal?.aborted, false)
  await composerTimeout.advance(1)
  const response = await result
  assert.equal(signal?.aborted, true, 'composer cancels at 15000 too')
  assert.equal(response.interpretation.copyReason, 'response_timeout')
  assert.equal(response.interpretation.responseProviderError?.code, 'timeout')
})

for (const [configured, expected] of [[undefined, 15000], ['6000', 6000], ['9500', 9500], ['14000', 14000], ['15000', 15000], ['60000', 15000], ['0', 1000], ['999', 1000], ['NaN', 15000], ['Infinity', 15000], ['1000.5', 15000], ['-1', 15000], ['no', 15000], ['', 15000], ['9'.repeat(400), 15000]] as const) {
  assert.equal(resolveQaPreviewAiTimeoutMs({ CONVERSATIONAL_QA_AI_TIMEOUT_MS: configured }), expected, `QA env ${String(configured)}`)
  assert.equal(resolveWhatsAppConversationAi({ CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true', CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS: configured })!.timeoutMs, expected, `WhatsApp env ${String(configured)}`)
}

for (const timeoutMs of [undefined, 14000] as const) {
  const clock = new ControlledClock()
  await clock.use(async () => {
    const signals: AbortSignal[] = []
    const saves: string[] = []
    const result = runConversationalPreview({
      load: async () => null,
      save: async (_phone, _message, reply) => { saves.push(reply) },
      createPort: async () => ({ context, port: bookingPort }),
      interpretationProvider: delayedProvider(6000, 6000, signals),
      ...(timeoutMs === undefined ? {} : { interpretationTimeoutMs: timeoutMs })
    }, 'qa', 'demo:timeout', 'Consulta')
    await clock.advance(12000)
    const response = await result
    assert.equal(response.interpretation.mode, 'ai', 'preview does not reintroduce its old 4500ms default')
    assert.ok('copyMode' in response.interpretation)
    assert.equal(response.interpretation.copyMode, 'ai')
    assert.deepEqual(saves, [groundedReply])
    assert.equal(response.interpretation.aiCalls, 2)
    assert.ok(signals.every(signal => !signal.aborted))
  })
}

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
assert.match(example, /^CONVERSATIONAL_QA_AI_TIMEOUT_MS=15000$/m)
assert.match(example, /^CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS=15000$/m)
const server = readFileSync(new URL('../src/routes/demo-profile.ts', import.meta.url), 'utf8')
assert.ok(server.includes('resolveQaPreviewAiTimeoutMs(process.env)'), 'QA composition forwards the environment deadline')
console.log('conversational AI 15000ms defaults, per-call deadlines, abort, env and preview: PASS')
