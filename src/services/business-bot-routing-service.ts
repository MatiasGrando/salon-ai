import { prisma } from '../config/prisma.js'
import {
  assertActivatableConfiguration,
  resumeDispatchScope,
  startActivationPreflight,
  switchPausedRouting,
  type DispatchPauseHandle
} from '../bot-options/infrastructure/prisma-activation.js'
import { attestLegacyDispatchCoverage } from '../bot-options/infrastructure/prisma-activation.js'

export type BusinessBotRoutingTarget = 'legacy-whatsapp' | string

export const businessBotRoutingService = {
  async state(input: { businessId: string }) {
    const [pointer, configurations, audits] = await Promise.all([
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
      })
    ])
    return {
      businessId: input.businessId,
      deploymentId: pointer?.id ?? null,
      engineKey: pointer?.engineKey ?? 'legacy-whatsapp',
      activeConfigurationId: pointer?.activeConfigurationId ?? null,
      generation: pointer?.generation ?? 0,
      paused: Boolean(pointer?.claimsPausedAt),
      configurations,
      audits
    }
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
