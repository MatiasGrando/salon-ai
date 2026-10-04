import { choiceDraftFingerprint } from './choices.js'
import type { ChoiceScope } from './choices.js'

export const PREVIEW_GROUP_FIELD = 'previewTurnGroup'
export const PREVIEW_GROUP_MAX_FRAGMENTS = 32
export const PREVIEW_GROUP_MAX_TEXT = 2_000
export type PreviewTurnGroupInput = { id: string; revision: string; visibleRevision: string; fragments: string[] }
type Group = PreviewTurnGroupInput & { version: 1; businessId: string; conversationKey: string; policyKey: string; base: unknown; fingerprint: string; sealed: boolean }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export class PreviewTurnGroupError extends Error {
  constructor() { super('El grupo de mensajes ya no esta vigente. Inicia una nueva conversacion para continuar.'); this.name = 'PreviewTurnGroupError' }
}
export function parsePreviewTurnGroupInput(value: unknown): PreviewTurnGroupInput {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'fragments,id,revision,visibleRevision' ||
    typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
    typeof value.revision !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(value.revision) ||
    typeof value.visibleRevision !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(value.visibleRevision) ||
    !Array.isArray(value.fragments) || !value.fragments.length || value.fragments.length > PREVIEW_GROUP_MAX_FRAGMENTS ||
    value.fragments.some(text => typeof text !== 'string' || !text.trim() || text.length > PREVIEW_GROUP_MAX_TEXT || /[\u0000]/.test(text)) ||
    value.fragments.join(' ').length > PREVIEW_GROUP_MAX_TEXT) throw new PreviewTurnGroupError()
  return { id: value.id, revision: value.revision, visibleRevision: value.visibleRevision, fragments: [...value.fragments] as string[] }
}
function readGroup(stored: unknown): Group | null {
  if (!object(stored) || !Object.hasOwn(stored, PREVIEW_GROUP_FIELD)) return null
  const group = stored[PREVIEW_GROUP_FIELD]
  if (!object(group)) throw new PreviewTurnGroupError()
  parsePreviewTurnGroupInput({ id: group.id, revision: group.revision, visibleRevision: group.visibleRevision, fragments: group.fragments })
  if (Object.keys(group).sort().join(',') !== 'base,businessId,conversationKey,fingerprint,fragments,id,policyKey,revision,sealed,version,visibleRevision' ||
    group.version !== 1 || typeof group.businessId !== 'string' || typeof group.conversationKey !== 'string' ||
    typeof group.policyKey !== 'string' || typeof group.sealed !== 'boolean' ||
    !Object.hasOwn(group, 'base') || group.fingerprint !== choiceDraftFingerprint(group.base) ||
    object(group.base) && Object.hasOwn(group.base, PREVIEW_GROUP_FIELD)) throw new PreviewTurnGroupError()
  return group as Group
}
/** Client supplies fragments, never a rollback snapshot. Only the exact latest scoped revision can extend a group. */
export function preparePreviewTurnGroup(stored: unknown, draft: unknown, scope: ChoiceScope, input: unknown, message: string) {
  const request = parsePreviewTurnGroupInput(input), previous = readGroup(stored)
  if (request.revision !== scope.revision || request.fragments.at(-1) !== message) throw new PreviewTurnGroupError()
  if (previous && (previous.businessId !== scope.businessId || previous.conversationKey !== scope.conversationKey || previous.policyKey !== scope.policyKey || previous.revision !== scope.revision)) throw new PreviewTurnGroupError()
  let base = draft
  if (previous?.id === request.id) {
    if (previous.sealed || previous.businessId !== scope.businessId || previous.conversationKey !== scope.conversationKey ||
      previous.policyKey !== scope.policyKey || previous.revision !== scope.revision || previous.visibleRevision !== request.visibleRevision ||
      request.fragments.length <= previous.fragments.length ||
      previous.fragments.some((text, index) => request.fragments[index] !== text)) throw new PreviewTurnGroupError()
    base = previous.base
  } else if (request.visibleRevision !== scope.revision && !(object(draft) && object(draft.sandboxReservation) && object(draft.sandboxReservation.receipt))) throw new PreviewTurnGroupError()
  const group: Group = { ...request, version: 1, businessId: scope.businessId, conversationKey: scope.conversationKey,
    policyKey: scope.policyKey, base: structuredClone(base), fingerprint: choiceDraftFingerprint(base), sealed: false }
  return { group, draft: structuredClone(base), message: request.fragments.join(' ') }
}
export function storePreviewTurnGroup<T extends object>(draft: T, group: Group | null, revision: string, sealed: boolean): T {
  return group ? Object.assign(draft, { [PREVIEW_GROUP_FIELD]: { ...structuredClone(group), revision, sealed } }) : draft
}
