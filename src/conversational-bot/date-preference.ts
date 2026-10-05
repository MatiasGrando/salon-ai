import { isCustomerText } from './customer-text.js'
import { resolveDialogueDate } from './dialogue-date.js'

/** Ordered alternatives are restrictions to verify, never a selected booking date. */
export type DatePreferenceCandidate = { expression: string; value: string | null }
export type DatePreference = { expression: string; value: string }
export const DATE_PREFERENCE_LIMITS = { minimum: 2, maximum: 3, expression: 300 } as const
export const DATE_PREFERENCES_JSON_SCHEMA = {
  type: 'array', minItems: DATE_PREFERENCE_LIMITS.minimum, maxItems: DATE_PREFERENCE_LIMITS.maximum,
  items: { type: 'object', additionalProperties: false, required: ['expression', 'value'],
    properties: { expression: { type: 'string', minLength: 1, maxLength: DATE_PREFERENCE_LIMITS.expression },
      value: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } }
} as const
const normal = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contains = (text: string, fragment: string) => (' ' + normal(text) + ' ').includes(' ' + normal(fragment) + ' ')
const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validDate = (value: unknown): value is string => typeof value === 'string' && resolveDialogueDate(value, null).kind === 'resolved' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Structural validation is separate from resolving every date against the current business clock. */
export function parseDatePreferenceCandidates(value: unknown, evidence?: string): DatePreferenceCandidate[] {
  if (!Array.isArray(value) || value.length < DATE_PREFERENCE_LIMITS.minimum || value.length > DATE_PREFERENCE_LIMITS.maximum) throw new Error('invalid date preferences')
  const expressions = new Set<string>(), dates = new Set<string>()
  return value.map(candidate => {
    if (!row(candidate) || Object.keys(candidate).sort().join(',') !== 'expression,value' ||
        !isCustomerText(candidate.expression, DATE_PREFERENCE_LIMITS.expression) || !normal(candidate.expression) ||
        candidate.value !== null && !validDate(candidate.value) ||
        evidence !== undefined && !contains(evidence, candidate.expression)) throw new Error('invalid date preference candidate')
    const expression = normal(candidate.expression)
    if (expressions.has(expression) || candidate.value !== null && dates.has(candidate.value as string)) throw new Error('duplicate date preference')
    expressions.add(expression)
    if (candidate.value !== null) dates.add(candidate.value as string)
    return { expression: candidate.expression, value: candidate.value as string | null }
  })
}

/** Persist only a fully resolved list; do not accept partial, inferred or selected-date projections. */
export function parseDatePreferences(value: unknown): DatePreference[] {
  const candidates = parseDatePreferenceCandidates(value)
  if (candidates.some(candidate => candidate.value === null)) throw new Error('unresolved date preferences')
  return candidates as DatePreference[]
}

/** A singular proposal cannot cover contradictory dates in its actual speech-act scope. */
export function dateExpressionCoversCurrentEvidence(expression: string, evidence: string, businessDate: string): boolean {
  const scope = resolveDialogueDate(evidence, businessDate)
  if (scope.kind === 'ambiguous' || scope.kind === 'invalid') return false
  const date = resolveDialogueDate(expression, businessDate)
  return scope.kind !== 'resolved' || date.kind !== 'resolved' || scope.date === date.date
}

export function resolveDatePreferences(candidates: readonly DatePreferenceCandidate[], businessDate: string): DatePreference[] | null {
  const resolved: DatePreference[] = []
  for (const candidate of candidates) {
    const resolution = resolveDialogueDate(candidate.expression, businessDate)
    if (resolution.kind !== 'resolved' || resolution.date < businessDate ||
        candidate.value !== null && candidate.value !== resolution.date || resolved.some(item => item.value === resolution.date)) return null
    resolved.push({ expression: candidate.expression, value: resolution.date })
  }
  return resolved
}
