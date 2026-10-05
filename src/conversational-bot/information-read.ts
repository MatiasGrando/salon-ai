import { stageContent } from '../bot-options/domain/service-content.js'
import { hasBasketSelection, selectionBasket } from './service-basket.js'
import type { TurnPlan } from './turn-plan.js'
import { standardDelivery, standardWorkSchedule, safePublicLink, type StandardField } from './standard-delivery.js'
import { routeActions, type InformationAction } from './actions.js'
import { normalizeAnswer } from './dialogue-context.js'
import { affirmativeMatchAnswer, matchPresentedServiceAnswer } from './contextual-matching.js'
import { formatCatalogPrice, formatCatalogDuration } from '../bot-options/application/catalog-queries.js'
import { formatServiceEstimate, parseEstimateOptions, resolveServiceEstimate } from '../bot-options/domain/service-booking.js'
import { renderInformation, renderServices, validateFacts, pendingQuestion, type BusinessFacts } from './information.js'
import { parseInformationFocus, parseInformationTarget, type InformationTarget, type InformationFocus, type ServiceInformationAspect, type BusinessInformationSubject, type ProfessionalInformationFacts } from './information-contract.js'
import type { DialogueContext, DialoguePort, DialogueService, DialogueState } from './engine.js'

export type InformationRead = { reply: string; outcome: 'found' | 'missing' | 'clarifying'; failed?: true; focus?: InformationFocus; guidanceCoverage?: { serviceId: string; remainder: string } }
/** An informational focus is evidence for a read, never an implicit basket selection. */
export function focusedInformationService(state: DialogueState, services: readonly DialogueService[]): DialogueService | null {
  const focus = state.informationFocus
  if (!focus?.serviceId || focus.awaitingChoice) return null
  const service = services.find(item => item.id === focus.serviceId)
  return service && focus.options.some(option => option.id === service.id && normalizeAnswer(option.label) === normalizeAnswer(service.name)) ? service : null
}
export function validInformationEstimate(target: InformationTarget, services: readonly DialogueService[]): boolean {
  if (target.kind !== 'service' || target.estimateOptionId === undefined) return true
  const service = services.find(item => item.id === target.serviceIds[0])
  const options = parseEstimateOptions(service?.bookingPolicy?.estimateOptions ?? [])
  return Boolean(service?.bookingPolicy && options?.some(option => option.id === target.estimateOptionId) && resolveServiceEstimate(service.bookingPolicy, target.estimateOptionId))
}
/** Compatibility adapter: legacy estimate proposals may refine a current price inquiry only. */
export function normalizeInformativeEstimates(plan: TurnPlan, state: DialogueState, services: readonly DialogueService[]): TurnPlan {
  if (plan.operations.some(operation => ['basket', 'service', 'service_request'].includes(operation.kind))) return plan
  const focused = focusedInformationService(state, services)
  if (!focused || state.informationFocus?.aspect !== 'price') return plan
  return { ...plan, operations: plan.operations.map(operation => {
    if (operation.kind !== 'estimate' || operation.confidence < .85 || operation.optionId === null ||
        operation.serviceId !== focused.id || selectionBasket(state).members.some(member => member.mode === 'single' && member.serviceIds.includes(operation.serviceId))) return operation
    const target: InformationTarget = { kind: 'service', actions: [], serviceIds: [focused.id], aspect: 'price', estimateOptionId: operation.optionId }
    return validInformationEstimate(target, services) ? { kind: 'information', target, evidence: operation.evidence, confidence: operation.confidence } : operation
  }) }
}
const missing = (subject = 'esa información'): InformationRead => ({ reply: standardDelivery({ kind: 'missing', subject }), outcome: 'missing' })
const explicitBooking = (message: string) => /\b(reservar|agendar|turno)\b/.test(normalizeAnswer(message)) && !routeActions(message).information.length
export function informationAspect(message: string): ServiceInformationAspect | null {
  const text = normalizeAnswer(message)
  if (/\b(descuento|efectivo)\b/.test(text)) return 'discount'
  if (/\b(diferencia|comparar|comparacion)\b/.test(text)) return 'comparison'
  if (/\b(mejor|conviene|recomendacion|recomendas)\b/.test(text)) return 'recommendation'
  if (/\b(producto|productos|marca|marcas)\b/.test(text)) return 'products'
  if (/\b(variantes|opciones)\b/.test(text)) return 'variants'
  if (/\b(dura|duracion|minutos)\b/.test(text)) return 'duration'
  if (/\b(incluye|incluyen|descripcion)\b/.test(text)) return 'description'
  if (/\b(precio|precios|sale|cuesta|costo)\b/.test(text)) return 'price'
  return null
}
export function businessSubject(message: string): BusinessInformationSubject | undefined {
  const text = normalizeAnswer(message)
  for (const subject of ['instagram', 'facebook', 'tiktok', 'wifi'] as const) if (text.includes(subject)) return subject
  if (/\bredes\b/.test(text)) return 'socials'
  if (/\b(pago|pagos|pagar|tarjeta|transferencia|efectivo)\b/.test(text)) return 'payments'
  if (/\bdescuentos?\b/.test(text)) return 'discounts'
  if (/\b(estacionamiento|estacionar)\b/.test(text)) return 'parking'
  if (/\b(accesibilidad|accesible)\b/.test(text)) return 'accessibility'
  if (/\bpoliticas?\b/.test(text)) return 'policies'
  if (/\b(pagina|web|sitio)\b/.test(text)) return 'website'
  if (/\b(contacto|telefono|whatsapp|correo|email)\b/.test(text)) return 'contact'
  return undefined
}
function namedInformationServices(message: string, services: readonly DialogueService[]) {
  const tokens = normalizeAnswer(message).split(' ')
  const terms = (name: string) => normalizeAnswer(name).split(' ').filter(word => !['de', 'del', 'y'].includes(word))
  let found = services.filter(service => terms(service.name).every(word => tokens.includes(word)))
  const partial = services.filter(service => terms(service.name).some(word => tokens.includes(word)))
  if (!found.length || found.length === 1 && partial.some(other => other.id !== found[0]!.id && terms(found[0]!.name).every(word => terms(other.name).includes(word)))) found = partial
  return found
}
/** Infer only bounded read targets; the provider remains the semantic path for richer language. */
export function inferInformationTarget(state: DialogueState, message: string, services: readonly DialogueService[], actions: readonly InformationAction[] = routeActions(message).information): InformationTarget | null {
  if (explicitBooking(message)) return null
  if (actions.includes('SERVICES')) return { kind: 'business', actions }
  const focus = state.informationFocus
  const aspect = informationAspect(message)
  const named = namedInformationServices(message, services)
  if ((actions.includes('SERVICE_DETAILS') || actions.includes('PRICES')) && named.length) {
    return { kind: 'service', actions: [], serviceIds: named.length > 10 ? [] : named.map(service => service.id), aspect: actions.includes('PRICES') ? 'price' : aspect ?? 'overview' }
  }
  if (focus && (focus.awaitingChoice && !actions.length || aspect && !businessSubject(message) || aspect === 'discount' && focus.serviceId)) {
    return { kind: 'service', actions: [], serviceIds: focus.options.filter(option => services.some(service => service.id === option.id && normalizeAnswer(service.name) === normalizeAnswer(option.label))).map(option => option.id), aspect: aspect ?? focus.aspect }
  }
  if (actions.includes('SERVICE_DETAILS') || actions.includes('PRICES')) {
    return { kind: 'service', actions: [], serviceIds: named.length > 10 ? [] : named.map(service => service.id), aspect: actions.includes('PRICES') ? 'price' : aspect ?? 'overview' }
  }
  if (actions.length) return { kind: 'business', actions, ...(businessSubject(message) ? { subject: businessSubject(message)! } : {}) }
  return null
}
function focusFor(state: DialogueState, services: readonly DialogueService[], aspect: ServiceInformationAspect, serviceId: string | null, candidateId: string | null = null): InformationFocus {
  return parseInformationFocus({ version: 1, businessId: state.businessId, topic: aspect === 'price' ? 'price' : 'details', aspect,
    serviceId, awaitingChoice: serviceId === null, candidateId, options: services.map(service => ({ id: service.id, label: service.name })) }, state.businessId)
}
function clarifyService(state: DialogueState, services: readonly DialogueService[], aspect: ServiceInformationAspect, candidateId: string | null = null): InformationRead {
  if (services.length > 10) services = []
  const question = candidateId ? '¿Te referís a ' + services.find(service => service.id === candidateId)!.name + '?'
    : aspect === 'price' ? services.length ? '¿De cuál de estos servicios querés saber el precio?' : '¿De qué servicio querés consultar el precio?'
      : services.length ? '¿De cuál de estos servicios querés información?' : '¿Sobre qué servicio querés información?'
  return { reply: candidateId || !services.length ? question : renderServices(services, aspect === 'price' ? 'price' : 'details'), outcome: 'clarifying',
    focus: focusFor(state, services, aspect, null, candidateId) }
}
function serviceRead(state: DialogueState, message: string, target: Extract<InformationTarget, { kind: 'service' }>, services: readonly DialogueService[]): InformationRead {
  const old = state.informationFocus
  if (old?.serviceId && !services.some(service => service.id === old.serviceId) && !target.serviceIds.length) return missing('la información vigente de ese servicio')
  let selected = services.filter(service => target.serviceIds.includes(service.id))
  if (!target.serviceIds.length) selected = namedInformationServices(message, services)
  const choiceAnswer = old?.awaitingChoice && !routeActions(message).information.length
  if (choiceAnswer) {
    const eligible = services.filter(service => old.options.some(option => option.id === service.id && normalizeAnswer(option.label) === normalizeAnswer(service.name)))
    if (eligible.length !== old.options.length) return missing('la información vigente de ese servicio')
    if (old.candidateId && !/[?¿]/.test(message) && affirmativeMatchAnswer(message)) selected = eligible.filter(service => service.id === old.candidateId)
    else {
      const pool = old.options.length ? eligible : services
      const result = matchPresentedServiceAnswer({ businessId: state.businessId, category: 'service' }, message, pool.map(service => ({ businessId: state.businessId, category: 'service', id: service.id, label: service.name })))
      if (result.kind !== 'exact' || result.items.length !== 1 || !result.complete) return clarifyService(state, eligible, target.aspect,
        result.kind === 'candidates' && result.items.length === 1 ? result.items[0]!.id : null)
      if (!old.options.length && normalizeAnswer(message) !== normalizeAnswer(result.items[0]!.label)) return clarifyService(state, [], target.aspect)
      selected = pool.filter(service => service.id === result.items[0]!.id)
    }
  }
  if (target.serviceIds.length && selected.length !== target.serviceIds.length && !choiceAnswer) return missing('la información vigente de ese servicio')
  if (selected.length !== 1) return clarifyService(state, selected, target.aspect)
  const item = selected[0]!
  if (old?.serviceId === item.id && old.options.some(option => option.id === item.id && normalizeAnswer(option.label) !== normalizeAnswer(item.name))) return missing('la información vigente de ese servicio')
  for (const value of [item.name, item.description]) if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw new Error('invalid service information')
  const focus = focusFor(state, [item], target.aspect, item.id)
  const unavailable = (subject: string) => ({ ...missing(subject + ' sobre ' + item.name), focus })
  const options = parseEstimateOptions(item.bookingPolicy?.estimateOptions ?? []) ?? []
  if (!validInformationEstimate(target, services)) return unavailable('esa opción vigente del presupuesto')
  const chosenOptions = target.estimateOptionId ? options.filter(option => option.id === target.estimateOptionId) : options
  const choiceContent = item.bookingPolicy ? stageContent(item.bookingPolicy, state.businessId, 'choice').fragments : []
  const variants = chosenOptions.map(option => '• ' + option.label + ': ' + formatServiceEstimate({ optionId: option.id, optionLabel: option.label, priceMin: option.priceMin, priceMax: option.priceMax }) + (item.bookingPolicy ? choiceContent.filter(fragment => fragment.source === 'option:' + option.id).map(fragment => ' — ' + fragment.text).join('') : option.note ? ' — ' + option.note : ''))
  const duration = formatCatalogDuration(item.durationMinutes, item.durationMinMinutes ?? null, item.durationMaxMinutes ?? null)
  const price = formatCatalogPrice(item.price, item.priceMode ?? 'FIXED')
  let lines: string[] = []
  if (target.aspect === 'discount') return unavailable('esa información de descuentos')
  if (target.aspect === 'duration') {
    if (!duration) return unavailable('la duración')
    lines = [duration]
  } else if (target.aspect === 'description') {
    if (!item.description) return unavailable('la descripción o lo que incluye')
    lines = [item.description]
  } else if (['products', 'variants', 'comparison', 'recommendation'].includes(target.aspect)) {
    if (!variants.length || target.aspect === 'recommendation' && !options.some(option => option.note)) return unavailable('esa información')
    lines = ['Opciones configuradas:', ...variants]
  } else {
    lines = [...(target.aspect === 'overview' && item.description ? [item.description] : []),
      ...(variants.length ? variants : price ? [price] : ['Precio a consultar']),
      ...(target.aspect === 'overview' && duration ? [duration] : []), ...choiceContent.filter(fragment => fragment.source === 'disclaimer').map(fragment => fragment.text)]
  }
  const reply = standardDelivery({ kind: 'service_details', name: item.name, lines })
  const uncovered = target.aspect === 'overview' ? [...(item.description ? [item.description] : []), ...(duration ? [duration] : [])] : []
  return { reply, outcome: 'found', focus,
    ...(['price', 'overview'].includes(target.aspect) && item.bookingPolicy?.attentionMode === 'GUIDED_ESTIMATE' && !target.estimateOptionId
      ? { guidanceCoverage: { serviceId: item.id, remainder: uncovered.length ? standardDelivery({ kind: 'service_details', name: item.name, lines: uncovered }) : '' } } : {}) }
}
function businessRead(target: Extract<InformationTarget, { kind: 'business' }>, message: string, facts: BusinessFacts | null, services: readonly DialogueService[]): InformationRead {
  const subject = target.subject ?? businessSubject(message)
  if (target.actions.includes('BUSINESS_INFO') && subject && subject !== 'general') {
    const fields = subject === 'socials' ? ['instagram', 'facebook', 'tiktok'] : subject === 'website' ? ['website']
      : subject === 'contact' ? ['whatsapp', 'email'] : subject === 'payments' ? ['paymentMethods'] : [subject]
    const labels: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', website: 'Sitio web', whatsapp: 'WhatsApp', email: 'Correo', paymentMethods: 'Medios de pago', discounts: 'Descuentos', parking: 'Estacionamiento', accessibility: 'Accesibilidad', wifi: 'Wi-Fi', policies: 'Políticas' }
    const loaded: StandardField[] = fields.flatMap(field => {
      const value = facts?.[field as keyof BusinessFacts]
      const link = ['instagram', 'facebook', 'tiktok', 'website'].includes(field)
      return typeof value === 'string' && value.trim() && (!link || safePublicLink(value)) ? [{ label: labels[field] ?? field, value, link }] : []
    })
    return loaded.length ? { reply: standardDelivery({ kind: 'fields', fields: loaded }), outcome: 'found' }
      : { reply: standardDelivery({ kind: 'missing', businessName: facts?.name ?? null }), outcome: 'missing' }
  }
  const reply = renderInformation(target.actions, message, facts, services)
  const missingData = target.actions.some(action => action === 'HOURS' ? !facts?.hours || facts.hours === 'No tengo horarios publicados.'
    : action === 'ADDRESS' ? !facts?.address && !facts?.area : action === 'BUSINESS_INFO' ? !facts?.description : action === 'SERVICES' ? !services.length : false)
  return { reply: reply || missing().reply, outcome: missingData ? 'missing' : 'found' }
}
function professionalRead(value: ProfessionalInformationFacts, businessId: string, target: Extract<InformationTarget, { kind: 'professional' }>): InformationRead {
  if (value.businessId !== businessId || typeof value.complete !== 'boolean' || !Array.isArray(value.professionals) || value.professionals.length > 50) throw new Error('invalid professional information scope')
  for (const professional of value.professionals) {
    if (!professional.id || !professional.name || professional.services.length > 200) throw new Error('invalid professional information')
    for (const field of [professional.id, professional.name, professional.description, professional.schedule, ...professional.services.flatMap((service: ProfessionalInformationFacts['professionals'][number]['services'][number]) => [service.id, service.name, service.description])]) {
      if (field !== undefined && field !== null && (typeof field !== 'string' || field.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(field))) throw new Error('invalid professional facts')
    }
  }
  if (!value.professionals.length) return missing(value.complete ? 'la información de ese profesional' : 'la jornada completa de esos profesionales')
  const details = value.professionals.flatMap(professional => {
    const lines = [
      ...(target.aspect === 'overview' && professional.description ? [professional.description] : []),
      ...(target.aspect === 'services' ? [professional.services.length ? 'Servicios: ' + professional.services.map((service: ProfessionalInformationFacts['professionals'][number]['services'][number]) => service.name).join(', ') : 'Todavía no tengo sus servicios cargados.'] : []),
      ...(target.aspect === 'schedule' ? [professional.schedule ? 'Horario habitual:\n' + standardWorkSchedule(professional.schedule) : 'Todavía no tengo su horario habitual cargado.'] : [])]
    return lines.length ? [professional.name + ':\n' + lines.join('\n')] : []
  })
  return { reply: standardDelivery({ kind: 'professionals', names: value.professionals.map(pro => pro.name), details, complete: value.complete, overview: target.aspect === 'overview' }),
    outcome: !value.complete || target.aspect === 'schedule' && value.professionals.every(professional => !professional.schedule) || target.aspect === 'services' && value.professionals.every(professional => !professional.services.length) ? 'missing' : 'found' }
}
export async function readInformation(context: DialogueContext, state: DialogueState, message: string, port: DialoguePort, rawTarget: InformationTarget, preparedServices?: readonly DialogueService[]): Promise<InformationRead> {
  const target = parseInformationTarget(rawTarget)
  if (target.kind === 'presented_offer') throw new Error('presented offer requires the existing reference route')
  if (target.kind === 'professional') {
    if (!port.professionalInformation) return missing('la información de profesionales')
    return professionalRead(await port.professionalInformation(target), context.businessId, target)
  }
  const needsCatalog = target.kind === 'service' || target.actions.some(action => ['SERVICES', 'PRICES', 'SERVICE_DETAILS'].includes(action))
  const services = preparedServices ?? (needsCatalog ? await port.catalog() : [])
  if (services.length > 200 || services.some(service => !service.id || service.id.length > 128 || !service.name || service.name.length > 200 || /[\u0000-\u001f]/.test(service.id + service.name) ||
      service.price !== null && (!Number.isFinite(service.price) || service.price < 0) ||
      [service.durationMinutes, service.durationMinMinutes, service.durationMaxMinutes].some(value => value != null && (!Number.isFinite(value) || value <= 0)) ||
      service.description != null && (service.description.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(service.description))) || new Set(services.map(service => service.id)).size !== services.length) throw new Error('invalid information catalog')
  if (target.kind === 'service') return serviceRead(state, message, target, services)
  if (target.actions.includes('PRICES') || target.actions.includes('SERVICE_DETAILS')) {
    if (target.actions.includes('SERVICES') && !namedInformationServices(message, services).length) return { reply: renderServices(services), outcome: 'found' }
    const focusedTarget = inferInformationTarget(state, message, services, target.actions.filter(action => action !== 'SERVICES'))
    const read = focusedTarget?.kind === 'service' ? serviceRead(state, message, focusedTarget, services) : missing()
    const other = target.actions.filter(action => !['PRICES', 'SERVICE_DETAILS'].includes(action))
    if (!other.length) return read
    const additional = await readInformation(context, state, message, port, { kind: 'business', actions: other }, services)
    const serviceReply = other.includes('SERVICES') && read.outcome === 'clarifying' ? read.reply.split('\n')[0]! : read.reply
    return { ...read, reply: additional.reply + '\n' + serviceReply, outcome: read.outcome === 'found' ? additional.outcome : read.outcome }
  }
  let facts: BusinessFacts | null = null
  if (target.actions.some(action => action !== 'SERVICES') && port.information) {
    try { facts = await port.information(target.actions); validateFacts(facts, context.businessId) }
    catch (error) { if (error instanceof Error && /scope|invalid public facts/.test(error.message)) throw error; return { reply: 'No pude consultar esa información ahora. Puedo ayudarte con otra consulta sobre el local.', outcome: 'missing', failed: true } }
  }
  return businessRead(target, message, facts, services)
}
/** One contextual next step: inquiry is not permission to mutate a booking draft. */
export function informationNext(read: InformationRead, state: DialogueState, activeBooking: boolean): string {
  if (read.outcome === 'clarifying') return ''
  if (hasBasketSelection(state) || state.editRequest || state.serviceRequest || state.referral) return pendingQuestion(state)
  const service = read.outcome === 'found' && read.focus?.serviceId ? read.focus.options.find(option => option.id === read.focus!.serviceId) : null
  if (service) return '¿Querés agendar ' + service.label + '?'
  return activeBooking ? pendingQuestion(state) : '¿En qué más te puedo ayudar?'
}
export function informationReply(read: InformationRead, state: DialogueState, activeBooking: boolean): string {
  const next = informationNext(read, state, activeBooking)
  return read.reply + (next ? '\n' + next : '')
}
export function informationReadActions(target: InformationTarget): readonly InformationAction[] {
  return target.kind === 'service' ? [] : target.kind === 'business' ? target.actions : []
}
