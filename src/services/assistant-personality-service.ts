import { prisma } from '../config/prisma.js'
import { normalizeAssistantPersonality } from './assistant-personality-config.js'
export * from './assistant-personality-config.js'

export async function getBusinessAssistantPersonality(businessId: string) {
  const settings = await prisma.businessFeatureSettings.findUnique({
    where: { businessId },
    select: { assistantPersonality: true }
  })
  return normalizeAssistantPersonality(settings?.assistantPersonality)
}
