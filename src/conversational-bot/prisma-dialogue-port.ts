import { explanationForDate, parseAvailabilityExplanation } from '../bot-options/application/availability-evidence.js'
import { attachServiceContent, type ServiceContentConfiguration } from '../bot-options/domain/service-content.js'
import { loadPrismaBasketAvailability, loadPrismaVerifiedDateChoices, projectDialogueService } from './prisma-basket-availability.js'
import { loadPublicProfessionalFacts, type PublicProfessionalClient } from './prisma-public-professional-facts.js'
import { queryPublicProfessionalFacts } from './public-professional-facts.js'
import { loadDialogueIdentity, type DialogueIdentityClient } from './prisma-dialogue-identity.js'
import { publicCacheFor, type PublicCacheDiagnostics } from './public-data-cache.js'
import { readPublicSourceStamp, loadReadonlyPublicSnapshot, PublicSourceIntegrityError, type PublicSnapshotClient } from './public-source-stamp.js'
import { loadBusinessFacts, type FactsClient } from './prisma-business-facts.js'
import { PrismaCatalogRepository } from '../bot-options/infrastructure/prisma-catalog.js'
import { PrismaAvailabilityRepository } from '../bot-options/infrastructure/prisma-availability.js'
import { localDateKey } from '../bot-options/application/availability-queries.js'
import type { DialogueContext, DialoguePort, DialogueService } from './engine.js'

type DialogueClient = FactsClient & PublicProfessionalClient & DialogueIdentityClient & ConstructorParameters<typeof PrismaCatalogRepository>[0] & ConstructorParameters<typeof PrismaAvailabilityRepository>[0]
/** All identity, settings and clock values come from the caller's trusted tenant/client. */
export async function createPrismaDialoguePort(client: DialogueClient, businessId: string, serviceContent: ServiceContentConfiguration | null = null): Promise<{ context: DialogueContext; port: DialoguePort; cacheDiagnostics?: PublicCacheDiagnostics }> {
  if (!businessId || businessId.length > 128) throw new Error('invalid tenant')
  const availability = new PrismaAvailabilityRepository(client)
  const { settings, dbNow } = await availability.loadSettingsWithClock(businessId)
  const context = { businessId, timezone: settings.timezone, dbNow }
  const cacheDiagnostics: PublicCacheDiagnostics = { hits: 0, misses: 0, bypasses: 0, stampReads: 0, stampMs: 0, loadMs: 0 }
  const cache = publicCacheFor(client)
  const readStamp = async (source: DialogueClient = client) => {
    const started = performance.now(); cacheDiagnostics.stampReads++
    try { return await readPublicSourceStamp(source, context) }
    finally { cacheDiagnostics.stampMs += performance.now() - started }
  }
  const snapshotClient = client as DialogueClient & Partial<PublicSnapshotClient<DialogueClient>>
  const snapshot = async <T>(load: (source: DialogueClient) => Promise<T>): Promise<T> => {
    if (!snapshotClient.$transaction) return load(client)
    return loadReadonlyPublicSnapshot(snapshotClient as PublicSnapshotClient<DialogueClient>, load)
  }
  const bypass = async <T>(load: (source: DialogueClient) => Promise<T>): Promise<T> => {
    cacheDiagnostics.bypasses++
    const started = performance.now()
    try { return await snapshot(async source => {
      const current = await new PrismaAvailabilityRepository(source).loadSettings(businessId)
      if (current.timezone !== context.timezone) throw new PublicSourceIntegrityError('public source timezone changed')
      const business = await source.business.findFirst({ where: { id: businessId }, select: { id: true } })
      if (business?.id !== businessId) throw new PublicSourceIntegrityError('invalid public source scope')
      return load(source)
    }) }
    finally { cacheDiagnostics.loadMs += performance.now() - started }
  }
  const cached = async <T>(kind: string, load: (source: DialogueClient) => Promise<T>): Promise<T> => {
    if (!snapshotClient.$transaction) return bypass(load)
    try {
      return await cache.read({
        key: JSON.stringify([businessId, settings.timezone, localDateKey(dbNow, settings.timezone), kind]),
        stamp: await readStamp(), readStamp, load: () => load(client), diagnostics: cacheDiagnostics,
        loadSnapshot: () => snapshot(async source => ({ stamp: await readStamp(source), value: await load(source) }))
      })
    } catch (error) {
      if (error instanceof PublicSourceIntegrityError) throw error
      return bypass(load)
    }
  }
  const loadCatalog = async (source: DialogueClient) => {
    const catalog = new PrismaCatalogRepository(source)
    const services = await catalog.loadPublicCatalogSnapshot(businessId)
    return services.map(projectDialogueService)
  }
  let publicBusiness: { businessId: string; businessName: string } | undefined
  return { context, cacheDiagnostics, port: {
    ...('businessFeatureSettings' in client && client.businessFeatureSettings ? {identity: () => loadDialogueIdentity(client,businessId,publicBusiness)} : {}),
    async information(actions) {
      const facts = await cached(!actions || actions.includes('HOURS') ? 'information:hours' : 'information:public', source => loadBusinessFacts(source, context, actions))
      publicBusiness = {businessId:facts.businessId,businessName:facts.name}
      return facts
    },
    professionalInformation: async target => queryPublicProfessionalFacts(await cached('professionals',source => loadPublicProfessionalFacts(source,context)),target),
    verifiedDateChoices: (services,professionalId,estimates,temporal) => snapshot(source => loadPrismaVerifiedDateChoices(source,context,settings,services,professionalId,estimates,temporal,serviceContent)),
    catalog: async () => (await cached('catalog', loadCatalog)).map(service => service.bookingPolicy ? { ...service, bookingPolicy: attachServiceContent(service.bookingPolicy, businessId, serviceContent) } : service),
    availabilityBasket: (services, date, professionalId, estimates, temporal) => snapshot(source => loadPrismaBasketAvailability(source, context, settings, services, date, professionalId, estimates, serviceContent, temporal)),
    async availability(selected: DialogueService, date: string, professionalId?: string, temporal?: import('./prisma-basket-availability.js').VerifiedDateTemporal) {
      return snapshot(async source => {
        if (professionalId) {
          // Preferred singular bookings use the same fresh guard/eligibility proof as complete baskets.
          const guarded = await loadPrismaBasketAvailability(source, context, settings, [selected], date, professionalId, {}, serviceContent, temporal)
          if (guarded.ok) return {professionals:guarded.professionals,slots:guarded.slots,...(guarded.explanation?{explanation:guarded.explanation}:{}),...(guarded.requestedStartEvidence?{requestedStartEvidence:guarded.requestedStartEvidence}:{})}
          if (guarded.reason === 'PREFERRED_PROFESSIONAL_INCOMPATIBLE') return {professionals:guarded.professionals,slots:[],preferredProfessionalIncompatible:true as const,...(guarded.professionalFailure?{professionalFailure:guarded.professionalFailure}:{})}
          throw Error('preferred service requires domain consultation')
        }
        const service = await new PrismaCatalogRepository(source).getService({ businessId, serviceId: selected.id })
        if (!service || service.requiresConsultation || service.bookingPolicy?.attentionMode !== 'DIRECT_BOOKING' || service.bookingPolicy?.requiresPhoto || service.bookingPolicy?.validationEnabled || !service.durationMinutes || service.durationMinutes <= 0) throw new Error('service requires domain consultation')
        const today = localDateKey(dbNow, settings.timezone)
        const last = localDateKey(dbNow, settings.timezone, settings.horizonDays)
        if (date < today || date >= last) return { professionals: [], slots: [], explanation: {
          date, reasons: [date < today ? 'DATE_PAST' as const : 'OUTSIDE_HORIZON' as const], otherProfessionals: [], nextDates: []
        } }
        const availability = new PrismaAvailabilityRepository(source)
        const professionals = await availability.compatibleProfessionals({ businessId, serviceIds: [service.id] })
        if (professionals.length > 50) throw new Error('professional catalog exceeds supported bound')
        const customerDurationMinutes = projectDialogueService(service).customerDurationMinutes ?? service.durationMinutes
        const result = await availability.search({ businessId, serviceIds: [service.id], durationMinutes: service.durationMinutes,
          customerDurationMinutes, dbNow, settings, allocation: 'all', diagnostics: true,
          ...(temporal?.requestedTime || temporal?.preference?.kind === 'around' ? {requestedStart:{date,time:temporal.requestedTime ?? (temporal.preference as {time:string}).time}} : {}) }, professionals)
        const slots = result.slots.filter(slot => slot.date === date && (!professionalId || slot.professionalId === professionalId))
        if (slots.length > 500) throw new Error('availability exceeds supported bound')
        const explanation = result.evidence ? parseAvailabilityExplanation(explanationForDate(result.evidence, date, professionalId, result.slots),
          { date, professionals, dbNow, timezone: settings.timezone, ...(professionalId ? { professionalId } : {}) }) : undefined
        return { professionals, slots, ...(explanation ? { explanation } : {}), ...(result.evidence?.requestedStart ? {requestedStartEvidence:result.evidence.requestedStart} : {}) }
      })
    }
  } }
}
