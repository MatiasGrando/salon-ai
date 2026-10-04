/** Shared server-owned reply policy. Diagnostics contain no chat text, catalog IDs or names. */
export type ReplyFact = { id: string; text: string; variants?: readonly { id: string; text: string }[] }
export type ReplyRole = 'social' | 'information' | 'clarification' | 'continuation' | 'confirmation'
export type ReplyContract = {
  version: 1
  role: ReplyRole
  introduction: 'server_pending' | 'server_complete' | 'none'
  continuation: 'next' | null
  neutral: boolean
}
export type ReplyRejection =
  | 'missing_draft' | 'invalid_shape' | 'fact_membership' | 'fact_order' | 'continuation_conflict'
  | 'neutral_frame' | 'frame_bounds' | 'unverified_value' | 'catalog_in_frame' | 'unverified_action'
  | 'identity_in_frame' | 'empty_text' | 'reply_bounds' | 'intake_mismatch'
  | 'provider_error' | 'timeout' | 'interpretation_invalid'
export type ReplyValidation = {
  status: 'accepted' | 'rejected' | 'not_attempted'
  reason: ReplyRejection | 'new_facts' | 'canonical_only' | null
  factCount: number
  providedCount: number
}
export type ReplyValidationTrace = { firstCall: ReplyValidation; secondCall: ReplyValidation }
export type ReplyValidationResult = { validation: ReplyValidation; text: string | null; modelFraming: boolean }

export const REPLY_DRAFT_SCHEMA = {
  type: ['object', 'null'], additionalProperties: false, required: ['opening', 'factIds', 'closing', 'variantChoices'],
  properties: {
    opening: { type: ['string', 'null'] },
    factIds: { type: 'array', items: { type: 'string' } },
    closing: { type: ['string', 'null'] },
    variantChoices: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['factId', 'variantId'], properties: { factId: { type: 'string' }, variantId: { type: 'string' } } } }
  }
} as const
export const REPLY_CONTRACT_INSTRUCTIONS =
  'replyContract define el rol y la propiedad de la presentación. ' +
  'La introducción configurada pertenece al servidor: con server_pending o server_complete no agregues saludo ni identidad. opening puede responder charla concreta sin presentación. ' +
  'Primero atendé la respuesta social o intención concreta del mensaje, luego los hechos verificados y sólo la continuación necesaria. Podés variar naturalmente transiciones y charla según el rol, sin frases obligatorias. Las preguntas sociales no están prohibidas globalmente. ' +
  'Incluí todos los factIds exactamente una vez en el orden recibido; el servidor inserta sus textos o la variante revisada elegida por ID. variantChoices es null o una lista de factId/variantId presentes en variants del hecho; no contiene texto libre. Hechos sin variants son inmutables. ' +
  'Si hay next debe ir al final y closing es null. Si neutral es true, opening es null: el cuerpo ya contiene el encuadre verificado. ' +
  'opening/closing no contienen cifras, URLs, entidades del catálogo, hechos del negocio ni acciones ejecutadas. ' +
  'Si no necesitás encuadre, ambos son null: el servidor puede entregar el cuerpo verificado sin otra llamada.'

export function replyContract(role: ReplyRole, identityAvailable: boolean, introduced: boolean,
  facts: readonly ReplyFact[], neutral = false): ReplyContract {
  return {
    version: 1, role,
    introduction: identityAvailable ? introduced ? 'server_complete' : 'server_pending' : 'none',
    continuation: facts.some(fact => fact.id === 'next') ? 'next' : null, neutral
  }
}
export function skippedReplyValidation(facts: readonly ReplyFact[], reason: 'new_facts' | 'canonical_only'): ReplyValidation {
  return { status: 'not_attempted', reason, factCount: Math.min(facts.length, 101), providedCount: 0 }
}
const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const words = (text: string) => ' ' + normalized(text).replace(/[^a-z0-9]+/g, ' ').trim() + ' '

/** Model frames are optional. Fact membership, order and material fragments always belong to the server. */
export function validateReplyDraft(raw: unknown, facts: readonly ReplyFact[], contract: ReplyContract,
  catalogNames: readonly string[]): ReplyValidationResult {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  const providedCount = Array.isArray(value?.factIds) ? Math.min(value.factIds.length, 101) : 0
  const selectedVariants = new Map<string, string>()
  const result = (reason: ReplyRejection | null, text: string | null = null): ReplyValidationResult => ({
    text,
    modelFraming: Boolean(text && [value?.opening, value?.closing]
      .some(part => typeof part === 'string' && part.trim()) || text && selectedVariants.size),
    validation: { status: reason ? 'rejected' : 'accepted', reason, factCount: Math.min(facts.length, 101), providedCount }
  })
  if (raw == null) return result('missing_draft')
  if (!value || !['closing,factIds,opening', 'closing,factIds,opening,variantChoices'].includes(Object.keys(value).sort().join(',')) || !Array.isArray(value.factIds)) return result('invalid_shape')
  if (value.factIds.length !== facts.length || new Set(value.factIds).size !== facts.length ||
      value.factIds.some(id => typeof id !== 'string' || !facts.some(fact => fact.id === id))) return result('fact_membership')
  if (JSON.stringify(value.factIds) !== JSON.stringify(facts.map(fact => fact.id))) return result('fact_order')
  if (value.variantChoices !== undefined && value.variantChoices !== null) {
    if (!Array.isArray(value.variantChoices) || value.variantChoices.length > facts.length) return result('invalid_shape')
    for (const rawChoice of value.variantChoices) {
      if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice)) return result('invalid_shape')
      const choice = rawChoice as Record<string, unknown>
      if (Object.keys(choice).sort().join(',') !== 'factId,variantId' || typeof choice.factId !== 'string' || typeof choice.variantId !== 'string' || selectedVariants.has(choice.factId)) return result('invalid_shape')
      const fact = facts.find(item => item.id === choice.factId)
      const variant = fact?.variants?.find(item => item.id === choice.variantId)
      if (!variant || variant.text.length > 1000 || /[\u0000-\u001f]/.test(variant.text)) return result('fact_membership')
      selectedVariants.set(choice.factId, variant.text)
    }
  }
  if (contract.continuation && (value.factIds.at(-1) !== 'next' || value.closing !== null)) return result('continuation_conflict')
  if (contract.neutral && value.opening !== null) return result('neutral_frame')
  const framing = [value.opening, value.closing]
  if (framing.some(part => part !== null && (typeof part !== 'string' || part.length > 180 || /[\u0000-\u001f]/.test(part)))) return result('frame_bounds')
  if (framing.some(part => typeof part === 'string' && /[\d$€]|https?:|www\./i.test(part))) return result('unverified_value')
  if (framing.some(part => typeof part === 'string' && catalogNames.some(name => words(part).includes(words(name))))) return result('catalog_in_frame')
  if (framing.some(part => typeof part === 'string' && /\b(?:reserve|agende|confirme|guarde|actualice|cambie|modifique|asigne|asignado|seleccione|seleccionado|anote|anotado|reservado|agendado|confirmado|disponible|disponibilidad|agotado|gratis)\b/.test(normalized(part)))) return result('unverified_action')
  if (contract.introduction !== 'none' && framing.some(part => typeof part === 'string' && /\b(?:soy|me llamo|mi nombre)\b/.test(normalized(part)))) return result('identity_in_frame')
  if (contract.introduction === 'server_pending' && framing.some(part => typeof part === 'string' && /\bhol+a\b/.test(normalized(part)))) return result('identity_in_frame')
  const text = [value.opening, ...facts.map(fact => selectedVariants.get(fact.id) ?? fact.text), value.closing]
    .filter(part => typeof part === 'string' && part.trim()).join('\n')
  return !text ? result('empty_text') : text.length > 5000 ? result('reply_bounds') : result(null, text)
}
