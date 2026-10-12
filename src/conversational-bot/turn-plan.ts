import { DATE_PREFERENCES_JSON_SCHEMA, parseDatePreferenceCandidates, type DatePreferenceCandidate } from './date-preference.js'
import { parseServiceRequest, type ServiceRequest } from './service-request.js'
import { isCustomerText } from './customer-text.js'
import { INFORMATION_TARGET_JSON_SCHEMA, parseInformationTarget, SERVICE_INFORMATION_ASPECTS } from './information-contract.js'
import { TIME_PREFERENCE_JSON_SCHEMA, parseTimePreference, literalClockMeaning, timePreferenceMatchesEvidence, timeOperationMatchesEvidence, type TimePreference } from './time-preference.js'
import { parseTimeClarification } from './temporal-grounding.js'
import { ACTION_REGISTRY, type InformationAction } from './actions.js'
import type { InformationTarget } from './engine.js'
import { BASKET_LIMITS, type BasketMutation } from './service-basket.js'

/** Untrusted semantic proposals. The engine, never the model, authorizes catalog/agenda use. */
export const DRAFT_EDIT_FIELDS = ['service', 'date', 'professional', 'time', 'name'] as const
export type DraftEditField = typeof DRAFT_EDIT_FIELDS[number]
type Evidence = { evidence: string; confidence: number }
export type UnsupportedTurnAction = 'CANCEL' | 'RESCHEDULE' | 'HUMAN_HANDOFF'
export type TurnOperation = Evidence & (
  | BasketMutation
  | ({ kind: 'service_request' } & ServiceRequest)
  | { kind: 'service_reference'; action: 'confirm' | 'select'; serviceId: string }
  | { kind: 'referral'; action: 'consult' | 'resume' }
  | { kind: 'confirm_proposal' }
  | { kind: 'request_change'; field: DraftEditField }
  | { kind: 'estimate'; serviceId: string; optionId: string | null }
  | { kind: 'service'; mode: 'single' | 'alternatives' | 'multiple' | 'unresolved'; serviceIds: readonly string[]; correction: boolean }
  | { kind: 'professional'; mode: 'specific'; mention: string }
  | { kind: 'professional'; mode: 'option'; optionId: string; optionIndex: number }
  | { kind: 'professional'; mode: 'any' | 'clear' }
  | { kind: 'professional_reference'; action: 'prefer' | 'dismiss' }
  | { kind: 'date'; expression: string; value?: string }
  | { kind: 'date_preferences'; candidates: readonly DatePreferenceCandidate[] }
  | { kind: 'time'; value: string }
  | { kind: 'time_preference'; preference: TimePreference }
  | { kind: 'time_clarification'; candidateTimes: readonly string[] }
  | { kind: 'name'; value: string }
  | { kind: 'information'; target: InformationTarget }
  | { kind: 'unsupported_action'; action: UnsupportedTurnAction }
  | { kind: 'own_appointment'; action: 'read'|'cancel'|'reschedule'; optionKey: string|null }
)
export type TurnPlan = { version: 1; operations: readonly TurnOperation[] }
export const TURN_PLAN_LIMITS = { operations: 12, serialized: 16000, evidence: 300, candidates: 10 } as const
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
    ...(['clear', 'alternatives', 'needs_detail', 'unverified_variant'] as const).map(disposition => operationSchema('service_request', {
      purpose: { type: 'string', enum: ['inquiry', 'booking'] },
      disposition: { type: 'string', enum: [disposition] },
      serviceIds: { type: 'array', items: stringSchema(128), minItems: disposition === 'clear' ? 1 : disposition === 'alternatives' ? 2 : 0,
        maxItems: disposition === 'clear' ? 1 : TURN_PLAN_LIMITS.candidates },
      correction: { type: 'boolean' },
      basis: { type: 'string', enum: ['exact_public_name', 'documented_variant', 'semantic_equivalent', 'related_category'] },
      sourceQuote: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
      subject: { type: ['string', 'null'], minLength: 1, maxLength: 300 },
      aspect: { type: ['string', 'null'], enum: [...SERVICE_INFORMATION_ASPECTS, null] },
      continuation: { type: 'boolean' }
    })),
    operationSchema('service', { mode: { type: 'string', enum: ['single', 'alternatives', 'multiple', 'unresolved'] }, serviceIds: { type: 'array', items: stringSchema(128), minItems: 0, maxItems: TURN_PLAN_LIMITS.candidates }, correction: { type: 'boolean' } }),
    operationSchema('basket', {
      mutation: { type: 'string', enum: ['set', 'add', 'remove', 'replace'] }, scope: { type: 'string', enum: ['all', 'members'] },
      targetMemberIds: { type: 'array', items: stringSchema(32), maxItems: BASKET_LIMITS.members },
      members: { type: 'array', maxItems: BASKET_LIMITS.members, items: objectSchema({ mode: { type: 'string', enum: ['single', 'alternatives', 'unresolved'] }, serviceIds: { type: 'array', items: stringSchema(128), maxItems: BASKET_LIMITS.candidates }, ...evidenceSchema }) }
    }),
    operationSchema('service_reference', { action: { type: 'string', enum: ['confirm', 'select'] }, serviceId: stringSchema(128) }),
    operationSchema('referral', { action: { type: 'string', enum: ['consult', 'resume'] } }),
    operationSchema('confirm_proposal', {}),
    operationSchema('request_change', { field: { type: 'string', enum: DRAFT_EDIT_FIELDS } }),
    operationSchema('estimate', { serviceId: stringSchema(128), optionId: { type: ['string','null'], minLength: 1, maxLength: 128 } }),
    operationSchema('professional', { mode: { type: 'string', enum: ['specific'] }, mention: stringSchema(100) }),
    operationSchema('professional', { mode: { type: 'string', enum: ['option'] }, optionId: stringSchema(128), optionIndex: { type: 'integer', minimum: 1, maximum: 50 } }),
    operationSchema('professional', { mode: { type: 'string', enum: ['any', 'clear'] } }),
    operationSchema('professional_reference', { action: { type: 'string', enum: ['prefer', 'dismiss'] } }),
    operationSchema('date', { expression: stringSchema(300), value: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
    operationSchema('date_preferences', { candidates: DATE_PREFERENCES_JSON_SCHEMA }),
    operationSchema('time', { value: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' } }),
    operationSchema('time_clarification', { candidateTimes: { type: 'array', minItems: 2, maxItems: 2, items: stringSchema(5) } }),
    operationSchema('time_preference', { preference: TIME_PREFERENCE_JSON_SCHEMA }),
    operationSchema('name', { value: stringSchema(100) }),
    operationSchema('information', { target: INFORMATION_TARGET_JSON_SCHEMA }),
    operationSchema('own_appointment', { action: { type:'string',enum:['read','cancel','reschedule'] },optionKey:{type:['string','null'],pattern:'^appointment:[a-f0-9]{24}$'} }),
    operationSchema('unsupported_action', { action: { type: 'string', enum: pendingActions } })
  ] } }
})
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contains = (text: string, fragment: string) => (' ' + normalized(text) + ' ').includes(' ' + normalized(fragment) + ' ')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value)
export type TurnPlanValidationCause = 'evidence' | 'shape' | 'catalog' | 'conflict' | 'estimate'
export class TurnPlanValidationError extends Error {
  constructor(readonly validationCause: TurnPlanValidationCause, message = 'invalid AI turn plan') { super(message) }
}
function fail(reason: string): never {
  const cause: TurnPlanValidationCause = reason.includes('catalog') ? 'catalog' : reason.includes('evidence') ? 'evidence'
    : reason.includes('duplicate') ? 'conflict' : 'shape'
  throw new TurnPlanValidationError(cause, 'invalid turn plan: ' + reason)
}
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
  return parseTurnPlanCore(value, message, catalogIds, true)
}
/** Server validation before deny-only semantic filtering; never an input flag on a model schema. */
export function parseTurnPlanStructure(value: unknown, message: string, catalogIds?: readonly string[]): TurnPlan {
  return parseTurnPlanCore(value, message, catalogIds, false)
}
function parseTurnPlanCore(value: unknown, message: string, catalogIds: readonly string[] | undefined, semantic: boolean): TurnPlan {
  if (!object(value)) fail('object')
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return fail('serialization') }
  if (serialized.length > TURN_PLAN_LIMITS.serialized) fail('size')
  exactKeys(value, ['version', 'operations'])
  if (value.version !== 1 || !Array.isArray(value.operations) || value.operations.length > TURN_PLAN_LIMITS.operations) fail('version or operations')
  const seen = new Set<string>()
  for (const raw of value.operations) {
    if (!object(raw) || !isCustomerText(raw.evidence, TURN_PLAN_LIMITS.evidence) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) fail('evidence or confidence')
    const evidence = normalized(raw.evidence)
    if (!evidence || !contains(message, raw.evidence)) fail('ungrounded evidence')
    const common = ['kind', 'evidence', 'confidence']
    let identity = String(raw.kind)
    if (raw.kind === 'basket') {
      exactKeys(raw, [...common, 'mutation', 'scope', 'targetMemberIds', 'members'])
      if (!['set','add','remove','replace'].includes(String(raw.mutation)) || !['all','members'].includes(String(raw.scope)) ||
          !Array.isArray(raw.targetMemberIds) || raw.targetMemberIds.length > BASKET_LIMITS.members || new Set(raw.targetMemberIds).size !== raw.targetMemberIds.length ||
          raw.targetMemberIds.some(id => typeof id !== 'string' || !/^m[1-9][0-9]*$/.test(id)) ||
          !Array.isArray(raw.members) || raw.members.length > BASKET_LIMITS.members ||
          (raw.scope === 'members' ? !raw.targetMemberIds.length || !['remove','replace'].includes(String(raw.mutation)) : raw.targetMemberIds.length !== 0) ||
          (raw.mutation === 'remove' ? raw.members.length !== 0 : raw.members.length === 0)) fail('basket mutation')
      const ids = new Set<string>()
      for (const member of raw.members) {
        if (!object(member)) fail('basket member')
        exactKeys(member, ['mode','serviceIds','evidence','confidence'])
        if (!isCustomerText(member.evidence, TURN_PLAN_LIMITS.evidence) || !contains(raw.evidence, member.evidence) || !contains(message, member.evidence) ||
            typeof member.confidence !== 'number' || !Number.isFinite(member.confidence) || member.confidence < 0 || member.confidence > 1) fail('basket member evidence')
        if (!['single','alternatives','unresolved'].includes(String(member.mode)) || !Array.isArray(member.serviceIds) || member.serviceIds.length > BASKET_LIMITS.candidates ||
            (member.mode === 'single' ? member.serviceIds.length !== 1 : member.mode === 'alternatives' ? member.serviceIds.length < 2 : member.serviceIds.length !== 0)) fail('basket member')
        for (const id of member.serviceIds) {
          if (!bounded(id,128) || ids.has(id)) fail('basket duplicate service')
          if (catalogIds && !catalogIds.includes(id)) fail('catalog')
          ids.add(id)
        }
      }
      identity = 'service'
    } else if (raw.kind === 'service_reference') {
      exactKeys(raw, [...common, 'action', 'serviceId'])
      if (!['confirm', 'select'].includes(String(raw.action)) || !bounded(raw.serviceId, 128)) fail('service reference')
      if (catalogIds && !catalogIds.includes(raw.serviceId)) fail('catalog reference')
      identity = 'service'
    } else if (raw.kind === 'referral') {
      exactKeys(raw, [...common, 'action'])
      if (!['consult', 'resume'].includes(String(raw.action))) fail('referral')
      identity = 'referral'
    } else if (raw.kind === 'service_request') {
      exactKeys(raw, [...common, 'purpose', 'disposition', 'serviceIds', 'correction', 'basis', 'sourceQuote', 'continuation'], ['subject', 'aspect'])
      if (raw.subject != null && (typeof raw.subject !== 'string' || !raw.evidence.includes(raw.subject))) fail('subject evidence')
      try { parseServiceRequest(raw, catalogIds) } catch {
        return fail(catalogIds && Array.isArray(raw.serviceIds) && raw.serviceIds.some(id => !catalogIds.includes(String(id)))
          ? 'catalog request' : 'service request')
      }
      identity = 'service'
    } else if (raw.kind === 'service') {
      exactKeys(raw, [...common, 'mode', 'serviceIds', 'correction'])
      if (!['single', 'alternatives', 'multiple', 'unresolved'].includes(String(raw.mode)) || typeof raw.correction !== 'boolean' || !Array.isArray(raw.serviceIds) || raw.serviceIds.length > TURN_PLAN_LIMITS.candidates || raw.serviceIds.some(id => !bounded(id, 128)) || new Set(raw.serviceIds).size !== raw.serviceIds.length || (raw.mode === 'single' ? raw.serviceIds.length !== 1 : raw.mode === 'unresolved' ? raw.serviceIds.length !== 0 : raw.serviceIds.length < 2)) fail('service')
      if (catalogIds && raw.serviceIds.some(id => !catalogIds.includes(id))) fail('catalog')
    } else if (raw.kind === 'request_change') {
      exactKeys(raw, [...common, 'field'])
      if (!DRAFT_EDIT_FIELDS.includes(raw.field as DraftEditField)) fail('edit field')
      identity = String(raw.field)
    } else if (raw.kind === 'estimate') {
      exactKeys(raw, [...common,'serviceId','optionId'])
      if (!bounded(raw.serviceId,128) || raw.optionId !== null && !bounded(raw.optionId,128)) fail('estimate')
      if (catalogIds && !catalogIds.includes(raw.serviceId)) fail('catalog estimate')
      identity += ':' + raw.serviceId
    } else if (raw.kind === 'professional') {
      exactKeys(raw, raw.mode === 'specific' ? [...common, 'mode', 'mention'] : raw.mode === 'option' ? [...common, 'mode', 'optionId', 'optionIndex'] : [...common, 'mode'])
      if (!['specific', 'option', 'any', 'clear'].includes(String(raw.mode)) || raw.mode === 'specific' && (!bounded(raw.mention, 100) || !contains(raw.evidence, raw.mention)) ||
          raw.mode === 'option' && (!bounded(raw.optionId, 128) || !Number.isSafeInteger(raw.optionIndex) || Number(raw.optionIndex) < 1 || Number(raw.optionIndex) > 50)) fail('professional')
    } else if (raw.kind === 'professional_reference') {
      exactKeys(raw, [...common, 'action'])
      if (!['prefer', 'dismiss'].includes(String(raw.action))) fail('professional reference')
      identity = 'professional'
    } else if (raw.kind === 'date') {
      exactKeys(raw, [...common, 'expression'], ['value'])
      if (!bounded(raw.expression, 300) || !contains(raw.evidence, raw.expression) || Object.hasOwn(raw, 'value') && raw.value !== null && !validTurnPlanDate(raw.value)) fail('date')
    } else if (raw.kind === 'date_preferences') {
      exactKeys(raw, [...common, 'candidates'])
      try { parseDatePreferenceCandidates(raw.candidates, raw.evidence) } catch { return fail('date preferences') }
      identity = 'date'
    } else if (raw.kind === 'time') {
      exactKeys(raw, [...common, 'value'])
      if (typeof raw.value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.value)) fail('time')
      if (semantic) {
        const meaning = literalClockMeaning(message, raw.evidence)
        if (meaning.kind === 'alternatives' || meaning.kind === 'single' && meaning.time !== raw.value) fail('clock value evidence')
        if (!timeOperationMatchesEvidence({ kind: 'time', value: raw.value }, message, raw.evidence)) fail('preference is not exact time')
      }
    } else if (raw.kind === 'time_preference') {
      exactKeys(raw, [...common, 'preference'])
      const preference = parseTimePreference(raw.preference)
      if (semantic && !timePreferenceMatchesEvidence(preference, message, raw.evidence)) fail('incomplete range evidence')
      identity = 'time'
    } else if (raw.kind === 'time_clarification') {
      exactKeys(raw, [...common, 'candidateTimes'])
      try { parseTimeClarification({candidateTimes:raw.candidateTimes}) } catch { return fail('temporal clarification') }
      identity = 'time'
    } else if (raw.kind === 'name') {
      exactKeys(raw, [...common, 'value'])
      if (!bounded(raw.value, 100) || !/^[\p{L}][\p{L} '\-]*$/u.test(raw.value) || !contains(raw.evidence, raw.value)) fail('name')
    } else if (raw.kind === 'information') {
      exactKeys(raw, [...common, 'target'])
      let target: InformationTarget
      try { target = parseInformationTarget(raw.target, catalogIds) } catch { return fail('information target') }
      if (target.kind === 'professional' && target.mention !== null && !contains(raw.evidence, target.mention)) fail('ungrounded informational professional')
      identity += ':' + target.kind
    } else if (raw.kind === 'confirm_proposal') {
      exactKeys(raw, common)
    } else if (raw.kind === 'own_appointment') {
      exactKeys(raw,[...common,'action','optionKey'])
      if (!['read','cancel','reschedule'].includes(String(raw.action)) || raw.optionKey!==null && (typeof raw.optionKey!=='string' || !/^appointment:[a-f0-9]{24}$/.test(raw.optionKey))) fail('own appointment')
    } else if (raw.kind === 'unsupported_action') {
      exactKeys(raw, [...common, 'action'])
      if (!pendingActions.includes(raw.action as UnsupportedTurnAction) || ACTION_REGISTRY[raw.action as UnsupportedTurnAction].status !== 'pending') fail('unsupported action')
      identity += ':' + String(raw.action)
    } else fail('operation')
    if (seen.has(identity)) fail('conflicting duplicate field')
    seen.add(identity)
  }
  if (value.operations.some(raw => object(raw) && ['service_request', 'service_reference', 'referral'].includes(String(raw.kind))) &&
      value.operations.some(raw => object(raw) && raw.kind === 'confirm_proposal')) fail('duplicate consent and service request')
  if (value.operations.some(raw => object(raw) && raw.kind === 'service_reference') &&
      value.operations.some(raw => object(raw) && raw.kind === 'referral')) fail('duplicate reference and referral')
  const plan = structuredClone(value) as unknown as TurnPlan
  for (const op of plan.operations) if (op.kind === 'date' && op.value === null) delete op.value
  return plan
}
