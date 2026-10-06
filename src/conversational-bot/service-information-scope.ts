import { assessServiceIdentity } from './service-request.js'
import type { DialogueService } from './engine.js'
import { isCustomerText } from './customer-text.js'
import type { ServiceInformationAspect } from './information-contract.js'
import type { TurnOperation } from './turn-plan.js'

/** Ephemeral current-turn evidence, not a provider field or persisted focus. */
export type CurrentServiceInquiry = {
  operationIndex: number; businessId: string; serviceId: string; aspect: ServiceInformationAspect
  identityMention: string; ownerEvidence: string; inquiryEvidence: string; operationEvidence: string
}
/** Locate against original text; Unicode normalization must never supply offsets. */
export function uniqueLiteralSpan(text: string, mention: string): { start: number; end: number } | null {
  if (!mention) return null
  const start = text.indexOf(mention)
  if (start < 0 || text.indexOf(mention, start + 1) >= 0) return null
  return { start, end: start + mention.length }
}
/** A complete current body fences modern reads even when no identity scope was proved. */
export type CurrentServiceReadEvidence = Omit<CurrentServiceInquiry, 'identityMention' | 'ownerEvidence'> & { projectionRejected?: true }
export function validCurrentServiceReadOrigin(scope: CurrentServiceReadEvidence, operation: TurnOperation | undefined,
  message: string, businessId: string): boolean {
  return scope.businessId === businessId &&
    Number.isSafeInteger(scope.operationIndex) && scope.operationIndex >= 0 &&
    isCustomerText(scope.serviceId, 128) && isCustomerText(scope.operationEvidence, 300) &&
    isCustomerText(scope.inquiryEvidence, 2000) && scope.inquiryEvidence === message && message.includes(scope.operationEvidence) &&
    operation?.kind === 'information' && Number.isFinite(operation.confidence) &&
    operation.confidence >= 0 && operation.confidence <= 1 && operation.target.kind === 'service' &&
    operation.target.estimateOptionId === undefined && operation.target.serviceIds.length === 1 &&
    operation.target.serviceIds[0] === scope.serviceId && operation.target.aspect === scope.aspect &&
    operation.evidence === scope.operationEvidence
}
/** Structural weak-origin evidence carries rejection only; it never grants read authority. */
export function validCurrentServiceRead(scope: CurrentServiceReadEvidence, operation: TurnOperation | undefined,
  message: string, businessId: string): boolean {
  return !scope.projectionRejected && validCurrentServiceReadOrigin(scope, operation, message, businessId) &&
    operation!.confidence >= .85
}
export function validCurrentServiceInquiry(scope: CurrentServiceInquiry, operation: TurnOperation | undefined,
  message: string, businessId: string): boolean {
  return validCurrentServiceRead(scope, operation, message, businessId) &&
    isCustomerText(scope.ownerEvidence, 300) && message.includes(scope.ownerEvidence) &&
    isCustomerText(scope.identityMention, 100) &&
    !!uniqueLiteralSpan(message, scope.identityMention) && !!uniqueLiteralSpan(scope.ownerEvidence, scope.identityMention) &&
    !!uniqueLiteralSpan(scope.operationEvidence, scope.identityMention)
}
const dimensions: Record<ServiceInformationAspect, readonly string[]> = {
  price: ['precio', 'valor', 'costo', 'coste'], duration: ['duracion'],
  description: ['descripcion', 'inclusion'], overview: ['informacion', 'detalle', 'detalles'],
  variants: ['opciones', 'variantes'], products: ['producto', 'productos', 'marca', 'marcas'],
  discount: ['descuento', 'descuentos'], comparison: ['comparacion'], recommendation: ['recomendacion']
}
/**
 * Complete grammar of factual operators around one exact identity span.
 * This is intentionally bounded, not a semantic classifier or a service alias list.
 * Anything not consumed (including modifiers/negation/conditions) stays unproven.
 */
export function neutralServiceInquiry(evidence: string, mention: string, aspect: ServiceInformationAspect): boolean {
  const span = uniqueLiteralSpan(evidence, mention)
  if (!span || !dimensions[aspect]) return false
  const remainder = (evidence.slice(0, span.start) + ' @ ' + evidence.slice(span.end))
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (/[^a-z\s@¿?.,]/u.test(remainder)) return false
  const text = remainder.replace(/[¿?.,]/g, ' ').trim().split(/\s+/u).join(' ')
  if (text === '@') return true
  const dimension = '(?:' + dimensions[aspect].join('|') + ')'
  const article = '(?:(?:el|la|los|las) )?'
  const referential = '(?:(?:de esas opciones|de estas opciones|entre esas opciones) )?'
  const intention = '(?:me (?:interesa|gustaria)|quiero|quisiera|queria|deseo|necesito)'
  const reading = '(?:saber|consultar|conocer|averiguar)'
  const carrier = '(?:(?:' + intention + '(?: ' + reading + ')?|' + reading + ') )?'
  const question = '(?:(?:cual es|cuales son|que) )?'
  const before = referential + carrier + question + article + dimension + ' (?:de|del|sobre|para) ' + article + '@'
  const after = '(?:sobre|de|para) (?:(?:ese|esa|el|la) )?@ (?:que ' + dimension + ' tiene|cual es ' + article + dimension + ')'
  const priceVerb = aspect === 'price' ? referential + carrier + 'cuanto (?:cuesta|sale|vale) ' + article + '@' : '(?!)'
  return new RegExp('^(?:' + before + '|' + after + '|' + priceVerb + ')$').test(text)
}

/** Complete-body fallback uses current exact public names, never partial quotes or proposed IDs alone. */
export function neutralCatalogServiceInquiry(evidence: string, serviceId: string, aspect: ServiceInformationAspect,
  services: readonly DialogueService[]): boolean {
  const candidates = services.filter(service => uniqueLiteralSpan(evidence, service.name))
  if (candidates.length !== 1 || candidates[0]!.id !== serviceId) return false
  const name = candidates[0]!.name
  return neutralServiceInquiry(evidence, name, aspect) &&
    assessServiceIdentity(name, serviceId, 1, services).kind === 'supported'
}

/** Independent current-body proof. Catalog labels provide grammar tokens, not rejected-model authority. */
export function independentServiceInformationInquiry(message: string, aspect: ServiceInformationAspect | null,
  focus: import('./information-contract.js').InformationFocus | undefined, businessId: string,
  services: readonly DialogueService[]): { serviceId: string; identityMention: string; aspect: ServiceInformationAspect } | null {
  if (!isCustomerText(message, 2000) || !aspect || !focus?.serviceId || focus.awaitingChoice || focus.businessId !== businessId ||
      focus.options.some(option => !services.some(service => service.id === option.id && service.name === option.label))) return null
  const escape = (value: string) => value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
  const candidates = services.flatMap(service => {
    const tokens = service.name.trim().split(/\s+/u)
    if (!tokens.length || !tokens.every(Boolean)) return []
    const pattern = tokens.map(escape).join('\\s+(?:(?:de|del|el|la|los|las)\\s+)*')
    const matches = [...message.matchAll(new RegExp('(?<![\\p{L}\\p{N}])' + pattern + '(?![\\p{L}\\p{N}])', 'giu'))]
    return matches.map(match => ({ serviceId: service.id, identityMention: match[0] }))
  })
  if (candidates.length !== 1 || candidates[0]!.serviceId !== focus.serviceId) return null
  const current = candidates[0]!
  return neutralServiceInquiry(message, current.identityMention, aspect) &&
    assessServiceIdentity(current.identityMention, current.serviceId, 1, services).kind === 'supported'
    ? { ...current, aspect } : null
}
