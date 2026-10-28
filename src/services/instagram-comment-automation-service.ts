import { normalizeInstagramKeyword } from './instagram-automation-domain.js'

export class InstagramAutomationError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}
export type InstagramAutomationTarget = { mediaId: string } | { publicationId: string }
type Client = Record<string, any>
export type InstagramAutomationInput = {
  enabled: boolean; keywords: string[]; privateReplyEnabled: boolean; privateReplyText: string
  publicReplyEnabled: boolean; publicReplyText: string
}

export class InstagramCommentAutomationService {
  constructor(private readonly client: Client) {}

  async get(businessId: string, target: InstagramAutomationTarget) {
    return this.client.$transaction(async (tx: Client) => {
      const resolved = await resolveInstagramAutomationTarget(tx, businessId, target, false)
      return this.present(tx, resolved)
    })
  }

  async save(businessId: string, target: InstagramAutomationTarget, raw: unknown) {
    const input = validateAutomation(raw)
    return this.client.$transaction(async (tx: Client) => {
      const resolved = await resolveInstagramAutomationTarget(tx, businessId, target)
      const data = { enabled: input.enabled, privateReplyEnabled: input.privateReplyEnabled,
        privateReplyText: input.privateReplyText, publicReplyEnabled: input.publicReplyEnabled, publicReplyText: input.publicReplyText }
      const automation = resolved.automation
        ? await tx.instagramCommentAutomation.update({ where: { id: resolved.automation.id }, data })
        : await tx.instagramCommentAutomation.create({ data: { ...data, businessId,
          publicationId: resolved.publicationId, accountId: resolved.mediaId ? resolved.accountId : null, mediaId: resolved.mediaId } })
      await tx.instagramAutomationKeyword.deleteMany({ where: { businessId, automationId: automation.id } })
      await tx.instagramAutomationKeyword.createMany({ data: input.keywords.map((value) => ({ businessId, automationId: automation.id,
        value, normalizedValue: normalizeInstagramKeyword(value) })) })
      resolved.automation = { ...automation, keywords: input.keywords.map((value) => ({ value, normalizedValue: normalizeInstagramKeyword(value) })) }
      return this.present(tx, resolved)
    })
  }

  private async present(tx: Client, resolved: Awaited<ReturnType<typeof resolveInstagramAutomationTarget>>) {
    const row = resolved.automation
    const actions = row ? await tx.instagramCommentAction.findMany({ where: { businessId: row.businessId,
      execution: { automationId: row.id } }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, executionId: true, kind: true, status: true, attempts: true, sentAt: true, lastError: true } }) : []
    return { accountId: resolved.accountId, mediaId: resolved.mediaId, publicationId: resolved.publicationId,
      automation: row ? { id: row.id, enabled: row.enabled, keywords: row.keywords.map((k: any) => k.value),
        privateReplyEnabled: row.privateReplyEnabled, privateReplyText: row.privateReplyText,
        publicReplyEnabled: row.publicReplyEnabled, publicReplyText: row.publicReplyText } : null,
      recentActions: actions.map((action: any) => ({ ...action, lastError: action.lastError ? 'No se pudo completar esta accion. Revisa su estado.' : null })) }
  }
}

// All configuration entry points serialize on the same account row. Then lock
// catalogue before publication, so local/imported configuration cannot clone IDs.
export async function resolveInstagramAutomationTarget(tx: Client, businessId: string, target: InstagramAutomationTarget, attach = true) {
  await tx.$queryRaw`SELECT "businessId" FROM "BusinessInstagramConfig" WHERE "businessId"=${businessId} FOR UPDATE`
  const config = await tx.businessInstagramConfig.findUnique({ where: { businessId }, select: { instagramAccountId: true } })
  const accountId = config?.instagramAccountId
  if (!accountId) throw new InstagramAutomationError(409, 'Configura la cuenta profesional de Instagram antes de continuar.')
  let media: any = null
  let publication: any = null
  if ('publicationId' in target) {
    publication = await tx.instagramPublication.findFirst({ where: { businessId, id: target.publicationId } })
    if (!publication) throw new InstagramAutomationError(404, 'Publicacion no encontrada.')
    if ((publication.publicationType ?? 'REEL') !== 'REEL' || publication.status !== 'PUBLISHED') throw new InstagramAutomationError(409, 'La automatizacion de este panel requiere un Reel publicado.')
    if (publication.metaMediaId) media = await tx.instagramMedia.findFirst({ where: { businessId, accountId, providerMediaId: publication.metaMediaId } })
  } else {
    media = await tx.instagramMedia.findFirst({ where: { businessId, accountId, id: target.mediaId, mediaProductType: 'REELS' } })
    if (!media) throw new InstagramAutomationError(404, 'Reel no encontrado para esta cuenta.')
    publication = await tx.instagramPublication.findFirst({ where: { businessId, metaMediaId: media.providerMediaId, status: 'PUBLISHED' } })
  }
  if (media) await tx.$queryRaw`SELECT "id" FROM "InstagramMedia" WHERE "id"=${media.id} AND "businessId"=${businessId} AND "accountId"=${accountId} FOR UPDATE`
  if (publication) await tx.$queryRaw`SELECT "id" FROM "InstagramPublication" WHERE "id"=${publication.id} AND "businessId"=${businessId} FOR UPDATE`
  const matches = await tx.instagramCommentAutomation.findMany({ where: { businessId, OR: [
    ...(media ? [{ accountId, mediaId: media.id }] : []), ...(publication ? [{ publicationId: publication.id }] : [])
  ] }, include: { keywords: true } })
  if (matches.length > 1) throw new InstagramAutomationError(409, 'Existen automatizaciones incompatibles para este Reel.')
  let automation = matches[0] ?? null
  if (automation && ((automation.accountId && automation.accountId !== accountId) ||
    (automation.mediaId && automation.mediaId !== media?.id))) throw new InstagramAutomationError(409, 'La automatizacion pertenece a otra cuenta.')
  if (attach && automation && media && !automation.mediaId) {
    automation = await tx.instagramCommentAutomation.update({ where: { id: automation.id },
      data: { accountId, mediaId: media.id }, include: { keywords: true } })
  }
  if (attach && automation && publication && !automation.publicationId) {
    automation = await tx.instagramCommentAutomation.update({ where: { id: automation.id },
      data: { publicationId: publication.id }, include: { keywords: true } })
  }
  return { businessId, accountId, mediaId: media?.id ?? null, publicationId: publication?.id ?? null, automation }
}

export function validateAutomation(raw: unknown): InstagramAutomationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InstagramAutomationError(400, 'Configuracion invalida.')
  const body = raw as Record<string, unknown>
  for (const flag of ['enabled', 'privateReplyEnabled', 'publicReplyEnabled']) {
    if (typeof body[flag] !== 'boolean') throw new InstagramAutomationError(400, 'Selecciona las acciones de la automatizacion.')
  }
  const privateReplyText = typeof body.privateReplyText === 'string' ? body.privateReplyText.trim() : ''
  const publicReplyText = typeof body.publicReplyText === 'string' ? body.publicReplyText.trim() : ''
  const keywords = Array.isArray(body.keywords) ? [...new Map(body.keywords.filter((k): k is string => typeof k === 'string')
    .map((value) => [normalizeInstagramKeyword(value), value.trim()])).entries()].filter(([key]) => key).map(([, value]) => value) : []
  if ((body.enabled && keywords.length < 1) || keywords.length > 20 || keywords.some((k) => k.length > 120) ||
    (body.enabled && !body.privateReplyEnabled && !body.publicReplyEnabled) ||
    privateReplyText.length > 1000 || publicReplyText.length > 1000 ||
    (body.enabled && body.privateReplyEnabled && !privateReplyText) ||
    (body.enabled && body.publicReplyEnabled && !publicReplyText) ||
    (body.publicReplyEnabled && /\{\{weex_form:|[?&]ref=/i.test(publicReplyText))) throw new InstagramAutomationError(400, 'Revisa palabras clave y textos. Los enlaces privados no se publican en comentarios.')
  return { enabled: body.enabled as boolean, privateReplyEnabled: body.privateReplyEnabled as boolean,
    publicReplyEnabled: body.publicReplyEnabled as boolean, privateReplyText, publicReplyText, keywords }
}
