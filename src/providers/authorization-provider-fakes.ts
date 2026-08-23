import type {
  AuthorizationProviders,
  CalendarCreateInput,
  EmailSendInput,
  MediaDownloadInput,
  WhatsAppSendInput
} from './authorization-providers.js'

export type AuthorizationProviderCalls = {
  whatsapp: WhatsAppSendInput[]
  media: MediaDownloadInput[]
  email: EmailSendInput[]
  calendar: CalendarCreateInput[]
}

export function createAuthorizationProviderFakes() {
  const calls: AuthorizationProviderCalls = {
    whatsapp: [],
    media: [],
    email: [],
    calendar: []
  }

  const providers: AuthorizationProviders = {
    whatsapp: {
      async sendTextMessage(input) {
        calls.whatsapp.push(input)
        return {
          sent: true,
          to: input.to,
          response: {
            messages: [{ id: `fake-whatsapp-${calls.whatsapp.length}` }]
          }
        }
      }
    },
    media: {
      async download(input) {
        calls.media.push(input)
        return {
          downloaded: true,
          data: Buffer.from(`fake-media-${calls.media.length}`),
          contentType: 'application/octet-stream'
        }
      }
    },
    email: {
      async send(input) {
        calls.email.push(input)
      }
    },
    calendar: {
      async createEvent(input) {
        calls.calendar.push(input)
      }
    }
  }

  return { calls, providers }
}
