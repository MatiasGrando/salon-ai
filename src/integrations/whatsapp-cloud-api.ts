import { resolveBusinessWhatsAppCredentials, type WhatsAppCloudCredentials } from '../services/business-whatsapp-settings.js'
import { normalizeArgentineMobilePhone } from '../services/phone-normalization-service.js'

const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024

type SendTextMessageInput = {
  businessId?: string | null
  to: string
  text: string
  credentials?: WhatsAppCloudCredentials
}

type SendReplyButtonsMessageInput = SendTextMessageInput & {
  buttons: Array<{ id: string; title: string }>
}

type SendInteractiveListMessageInput = SendTextMessageInput & {
  rows: Array<{ id: string; title: string; description?: string }>
  buttonText?: string
  sectionTitle?: string
}

export function buildWhatsAppReplyButtonsPayload(input: SendReplyButtonsMessageInput) {
  const requestedButtons = input.buttons.slice(0, 3)
  const normalizedTitles = requestedButtons.map((button) => button.title.trim().toLocaleLowerCase('es'))
  const hasDuplicateTitles = new Set(normalizedTitles).size < normalizedTitles.length
  const buttons = hasDuplicateTitles
    ? requestedButtons.map((button, index) => ({
        ...button,
        title: `${index + 1}. ${button.title.trim()}`.slice(0, 20).trim()
      }))
    : requestedButtons
  if (!buttons.length) throw new Error('Se necesita al menos un botón de respuesta')
  if (buttons.some((button) => !button.id.trim() || !button.title.trim() || button.title.length > 20)) {
    throw new Error('Los botones de WhatsApp requieren id, título y un máximo de 20 caracteres')
  }
  return {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: input.text },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: button.title }
        }))
      }
    }
  }
}

export function buildWhatsAppInteractiveListPayload(input: SendInteractiveListMessageInput) {
  const rows = input.rows.slice(0, 10).map((row) => ({
    id: row.id.trim(),
    title: row.title.trim(),
    ...(row.description?.trim() ? { description: row.description.trim() } : {})
  }))
  if (!rows.length) throw new Error('Se necesita al menos una opción para la lista de WhatsApp')
  if (rows.some((row) => !row.id || !row.title || row.title.length > 24 || (row.description?.length ?? 0) > 72)) {
    throw new Error('Las listas de WhatsApp requieren id, títulos de hasta 24 caracteres y descripciones de hasta 72')
  }
  return {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: input.text },
      action: {
        button: (input.buttonText?.trim() || 'Ver opciones').slice(0, 20),
        sections: [{
          title: (input.sectionTitle?.trim() || 'Elegí una opción').slice(0, 24),
          rows
        }]
      }
    }
  }
}

type SendTemplateMessageInput = {
  businessId?: string | null
  to: string
  templateName: string
  languageCode?: string
  bodyParameters?: string[]
  headerImageDataUrl?: string | null
}

type CreateMessageTemplateInput = {
  businessId?: string | null
  name: string
  languageCode: string
  category: 'MARKETING' | 'UTILITY'
  bodyText: string
  bodyExamples?: string[]
  headerImageDataUrl?: string | null
}

type FindMessageTemplateInput = {
  businessId?: string | null
  id?: string | null
  name: string
  languageCode?: string
}

type MessageTemplateData = {
  id?: string
  name?: string
  status?: string
  language?: string
  category?: string
  rejected_reason?: string
}

type FindMessageTemplateResult =
  | { found: true; template: MessageTemplateData }
  | { found: false; template: null; reason?: string; status?: number; errorCode?: number | string; errorMessage?: string }

type ListMessageTemplatesResult =
  | { listed: true; templates: MessageTemplateData[] }
  | { listed: false; templates: []; reason?: string; status?: number; errorCode?: number | string; errorMessage?: string }

type WhatsAppErrorBody = {
  error?: {
    code?: number | string
    message?: string
    type?: string
    error_subcode?: number | string
    fbtrace_id?: string
    error_data?: {
      details?: string
    }
  }
}

function preferredMessageTemplate(templates: MessageTemplateData[]) {
  return [...templates].sort((a, b) => messageTemplateStatusRank(a.status) - messageTemplateStatusRank(b.status))[0]
}

function messageTemplateStatusRank(status?: string) {
  const normalized = status?.toUpperCase()
  if (normalized === 'APPROVED' || normalized === 'ACTIVE') return 0
  if (normalized === 'PAUSED') return 1
  if (normalized === 'PENDING' || normalized === 'IN_APPEAL') return 2
  if (normalized === 'REJECTED' || normalized === 'DISABLED') return 3
  return 4
}

export class WhatsAppCloudApi {
  async downloadMedia(input: { businessId?: string | null; mediaId: string }) {
    const config = await resolveBusinessWhatsAppCredentials(input.businessId)
    if (!config.accessToken) {
      return {
        downloaded: false as const,
        reason: 'WHATSAPP_ACCESS_TOKEN no configurado'
      }
    }

    const metadataResponse = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(input.mediaId)}`,
      {
        headers: {
          Authorization: `Bearer ${config.accessToken}`
        }
      }
    )
    if (!metadataResponse.ok) {
      const parsedError = parseWhatsAppError(await metadataResponse.text())
      return {
        downloaded: false as const,
        status: metadataResponse.status,
        errorCode: parsedError.code,
        errorMessage: parsedError.message
      }
    }

    const metadata = await metadataResponse.json() as {
      url?: string
      mime_type?: string
      file_size?: number
    }
    if (!metadata.url) {
      return {
        downloaded: false as const,
        reason: 'Meta no devolvio la URL del archivo'
      }
    }
    if (metadata.file_size && metadata.file_size > MAX_INBOUND_MEDIA_BYTES) {
      return {
        downloaded: false as const,
        reason: 'El archivo supera el limite de 25 MB'
      }
    }

    const mediaResponse = await fetch(metadata.url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`
      }
    })
    if (!mediaResponse.ok) {
      return {
        downloaded: false as const,
        status: mediaResponse.status,
        reason: 'No pude descargar el archivo desde Meta'
      }
    }

    const data = Buffer.from(await mediaResponse.arrayBuffer())
    if (data.length > MAX_INBOUND_MEDIA_BYTES) {
      return {
        downloaded: false as const,
        reason: 'El archivo supera el limite de 25 MB'
      }
    }

    return {
      downloaded: true as const,
      data,
      contentType: metadata.mime_type || mediaResponse.headers.get('content-type') || 'application/octet-stream'
    }
  }

  async listMessageTemplates(input: { businessId?: string | null; name: string }): Promise<ListMessageTemplatesResult> {
    const config = await resolveBusinessWhatsAppCredentials(input.businessId)
    if (!config.accessToken || !config.businessAccountId) {
      return { listed: false, templates: [], reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' }
    }

    const fields = 'id,name,status,language,category,rejected_reason'
    const url = `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates?fields=${encodeURIComponent(fields)}&name=${encodeURIComponent(input.name)}&limit=100`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` } })

    if (!response.ok) {
      const parsedError = parseWhatsAppError(await response.text())
      return {
        listed: false,
        templates: [],
        status: response.status,
        ...definedString('errorCode', parsedError.code),
        ...definedString('errorMessage', parsedError.message)
      }
    }

    const body = await response.json() as { data?: MessageTemplateData[] }
    return { listed: true, templates: (body.data || []).filter((item) => item.name === input.name) }
  }

  async findMessageTemplate(input: FindMessageTemplateInput): Promise<FindMessageTemplateResult> {
    const config = await resolveBusinessWhatsAppCredentials(input.businessId)
    if (!config.accessToken || !config.businessAccountId) {
      return { found: false, template: null, reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' }
    }

    const fields = 'id,name,status,language,category,rejected_reason'
    const url = input.id
      ? `https://graph.facebook.com/${config.apiVersion}/${input.id}?fields=${encodeURIComponent(fields)}`
      : `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates?fields=${encodeURIComponent(fields)}&name=${encodeURIComponent(input.name)}&limit=100`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` } })

    if (!response.ok) {
      const parsedError = parseWhatsAppError(await response.text())
      return {
        found: false,
        template: null,
        status: response.status,
        ...definedString('errorCode', parsedError.code),
        ...definedString('errorMessage', parsedError.message)
      }
    }

    const body = await response.json() as {
      id?: string
      name?: string
      status?: string
      language?: string
      category?: string
      rejected_reason?: string
      data?: MessageTemplateData[]
    }
    const template = input.id
      ? body
      : preferredMessageTemplate((body.data || []).filter((item) => item.name === input.name && (!input.languageCode || item.language === input.languageCode)))

    return template ? { found: true, template } : { found: false, template: null, reason: 'No encontre esa plantilla en Meta' }
  }

  async createMessageTemplate(input: CreateMessageTemplateInput) {
    const config = await resolveBusinessWhatsAppCredentials(input.businessId)
    if (!config.accessToken || !config.businessAccountId) {
      return {
        created: false,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID no configurado'
      }
    }

    let headerHandle: string | null = null
    if (input.headerImageDataUrl) {
      if (!config.appId) {
        return { created: false, reason: 'META_APP_ID no configurado para subir la imagen de la plantilla' }
      }
      const upload = await uploadTemplateImage(input.headerImageDataUrl, config)
      if (!upload.uploaded) return { created: false, reason: upload.errorMessage || 'No pude subir la imagen a Meta' }
      headerHandle = upload.handle
    }

    const response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: input.name,
          language: input.languageCode,
          category: input.category,
          components: [
            ...(headerHandle
              ? [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } }]
              : []),
            {
              type: 'BODY',
              text: input.bodyText,
              ...(input.bodyExamples?.length ? { example: { body_text: [input.bodyExamples] } } : {})
            }
          ]
        })
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = parseWhatsAppError(errorBody)

      return {
        created: false,
        status: response.status,
        errorType: parsedError.type,
        errorCode: parsedError.code,
        errorSubcode: parsedError.subcode,
        fbtraceId: parsedError.fbtraceId,
        errorMessage: parsedError.message
      }
    }

    return {
      created: true,
      response: await response.json()
    }
  }

  async sendTextMessage(input: SendTextMessageInput) {
    const config = input.credentials ?? await resolveBusinessWhatsAppCredentials(input.businessId)
    const recipientPhone = formatRecipientPhone(input.to, config)

    if (!config.accessToken || !config.phoneNumberId) {
      return {
        sent: false,
        to: recipientPhone,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado'
      }
    }

    const response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: {
            body: input.text
          }
        })
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = parseWhatsAppError(errorBody)

      return {
        sent: false,
        to: recipientPhone,
        status: response.status,
        error: errorBody,
        errorType: parsedError.type,
        errorCode: parsedError.code,
        errorSubcode: parsedError.subcode,
        fbtraceId: parsedError.fbtraceId,
        errorMessage: parsedError.message
      }
    }

    return {
      sent: true,
      to: recipientPhone,
      response: await response.json()
    }
  }

  async sendReplyButtonsMessage(input: SendReplyButtonsMessageInput) {
    const config = input.credentials ?? await resolveBusinessWhatsAppCredentials(input.businessId)
    const recipientPhone = formatRecipientPhone(input.to, config)

    if (!config.accessToken || !config.phoneNumberId) {
      return { sent: false, to: recipientPhone, reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado' }
    }

    const response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildWhatsAppReplyButtonsPayload({ ...input, to: recipientPhone }))
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = parseWhatsAppError(errorBody)
      return {
        sent: false,
        to: recipientPhone,
        status: response.status,
        error: errorBody,
        errorType: parsedError.type,
        errorCode: parsedError.code,
        errorSubcode: parsedError.subcode,
        fbtraceId: parsedError.fbtraceId,
        errorMessage: parsedError.message
      }
    }

    return { sent: true, to: recipientPhone, response: await response.json() }
  }

  async sendInteractiveListMessage(input: SendInteractiveListMessageInput) {
    const config = input.credentials ?? await resolveBusinessWhatsAppCredentials(input.businessId)
    const recipientPhone = formatRecipientPhone(input.to, config)

    if (!config.accessToken || !config.phoneNumberId) {
      return { sent: false, to: recipientPhone, reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado' }
    }

    const response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildWhatsAppInteractiveListPayload({ ...input, to: recipientPhone }))
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = parseWhatsAppError(errorBody)
      return {
        sent: false,
        to: recipientPhone,
        status: response.status,
        error: errorBody,
        errorType: parsedError.type,
        errorCode: parsedError.code,
        errorSubcode: parsedError.subcode,
        fbtraceId: parsedError.fbtraceId,
        errorMessage: parsedError.message
      }
    }

    return { sent: true, to: recipientPhone, response: await response.json() }
  }

  async sendTemplateMessage(input: SendTemplateMessageInput) {
    const config = await resolveBusinessWhatsAppCredentials(input.businessId)
    const recipientPhone = formatRecipientPhone(input.to, config)

    if (!config.accessToken || !config.phoneNumberId) {
      return {
        sent: false,
        to: recipientPhone,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado'
      }
    }

    let headerMediaId: string | null = null
    if (input.headerImageDataUrl) {
      const upload = await uploadWhatsAppMedia(input.headerImageDataUrl, config)
      if (!upload.uploaded) return { sent: false, to: recipientPhone, reason: upload.errorMessage || 'No pude subir la imagen a WhatsApp' }
      headerMediaId = upload.id
    }

    const components = [
      ...(headerMediaId ? [{ type: 'header', parameters: [{ type: 'image', image: { id: headerMediaId } }] }] : []),
      ...(input.bodyParameters?.length
        ? [{ type: 'body', parameters: input.bodyParameters.map((text) => ({ type: 'text', text })) }]
        : [])
    ]

    const response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'template',
          template: {
            name: input.templateName,
            language: {
              code: input.languageCode ?? 'en_US'
            },
            ...(components.length
              ? { components }
              : {})
          }
        })
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = parseWhatsAppError(errorBody)

      return {
        sent: false,
        to: recipientPhone,
        status: response.status,
        errorType: parsedError.type,
        errorCode: parsedError.code,
        errorSubcode: parsedError.subcode,
        fbtraceId: parsedError.fbtraceId,
        errorMessage: parsedError.message
      }
    }

    return {
      sent: true,
      to: recipientPhone,
      response: await response.json()
    }
  }
}

async function uploadTemplateImage(dataUrl: string, config: WhatsAppCloudCredentials): Promise<{ uploaded: true; handle: string } | { uploaded: false; errorMessage?: string }> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match || !config.accessToken || !config.appId) return { uploaded: false, errorMessage: 'Imagen de plantilla inválida' }
  const mimeType = match[1]
  const base64Data = match[2]
  if (!mimeType || !base64Data) return { uploaded: false, errorMessage: 'Imagen de plantilla invalida' }
  const bytes = Buffer.from(base64Data, 'base64')
  const sessionResponse = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(mimeType)}&file_name=template-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}` }
  })
  if (!sessionResponse.ok) {
    const parsed = parseWhatsAppError(await sessionResponse.text())
    return { uploaded: false, ...definedString('errorMessage', parsed.message) }
  }
  const session = await sessionResponse.json() as { id?: string }
  if (!session.id) return { uploaded: false, errorMessage: 'Meta no devolvió una sesión para la imagen' }
  const uploadResponse = await fetch(`https://graph.facebook.com/${config.apiVersion}/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${config.accessToken}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes)
  })
  if (!uploadResponse.ok) {
    const parsed = parseWhatsAppError(await uploadResponse.text())
    return { uploaded: false, ...definedString('errorMessage', parsed.message) }
  }
  const uploaded = await uploadResponse.json() as { h?: string }
  return uploaded.h ? { uploaded: true, handle: uploaded.h } : { uploaded: false, errorMessage: 'Meta no devolvió el identificador de la imagen' }
}

async function uploadWhatsAppMedia(dataUrl: string, config: WhatsAppCloudCredentials): Promise<{ uploaded: true; id: string } | { uploaded: false; errorMessage?: string }> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match || !config.accessToken || !config.phoneNumberId) return { uploaded: false, errorMessage: 'Imagen de plantilla inválida' }
  const mimeType = match[1]
  const base64Data = match[2]
  if (!mimeType || !base64Data) return { uploaded: false, errorMessage: 'Imagen de plantilla invalida' }
  const bytes = Buffer.from(base64Data, 'base64')
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), 'template-image')
  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form
  })
  if (!response.ok) {
    const parsed = parseWhatsAppError(await response.text())
    return { uploaded: false, ...definedString('errorMessage', parsed.message) }
  }
  const uploaded = await response.json() as { id?: string }
  return uploaded.id ? { uploaded: true, id: uploaded.id } : { uploaded: false, errorMessage: 'WhatsApp no devolvió el identificador de la imagen' }
}

function parseWhatsAppError(errorBody: string) {
  try {
    const parsedBody = JSON.parse(errorBody) as WhatsAppErrorBody

    return {
      type: parsedBody.error?.type,
      code: parsedBody.error?.code ? String(parsedBody.error.code) : undefined,
      subcode: parsedBody.error?.error_subcode ? String(parsedBody.error.error_subcode) : undefined,
      fbtraceId: parsedBody.error?.fbtrace_id,
      message: parsedBody.error?.error_data?.details ?? parsedBody.error?.message
    }
  } catch {
    return {
      type: undefined,
      code: undefined,
      subcode: undefined,
      fbtraceId: undefined,
      message: errorBody
    }
  }
}

function definedString<T extends string>(key: T, value?: string) {
  return value === undefined ? {} : { [key]: value } as Record<T, string>
}

function formatRecipientPhone(phone: string, config: WhatsAppCloudCredentials) {
  const normalized = normalizeArgentineMobilePhone(phone)
  const digits = normalized.ok ? normalized.phone : phone.replace(/\D/g, '')

  if (config.phoneNumberMode === 'legacy_argentina_without_mobile_9' && digits.startsWith('549')) {
    return `54${digits.slice(3)}`
  }

  return digits
}
