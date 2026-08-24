import type { FastifyInstance } from 'fastify'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'

export type WhatsAppSendInput = Parameters<WhatsAppCloudApi['sendTextMessage']>[0]
export type WhatsAppSendResult = Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>>
export type MediaDownloadInput = Parameters<WhatsAppCloudApi['downloadMedia']>[0]
export type MediaDownloadResult = Awaited<ReturnType<WhatsAppCloudApi['downloadMedia']>>

export type EmailSendInput = {
  businessId: string
  recipientEmail: string
  subject: string
}

export type CalendarCreateInput = {
  businessId: string
  appointmentId: string
}

export type AuthorizationProviders = {
  whatsapp: {
    sendTextMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult>
  }
  media: {
    download(input: MediaDownloadInput): Promise<MediaDownloadResult>
  }
  email: {
    send(input: EmailSendInput): Promise<void>
  }
  calendar: {
    createEvent(input: CalendarCreateInput): Promise<void>
  }
}

export type AppClock = () => Date

export type BuildAppOptions = {
  authorizationProviders?: AuthorizationProviders
  clock?: AppClock
}

function unavailableProvider(name: string): never {
  throw new Error(`${name} provider is not wired through the authorization seam yet`)
}

export function createUnavailableAuthorizationProviders(): AuthorizationProviders {
  return {
    whatsapp: {
      async sendTextMessage() {
        return unavailableProvider('WhatsApp')
      }
    },
    media: {
      async download() {
        return unavailableProvider('Media')
      }
    },
    email: {
      async send() {
        return unavailableProvider('Email')
      }
    },
    calendar: {
      async createEvent() {
        return unavailableProvider('Calendar')
      }
    }
  }
}

export function createProductionAuthorizationProviders(): AuthorizationProviders {
  const whatsappCloudApi = new WhatsAppCloudApi()
  const unavailable = createUnavailableAuthorizationProviders()
  return {
    whatsapp: {
      sendTextMessage: (input) => whatsappCloudApi.sendTextMessage(input)
    },
    media: {
      download: (input) => whatsappCloudApi.downloadMedia(input)
    },
    email: unavailable.email,
    calendar: unavailable.calendar
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authorizationProviders: AuthorizationProviders
    clock: AppClock
  }
}

export function installAuthorizationProviders(
  app: FastifyInstance,
  options: BuildAppOptions
) {
  app.decorate(
    'authorizationProviders',
    options.authorizationProviders ?? createUnavailableAuthorizationProviders()
  )
  app.decorate('clock', options.clock ?? (() => new Date()))
}
