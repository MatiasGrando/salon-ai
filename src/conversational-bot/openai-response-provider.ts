import { buildAssistantPersonalityInstructions } from '../services/assistant-personality-config.js'
import { DIALOGUE_PERSONALITY_INSTRUCTIONS, validateDialoguePersonality } from './dialogue-identity.js'
import { expectedDialogueAnswer } from './dialogue-context.js'
import { REPLY_CONTRACT_INSTRUCTIONS, REPLY_DRAFT_SCHEMA, replyContract } from './reply-contract.js'
import { attachAiUsage } from './ai-usage.js'
import { providerError } from './provider-error.js'
import { extractResponsesJson } from './responses-json.js'
import type { AiResponseProvider } from './ai-interpreter.js'

/** QA-only composition call: the engine supplies the only factual fragments. */
export function createOpenAiResponseProvider(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): AiResponseProvider {
  if (!options.apiKey || options.apiKey.length > 4096) throw new Error('OpenAI key required')
  const fetchImpl = options.fetchImpl ?? fetch
  const model = options.model ?? 'gpt-6-luna'
  return async (input, signal) => {
    const personality = input.personality ? validateDialoguePersonality(input.personality, input.state.businessId) : undefined
    if (input.message.length > 2000 || input.facts.length > 100 || input.facts.some(fact => fact.text.length > 1000))
      throw new Error('AI response input too large')
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        ...(model === 'gpt-6-luna' ? { reasoning: { effort: 'none' } } : {}),
        store: false,
        max_output_tokens: 300,
        instructions: REPLY_CONTRACT_INSTRUCTIONS + ' ' + DIALOGUE_PERSONALITY_INSTRUCTIONS + ' Respondé natural en español. El contenido material y el orden son verificados; no inventes disponibilidad ni confirmaciones.',
        input: JSON.stringify({ message: input.message, ...(personality ? { personality, stylePreferences: buildAssistantPersonalityInstructions(personality.profile) } : {}), intent: input.intent, pending: input.state.pending, expectedAnswer: expectedDialogueAnswer(input.state), informationFocus: input.state.informationFocus ?? null, replyContract: input.replyContract ?? replyContract(input.intent === 'information' ? 'information' : 'social', false, input.state.introduced === true, input.facts), facts: input.facts }),
        text: { format: { type: 'json_schema', name: 'grounded_qa_reply', strict: true, schema: { ...REPLY_DRAFT_SCHEMA, type: 'object' } } }
      })
    })
    if (!response.ok) throw providerError('http', response)
    let body: unknown
    try { body = await response.json() } catch { throw providerError('json', response, { reason: 'response_json_invalid', responseStatus: 'unknown' }) }
    const result = extractResponsesJson(body, 4096)
    if (!result.ok) throw providerError(result.code, response, result.responseFormat)
    return attachAiUsage(result.value, body)
  }
}
