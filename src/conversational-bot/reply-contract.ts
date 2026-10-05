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
export type ReplyValidationResult = { validation: ReplyValidation; text: string | null; modelFraming: boolean; openingText?: string }

export const REPLY_DRAFT_SCHEMA = {
  type: ['object', 'null'], additionalProperties: false, required: ['salutation', 'opening', 'factIds', 'closing', 'variantChoices'],
  properties: {
    salutation: { type: ['string', 'null'], enum: ['greeting', null] },
    opening: { type: ['string', 'null'] },
    factIds: { type: 'array', items: { type: 'string' } },
    closing: { type: ['string', 'null'] },
    variantChoices: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['factId', 'variantId'], properties: { factId: { type: 'string' }, variantId: { type: 'string' } } } }
  }
} as const
/** Shared writing guide: the model owns framing choices, not identity, facts or effects. */
export const REPLY_COMPOSITION_GUIDE = [
  'Presentación del servidor: replyContract define el rol y la propiedad de la presentación. salutation es null o greeting, nunca texto libre. Con server_pending, greeting expresa saludar pero el servidor lo integra en su presentación configurada una sola vez. Con server_complete, greeting produce sólo un saludo del servidor, sin repetir identidad; con none produce sólo ese saludo. opening/closing no repiten el saludo si usás el contrato con salutation. No escribas identidad propia con server_pending ni server_complete.',
  'Respuesta social y reconocimiento: opening atiende la charla concreta y reconoce la intención antes del cuerpo material, sin otra presentación. Podés variar naturalmente respuesta social y transición según el mensaje y el rol, sin frases obligatorias ni inventar hechos o estados del negocio. Ante una pregunta explícita de cortesía, opening incluye una respuesta social breve y natural antes de reconocer el pedido y continuar. El saludo no sustituye esa respuesta, ni la pregunta de ayuda responde por sí sola a la cortesía. No repitas un saludo en opening como respuesta social. Redactá libremente dentro de ese orden, sin copiar una frase obligatoria. Un saludo no obliga a preguntar cómo está el cliente. Las preguntas sociales no están prohibidas globalmente.',
  'Cuerpo material: incluí todos los factIds exactamente una vez en el orden recibido; el servidor inserta sus textos o la variante revisada elegida por ID. variantChoices es null o una lista de factId/variantId presentes en variants del hecho; no contiene texto libre. Hechos sin variants son inmutables. opening/closing no contienen cifras, URLs, entidades del catálogo, hechos del negocio ni acciones ejecutadas.',
  'Continuación pertinente: si hay next debe ir al final y closing es null. No agregues otra pregunta de adquisición o confirmación en opening. Si neutral es true, opening es null: el cuerpo ya contiene el encuadre verificado. Si no necesitás encuadre, salutation/opening/closing son null: el servidor puede entregar el cuerpo verificado sin otra llamada.'
] as const
export const REPLY_CONTRACT_INSTRUCTIONS = REPLY_COMPOSITION_GUIDE.join(' ')

/** Interpretation shares the writing policy, but its facts precede semantic updates. */
export const FIRST_CALL_COMPOSITION_INSTRUCTIONS =
  'Primera llamada, cualquier intención: si firstReplyFacts está presente, redactá el encuadre firstReply que corresponde al mensaje junto con la interpretación. Incluye charla, información, booking con operations vacío y pedidos combinados con cambios. Separá salutation de opening: respondé la charla y reconocé la intención concreta sin otra identidad ni saludo libre. La respuesta a cortesía explícita no se omite por una reserva, una consulta lateral o un cambio de datos; después va la pregunta pertinente del servidor. ' +
  'Usá todos los factIds originales en orden y closing null cuando hay next. El servidor valida el borrador completo; si el motor prepara otro cuerpo reutiliza sólo el encuadre validado y reemplaza los hechos y la continuación por los verificados. No copies ni anticipes hechos posteriores; no es necesario predecir la nueva pregunta. Si firstReplyFacts no está presente, firstReply es null. ' +
  'intakeReply se conserva sólo para el adaptador sin plan: si intakeReplyAllowed y no hay corrección podés anticipar pregunta de servicio o fecha, con pending/serviceId/candidateIds del próximo estado esperado; el servidor verificará e insertará hechos. Si no podés anticiparlo, intakeReply null. Con plan, intakeReply null. Ante charla conservá la pregunta pendiente; pedidos ajenos se encauzan brevemente a ayuda del local. '

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

/** Recognize presentation acts in outbound framing, not intentions in client messages.
 * Orthographic emphasis does not change the act. Clausal greetings remain distinct
 * from ordinary courtesy such as thanking someone for their buenas palabras.
 */
function hasSalutationAct(text: string): boolean {
  const plain = normalized(text).replace(/([a-z])\1+/g, '$1')
  return plain.split(/[.!?¡¿,;:]+/u).some(clause => {
    const tokens: string[] = clause.match(/[a-z]+/g) ?? []
    return tokens.includes('hola') || tokens[0] === 'buenas' && (tokens.length === 1 || ['tardes', 'noches'].includes(tokens[1] ?? '')) ||
      tokens[0] === 'buen' && tokens[1] === 'dia' || tokens[0] === 'buenos' && tokens[1] === 'dias'
  })
}

/** Model frames are optional. Fact membership, order and material fragments always belong to the server. */
export function validateReplyDraft(raw: unknown, facts: readonly ReplyFact[], contract: ReplyContract,
  catalogNames: readonly string[]): ReplyValidationResult {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  const providedCount = Array.isArray(value?.factIds) ? Math.min(value.factIds.length, 101) : 0
  const selectedVariants = new Map<string, string>()
  // A typed act is rendered by the server; no free greeting string is trimmed or rescued.
  const salutation = value?.salutation === 'greeting' && contract.introduction !== 'server_pending' ? '¡Hola!' : null
  const result = (reason: ReplyRejection | null, text: string | null = null): ReplyValidationResult => ({
    text,
    ...(!reason ? { openingText: [salutation, value?.opening].filter(part => typeof part === 'string' && part.trim()).join('\n') } : {}),
    modelFraming: Boolean(text && [value?.opening, value?.closing]
      .some(part => typeof part === 'string' && part.trim()) || text && (selectedVariants.size || salutation)),
    validation: { status: reason ? 'rejected' : 'accepted', reason, factCount: Math.min(facts.length, 101), providedCount }
  })
  if (raw == null) return result('missing_draft')
  if (!value || !['closing,factIds,opening', 'closing,factIds,opening,variantChoices'].includes(Object.keys(value).filter(key => key !== 'salutation').sort().join(',')) || !Array.isArray(value.factIds)) return result('invalid_shape')
  if (Object.hasOwn(value, 'salutation') && value.salutation !== null && value.salutation !== 'greeting') return result('invalid_shape')
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
  if ((contract.introduction !== 'none' || Object.hasOwn(value, 'salutation')) && framing.some(part => typeof part === 'string' && /\b(?:soy|me llamo|mi nombre)\b/.test(normalized(part)))) return result('identity_in_frame')
  if ((contract.introduction === 'server_pending' || Object.hasOwn(value, 'salutation')) && framing.some(part => typeof part === 'string' && hasSalutationAct(part))) return result('identity_in_frame')
  const text = [salutation, value.opening, ...facts.map(fact => selectedVariants.get(fact.id) ?? fact.text), value.closing]
    .filter(part => typeof part === 'string' && part.trim()).join('\n')
  return !text ? result('empty_text') : text.length > 5000 ? result('reply_bounds') : result(null, text)
}
