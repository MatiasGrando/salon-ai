import { initialDialogueState, parseDialogueState, respond, type DialogueContext, type DialoguePort, type DialogueState } from './engine.js'

/** The preview owns no booking, WhatsApp or AI side effects. Its caller persists QA test-chat history only. */
export type PreviewDependencies = {
  load(phone: string): Promise<unknown>
  save(phone: string, inbound: string, reply: string, state: DialogueState): Promise<void>
  createPort(businessId: string): Promise<{ context: DialogueContext; port: DialoguePort }>
}

export async function runConversationalPreview(deps: PreviewDependencies, businessId: string, phone: string, message: string) {
  const started = performance.now()
  const previous = await deps.load(phone)
  const loadedAt = performance.now()
  const { context, port } = await deps.createPort(businessId)
  if (context.businessId !== businessId) throw new Error('preview tenant mismatch')
  const contextAt = performance.now()
  const response = await respond(context, previous === null ? initialDialogueState(businessId) : parseDialogueState(previous, businessId, context.timezone), message, port)
  const computedAt = performance.now()
  await deps.save(phone, message, response.reply, response.state)
  const savedAt = performance.now()
  const ms = (duration: number) => Math.round(duration * 10) / 10
  return {
    reply: response.reply,
    state: response.state,
    proposalReady: response.proposal !== null,
    timings: {
      loadMs: ms(loadedAt - started),
      contextMs: ms(contextAt - loadedAt),
      engineMs: ms(computedAt - contextAt),
      persistMs: ms(savedAt - computedAt),
      totalMs: ms(savedAt - started)
    }
  }
}
