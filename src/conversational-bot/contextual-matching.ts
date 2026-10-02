import Fuse from 'fuse.js'
import { normalizeAnswer } from './dialogue-context.js'

export type MatchingCategory = 'service' | 'professional' | 'estimate'
export type MatchingScope = { businessId: string; category: MatchingCategory; targetId?: string }
export type MatchingItem = MatchingScope & { id: string; label: string; aliases?: readonly string[] }
export type MatchingResult = { kind: 'exact' | 'candidates' | 'none'; items: MatchingItem[]; complete: boolean }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value)
const words = (value: string) => normalizeAnswer(value).split(' ').filter(word => word && word !== 'y').sort()
/** Search scores rank retrieval only. They are not probabilities, confidence or permission to select. */
export function matchContextualItems(scope: MatchingScope, query: string, items: readonly MatchingItem[]): MatchingResult {
  if (!text(scope.businessId, 128) || !['service','professional','estimate'].includes(scope.category) || scope.targetId !== undefined && !text(scope.targetId, 128) || items.length > 200 || !text(query, 2000)) throw new Error('invalid matching input')
  const scoped = items.filter(item => item.businessId === scope.businessId && item.category === scope.category && item.targetId === scope.targetId)
  if (new Set(scoped.map(item => item.id)).size !== scoped.length || scoped.some(item => !text(item.id, 128) || !text(item.label, 200) || item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.length > 12 || item.aliases.some(alias => !text(alias, 200))))) throw new Error('invalid matching catalogue')
  const input = words(query), normalized = ' ' + normalizeAnswer(query) + ' '
  const exact = scoped.filter(item => [item.label, ...(item.aliases ?? [])].some(label => {
    const terms = words(label)
    return JSON.stringify(input) === JSON.stringify(terms) || normalized.includes(' ' + normalizeAnswer(label) + ' ') ||
      scope.category === 'service' && terms.every(word => input.includes(word))
  }))
  const partial = scope.category === 'service' && !exact.length ? input.filter(word => !['quiero','un','una','turno','para','hoy','manana','con','el','la','servicio','cambiar'].includes(word)) : []
  const contextualExact = exact.length ? exact : partial.length ? scoped.filter(item => [item.label, ...(item.aliases ?? [])].some(label => partial.every(word => words(label).includes(word)))) : []
  if (contextualExact.length) return { kind: 'exact', items: contextualExact.slice(0, 10), complete: contextualExact.length <= 10 }
  const fuse = new Fuse(scoped, { keys: ['label','aliases'], threshold: 0.34, includeScore: true, ignoreLocation: true, ignoreFieldNorm: true, ignoreDiacritics: true, minMatchCharLength: 2 })
  // Keep close retrieval alternatives, not a much worse unrelated tail. Still never auto-select.
  const ranked = fuse.search(normalizeAnswer(query))
  const found = ranked.filter(result => (result.score ?? 1) <= (ranked[0]?.score ?? 1) + 0.12)
  return { kind: found.length ? 'candidates' : 'none', items: found.slice(0, 10).map(result => result.item), complete: found.length <= 10 }
}
export function matchNamedItems(scope: MatchingScope, query: string, items: readonly { id: string; name: string; aliases?: readonly string[] }[]): MatchingResult {
  return matchContextualItems(scope, query, items.map(item => ({ ...scope, id: item.id, label: item.name, ...(item.aliases ? { aliases: item.aliases } : {}) })))
}
export function matchingQuestion(result: MatchingResult, category: MatchingCategory): string {
  if (!result.items.length && category === 'service') return 'No pude identificar ese servicio. ¿Qué servicio necesitás?'
  if (result.items.length === 1) return '¿Te referís a ' + result.items[0]!.label + '?'
  const field = category === 'professional' ? 'profesional' : category === 'estimate' ? 'opción del presupuesto' : 'servicio'
  return 'No pude identificar ' + (category === 'estimate' ? 'una única opción del presupuesto' : 'un único ' + field) + '. ¿Cuál elegís?' +
    (result.items.length ? '\n' + result.items.map(item => item.label).join(', ') : '')
}
/** Confirmation is a closed answer, optionally accompanied by independently validated operation evidence. */
export function affirmativeMatchAnswer(message: string, independentEvidence: readonly string[] = []): boolean {
  let answer = ' ' + normalizeAnswer(message) + ' '
  for (const evidence of independentEvidence) answer = answer.replace(' ' + normalizeAnswer(evidence) + ' ', ' ')
  return /^(?:si|correcto|dale|ese|esa|exacto)$/.test(answer.trim())
}

/** A presented service answer is closed: unknown words cannot authorize an exact choice. */
export function matchPresentedServiceAnswer(scope: MatchingScope, query: string, items: readonly MatchingItem[]): MatchingResult {
  const none: MatchingResult = { kind: 'none', items: [], complete: true }
  const answer = normalizeAnswer(query)
  if (scope.category !== 'service' || /[?¿]/.test(query) ||
      /\b(no|pero|mejor|antes|depende|quizas|tal vez|soy|nombre|llamo)\b/.test(answer) ||
      affirmativeMatchAnswer(query)) return none
  const result = matchContextualItems(scope, query, items)
  if (result.kind !== 'exact') return result
  const input = answer.split(' ')
  const closed = result.items.filter(item => [item.label, ...(item.aliases ?? [])].some(label =>
    input.every(word => normalizeAnswer(label).split(' ').includes(word))))
  return { kind: closed.length ? 'exact' : 'none', items: closed, complete: result.complete }
}
