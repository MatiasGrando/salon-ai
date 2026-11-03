import { randomUUID } from 'node:crypto'
import { instagramConfig } from '../config/instagram.js'
import { InstagramApi, InstagramApiRequestError } from '../integrations/instagram-api.js'
import { emptyInsights, InstagramMediaError, INSTAGRAM_INSIGHT_METRICS, type ImportedInstagramMedia, type InsightValues, type InsightPeriods } from './instagram-media-domain.js'
import { PrismaInstagramMediaRepository } from './prisma-instagram-media-repository.js'

export type MediaConnection = { businessId: string; accountId: string; accessToken: string | null }
export type MediaScope = Pick<MediaConnection, 'businessId' | 'accountId'>
export type MediaListOptions = { limit: number; offset: number; kind?: 'REELS'; sort: 'publishedAt' | 'reach' | 'views'; from?: Date; to?: Date }
export type MediaObservation = { providerMediaId: string; observedAt: Date; apiVersion: string; values: InsightValues; periods: InsightPeriods; status: 'complete' | 'partial' | 'unavailable'; errorCode: string | null }
export type MediaPageClaim = { id: string; after: string | null; claimToken: string }
export interface InstagramMediaRepository {
  connection(businessId: string): Promise<MediaConnection | null>
  list(scope: MediaScope, options: MediaListOptions): Promise<{ items: any[]; total: number; linkedPublicationIds: string[] }>
  history(scope: MediaScope, id: string, limit: number, offset: number): Promise<{ items: any[]; total: number } | null>
  claim(connection: MediaConnection, continuation: string | undefined, claimToken: string, now: Date): Promise<MediaPageClaim>
  commit(input: { connection: MediaConnection; claim: MediaPageClaim; media: ImportedInstagramMedia[]; metadataObservedAt: Date; observations: MediaObservation[]; nextCursor: string | null; now: Date }): Promise<void>
  release(claim: MediaPageClaim): Promise<void>
}
export { InstagramMediaError } from './instagram-media-domain.js'
export class InstagramMediaService {
  constructor(
    private readonly repository: InstagramMediaRepository = new PrismaInstagramMediaRepository(),
    private readonly api: Pick<InstagramApi, 'listMedia' | 'getReelInsights'> = new InstagramApi(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(businessId: string, options: MediaListOptions) {
    const connection = await this.repository.connection(businessId)
    const result = connection ? await this.repository.list({ businessId, accountId: connection.accountId }, options) : { items: [], total: 0, linkedPublicationIds: [] }
    return { ...result, accountId: connection?.accountId ?? null, limit: options.limit, offset: options.offset }
  }

  async history(businessId: string, id: string, limit: number, offset: number) {
    const connection = await this.repository.connection(businessId)
    const result = connection ? await this.repository.history({ businessId, accountId: connection.accountId }, id, limit, offset) : null
    if (!result) throw new InstagramMediaError(404, 'Contenido de Instagram no encontrado.')
    return { ...result, accountId: connection!.accountId, mediaId: id, limit, offset }
  }

  async sync(businessId: string, continuation?: string) {
    const connection = await this.repository.connection(businessId)
    if (!connection?.accessToken) throw new InstagramMediaError(409, 'Guarda una conexion de Instagram antes de sincronizar.')
    const claim = await this.repository.claim(connection, continuation, randomUUID(), this.now())
    let page: Awaited<ReturnType<InstagramApi['listMedia']>>
    try {
      page = await this.api.listMedia({ accountId: connection.accountId, accessToken: connection.accessToken, after: claim.after })
    } catch (error) {
      await this.repository.release(claim)
      return { status: 'failed', accountId: connection.accountId, imported: 0, skipped: 0, continuation: claim.id, errorCode: insightErrorCode(error) }
    }
    const metadataObservedAt = this.now()
    const observations: MediaObservation[] = []
    // Bounded page of five; at most three 5s requests overlap. No background job.
    const reels = page.media.filter((item) => item.mediaProductType === 'REELS')
    for (let start = 0; start < reels.length; start += 3) {
      observations.push(...await Promise.all(reels.slice(start, start + 3).map(async (item): Promise<MediaObservation> => {
        let values = emptyInsights()
        let periods = Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name) => [name, null])) as InsightPeriods
        let errorCode: string | null = null
        try { ({ values, periods } = await this.api.getReelInsights({ mediaId: item.providerMediaId, accessToken: connection.accessToken! })) }
        catch (error) { errorCode = insightErrorCode(error) }
        const known = INSTAGRAM_INSIGHT_METRICS.filter((name) => values[name] !== null).length
        return { providerMediaId: item.providerMediaId, observedAt: this.now(), apiVersion: instagramConfig.apiVersion, values, periods,
          status: known === 7 ? 'complete' : known ? 'partial' : 'unavailable', errorCode: errorCode ?? (known ? null : 'no_data') }
      })))
    }
    try {
      await this.repository.commit({ connection, claim, media: page.media, metadataObservedAt, observations, nextCursor: page.nextCursor, now: this.now() })
    } catch (error) {
      await this.repository.release(claim)
      throw error
    }
    return { status: observations.some((item) => item.status !== 'complete') ? 'partial' : page.nextCursor ? 'more' : 'complete',
      accountId: connection.accountId, imported: page.media.length, skipped: page.skipped,
      continuation: page.nextCursor ? claim.id : null, errorCode: null }
  }
}
function insightErrorCode(error: unknown) {
  if (error instanceof InstagramApiRequestError) {
    if (error.httpStatus === 429) return 'rate_limited'
    if (error.httpStatus === 403 || error.metaCode === 10 || error.metaCode === 200) return 'permission_unavailable'
    if (error.metaCode === 190) return 'credentials_unavailable'
  }
  return error instanceof Error && error.message === 'unsupported_api_version' ? 'unsupported_api_version' : 'provider_unavailable'
}
