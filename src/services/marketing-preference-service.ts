import { prisma } from '../config/prisma.js'

export type MarketingOptOutUnderstanding = {
  action: 'opt_out' | 'none'
  confidence: number
  evidence: string
}

export function defaultMarketingPreferenceData(now = new Date()) {
  return {
    status: 'ACTIVE',
    source: 'DEFAULT',
    optedInAt: now
  } as const
}

export async function ensureDefaultMarketingPreference(input: {
  businessId: string
  customerId: string
}) {
  const defaults = defaultMarketingPreferenceData()
  return prisma.customerMarketingPreference.upsert({
    where: {
      businessId_customerId: {
        businessId: input.businessId,
        customerId: input.customerId
      }
    },
    create: {
      businessId: input.businessId,
      customerId: input.customerId,
      ...defaults
    },
    update: {}
  })
}

export function shouldApplyMarketingOptOut(
  message: string,
  understanding: MarketingOptOutUnderstanding | null = null
) {
  const normalized = normalizeMarketingText(message)
  if (!normalized) return false
  if (['baja', 'stop'].includes(normalized)) return true

  const mentionsMarketing = /\b(promociones?|promos?|publicidad|campanas?|mensajes? comerciales?)\b/.test(normalized)
  const asksToStop = /\b(no quiero|no deseo|no me manden|no me envien|dejen de|dejar de|sacame|saquenme|borrenme|eliminenme|cancelar|darme de baja)\b/.test(normalized)
  if (mentionsMarketing && asksToStop) return true

  const cancelsOperationalRequest = /\b(turno|reserva|servicio)\b/.test(normalized) &&
    /\b(cancelar|cancelo|no quiero|dar de baja)\b/.test(normalized)
  if (cancelsOperationalRequest) return false

  if (!understanding || understanding.action !== 'opt_out' || understanding.confidence < 0.8) return false
  const evidence = normalizeMarketingText(understanding.evidence)
  return evidence.length >= 3 && normalized.includes(evidence)
}

function normalizeMarketingText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
