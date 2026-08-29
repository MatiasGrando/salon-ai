import { prisma } from '../config/prisma.js'
import {
  assertActivatableConfiguration,
  resumeDispatchScope,
  startActivationPreflight,
  switchPausedRouting,
  type DispatchPauseHandle
} from '../bot-options/infrastructure/prisma-activation.js'
import { attestLegacyDispatchCoverage } from '../bot-options/infrastructure/prisma-activation.js'
import { BOT_OPTIONS_ENGINE_KEY } from '../bot-options/domain/actions.js'
import { Prisma } from '../generated/prisma/client.js'

export type BusinessBotRoutingTarget = 'legacy-whatsapp' | string

export const businessBotRoutingService = {
  async state(input: { businessId: string }) {
    const [pointer, configurations, audits, whatsapp, settings] = await Promise.all([
      prisma.botChannelDeployment.findUnique({
        where: { businessId_channel: { businessId: input.businessId, channel: 'WHATSAPP' } },
        select: { id: true, engineKey: true, activeConfigurationId: true, generation: true, claimsPausedAt: true }
      }),
      prisma.businessBotConfiguration.findMany({
        where: { businessId: input.businessId, status: 'ACTIVE', routingMode: 'EXCLUSIVE' },
        select: { id: true, name: true, version: true },
        orderBy: [{ name: 'asc' }, { version: 'asc' }]
      }),
      prisma.botDeploymentAudit.findMany({
        where: { businessId: input.businessId },
        select: { id: true, action: true, generation: true, actorUserId: true, detail: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.businessWhatsAppConfig.findUnique({
        where: { businessId: input.businessId },
        select: { connectionStatus: true, phoneNumberId: true, displayPhoneNumber: true, accessToken: true, wabaId: true, appSecret: true }
      }),
      prisma.businessBotOptionsSettings.findUnique({ where: { businessId: input.businessId }, select: { timezone: true } })
    ])
    return {
      businessId: input.businessId,
      deploymentId: pointer?.id ?? null,
      engineKey: pointer?.engineKey ?? 'legacy-whatsapp',
      activeConfigurationId: pointer?.activeConfigurationId ?? null,
      generation: pointer?.generation ?? 0,
      paused: Boolean(pointer?.claimsPausedAt),
      configurations,
      preparation: {
        hasAppSecret: Boolean(whatsapp?.appSecret),
        hasTimezone: Boolean(settings?.timezone),
        timezone: settings?.timezone ?? null,
        whatsappReady: whatsapp?.connectionStatus === 'CONNECTED' && Boolean(whatsapp.phoneNumberId && whatsapp.displayPhoneNumber && whatsapp.accessToken && whatsapp.wabaId),
        ready: whatsapp?.connectionStatus === 'CONNECTED' && Boolean(whatsapp.phoneNumberId && whatsapp.displayPhoneNumber && whatsapp.accessToken && whatsapp.wabaId && whatsapp.appSecret && settings?.timezone)
      },
      audits
    }
  },

  async prepare(input: { businessId: string; timezone: string; actorId: string }) {
    assertIanaTimezone(input.timezone)
    const whatsapp = await prisma.businessWhatsAppConfig.findUnique({
      where: { businessId: input.businessId },
      select: { connectionStatus: true, phoneNumberId: true, displayPhoneNumber: true, accessToken: true, wabaId: true, appSecret: true }
    })
    if (whatsapp?.connectionStatus !== 'CONNECTED' || !whatsapp.phoneNumberId || !whatsapp.displayPhoneNumber || !whatsapp.accessToken || !whatsapp.wabaId) {
      throw new Error('WhatsApp debe estar conectado completamente antes de preparar F11')
    }
    if (!whatsapp.appSecret) throw new Error('Guardá el App Secret de Meta antes de preparar F11')

    return prisma.$transaction(async (tx) => {
      await tx.businessBotOptionsSettings.upsert({
        where: { businessId: input.businessId },
        create: { businessId: input.businessId, timezone: input.timezone },
        update: { timezone: input.timezone }
      })
      return tx.businessBotConfiguration.upsert({
        where: { businessId_botKey: { businessId: input.businessId, botKey: BOT_OPTIONS_ENGINE_KEY } },
        create: {
          businessId: input.businessId,
          botKey: BOT_OPTIONS_ENGINE_KEY,
          name: 'Bot de opciones F11',
          version: 'v1',
          mode: 'OPTIONS_ONLY',
          status: 'ACTIVE',
          channel: 'UNASSIGNED',
          routingMode: 'EXCLUSIVE',
          phoneNumberId: whatsapp.phoneNumberId,
          displayPhoneNumber: whatsapp.displayPhoneNumber,
          definition: { schemaVersion: 1, engineKey: BOT_OPTIONS_ENGINE_KEY, preparedBy: input.actorId } as Prisma.InputJsonValue
        },
        update: {
          name: 'Bot de opciones F11', version: 'v1', mode: 'OPTIONS_ONLY', status: 'ACTIVE', channel: 'UNASSIGNED', routingMode: 'EXCLUSIVE',
          phoneNumberId: whatsapp.phoneNumberId, displayPhoneNumber: whatsapp.displayPhoneNumber
        },
        select: { id: true, name: true, version: true }
      })
    })
  },

  async preflight(input: { businessId: string; expectedGeneration: number; target: BusinessBotRoutingTarget; actorId: string }) {
    if (input.target !== 'legacy-whatsapp') {
      await assertActivatableConfiguration({ client: prisma, businessId: input.businessId, configurationId: input.target })
    }
    await attestLegacyDispatchCoverage({ client: prisma, businessId: input.businessId, actorId: input.actorId, protocolVersion: 1 })
    const result = await startActivationPreflight({
      client: prisma,
      businessId: input.businessId,
      expectedGeneration: input.expectedGeneration,
      actorId: input.actorId,
      legacyCoverageComplete: true
    })
    return { ...result, targetConfigurationId: input.target === 'legacy-whatsapp' ? null : input.target }
  },

  async commit(input: { businessId: string; target: BusinessBotRoutingTarget; handle: DispatchPauseHandle; actorId: string }) {
    if (input.handle.businessId !== input.businessId) throw new Error('routing handle belongs to another business')
    const targetConfigurationId = input.target === 'legacy-whatsapp' ? null : input.target
    if (targetConfigurationId) {
      await assertActivatableConfiguration({ client: prisma, businessId: input.businessId, configurationId: targetConfigurationId })
    }
    return switchPausedRouting({
      client: prisma,
      handle: input.handle,
      actorId: input.actorId,
      action: targetConfigurationId === null ? 'ROLLBACK' : 'ACTIVATE',
      targetConfigurationId
    })
  },

  async abort(input: { businessId: string; handle: DispatchPauseHandle; actorId: string }) {
    if (input.handle.businessId !== input.businessId) throw new Error('routing handle belongs to another business')
    await resumeDispatchScope({ client: prisma, handle: input.handle, actorId: input.actorId })
  }
}

export type BusinessBotRoutingService = typeof businessBotRoutingService

function assertIanaTimezone(timezone: string) {
  const normalized = timezone.trim()
  if (!normalized || normalized.length > 100) throw new Error('Zona horaria inválida')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date())
  } catch {
    throw new Error('Zona horaria inválida')
  }
}
