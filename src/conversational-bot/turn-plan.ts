import { ACTION_REGISTRY, type InformationAction } from './actions.js'
import type { InformationTarget } from './engine.js'

/** Untrusted semantic proposals. The engine, never the model, authorizes catalog/agenda use. */
type Evidence = { evidence: string; confidence: number }
export type UnsupportedTurnAction = 'CANCEL' | 'RESCHEDULE' | 'HUMAN_HANDOFF'
export type TurnOperation = Evidence & (
  | { kind: 'service'; mode: 'single' | 'alternatives' | 'multiple' | 'unresolved'; serviceIds: readonly string[]; correction: boolean }
  | { kind: 'professional'; mode: 'specific'; mention: string }
  | { kind: 'professional'; mode: 'any' | 'clear' }
  | { kind: 'date'; expression: string; value?: string }
  | { kind: 'time'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'information'; target: InformationTarget }
  | { kind: 'unsupported_action'; action: UnsupportedTurnAction }
)
export type TurnPlan = { version: 1; operations: readonly TurnOperation[] }
export const TURN_PLAN_LIMITS = { operations: 12, serialized: 6000, evidence: 300, candidates: 10 } as const
const informationActions = Object.keys(ACTION_REGISTRY).filter(key => key !== 'AVAILABILITY' && ACTION_REGISTRY[key as InformationAction].kind === 'read' && ACTION_REGISTRY[key as InformationAction].status === 'implemented') as InformationAction[]
const pendingActions: readonly UnsupportedTurnAction[] = ['CANCEL', 'RESCHEDULE', 'HUMAN_HANDOFF']
const stringSchema = (maximum: number) => ({ type: 'string', minLength: 1, maxLength: maximum })
const evidenceSchema = { evidence: stringSchema(TURN_PLAN_LIMITS.evidence), confidence: { type: 'number', minimum: 0, maximum: 1 } }
const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const operationSchema = (kind: string, properties: Record<string, unknown>, optional: readonly string[] = []) => {
  const fields = { kind: { enum: [kind], type: 'string' }, ...evidenceSchema, ...properties }
  return objectSchema(fields, Object.keys(fields).filter(key => !optional.includes(key)))
}
/** Shared source for structured-output adapters; no duplicated operation registry in a provider. */
export const TURN_PLAN_JSON_SCHEMA = objectSchema({
  version: { type: 'integer', enum: [1] },
  operations: { type: 'array', maxItems: TURN_PLAN_LIMITS.operations, items: { anyOf: [
    operationSchema('service', { mode: { type: 'string', enum: ['single', 'alternatives', 'multiple', 'unresolved'] }, serviceIds: { type: 'array', items: stringSchema(128), minItems: 0, maxItems: TURN_PLAN_LIMITS.candidates }, correction: { type: 'boolean' } }),
    operationSchema('professional', { mode: { type: 'string', enum: ['specific'] }, mention: stringSchema(100) }),
    operationSchema('professional', { mode: { type: 'string', enum: ['any', 'clear'] } }),
    operationSchema('date', { expression: stringSchema(300), value: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
    operationSchema('time', { value: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' } }),
    operationSchema('name', { value: stringSchema(100) }),
    operationSchema('information', { target: { anyOf: [
      objectSchema({ kind: { type: 'string', enum: ['business'] }, actions: { type: 'array', items: { type: 'string', enum: informationActions }, minItems: 1, maxItems: informationActions.length } }),
      objectSchema({ kind: { type: 'string', enum: ['presented_offer'] }, actions: { type: 'array', items: { type: 'string' }, maxItems: 0 } })
    ] } }),
    operationSchema('unsupported_action', { action: { type: 'string', enum: pendingActions } })
  ] } }
})
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contains = (text: string, fragment: string) => (' ' + normalized(text) + ' ').includes(' ' + normalized(fragment) + ' ')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value)
function fail(reason: string): never { throw new Error('invalid turn plan: ' + reason) }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('keys')
}
export function validTurnPlanDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}
/** Strict structural/evidence validation; catalogIds, when provided, are the trusted tenant catalog. */
export function parseTurnPlan(value: unknown, message: string, catalogIds?: readonly string[]): TurnPlan {
  if (!object(value)) fail('object')
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return fail('serialization') }
  if (serialized.length > TURN_PLAN_LIMITS.serialized) fail('size')
  exactKeys(value, ['version', 'operations'])
  if (value.version !== 1 || !Array.isArray(value.operations) || value.operations.length > TURN_PLAN_LIMITS.operations) fail('version or operations')
  const seen = new Set<string>()
  for (const raw of value.operations) {
    if (!object(raw) || !bounded(raw.evidence, TURN_PLAN_LIMITS.evidence) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) fail('evidence or confidence')
    const evidence = normalized(raw.evidence)
    if (!evidence || !contains(message, raw.evidence)) fail('ungrounded evidence')
    const common = ['kind', 'evidence', 'confidence']
    let identity = String(raw.kind)
    if (raw.kind === 'service') {
      exactKeys(raw, [...common, 'mode', 'serviceIds', 'correction'])
      if (!['single', 'alternatives', 'multiple', 'unresolved'].includes(String(raw.mode)) || typeof raw.correction !== 'boolean' || !Array.isArray(raw.serviceIds) || raw.serviceIds.length > TURN_PLAN_LIMITS.candidates || raw.serviceIds.some(id => !bounded(id, 128)) || new Set(raw.serviceIds).size !== raw.serviceIds.length || (raw.mode === 'single' ? raw.serviceIds.length !== 1 : raw.mode === 'unresolved' ? raw.serviceIds.length !== 0 : raw.serviceIds.length < 2)) fail('service')
      if (catalogIds && raw.serviceIds.some(id => !catalogIds.includes(id))) fail('catalog')
    } else if (raw.kind === 'professional') {
      exactKeys(raw, raw.mode === 'specific' ? [...common, 'mode', 'mention'] : [...common, 'mode'])
      if (!['specific', 'any', 'clear'].includes(String(raw.mode)) || raw.mode === 'specific' && (!bounded(raw.mention, 100) || !contains(raw.evidence, raw.mention))) fail('professional')
    } else if (raw.kind === 'date') {
      exactKeys(raw, [...common, 'expression'], ['value'])
      if (!bounded(raw.expression, 300) || !contains(raw.evidence, raw.expression) || Object.hasOwn(raw, 'value') && raw.value !== null && !validTurnPlanDate(raw.value)) fail('date')
    } else if (raw.kind === 'time') {
      exactKeys(raw, [...common, 'value'])
      if (typeof raw.value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.value)) fail('time')
    } else if (raw.kind === 'name') {
      exactKeys(raw, [...common, 'value'])
      if (!bounded(raw.value, 100) || !/^[\p{L}][\p{L} '\-]*$/u.test(raw.value) || !contains(raw.evidence, raw.value)) fail('name')
    } else if (raw.kind === 'information') {
      exactKeys(raw, [...common, 'target'])
      if (!object(raw.target)) fail('information target')
      exactKeys(raw.target, ['kind', 'actions'])
      const actions = raw.target.actions
      if (!Array.isArray(actions) || new Set(actions).size !== actions.length || (raw.target.kind === 'business' ? !actions.length || actions.some(action => !informationActions.includes(action)) : raw.target.kind !== 'presented_offer' || actions.length !== 0)) fail('information actions')
      identity += ':' + String(raw.target.kind)
    } else if (raw.kind === 'unsupported_action') {
      exactKeys(raw, [...common, 'action'])
      if (!pendingActions.includes(raw.action as UnsupportedTurnAction) || ACTION_REGISTRY[raw.action as UnsupportedTurnAction].status !== 'pending') fail('unsupported action')
      identity += ':' + String(raw.action)
    } else fail('operation')
    if (seen.has(identity)) fail('conflicting duplicate field')
    seen.add(identity)
  }
  const plan = structuredClone(value) as unknown as TurnPlan
  for (const op of plan.operations) if (op.kind === 'date' && op.value === null) delete op.value
  return plan
}
