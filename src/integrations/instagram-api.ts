import { instagramConfig } from '../config/instagram.js'

type MetaErrorBody = {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    is_transient?: boolean
  }
}

type JsonObject = Record<string, unknown>

export class InstagramApiRequestError extends Error {
  readonly httpStatus: number | null
  readonly metaCode: number | null
  readonly metaSubcode: number | null
  readonly transient: boolean
  readonly ambiguous: boolean

  constructor(input: {
    message: string
    httpStatus: number | null
    metaCode?: number | null | undefined
    metaSubcode?: number | null | undefined
    transient: boolean
    ambiguous: boolean
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'InstagramApiRequestError'
    this.httpStatus = input.httpStatus
    this.metaCode = input.metaCode ?? null
    this.metaSubcode = input.metaSubcode ?? null
    this.transient = input.transient
    this.ambiguous = input.ambiguous
  }
}

export class InstagramApi {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getAccount(input: { accessToken: string }) {
    return this.getAccountById({ accountId: 'me', accessToken: input.accessToken })
  }

  async getAccountById(input: { accountId: string; accessToken: string }) {
    const url = this.resourceUrl(input.accountId)
    url.searchParams.set('fields', 'id,username,name')
    url.searchParams.set('access_token', input.accessToken)
    const body = await this.request<MetaErrorBody & { id?: string; username?: string; name?: string }>(url, {
      method: 'GET'
    }, 'Instagram no pudo validar el token.')
    if (!body.id) {
      throw this.invalidResponse('Instagram no pudo validar el token.')
    }
    return { id: body.id, username: body.username ?? null, name: body.name ?? null }
  }

  async createReelContainer(input: {
    accountId: string
    accessToken: string
    videoUrl: string
    caption: string
    shareToFeed: boolean
  }) {
    this.assertHttpsVideoUrl(input.videoUrl)
    const body = await this.request<MetaErrorBody & { id?: string }>(
      this.resourceUrl(input.accountId, 'media'),
      this.postJson(input.accessToken, {
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: input.shareToFeed
      }),
      'Instagram rechazo la creación del Reel.'
    )
    if (!body.id) {
      throw this.invalidResponse('Instagram no devolvió el contenedor del Reel.', true)
    }
    return { containerId: body.id }
  }

  async getContainerStatus(input: { containerId: string; accessToken: string }) {
    const url = this.resourceUrl(input.containerId)
    url.searchParams.set('fields', 'status_code')
    const body = await this.request<MetaErrorBody & { status_code?: string }>(url, {
      method: 'GET',
      headers: this.authorization(input.accessToken)
    }, 'Instagram no pudo consultar el estado del Reel.')
    if (!body.status_code) {
      throw this.invalidResponse('Instagram no devolvió el estado del Reel.')
    }
    return { statusCode: body.status_code }
  }

  async publishContainer(input: { accountId: string; accessToken: string; containerId: string }) {
    const body = await this.request<MetaErrorBody & { id?: string }>(
      this.resourceUrl(input.accountId, 'media_publish'),
      this.postJson(input.accessToken, { creation_id: input.containerId }),
      'Instagram rechazo la publicación del Reel.'
    )
    if (!body.id) {
      throw this.invalidResponse('Instagram no devolvió el identificador del Reel publicado.', true)
    }
    return { mediaId: body.id }
  }

  async getContentPublishingLimit(input: { accountId: string; accessToken: string }) {
    const url = this.resourceUrl(input.accountId, 'content_publishing_limit')
    url.searchParams.set('fields', 'quota_usage,config')
    const body = await this.request<MetaErrorBody & {
      data?: Array<{ quota_usage?: number; config?: JsonObject }>
    }>(url, {
      method: 'GET',
      headers: this.authorization(input.accessToken)
    }, 'Instagram no pudo consultar el límite de publicaciones.')
    const limit = body.data?.[0]
    if (!limit || typeof limit.quota_usage !== 'number') {
      throw this.invalidResponse('Instagram no devolvió el límite de publicaciones.')
    }
    return { quotaUsage: limit.quota_usage, config: limit.config ?? {} }
  }

  async sendPrivateReply(input: {
    accountId: string
    accessToken: string
    commentId: string
    text: string
  }) {
    return this.sendMessage({
      accountId: input.accountId,
      accessToken: input.accessToken,
      recipient: { comment_id: input.commentId },
      text: input.text
    })
  }

  async sendTextMessage(input: {
    instagramAccountId: string
    accessToken: string
    recipientId: string
    text: string
  }) {
    const delivery = await this.sendMessage({
      accountId: input.instagramAccountId,
      accessToken: input.accessToken,
      recipient: { id: input.recipientId },
      text: input.text,
      fallbackRecipientId: input.recipientId
    })
    // Preserve the established non-null recipient contract for direct DMs.
    return { messageId: delivery.messageId, recipientId: delivery.recipientId ?? input.recipientId }
  }

  private async sendMessage(input: {
    accountId: string
    accessToken: string
    recipient: { id: string } | { comment_id: string }
    text: string
    fallbackRecipientId?: string
  }) {
    const body = await this.request<MetaErrorBody & { message_id?: string; recipient_id?: string }>(
      this.resourceUrl(input.accountId, 'messages'),
      this.postJson(input.accessToken, {
        recipient: input.recipient,
        message: { text: input.text }
      }),
      'Instagram rechazo el mensaje.'
    )
    if (!body.message_id) {
      throw this.invalidResponse('Instagram no devolvió el identificador del mensaje.', true)
    }
    return {
      messageId: body.message_id,
      recipientId: body.recipient_id ?? input.fallbackRecipientId ?? null
    }
  }

  private resourceUrl(id: string, child?: string) {
    const suffix = child ? `/${child}` : ''
    return new URL(
      `https://graph.instagram.com/${instagramConfig.apiVersion}/${encodeURIComponent(id)}${suffix}`
    )
  }

  private authorization(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}` }
  }

  private postJson(accessToken: string, body: JsonObject): RequestInit {
    return {
      method: 'POST',
      headers: {
        ...this.authorization(accessToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  }

  private async request<T extends MetaErrorBody>(
    url: URL,
    init: RequestInit,
    fallbackMessage: string
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch (cause) {
      throw new InstagramApiRequestError({
        message: cause instanceof Error ? cause.message : 'No se pudo conectar con Instagram.',
        httpStatus: null,
        transient: true,
        ambiguous: init.method === 'POST',
        cause
      })
    }

    let body: T
    try {
      body = await response.json() as T
    } catch (cause) {
      throw new InstagramApiRequestError({
        message: fallbackMessage,
        httpStatus: response.status,
        transient: response.status === 429 || response.status >= 500,
        ambiguous: init.method === 'POST' && (response.ok || response.status >= 500),
        cause
      })
    }

    if (!response.ok || body.error) {
      throw new InstagramApiRequestError({
        message: body.error?.message || fallbackMessage,
        httpStatus: response.status,
        metaCode: body.error?.code,
        metaSubcode: body.error?.error_subcode,
        transient: body.error?.is_transient ?? (response.status === 429 || response.status >= 500),
        ambiguous: init.method === 'POST' && response.status >= 500 && !body.error
      })
    }
    return body
  }

  private invalidResponse(message: string, ambiguous = false) {
    return new InstagramApiRequestError({
      message,
      httpStatus: 200,
      transient: false,
      ambiguous
    })
  }

  private assertHttpsVideoUrl(videoUrl: string) {
    let parsed: URL
    try {
      parsed = new URL(videoUrl)
    } catch {
      throw new TypeError('La URL del video debe ser una URL HTTPS válida.')
    }
    if (parsed.protocol !== 'https:') {
      throw new TypeError('La URL del video debe usar HTTPS.')
    }
  }
}
