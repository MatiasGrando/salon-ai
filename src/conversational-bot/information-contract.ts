import { ACTION_REGISTRY, type InformationAction } from './actions.js'

export const SERVICE_INFORMATION_ASPECTS = ['overview', 'price', 'duration', 'description', 'variants', 'products', 'comparison', 'discount', 'recommendation'] as const
export type ServiceInformationAspect = typeof SERVICE_INFORMATION_ASPECTS[number]
export const BUSINESS_INFORMATION_SUBJECTS = ['general', 'socials', 'instagram', 'facebook', 'tiktok', 'website', 'contact', 'payments', 'discounts', 'parking', 'accessibility', 'wifi', 'policies'] as const
export type BusinessInformationSubject = typeof BUSINESS_INFORMATION_SUBJECTS[number]
export type ProfessionalInformationTarget = {
  kind: 'professional'; actions: readonly []; mention: string | null; serviceIds: readonly string[]
  date: string | null; weekday: number | null; aspect: 'overview' | 'services' | 'schedule'
}
export type InformationTarget =
  | { kind: 'business'; actions: readonly InformationAction[]; subject?: BusinessInformationSubject }
  | { kind: 'presented_offer'; actions: readonly [] }
  | { kind: 'service'; actions: readonly []; serviceIds: readonly string[]; aspect: ServiceInformationAspect; estimateOptionId?: string }
  | ProfessionalInformationTarget
export type ProfessionalInformationFacts = {
  businessId: string; complete: boolean
  professionals: readonly { id: string; name: string; description?: string | null; services: readonly { id: string; name: string; description?: string | null }[]; schedule: string | null }[]
}
export type InformationFocus = {
  version: 1; businessId: string; topic: 'price' | 'details'; aspect: ServiceInformationAspect
  serviceId: string | null; awaitingChoice: boolean; candidateId: string | null
  options: { id: string; label: string }[]
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value)
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 10 && new Set(value).size === value.length && value.every(id => text(id, 128))
const readActions = Object.keys(ACTION_REGISTRY).filter(key => key !== 'AVAILABILITY' && ACTION_REGISTRY[key as InformationAction].kind === 'read' && ACTION_REGISTRY[key as InformationAction].status === 'implemented')
export function parseInformationTarget(value: unknown, catalogIds?: readonly string[]): InformationTarget {
  if (!object(value) || JSON.stringify(value).length > 4096 || !Array.isArray(value.actions)) throw new Error('invalid information target')
  const actions = value.actions
  if (new Set(actions).size !== actions.length) throw new Error('invalid information actions')
  if (value.kind === 'business') {
    if (!keys(value, ['kind', 'actions'], ['subject']) || !actions.length || actions.some(action => !readActions.includes(action)) ||
        value.subject !== undefined && !BUSINESS_INFORMATION_SUBJECTS.includes(value.subject as BusinessInformationSubject)) throw new Error('invalid information business')
  } else {
    if (actions.length) throw new Error('invalid information actions')
    if (value.kind === 'presented_offer') {
      if (!keys(value, ['kind', 'actions'])) throw new Error('invalid information offer')
    } else if (value.kind === 'service') {
      if (!keys(value, ['kind', 'actions', 'serviceIds', 'aspect'], ['estimateOptionId']) || !ids(value.serviceIds) ||
          !SERVICE_INFORMATION_ASPECTS.includes(value.aspect as ServiceInformationAspect) || value.estimateOptionId !== undefined && (!text(value.estimateOptionId, 128) || value.aspect !== 'price' || value.serviceIds.length !== 1)) throw new Error('invalid information service')
    } else if (value.kind === 'professional') {
      if (!keys(value, ['kind', 'actions', 'mention', 'serviceIds', 'date', 'weekday', 'aspect']) || !ids(value.serviceIds) ||
          value.mention !== null && !text(value.mention, 100) ||
          value.date !== null && (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date + 'T12:00:00Z')) || new Date(value.date + 'T12:00:00Z').toISOString().slice(0, 10) !== value.date) ||
          value.weekday !== null && (!Number.isInteger(value.weekday) || Number(value.weekday) < 0 || Number(value.weekday) > 6) ||
          !['overview', 'services', 'schedule'].includes(String(value.aspect))) throw new Error('invalid information professional')
    } else throw new Error('invalid information kind')
    if ((value.kind === 'service' || value.kind === 'professional') && catalogIds && (value.serviceIds as string[]).some(id => !catalogIds.includes(id))) throw new Error('invalid information catalog')
  }
  return structuredClone(value) as unknown as InformationTarget
}
export function parseInformationFocus(value: unknown, businessId: string): InformationFocus {
  if (!object(value) || !keys(value, ['version', 'businessId', 'topic', 'aspect', 'serviceId', 'awaitingChoice', 'candidateId', 'options']) ||
      value.version !== 1 || value.businessId !== businessId || JSON.stringify(value).length > 4096 ||
      !['price', 'details'].includes(String(value.topic)) || !SERVICE_INFORMATION_ASPECTS.includes(value.aspect as ServiceInformationAspect) ||
      typeof value.awaitingChoice !== 'boolean' || !Array.isArray(value.options) || value.options.length > 10 ||
      value.options.some(option => !object(option) || !keys(option, ['id', 'label']) || !text(option.id, 128) || !text(option.label, 200)) ||
      new Set(value.options.map(option => option.id)).size !== value.options.length ||
      value.serviceId !== null && (!text(value.serviceId, 128) || !value.options.some(option => option.id === value.serviceId)) ||
      value.candidateId !== null && (!value.awaitingChoice || !text(value.candidateId, 128) || !value.options.some(option => option.id === value.candidateId)) ||
      !value.awaitingChoice && value.serviceId === null && !(value.aspect === 'comparison' && value.options.length > 1 && value.candidateId === null) ||
      value.awaitingChoice && value.serviceId !== null) throw new Error('invalid information focus')
  return structuredClone(value) as unknown as InformationFocus
}
const string = { type: 'string', minLength: 1, maxLength: 128 }
const array = { type: 'array', items: string, maxItems: 10 }
const emptyActions = { type: 'array', items: { type: 'string' }, maxItems: 0 }
const schema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const businessProperties = { kind: { type: 'string', enum: ['business'] }, actions: { type: 'array', items: { type: 'string', enum: readActions }, minItems: 1, maxItems: readActions.length } }
export const INFORMATION_TARGET_JSON_SCHEMA = { anyOf: [
  schema(businessProperties),
  schema({ ...businessProperties, subject: { type: 'string', enum: BUSINESS_INFORMATION_SUBJECTS } }),
  schema({ kind: { type: 'string', enum: ['presented_offer'] }, actions: emptyActions }),
  schema({ kind: { type: 'string', enum: ['service'] }, actions: emptyActions, serviceIds: array, aspect: { type: 'string', enum: SERVICE_INFORMATION_ASPECTS } }),
  schema({ kind: { type: 'string', enum: ['service'] }, actions: emptyActions, serviceIds: { ...array, minItems: 1, maxItems: 1 }, aspect: { type: 'string', enum: ['price'] }, estimateOptionId: string }),
  schema({ kind: { type: 'string', enum: ['professional'] }, actions: emptyActions, mention: { type: ['string', 'null'], minLength: 1, maxLength: 100 },
    serviceIds: array, date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, weekday: { type: ['integer', 'null'], minimum: 0, maximum: 6 },
    aspect: { type: 'string', enum: ['overview', 'services', 'schedule'] } })
] }
