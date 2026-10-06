import { createHash, randomBytes } from 'node:crypto'
import { parseTimePreference, type TimePreference } from './time-preference.js'

/** Server-owned operations. A label or a token supplied by a client is never an operation. */
export type ConversationChoiceOperation =
  | { kind: 'service'; serviceId: string; targetMemberId?: string }
  | { kind: 'professional'; professionalId: string }
  | { kind: 'any_professional' }
  | { kind: 'date'; date: string }
  | { kind: 'slot'; date: string; time: string; startAt: string; professionalId: string; coordinationKey?: string }
  | { kind: 'preference'; preference: TimePreference }
  | { kind: 'estimate'; serviceId: string; optionId: string; configurationKey: string }
  | { kind: 'confirm'; nonce: string }
  | { kind: 'page'; questionKind: 'slots' | 'professionals' | 'dates'; cursor: number }
export type ConversationChoiceKind = 'service' | 'date' | 'professional' | 'slot' | 'preference' | 'estimate' | 'proposal'
export type ConversationChoicePresentation = {
  kind: ConversationChoiceKind; title: string
  choices: readonly { label: string; operation: ConversationChoiceOperation }[]
}
export type ChoiceScope = {
  businessId: string; conversationKey: string; policyKey: string; policyGeneration: number; revision: string
}
export type ChoiceQuestion = {
  version: 1; scope: ChoiceScope; draftFingerprint: string; nonce: string
  kind: ConversationChoiceKind; title: string
  choices: { token: string; label: string; operation: ConversationChoiceOperation }[]
}
export type PublicChoiceQuestion = {
  kind: ConversationChoiceKind; title: string; mode: 'buttons' | 'list'; choices: { id: string; title: string }[]
}
export const CHOICE_LIMITS = { choices: 10, serializedBytes: 16384, draftBytes: 16384, token: 48, actionId: 110 } as const
const kinds: readonly string[] = ['service', 'date', 'professional', 'slot', 'preference', 'estimate', 'proposal']
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{16,48}$/.test(value)
function fail(reason: string): never { throw new Error('invalid conversation choice: ' + reason) }
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('keys')
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return year! >= 1900 && year! <= 2200 && date.toISOString().slice(0, 10) === value
}
function parseScope(value: unknown): ChoiceScope {
  if (!object(value)) return fail('scope')
  keys(value, ['businessId', 'conversationKey', 'policyKey', 'policyGeneration', 'revision'])
  if (!text(value.businessId, 128) || !text(value.conversationKey, 256) || !text(value.policyKey, 128) ||
      !Number.isSafeInteger(value.policyGeneration) || Number(value.policyGeneration) < 0 ||
      typeof value.revision !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(value.revision) || BigInt(value.revision) > 9223372036854775807n) fail('scope')
  return { businessId: value.businessId as string, conversationKey: value.conversationKey as string,
    policyKey: value.policyKey as string, policyGeneration: value.policyGeneration as number, revision: value.revision as string }
}
export function parseConversationChoiceOperation(value: unknown): ConversationChoiceOperation {
  if (!object(value)) return fail('operation')
  switch (value.kind) {
    case 'service':
      keys(value, ['kind', 'serviceId'], ['targetMemberId'])
      if (!text(value.serviceId, 128) || value.targetMemberId !== undefined && (typeof value.targetMemberId !== 'string' || !/^m[1-9]\d*$/.test(value.targetMemberId) || value.targetMemberId.length > 32)) fail('service')
      break
    case 'professional':
      keys(value, ['kind', 'professionalId'])
      if (!text(value.professionalId, 128)) fail('professional')
      break
    case 'any_professional': keys(value, ['kind']); break
    case 'date':
      keys(value, ['kind', 'date'])
      if (!validDate(value.date)) fail('date')
      break
    case 'slot':
      keys(value, ['kind', 'date', 'time', 'startAt', 'professionalId'], ['coordinationKey'])
      if (!validDate(value.date) || typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) ||
          !text(value.startAt, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.startAt) || !Number.isFinite(Date.parse(value.startAt)) || !text(value.professionalId, 128)) fail('slot')
      if (value.coordinationKey !== undefined && (typeof value.coordinationKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.coordinationKey))) fail('coordination key')
      break
    case 'preference': keys(value, ['kind', 'preference']); parseTimePreference(value.preference); break
    case 'estimate':
      keys(value, ['kind', 'serviceId', 'optionId', 'configurationKey'])
      if (!text(value.serviceId, 128) || !text(value.optionId, 128) || !text(value.configurationKey, 6000)) fail('estimate')
      break
    case 'confirm':
      keys(value, ['kind', 'nonce'])
      if (!text(value.nonce, 128)) fail('confirmation')
      break
    case 'page':
      keys(value, ['kind', 'questionKind', 'cursor'])
      if (!['slots', 'professionals', 'dates'].includes(String(value.questionKind)) || !Number.isSafeInteger(value.cursor) || Number(value.cursor) < 0 || Number(value.cursor) > 10000) fail('page')
      break
    default: return fail('unknown operation')
  }
  return structuredClone(value) as unknown as ConversationChoiceOperation
}
export function choiceDraftFingerprint(draft: unknown): string {
  let serialized: string
  try { serialized = JSON.stringify(draft) } catch { return fail('draft serialization') }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > CHOICE_LIMITS.draftBytes) fail('draft size')
  // PostgreSQL JSONB reorders object keys. Arrays retain their meaningful order.
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
  return createHash('sha256').update(JSON.stringify(ordered(JSON.parse(serialized)))).digest('hex')
}
export function parseChoiceQuestion(value: unknown): ChoiceQuestion {
  if (!object(value)) return fail('question')
  keys(value, ['version', 'scope', 'draftFingerprint', 'nonce', 'kind', 'title', 'choices'])
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return fail('serialization') }
  if (Buffer.byteLength(serialized, 'utf8') > CHOICE_LIMITS.serializedBytes || value.version !== 1 ||
      typeof value.draftFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.draftFingerprint) || !token(value.nonce) ||
      !kinds.includes(String(value.kind)) || !text(value.title, 240) || !Array.isArray(value.choices) || value.choices.length < 1 || value.choices.length > CHOICE_LIMITS.choices) fail('question bounds')
  parseScope(value.scope)
  const seen = new Set([value.nonce])
  for (const choice of value.choices) {
    if (!object(choice)) fail('choice')
    keys(choice, ['token', 'label', 'operation'])
    if (!token(choice.token) || !text(choice.label, 200)) fail('choice bounds')
    if (seen.has(choice.token)) fail('duplicate token')
    seen.add(choice.token)
    parseConversationChoiceOperation(choice.operation)
  }
  return structuredClone(value) as unknown as ChoiceQuestion
}
export function issueChoiceQuestion(scope: ChoiceScope, draft: unknown, presentation: ConversationChoicePresentation, tokenFactory = () => randomBytes(16).toString('base64url')): ChoiceQuestion {
  return parseChoiceQuestion({ version: 1, scope: parseScope(scope), draftFingerprint: choiceDraftFingerprint(draft), nonce: tokenFactory(),
    kind: presentation.kind, title: presentation.title, choices: presentation.choices.map(choice => ({ token: tokenFactory(), label: choice.label, operation: choice.operation })) })
}
/** Never shorten a long reply button into a different choice: switch to a native list. */
export function preferredChoiceMode(labels: readonly string[]): 'buttons' | 'list' {
  return labels.length <= 3 && labels.every(label => [...label].length <= 20) ? 'buttons' : 'list'
}
export function publicChoiceQuestion(value: ChoiceQuestion): PublicChoiceQuestion {
  const question = parseChoiceQuestion(value)
  return { kind: question.kind, title: question.title, mode: preferredChoiceMode(question.choices.map(choice => choice.label)),
    choices: question.choices.map(choice => ({ id: `c1.${question.nonce}.${choice.token}`, title: choice.label })) }
}
export function resolveChoice(value: unknown, currentScope: ChoiceScope, currentDraft: unknown, actionId: string): { label: string; operation: ConversationChoiceOperation } {
  const question = parseChoiceQuestion(value)
  const scope = parseScope(currentScope)
  if (!text(actionId, CHOICE_LIMITS.actionId) || !/^c1\.[A-Za-z0-9_-]{16,48}\.[A-Za-z0-9_-]{16,48}$/.test(actionId)) fail('invalid action ID')
  if (JSON.stringify(parseScope(question.scope)) !== JSON.stringify(scope) || question.draftFingerprint !== choiceDraftFingerprint(currentDraft)) throw new Error('stale conversation choice scope or draft')
  const [, nonce, choiceToken] = actionId.split('.')
  if (nonce !== question.nonce) throw new Error('stale conversation choice question')
  const choice = question.choices.find(item => item.token === choiceToken)
  if (!choice) throw new Error('unknown conversation choice')
  return { label: choice.label, operation: structuredClone(choice.operation) }
}
