import type { AssistantPersonality } from '../services/assistant-personality-config.js'

export type DialogueIdentity = {
  businessId: string
  businessName: string
  assistantName: string
  treatment: AssistantPersonality['treatment']
  greetingEmoji?: string | null
}
export function validateDialogueIdentity(identity: DialogueIdentity): DialogueIdentity {
  for (const [value, limit] of [[identity.businessId, 128], [identity.businessName, 200], [identity.assistantName, 40]] as const) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error('invalid dialogue identity')
  }
  if (!['vos', 'tu', 'usted'].includes(identity.treatment)) throw new Error('invalid dialogue identity treatment')
  if (identity.greetingEmoji != null && (identity.greetingEmoji.length > 12 || /[\u0000-\u001f]/.test(identity.greetingEmoji))) throw new Error('invalid dialogue identity emoji')
  return identity
}
export type IntroductionInput = { identity: DialogueIdentity; introduced: boolean; customerName?: string | null } &
  ({ kind: 'social' } | { kind: 'concrete'; reply: string })
/** The caller owns conversation reset and intent. Identity alone is not a booking request. */
export function introduceDialogue(input: IntroductionInput): { reply: string; introduced: true } {
  const identity = validateDialogueIdentity(input.identity)
  if (typeof input.introduced !== 'boolean') throw new Error('invalid introduction marker')
  const help = identity.treatment === 'usted' ? '¿En qué puedo ayudarle?'
    : identity.treatment === 'tu' ? '¿En qué puedo ayudarte?' : '¿En qué te puedo ayudar?'
  const body = input.kind === 'social' ? help : input.reply.trim()
  // Public facts are already bounded by their source; transport owns fragmentation, not introduction.
  if (!body) throw new Error('invalid concrete reply')
  if (input.introduced) return { reply: body, introduced: true }
  const name = input.customerName?.trim()
  if (name && (name.length > 100 || /[\u0000-\u001f]/.test(name))) throw new Error('invalid customer greeting')
  const hello = name ? `¡Holaa, ${name}!` : '¡Holaa!'
  return { reply: `${hello}${identity.greetingEmoji ? ` ${identity.greetingEmoji}` : ''} Soy ${identity.assistantName}, de ${identity.businessName}.\n\n${body}`, introduced: true }
}
