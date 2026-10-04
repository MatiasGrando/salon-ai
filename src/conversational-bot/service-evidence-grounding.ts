import { TURN_PLAN_LIMITS, TurnPlanValidationError } from './turn-plan.js'
type CatalogItem = { id: string; name: string }
const articles = new Set(['un', 'una', 'el', 'la', 'de', 'del'])
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= TURN_PLAN_LIMITS.evidence && !/[\u0000-\u001f]/.test(value)
const anchors = (catalog: readonly CatalogItem[]) => new Set(catalog.flatMap(item => normalized(item.name).split(' ').filter(term => term.length >= 3 && !articles.has(term) && term !== 'y')))

/** Exactly one boundary edit tied to a catalog token; no character substitution or whole-string compaction. */
function boundaryVariants(value: string, catalog: readonly CatalogItem[]): string[] {
  if (catalog.some(item => normalized(item.name) === value)) return []
  const terms = anchors(catalog)
  const words = value.split(' ')
  const variants = new Set<string>()
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    for (let offset = 1; offset < word.length; offset++) {
      const left = word.slice(0, offset), right = word.slice(offset)
      if (!terms.has(word) && (articles.has(left) && terms.has(right) || terms.has(left) && (terms.has(right) || articles.has(right)))) {
        variants.add([...words.slice(0,index), left, right, ...words.slice(index+1)].join(' '))
      }
    }
    const next = words[index+1]
    if (next && terms.has(word + next)) variants.add([...words.slice(0,index), word + next, ...words.slice(index+2)].join(' '))
  }
  return [...variants]
}
/** Ephemeral catalog meaning only. The plan and persisted basket retain the original excerpt. */
export function serviceEvidenceMeaning(source: string, catalog: readonly CatalogItem[]): string {
  const original = normalized(source)
  const variants = boundaryVariants(original, catalog)
  return variants.length === 1 ? variants[0]! : original
}
function sourceExcerpt(message: string, evidence: string, confidence: unknown, catalog: readonly CatalogItem[]): string {
  const wanted = normalized(evidence)
  const words = [...message.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({ start: match.index, end: match.index + match[0].length }))
  const literal: string[] = [], aligned: string[] = []
  for (let start = 0; start < words.length; start++) {
    for (let end = start; end < words.length; end++) {
      const source = message.slice(words[start]!.start, words[end]!.end)
      if (source.length > TURN_PLAN_LIMITS.evidence) break
      const text = normalized(source)
      if (text.length > wanted.length + 1) break
      if (text === wanted) literal.push(source)
      else if (!catalog.some(item => normalized(item.name) === text) && Math.abs(text.length - wanted.length) === 1 &&
        (boundaryVariants(text, catalog).includes(wanted) || boundaryVariants(wanted, catalog).includes(text))) aligned.push(source)
    }
  }
  const candidates = literal.length ? literal : aligned
  if (!candidates.length) throw new TurnPlanValidationError('evidence', 'invalid turn plan: ungrounded evidence')
  const source = candidates[0]!
  const changedMeaning = serviceEvidenceMeaning(source, catalog) !== normalized(source)
  // Tolerance cannot establish identity, negate a rejection, or turn weak confidence into a selection.
  if ((!literal.length || changedMeaning) && (candidates.length !== 1 || typeof confidence !== 'number' || confidence < 0.85 ||
      /\b(no|ni|sin|nunca)\b/.test(normalized(message)))) throw new TurnPlanValidationError('evidence', 'invalid turn plan: ungrounded evidence')
  return source
}
/** Service-only grounding before the unchanged strict parser; all other evidence remains untouched. */
export function groundServicePlan(value: unknown, message: string, catalog: readonly CatalogItem[]): unknown {
  if (!record(value) || !Array.isArray(value.operations) || value.operations.length > TURN_PLAN_LIMITS.operations) return value
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return value }
  if (serialized.length > TURN_PLAN_LIMITS.serialized) return value
  const result = structuredClone(value)
  const ground = (item: Record<string, unknown>) => {
    if (Array.isArray(item.serviceIds) && item.serviceIds.some(id => typeof id === 'string' && !catalog.some(service => service.id === id))) throw new TurnPlanValidationError('catalog', 'invalid turn plan: catalog')
    if (bounded(item.evidence)) {
      const proposedEvidence = item.evidence
      const source = sourceExcerpt(message, proposedEvidence, item.confidence, catalog)
      item.evidence = source
      const meaning = serviceEvidenceMeaning(source, catalog)
      const recovered = normalized(proposedEvidence) !== normalized(source) || meaning !== normalized(source)
      if (recovered && Array.isArray(item.serviceIds) && item.serviceIds.length <= TURN_PLAN_LIMITS.candidates && new Set(item.serviceIds).size === item.serviceIds.length &&
          (item.mode === 'single' ? item.serviceIds.length === 1 : item.mode === 'unresolved' ? item.serviceIds.length === 0 : item.serviceIds.length >= 2) &&
          item.serviceIds.every(id => typeof id === 'string') &&
          ['single', 'alternatives', 'unresolved', 'multiple'].includes(String(item.mode))) {
        const terms = anchors(catalog)
        const requested = normalized(meaning).split(' ').filter(term => terms.has(term))
        const matches = catalog.filter(service => requested.length && requested.every(term => normalized(service.name).split(' ').includes(term)))
        if (item.mode === 'multiple') {
          if (item.serviceIds.some(id => {
            const service = catalog.find(candidate => candidate.id === id)
            return service && normalized(service.name).split(' ').filter(term => terms.has(term)).some(term => !requested.includes(term))
          })) throw new TurnPlanValidationError('catalog', 'invalid turn plan: catalog')
        } else {
          if (item.serviceIds.some(id => !matches.some(service => service.id === id))) throw new TurnPlanValidationError('catalog', 'invalid turn plan: catalog')
          if (matches.length > TURN_PLAN_LIMITS.candidates) throw new TurnPlanValidationError('catalog', 'invalid turn plan: catalog')
          if (matches.length > 1) {
            item.mode = 'alternatives'
            item.serviceIds = matches.map(service => service.id)
          }
        }
      }
    }
  }
  for (const item of result.operations as unknown[]) {
    if (!record(item)) continue
    if (item.kind === 'service') ground(item)
    if (item.kind === 'basket') {
      if (bounded(item.evidence)) item.evidence = sourceExcerpt(message, item.evidence, item.confidence, catalog)
      if (Array.isArray(item.members) && item.members.length <= 10) for (const member of item.members) if (record(member)) ground(member)
    }
  }
  return result
}
