import { prisma } from '../config/prisma.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

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
}, client: Pick<PrismaClient, 'customerMarketingPreference'> | Pick<Prisma.TransactionClient, 'customerMarketingPreference'> = prisma) {
  const defaults = defaultMarketingPreferenceData()
  return client.customerMarketingPreference.upsert({
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

  if (hasExplicitMarketingOptOutEvidence(normalized)) return true

  const cancelsOperationalRequest = /\b(turno|reserva|servicio)\b/.test(normalized) &&
    /\b(cancelar|cancelo|no quiero|dar de baja)\b/.test(normalized)
  if (cancelsOperationalRequest) return false

  if (!hasMarketingOptOutCandidate(message)) return false
  if (!understanding || understanding.action !== 'opt_out' || understanding.confidence < 0.8) return false
  const evidence = normalizeMarketingText(understanding.evidence)
  return evidence.length >= 8 && normalized.includes(evidence) && hasMarketingOptOutCandidate(evidence)
}

export function hasMarketingOptOutCandidate(message: string) {
  const normalized = normalizeMarketingText(message)
  if (['baja', 'stop'].includes(normalized)) return true
  const asksToStop = /\b(no quiero|no deseo|no me manden|no me envien|dejen de|dejar de|sacame|saquenme|borrenme|eliminenme|cancelar|darme de baja)\b/.test(normalized)
  const marketingContext = /\b(promociones?|promos?|publicidad|campanas?|mensajes?(?: comerciales)?|lista(?: de difusion)?|difusion|newsletter|avisos)\b/.test(normalized)
  return asksToStop && marketingContext
}

export function shouldDeferMarketingOptOutReply(currentStep: string) {
  return ['ASK_CUSTOMER_NAME', 'ASK_SERVICE', 'ASK_PROFESSIONAL', 'ASK_DATE', 'ASK_TIME', 'CONFIRM', 'AWAITING_DEPOSIT'].includes(currentStep)
}

function hasExplicitMarketingOptOutEvidence(normalized: string) {
  const asksToStop = /\b(no quiero|no deseo|no me manden|no me envien|dejen de|dejar de|sacame|saquenme|borrenme|eliminenme|cancelar|darme de baja)\b/.test(normalized)
  const marketingContext = /\b(promociones?|promos?|publicidad|campanas?|mensajes? comerciales?|lista de difusion|difusion|newsletter|avisos)\b/.test(normalized)
  return asksToStop && marketingContext
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
