import { whatsappConfig } from '../config/whatsapp.js'

type SendTextMessageInput = {
  to: string
  text: string
}

export class WhatsAppCloudApi {
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

      return {
        sent: false,
        to: recipientPhone,
        status: response.status,
        error: errorBody
      }
    }

    return {
      sent: true,
      to: recipientPhone,
      response: await response.json()
    }
  }
}

function formatRecipientPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')

  if (whatsappConfig.phoneNumberMode === 'sandbox_argentina' && digits.startsWith('549')) {
    return `54${digits.slice(3)}`
  }

  return digits
}
