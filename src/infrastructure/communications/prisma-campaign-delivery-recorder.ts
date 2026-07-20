import { prisma } from '../../config/prisma.js'
import type { CampaignDeliveryRecorder } from '../../application/campaigns/manual-campaign-communication-service.js'
import { isWithinCommunicationCooldown } from '../../domain/communications/communication.js'

export class PrismaCampaignDeliveryRecorder implements CampaignDeliveryRecorder {
  async recordManualSent(input: { businessId: string; campaignId: string; customerId: string; sentAt: Date }) {
    const [campaign, preference, lastDelivery] = await Promise.all([
      prisma.campaign.findFirst({
        where: { id: input.campaignId, businessId: input.businessId },
        select: { respectCooldown: true, cooldownDays: true }
      }),
      prisma.customerMarketingPreference.findUnique({
        where: { businessId_customerId: { businessId: input.businessId, customerId: input.customerId } },
        select: { status: true }
      }),
      prisma.campaignDelivery.findFirst({
        where: { businessId: input.businessId, customerId: input.customerId, status: { notIn: ['FAILED', 'CANCELLED'] } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true }
      })
    ])
    if (!campaign) throw new Error('No encontré esa campaña')
    if (preference?.status !== 'ACTIVE') throw new Error('El cliente no tiene autorización comercial activa')
    if (campaign.respectCooldown && isWithinCommunicationCooldown(lastDelivery?.sentAt ?? null, input.sentAt, campaign.cooldownDays)) {
      throw new Error('El cliente recibió una promoción dentro del período de descanso')
    }
    const previousAttempts = await prisma.campaignDelivery.count({
      where: {
        campaignId: input.campaignId,
        customerId: input.customerId,
        status: { notIn: ['FAILED', 'CANCELLED'] }
      }
    })
    return prisma.campaignDelivery.create({
      data: {
        businessId: input.businessId,
        campaignId: input.campaignId,
        customerId: input.customerId,
        status: 'SENT',
        attemptNumber: previousAttempts + 1,
        sentAt: input.sentAt
      },
      select: { id: true }
    })
  }
}
