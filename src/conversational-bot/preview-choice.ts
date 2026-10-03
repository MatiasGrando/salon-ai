import { choiceDraftFingerprint, parseChoiceQuestion, resolveChoice, type ChoiceQuestion, type ChoiceScope, type ConversationChoiceOperation } from './choices.js'

const FIELD = 'previewChoiceContext'
type Ledger = { version: 1; revision: string; question: ChoiceQuestion | null }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function validRevision(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
}
export function nextPreviewRevision(previous: string): string {
  if (!validRevision(previous) || previous === '9223372036854775807') throw new Error('invalid preview choice revision')
  return (BigInt(previous) + 1n).toString()
}
/** Old snapshots remain top-level DialogueState; the private ledger is never passed to the engine. */
export function readPreviewChoiceState(value: unknown): { draft: unknown; revision: string; question: ChoiceQuestion | null } {
  if (!object(value) || !Object.hasOwn(value, FIELD)) return { draft: structuredClone(value), revision: '0', question: null }
  const raw = value[FIELD]
  if (!object(raw) || Object.keys(raw).sort().join(',') !== 'question,revision,version' || raw.version !== 1 || !validRevision(raw.revision)) throw new Error('invalid preview choice ledger')
  const question = raw.question === null ? null : parseChoiceQuestion(raw.question)
  if (question && question.scope.revision !== raw.revision) throw new Error('invalid preview choice revision')
  const draft = structuredClone(value)
  delete draft[FIELD]
  return { draft, revision: raw.revision, question }
}
export function storePreviewChoiceState<T extends object>(draft: T, revision: string, question: ChoiceQuestion | null): T & { previewChoiceContext: Ledger } {
  if (!object(draft) || Object.hasOwn(draft, FIELD) || !validRevision(revision)) throw new Error('invalid preview choice draft or revision')
  if (question && question.scope.revision !== revision) throw new Error('invalid preview choice revision')
  if (question && question.draftFingerprint !== choiceDraftFingerprint(draft)) throw new Error('invalid preview choice draft')
  const ledger: Ledger = { version: 1, revision, question: question ? parseChoiceQuestion(question) : null }
  return Object.assign(structuredClone(draft), { previewChoiceContext: ledger })
}
export type PreviewChoiceGate = 'ledger_resolve' | 'engine_admission' | 'commit_recheck'
export type PreviewChoiceReason = 'not_current' | 'question_incomplete' | 'role_or_option_mismatch' | 'draft_not_eligible' | 'current_data_unavailable'
export class PreviewChoiceError extends Error {
  readonly gate: PreviewChoiceGate
  readonly reason: PreviewChoiceReason
  constructor(gate: PreviewChoiceGate = 'ledger_resolve', reason: PreviewChoiceReason = 'not_current') {
    super('Esta opción ya no está vigente. Elegí una opción de la última respuesta o escribí tu consulta.')
    this.name = 'PreviewChoiceError'
    this.gate = gate
    this.reason = reason
  }
}
export function resolvePreviewChoice(stored: unknown, scope: ChoiceScope, actionId: string): { label: string; operation: ConversationChoiceOperation } {
  try {
    const current = readPreviewChoiceState(stored)
    if (!current.question || current.revision !== scope.revision) throw new Error('stale preview choice')
    return resolveChoice(current.question, scope, current.draft, actionId)
  } catch { throw new PreviewChoiceError() }
}
