import { whatsappConfig } from '../config/whatsapp.js'

type SendTextMessageInput = {
  to: string
  text: string
}

type SendTemplateMessageInput = {
  to: string
  templateName: string
  languageCode?: string
  bodyParameters?: string[]
}

type CreateMessageTemplateInput = {
  name: string
  languageCode: string
  category: 'MARKETING' | 'UTILITY'
  bodyText: string
  bodyExamples?: string[]
}

type FindMessageTemplateInput = {
  id?: string | null
  name: string
  languageCode: string
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

export class WhatsAppCloudApi {
  async findMessageTemplate(input: FindMessageTemplateInput): Promise<FindMessageTemplateResult> {
    if (!whatsappConfig.accessToken || !whatsappConfig.businessAccountId) {
      return { found: false, template: null, reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' }
    }

    const fields = 'id,name,status,language,category,rejected_reason'
    const url = input.id
      ? `https://graph.facebook.com/${whatsappConfig.apiVersion}/${input.id}?fields=${encodeURIComponent(fields)}`
      : `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.businessAccountId}/message_templates?fields=${encodeURIComponent(fields)}&name=${encodeURIComponent(input.name)}&limit=100`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` } })

    if (!response.ok) {
      const parsedError = parseWhatsAppError(await response.text())
      return { found: false, template: null, status: response.status, errorCode: parsedError.code, errorMessage: parsedError.message }
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
      : body.data?.find((item) => item.name === input.name && item.language === input.languageCode)

    return template ? { found: true, template } : { found: false, template: null, reason: 'No encontre esa plantilla en Meta' }
  }

  async createMessageTemplate(input: CreateMessageTemplateInput) {
    if (!whatsappConfig.accessToken || !whatsappConfig.businessAccountId) {
      return {
        created: false,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID no configurado'
      }
    }

    const response = await fetch(
      `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.businessAccountId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappConfig.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: input.name,
          language: input.languageCode,
          category: input.category,
          components: [
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
    const recipientPhone = formatRecipientPhone(input.to)

    if (!whatsappConfig.accessToken || !whatsappConfig.phoneNumberId) {
      return {
        sent: false,
        to: recipientPhone,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado'
      }
    }

    const response = await fetch(
      `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappConfig.accessToken}`,
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

  async sendTemplateMessage(input: SendTemplateMessageInput) {
    const recipientPhone = formatRecipientPhone(input.to)

    if (!whatsappConfig.accessToken || !whatsappConfig.phoneNumberId) {
      return {
        sent: false,
        to: recipientPhone,
        reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado'
      }
    }

    const response = await fetch(
      `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappConfig.accessToken}`,
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
            ...(input.bodyParameters?.length
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: input.bodyParameters.map((text) => ({ type: 'text', text }))
                    }
                  ]
                }
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

function formatRecipientPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')

  if (whatsappConfig.phoneNumberMode === 'legacy_argentina_without_mobile_9' && digits.startsWith('549')) {
    return `54${digits.slice(3)}`
  }

  return digits
}
