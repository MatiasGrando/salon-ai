import type { AiInterpretationProvider } from './ai-interpreter.js'
import type { DialogueState, DialoguePort } from './engine.js'
import { pendingQuestion } from './information.js'
import { readConversationDraft } from './session-state.js'
import type { ConversationPolicy } from './runtime-policy.js'

export const CONVERSATION_PROOF_ACTION = 'conversation.deposit_proof'
export type AttachmentIntent = 'deposit_proof' | 'service_reference' | 'other' | 'unclear'
export type AttachmentMetadata = { messageType: 'image' | 'document'; mimeType: string | null; proofExpected: boolean }
export type ConversationProofBinding = {
  version: 1; businessId: string; sessionId: string; deploymentId: string; generation: number;
  configurationId: string; revision: string; depositId: string; operationKey: string;
  proposalNonce: string; fingerprint: string; coordinationGroupId: string
}
export type ProofSessionScope = { businessId: string; sessionId: string; deploymentId: string;
  generation: number; configurationId: string; revision: string; timezone?: string }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const purposes: readonly AttachmentIntent[] = ['deposit_proof', 'service_reference', 'other', 'unclear']
export function parseAttachmentIntent(value: unknown): AttachmentIntent | null {
  return typeof value === 'string' && purposes.includes(value as AttachmentIntent) ? value as AttachmentIntent : null
}

/** A receipt already committed with DEPOSIT_INSTRUCTIONS proves the server asked
 * for this exact payment. Do not depend on provider SENT callbacks: an attachment
 * can arrive before the sender's callback commits. No receipt is inferred from a
 * phone match, an AI classification, or a photo filename. */
export function conversationProofBindingFromState(state: unknown, scope: ProofSessionScope): ConversationProofBinding | null {
  if (!object(state) || state.flow !== 'DEPOSIT_INSTRUCTIONS' || state.booking !== 'HELD' ||
      !['PENDING_PROOF', 'REJECTED_RESUBMISSION_ALLOWED'].includes(String(state.deposit)) || !object(state.conversationDraft)) return null
  const policy = state.conversationDraft.policy
  if (!object(policy) || policy.businessId !== scope.businessId || policy.deploymentId !== scope.deploymentId ||
      policy.generation !== scope.generation || policy.configurationId !== scope.configurationId || !/^\d+$/.test(scope.revision)) return null
  try {
    const draft = readConversationDraft(state, policy as unknown as ConversationPolicy, scope.timezone ?? 'UTC')
    const reservation = draft.bookingReservation, receipt = reservation?.receipt
    if (receipt?.kind !== 'HELD' || !['PENDING_PROOF', 'PENDING_RESUBMISSION'].includes(receipt.depositStatus) ||
        receipt.proposalNonce !== reservation!.presented.nonce || receipt.fingerprint !== reservation!.presented.fingerprint) return null
    return { version: 1, businessId: scope.businessId, sessionId: scope.sessionId, deploymentId: scope.deploymentId,
      generation: scope.generation, configurationId: scope.configurationId, revision: scope.revision,
      depositId: receipt.depositId, operationKey: receipt.operationKey, proposalNonce: receipt.proposalNonce,
      fingerprint: receipt.fingerprint, coordinationGroupId: receipt.coordinationGroupId }
  } catch { return null }
}
export function parseConversationProofBinding(value: unknown): ConversationProofBinding | null {
  if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 ||
      !/^\d+$/.test(String(value.revision)) || Object.keys(value).sort().join(',') !==
      ['version','businessId','sessionId','deploymentId','generation','configurationId','revision','depositId','operationKey','proposalNonce','fingerprint','coordinationGroupId'].sort().join(',')) return null
  for (const key of ['businessId','sessionId','deploymentId','configurationId','depositId','operationKey','proposalNonce','fingerprint','coordinationGroupId']) {
    if (typeof value[key] !== 'string' || !(value[key] as string).length || (value[key] as string).length > 256 || /[\u0000-\u001f]/.test(value[key] as string)) return null
  }
  return value as unknown as ConversationProofBinding
}
export function sameConversationProofBinding(current: ConversationProofBinding, bound: ConversationProofBinding): boolean {
  // An unrelated acknowledgement may advance the revision without changing the
  // financial receipt. Never accept a binding from a future session revision.
  return BigInt(current.revision) >= BigInt(bound.revision) && Object.entries(bound).every(([key, value]) => key === 'revision' || current[key as keyof ConversationProofBinding] === value)
}

export async function interpretConversationAttachment(input: {
  state: DialogueState; payload: { messageType?: unknown; mediaMimeType?: unknown; textBody?: unknown };
  proofExpected: boolean; port: DialoguePort; provider?: AiInterpretationProvider; timeoutMs?: number
}): Promise<{ intent: AttachmentIntent; reply: string; aiCalls: number }> {
  const type = input.payload.messageType === 'document' ? 'document' : 'image'
  const mime = typeof input.payload.mediaMimeType === 'string' && input.payload.mediaMimeType.length <= 80
    ? input.payload.mediaMimeType.split(';')[0]!.trim().toLowerCase() : null
  const caption = typeof input.payload.textBody === 'string' ? input.payload.textBody.trim().slice(0, 2000) : ''
  let intent: AttachmentIntent = 'unclear', aiCalls = 0
  if (input.provider) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const services = await input.port.catalog()
      aiCalls = 1
      const result = await Promise.race([
        input.provider({ message: caption || '[El cliente envió un adjunto sin texto]', state: input.state, services,
          attachment: { messageType: type, mimeType: mime, proofExpected: input.proofExpected } }, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('attachment_interpretation_timeout')) }, input.timeoutMs ?? 15000) })
      ])
      if (object(result)) intent = parseAttachmentIntent(result.attachmentIntent) ?? 'unclear'
    } catch { intent = 'unclear' }
    finally { if (timer) clearTimeout(timer) }
  }
  // Purpose is only a conversational suggestion. It cannot create or approve a
  // payment; the caller must independently bind and revalidate a server receipt.
  if (intent === 'deposit_proof' && !input.proofExpected) intent = 'unclear'
  const next = pendingQuestion(input.state)
  const reply = intent === 'service_reference'
    ? 'Gracias por la referencia. No analicé el contenido del archivo. ¿Me contás qué resultado buscás? Conservé tu pedido.'
    : input.proofExpected
      ? 'No pude determinar para qué es ese archivo. Si es la seña, reenviá el comprobante con el texto «comprobante de la seña». Si es una referencia, contame qué resultado buscás. Todavía no registré un pago.'
      : 'Recibí tu archivo, pero no analicé su contenido. ¿Me contás para qué querés usarlo?' + (next ? '\n\n' + next : '')
  return { intent, reply, aiCalls }
}
