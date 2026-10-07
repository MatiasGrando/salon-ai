import { serviceRequestReply } from './service-request.js'
import { selectionBasket } from './service-basket.js'
import { serviceGuidance, type GuidanceBlock } from './service-guidance.js'
import type { DialogueResponse, DialogueService, DialogueState } from './engine.js'

export type ConversationalReferral = {
  businessId: string
  status: 'offered' | 'pending'
  reason: GuidanceBlock | 'UNVERIFIED_SERVICE'
  request: string
  serviceId: string | null
}
const reasons = ['INVALID_CONFIGURATION', 'DOMAIN_REVIEW', 'PHOTO_REQUIRED', 'VALIDATION_REQUIRED', 'ESTIMATE_NOT_BOOKABLE', 'UNVERIFIED_SERVICE']
const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value)
export function parseConversationalReferral(value: unknown, businessId: string): ConversationalReferral {
  const item = value as Record<string, unknown>
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).sort().join(',') !== 'businessId,reason,request,serviceId,status' ||
      item.businessId !== businessId || !['offered', 'pending'].includes(String(item.status)) ||
      !reasons.includes(String(item.reason)) || !bounded(item.request, 300) ||
      !(item.serviceId === null || bounded(item.serviceId, 128)) ||
      (item.reason === 'UNVERIFIED_SERVICE' ? item.serviceId !== null : item.serviceId === null)) {
    throw new Error('invalid conversational referral scope')
  }
  return structuredClone(item) as ConversationalReferral
}
/** Generic conversation controls only; no procedure vocabulary or CRM effects. */
export function explicitReferralAction(message: string): 'consult' | 'resume' | null {
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (/^(?:(?:quiero|prefiero|podemos) )?(?:volver|seguir|continuar) (?:con |al )?(?:el )?bot$/.test(text) ||
      /^(?:(?:quiero|prefiero) )?(?:sacar|quitar|cancelar) (?:la )?derivacion$/.test(text)) return 'resume'
  if (/^(?:(?:quiero|prefiero) )?consultar (?:con |al )?(?:el )?equipo$/.test(text)) return 'consult'
  return null
}
export function referralPendingReply(referral: ConversationalReferral): string {
  return 'Mantengo pendiente la consulta sobre «' + referral.request +
    '». Podés hablar con el equipo por los canales del local; desde este chat no les envié el pedido. Si preferís, podemos seguir acá o cambiar el servicio.'
}
/** A changed/resolved request leaves its old conversational consultation, not human ownership. */
export function reconcileConversationalReferral(state: DialogueState, services: readonly DialogueService[]): void {
  const referral = state.referral
  if (!referral) return
  const members = selectionBasket(state).members
  const current = referral.serviceId
    ? members.some(member => member.mode === 'single' && member.serviceIds.includes(referral.serviceId!)) &&
      services.some(service => {
        const guide = serviceGuidance(service)
        return service.id === referral.serviceId && service.name === referral.request &&
          guide.kind === 'blocked' && guide.reason === referral.reason
      })
    : state.serviceRequest?.request === referral.request ||
      members.some(member => member.mode === 'unresolved' && member.evidence === referral.request)
  if (!current) delete state.referral
}
/** Offers are derived only from a server outcome; they never queue or contact a human. */
export function attachReferralOffer(response: DialogueResponse, services: readonly DialogueService[], suppress = false): void {
  const state = response.state
  reconcileConversationalReferral(state, services)
  if (suppress || state.referral) return
  const unknown = state.serviceRequest?.disposition === 'unverified_variant' ? state.serviceRequest.request
    : selectionBasket(state).members.find(member => member.mode === 'unresolved')?.evidence
  if (unknown) {
    // An active procedure question clarifies first. Internal offered state only keeps
    // explicit consultation recoverable; it is not human ownership or consent.
    const clarifyingRequest = state.serviceRequest?.request === unknown
    const offeredReply = serviceRequestReply({
      businessId: state.businessId, purpose: 'booking', disposition: 'unverified_variant',
      serviceIds: [], correction: false, continuation: false, basis: 'related_category',
      sourceQuote: null, request: unknown
    }, services)
    if (!clarifyingRequest && !response.reply.includes(offeredReply)) {
      response.reply += '\nPara «' + unknown + '», ¿Querés consultarlo con el equipo?'
      response.replyPrepared = true
    }
    state.referral = { businessId: state.businessId, status: 'offered', reason: 'UNVERIFIED_SERVICE', request: unknown, serviceId: null }
    return
  }
  const reason = response.availability?.reason
  const blocked = services.find(service => {
    const guide = serviceGuidance(service)
    return selectionBasket(state).members.some(member => member.mode === 'single' && member.serviceIds.includes(service.id)) &&
      guide.kind === 'blocked' && guide.reason === reason
  })
  if (blocked && reason && reasons.includes(reason)) {
    state.referral = { businessId: state.businessId, status: 'offered', reason: reason as GuidanceBlock, request: blocked.name, serviceId: blocked.id }
    response.reply += '\n¿Querés consultarlo con el equipo?'
    response.replyPrepared = true
  }
}
