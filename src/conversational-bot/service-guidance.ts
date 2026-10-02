import { formatServiceEstimate, parseEstimateOptions, resolveServiceEstimate, serviceConfigurationKey, type ServiceBookingPolicy, type ServiceEstimate } from '../bot-options/domain/service-booking.js'
import type { DialogueService } from './engine.js'

export type GuidedSelection = { configurationKey: string; optionId: string | null }
export type ServiceEstimates = Readonly<Record<string, GuidedSelection>>
export type GuidanceBlock = 'INVALID_CONFIGURATION' | 'DOMAIN_REVIEW' | 'PHOTO_REQUIRED' | 'VALIDATION_REQUIRED' | 'ESTIMATE_NOT_BOOKABLE'
export type ServiceGuidance = { kind: 'direct' } | { kind: 'guided'; policy: ServiceBookingPolicy } | { kind: 'blocked'; reason: GuidanceBlock }
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, maximum: number, nullable = false, multiline = false): boolean => nullable && v === null ||
  typeof v === 'string' && (nullable || v.trim().length > 0) && v.length <= maximum &&
  !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(v)
const fields = ['id','name','attentionMode','price','priceMode','estimateAllowsBooking','estimateQuestion','estimateOptions','estimateExplanation','estimateDisclaimer','requiresPhoto','validationEnabled','validationMessage','validationQuestion']
/** Explicit metadata is never silently treated as legacy direct booking when malformed. */
export function serviceGuidance(service: DialogueService): ServiceGuidance {
  if (service.bookingPolicy === undefined) return service.requiresConsultation ? { kind: 'blocked', reason: 'DOMAIN_REVIEW' } : { kind: 'direct' }
  const p: unknown = service.bookingPolicy
  if (!object(p) || fields.some(key => !Object.hasOwn(p,key)) || Object.keys(p).some(key => !fields.includes(key)) ||
      p.id !== service.id || !text(p.id,128) || !text(p.name,200) || !['DIRECT_BOOKING','QUOTE','ADVISOR','GUIDED_ESTIMATE'].includes(String(p.attentionMode)) ||
      !['FIXED','STARTING_AT'].includes(String(p.priceMode)) || p.price !== service.price || p.priceMode !== (service.priceMode ?? 'FIXED') ||
      p.price !== null && (!Number.isSafeInteger(p.price) || Number(p.price) < 0) ||
      ['estimateAllowsBooking','requiresPhoto','validationEnabled'].some(key => typeof p[key] !== 'boolean') ||
      ['estimateQuestion','estimateExplanation','estimateDisclaimer','validationMessage','validationQuestion'].some(key => !text(p[key],2000,true,['estimateExplanation','estimateDisclaimer','validationMessage'].includes(key))) ||
      p.estimateOptions === null || !Array.isArray(p.estimateOptions) || p.estimateOptions.length > 12 || JSON.stringify(p).length > 6000) return { kind: 'blocked', reason: 'INVALID_CONFIGURATION' }
  const options = parseEstimateOptions(p.estimateOptions)
  if (!options || options.some(option => !text(option.id,128) || !text(option.label,200) || !text(option.note,1000,true)) ||
      p.attentionMode === 'GUIDED_ESTIMATE' && options.length > 0 && !text(p.estimateQuestion,240)) return {kind:'blocked',reason:'INVALID_CONFIGURATION'}
  if (p.requiresPhoto) return {kind:'blocked',reason:'PHOTO_REQUIRED'}
  if (p.validationEnabled) return {kind:'blocked',reason:'VALIDATION_REQUIRED'}
  if (p.attentionMode === 'QUOTE' || p.attentionMode === 'ADVISOR') return {kind:'blocked',reason:'DOMAIN_REVIEW'}
  if (p.attentionMode === 'GUIDED_ESTIMATE') {
    if (!p.estimateAllowsBooking) return {kind:'blocked',reason:'ESTIMATE_NOT_BOOKABLE'}
    if (!options.length && !resolveServiceEstimate(p as unknown as ServiceBookingPolicy,null)) return {kind:'blocked',reason:'INVALID_CONFIGURATION'}
    return {kind:'guided',policy:structuredClone(p) as unknown as ServiceBookingPolicy}
  }
  return service.requiresConsultation ? {kind:'blocked',reason:'DOMAIN_REVIEW'} : {kind:'direct'}
}
export function parseServiceEstimates(value: unknown, selectedIds: readonly string[]): Record<string,GuidedSelection> {
  if (!object(value) || Object.keys(value).length > 10 || JSON.stringify(value).length > 12000) throw new Error('invalid guidance selections')
  for (const [id,raw] of Object.entries(value)) {
    if (!selectedIds.includes(id) || !text(id,128) || !object(raw) || Object.keys(raw).sort().join(',') !== 'configurationKey,optionId' ||
        !text(raw.configurationKey,6000) || !(raw.optionId === null || text(raw.optionId,128))) throw new Error('invalid guidance selection')
  }
  return structuredClone(value) as Record<string,GuidedSelection>
}
export type GuidanceResolution = {
  selections: Record<string,GuidedSelection>; estimates: Record<string,ServiceEstimate>; changed: boolean
  pending: DialogueService | null; blocked: {service: DialogueService;reason:GuidanceBlock} | null
}
/** Every price is derived from the current policy, never transported in a client/model selection. */
export function resolveGuidance(services: readonly DialogueService[], previous: ServiceEstimates = {}): GuidanceResolution {
  const selections = new Map<string,GuidedSelection>(), estimates = new Map<string,ServiceEstimate>()
  let pending: DialogueService | null = null, blocked: GuidanceResolution['blocked'] = null
  for (const service of services) {
    const guide = serviceGuidance(service)
    if (guide.kind === 'blocked') { blocked ??= {service,reason:guide.reason}; continue }
    if (guide.kind !== 'guided') continue
    const key = serviceConfigurationKey(guide.policy)
    const old = Object.hasOwn(previous,service.id) ? previous[service.id] : undefined
    const optionId = old?.configurationKey === key ? old.optionId : null
    const estimate = resolveServiceEstimate(guide.policy,optionId)
    if (estimate) { selections.set(service.id,{configurationKey:key,optionId}); estimates.set(service.id,estimate) }
    else pending ??= service
  }
  const derived = Object.fromEntries(selections)
  const changed = Object.keys(derived).length !== Object.keys(previous).length || Object.entries(derived).some(([id,selection]) =>
    !Object.hasOwn(previous,id) || previous[id]?.configurationKey !== selection.configurationKey || previous[id]?.optionId !== selection.optionId)
  return {selections:derived,estimates:Object.fromEntries(estimates),pending,blocked,changed}
}
export function guidanceQuestion(service: DialogueService): string {
  const guide = serviceGuidance(service)
  if (guide.kind !== 'guided') return 'No pude leer la configuración de presupuesto de ese servicio.'
  const p = guide.policy
  return [service.name + ':', p.estimateExplanation, p.estimateQuestion,
    ...(p.estimateOptions ?? []).map(option => option.label + ': ' + formatServiceEstimate({optionId:option.id,optionLabel:option.label,priceMin:option.priceMin,priceMax:option.priceMax}) + (option.note ? ' ('+option.note+')' : '')),
    p.estimateDisclaimer].filter(Boolean).join('\n')
}
export function guidanceBlockMessage(reason: GuidanceBlock): string {
  if (reason === 'INVALID_CONFIGURATION') return 'No pude verificar los datos de configuración del servicio. Mantengo el pedido; necesitás consultar al equipo.'
  if (reason === 'PHOTO_REQUIRED') return 'El servicio requiere una foto previa; esta capacidad todavía debe gestionarla el equipo. Mantengo el pedido.'
  if (reason === 'VALIDATION_REQUIRED') return 'El servicio requiere una validación previa; esta capacidad todavía debe gestionarla el equipo. Mantengo el pedido.'
  if (reason === 'ESTIMATE_NOT_BOOKABLE') return 'El presupuesto de este servicio no habilita una reserva automática. Mantengo el pedido; necesitás consultarlo con el equipo.'
  return 'Este servicio requiere una consulta con el equipo antes de reservar. Mantengo todos los servicios solicitados.'
}
export function renderGuidedEstimates(services: readonly DialogueService[], selections: ServiceEstimates): string {
  const result = resolveGuidance(services,selections)
  return services.flatMap(service => {
    const estimate = Object.hasOwn(result.estimates,service.id) ? result.estimates[service.id] : undefined
    if (!estimate) return []
    return [service.name + ': ' + formatServiceEstimate(estimate) + ' (estimado)', service.bookingPolicy?.estimateDisclaimer].filter(Boolean) as string[]
  }).join('\n')
}
/** Bounded semantic context exposes choices, not monetary facts for the model to invent. */
export function guidedChoiceTargets(services: readonly DialogueService[], selectedIds: readonly string[]) {
  return services.filter(service => selectedIds.includes(service.id)).flatMap(service => {
    const guide = serviceGuidance(service)
    return guide.kind === 'guided' ? [{ serviceId: service.id, serviceName: service.name, question: guide.policy.estimateQuestion,
      options: (guide.policy.estimateOptions ?? []).map(option => ({id:option.id,label:option.label})) }] : []
  })
}
