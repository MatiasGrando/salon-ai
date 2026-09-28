import { initialDialogueState, parseDialogueState, respond, type DialogueContext, type DialoguePort, type DialogueState } from './engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider, type InterpretedDialogueResponse } from './ai-interpreter.js'

/** The preview owns no booking or WhatsApp effects. An AI interpreter runs only when explicitly injected by the QA caller. */
export type PreviewDependencies = {
  load(phone: string): Promise<unknown>
  save(phone: string, inbound: string, reply: string, state: DialogueState): Promise<void>
  createPort(businessId: string): Promise<{ context: DialogueContext; port: DialoguePort }>
  interpretationProvider?: AiInterpretationProvider
}

export async function runConversationalPreview(deps: PreviewDependencies, businessId: string, phone: string, message: string) {
  const started = performance.now()
  const previous = await deps.load(phone)
  const loadedAt = performance.now()
  const { context, port } = await deps.createPort(businessId)
  if (context.businessId !== businessId) throw new Error('preview tenant mismatch')
  const contextAt = performance.now()
  const state = previous === null ? initialDialogueState(businessId) : parseDialogueState(previous, businessId, context.timezone)
  const response = deps.interpretationProvider
    ? await respondWithAiInterpreter(context, state, message, port, deps.interpretationProvider)
    : await respond(context, state, message, port)
  const computedAt = performance.now()
  await deps.save(phone, message, response.reply, response.state)
  const savedAt = performance.now()
  const ms = (duration: number) => Math.round(duration * 10) / 10
  return {
    reply: response.reply,
    state: response.state,
    proposalReady: response.proposal !== null,
    interpretation: deps.interpretationProvider ? (response as InterpretedDialogueResponse).interpretation : null,
    timings: {
      loadMs: ms(loadedAt - started),
      contextMs: ms(contextAt - loadedAt),
      engineMs: ms(computedAt - contextAt),
      persistMs: ms(savedAt - computedAt),
      totalMs: ms(savedAt - started)
    }
  }
}
