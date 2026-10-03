import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { PrismaHoursRepository } from '../bot-options/infrastructure/prisma-hours.js'
import { formatBusinessWeeklySchedule, formatExceptionLabel } from '../bot-options/application/hours-queries.js'
import type { DialogueContext } from './engine.js'
import { validateFacts, type BusinessFacts } from './information.js'
import type { InformationAction } from './actions.js'
export type FactsClient = Pick<PrismaClient, 'business' | 'businessHours' | 'scheduleBlock'> & Partial<Pick<PrismaClient, '$queryRaw'>>
const publicSelect = { id: true, name: true, publicAddress: true, publicAddressArea: true, publicMapsUrl: true, publicWhatsapp: true, contactEmail: true, workshopPublicSiteUrl: true, instagramUrl: true, facebookUrl: true, tiktokUrl: true, landingDescription: true } as const
/** Only allowlisted customer-facing values leave the tenant-scoped query. */
export async function loadBusinessFacts(client: FactsClient, context: DialogueContext, actions?: readonly InformationAction[]): Promise<BusinessFacts> {
  const row = await client.business.findFirst({ where: { id: context.businessId }, select: publicSelect })
  if (!row || row.id !== context.businessId) throw new Error('invalid facts scope')
  let hoursText: string | null = null
  if (!actions || actions.includes('HOURS')) {
    const repo = new PrismaHoursRepository(client)
    const weekly = await repo.loadBusinessWeeklyHours({ businessId: context.businessId })
    const exceptions = await repo.loadBusinessOperationalExceptions({ businessId: context.businessId, dbNow: context.dbNow, timezone: context.timezone })
    if (weekly.length > 100 || exceptions.length > 100) throw new Error('public schedule exceeds supported bound')
    // The canonical weekly renderer intentionally omits exceptions; add only public labels.
    hoursText = weekly.length ? formatBusinessWeeklySchedule(weekly, exceptions, context.dbNow, context.timezone) : 'No tengo horarios publicados.'
    if (exceptions.length) hoursText += '\nExcepciones: ' + exceptions.map(e => formatExceptionLabel(e, context.timezone)).join('\n')
  }
  let paymentMethods: string | null = null
  if ((!actions || actions.includes('BUSINESS_INFO')) && client.$queryRaw) {
    const methods = await client.$queryRaw<Array<{ id: string; businessId: string; name: string }>>(Prisma.sql`
      /* conversational-public-payment-methods */
      SELECT "id", "businessId", "name" FROM "BusinessPaymentMethod"
      WHERE "businessId" = ${context.businessId} AND "isActive" = true
      ORDER BY "position" ASC, "name" ASC, "id" ASC LIMIT 101
    `)
    if (methods.length > 100 || methods.some(method => method.businessId !== context.businessId)) throw new Error('invalid public payment scope')
    if (methods.some(method => !method.name.trim() || method.name.length > 200 || /[\u0000-\u001f]/.test(method.name))) throw new Error('invalid public payment method')
    paymentMethods = methods.length ? methods.map(method => method.name).join(', ') : null
  }
  const facts: BusinessFacts = {
    businessId: row.id, name: row.name, address: row.publicAddress, area: row.publicAddressArea,
    mapsUrl: row.publicMapsUrl, website: row.workshopPublicSiteUrl, bookingUrl: null,
    whatsapp: row.publicWhatsapp, email: row.contactEmail ?? null, instagram: row.instagramUrl,
    facebook: row.facebookUrl, tiktok: row.tiktokUrl, description: row.landingDescription, hours: hoursText, paymentMethods
  }
  validateFacts(facts, context.businessId)
  return facts
}
