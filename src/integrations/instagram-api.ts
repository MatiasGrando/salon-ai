import { instagramConfig } from '../config/instagram.js'

type InstagramApiError = {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
  }
}

export class InstagramApi {
  async getAccount(input: { accessToken: string }) {
    const url = new URL(`https://graph.instagram.com/${instagramConfig.apiVersion}/me`)
    url.searchParams.set('fields', 'id,username,name')
    url.searchParams.set('access_token', input.accessToken)
    const response = await fetch(url)
    const body = await response.json() as InstagramApiError & { id?: string; username?: string; name?: string }
    if (!response.ok || !body.id) {
      throw new Error(body.error?.message || 'Instagram no pudo validar el token.')
    }
    return { id: body.id, username: body.username ?? null, name: body.name ?? null }
  }

  async sendTextMessage(input: { instagramAccountId: string; accessToken: string; recipientId: string; text: string }) {
    const response = await fetch(
      `https://graph.instagram.com/${instagramConfig.apiVersion}/${encodeURIComponent(input.instagramAccountId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipient: { id: input.recipientId },
          message: { text: input.text }
        })
      }
    )
    const body = await response.json() as InstagramApiError & { message_id?: string; recipient_id?: string }
    if (!response.ok || !body.message_id) {
      throw new Error(body.error?.message || 'Instagram rechazo el mensaje.')
    }
    return { messageId: body.message_id, recipientId: body.recipient_id ?? input.recipientId }
  }
}
