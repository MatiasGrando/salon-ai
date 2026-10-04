import type { DialogueProfessional, DialogueService } from './engine.js'
import type { ProfessionalInformationFacts } from './information-contract.js'

export type ProfessionalEligibilityFailure = {
  businessId: string
  serviceIds: readonly string[]
  professional: DialogueProfessional
  cause: 'SERVICE_MISMATCH' | 'BOOKING_RESTRICTED' | 'UNAVAILABLE'
  missingServices: readonly { id: string; name: string }[]
}
const validText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && value.length <= max && !/[\u0000-\u001f]/.test(value)

/** Public descriptors resolve identity only. Cached services, schedules and flags grant no booking authority. */
export function professionalIdentities(facts: ProfessionalInformationFacts, businessId: string): DialogueProfessional[] {
  const validScope = facts.businessId === businessId && typeof facts.complete === 'boolean'
  const validRows = Array.isArray(facts.professionals) && facts.professionals.length <= 50 &&
    new Set(facts.professionals.map(p => p.id)).size === facts.professionals.length &&
    facts.professionals.every(p => validText(p.id, 128) && validText(p.name, 200))
  if (!validScope || !validRows) throw Error('invalid professional identity scope')
  return facts.professionals.map(p => ({ id: p.id, name: p.name, priority: 0 }))
}

/** Reject foreign, partial-basket and invented missing-service evidence before rendering server data. */
export function professionalFailureMessage(
  proof: ProfessionalEligibilityFailure, businessId: string, services: readonly DialogueService[], professionalId: string
): string {
  const ids = services.map(s => s.id)
  const validScope = proof.businessId === businessId && proof.professional?.id === professionalId &&
    validText(proof.professional.name, 200) && Array.isArray(proof.serviceIds) && proof.serviceIds.length === ids.length &&
    new Set(proof.serviceIds).size === ids.length && proof.serviceIds.every(id => ids.includes(id))
  const validCause = ['SERVICE_MISMATCH', 'BOOKING_RESTRICTED', 'UNAVAILABLE'].includes(proof.cause)
  const validMissing = Array.isArray(proof.missingServices) &&
    new Set(proof.missingServices.map(s => s.id)).size === proof.missingServices.length &&
    proof.missingServices.every(s => validText(s.name, 200) && services.some(service => service.id === s.id && service.name === s.name)) &&
    (proof.cause === 'SERVICE_MISMATCH') === Boolean(proof.missingServices.length)
  if (!validScope || !validCause || !validMissing) throw Error('invalid professional eligibility proof scope')
  if (proof.cause === 'SERVICE_MISMATCH') return proof.professional.name + ' no realiza estos servicios del pedido: ' + proof.missingServices.map(s => s.name).join(', ') + '.'
  if (proof.cause === 'BOOKING_RESTRICTED') return 'Para reservar con ' + proof.professional.name + ' necesitás consultar con el equipo; no puedo reservar por este canal.'
  return 'No pude verificar la disponibilidad de ' + proof.professional.name + ' para este pedido. Podés consultar con el equipo.'
}
