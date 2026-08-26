import type { PrismaClient } from '../../generated/prisma/client.js'

export type ShadowAdmissionTenant = {
  businessId: string
  appSecret: string | null
  appSecretPrevious: string | null
  appSecretPreviousValidUntil: Date | null
}

export type ShadowEventInsert = {
  provider: 'WHATSAPP'
  eventKey: string
  businessId: string
  phoneNumberId: string
  eventType: 'MESSAGE' | 'STATUS' | 'UNSUPPORTED'
  payloadRedacted: Record<string, string | boolean | null>
  observedAt: Date
  result: 'ADMITTED'
  traceId?: string
}

export interface ShadowAdmissionRepository {
  findConnectedTenantsByPhoneNumberId(phoneNumberId: string): Promise<ShadowAdmissionTenant[]>
  insertShadowEvents(events: ShadowEventInsert[]): Promise<number>
}

type AdmissionPrismaClient = Pick<
  PrismaClient,
  'businessWhatsAppConfig' | 'botProviderEventShadow'
>

export class PrismaAdmissionRepository implements ShadowAdmissionRepository {
  readonly #client: AdmissionPrismaClient

  constructor(client: AdmissionPrismaClient) {
    this.#client = {
      businessWhatsAppConfig: client.businessWhatsAppConfig,
      botProviderEventShadow: client.botProviderEventShadow
    }
  }

  async findConnectedTenantsByPhoneNumberId(phoneNumberId: string) {
    return this.#client.businessWhatsAppConfig.findMany({
      where: {
        phoneNumberId,
        connectionStatus: 'CONNECTED'
      },
      select: {
        businessId: true,
        appSecret: true,
        appSecretPrevious: true,
        appSecretPreviousValidUntil: true
      },
      take: 2
    })
  }

  async insertShadowEvents(events: ShadowEventInsert[]) {
    if (events.length === 0) return 0

    const result = await this.#client.botProviderEventShadow.createMany({
      data: events.map((event) => ({
        provider: event.provider,
        eventKey: event.eventKey,
        businessId: event.businessId,
        phoneNumberId: event.phoneNumberId,
        eventType: event.eventType,
        payloadRedacted: event.payloadRedacted,
        observedAt: event.observedAt,
        result: event.result,
        ...(event.traceId ? { traceId: event.traceId } : {})
      })),
      skipDuplicates: true
    })

    return result.count
  }
}
