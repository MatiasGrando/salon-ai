import { publicCacheFor, type PublicCacheDiagnostics } from './public-data-cache.js'
import { readPublicSourceStamp, loadReadonlyPublicSnapshot, PublicSourceIntegrityError, type PublicSnapshotClient } from './public-source-stamp.js'
import { loadBusinessFacts, type FactsClient } from './prisma-business-facts.js'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaCatalogRepository } from '../bot-options/infrastructure/prisma-catalog.js'
import { PrismaAvailabilityRepository } from '../bot-options/infrastructure/prisma-availability.js'
import { localDateKey, type AvailabilitySettings } from '../bot-options/application/availability-queries.js'
import type { CatalogPage, CatalogServiceItem } from '../bot-options/application/catalog-queries.js'
import type { DialogueContext, DialoguePort, DialogueService } from './engine.js'

type DialogueClient = FactsClient & ConstructorParameters<typeof PrismaCatalogRepository>[0] & ConstructorParameters<typeof PrismaAvailabilityRepository>[0]
/** All identity, settings and clock values come from the caller's trusted tenant/client. */
export async function createPrismaDialoguePort(client: DialogueClient, businessId: string): Promise<{ context: DialogueContext; port: DialoguePort; cacheDiagnostics?: PublicCacheDiagnostics }> {
  if (!businessId || businessId.length > 128) throw new Error('invalid tenant')
  const catalog = new PrismaCatalogRepository(client)
  const availability = new PrismaAvailabilityRepository(client)
  const settings: AvailabilitySettings = await availability.loadSettings(businessId)
  const clock = await client.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`)
  const dbNow = clock[0]?.now
  if (!(dbNow instanceof Date) || !Number.isFinite(dbNow.getTime())) throw new Error('database clock unavailable')
  const context = { businessId, timezone: settings.timezone, dbNow }
  const collect = async <T>(load: (page: number) => Promise<CatalogPage<T> | null>): Promise<T[]> => {
    const result: T[] = []
    for (let page = 0; page < 30; page++) {
      const response = await load(page)
      if (!response || response.page !== page) throw new Error('catalog unavailable')
      result.push(...response.items)
      if (result.length > 200) throw new Error('catalog exceeds supported bound')
      if (!response.hasNext) return result
    }
    throw new Error('catalog pagination exceeds supported bound')
  }
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
    const categories = await collect(page => catalog.listCategories({ businessId, page }))
    const services: CatalogServiceItem[] = []
    for (const category of categories) {
      const roots = await collect(page => catalog.listServices({ businessId, categoryId: category.id, page }))
      for (const item of roots) {
        if (item.kind === 'SUBCATEGORY') services.push(...await collect(page => catalog.listServices({ businessId, categoryId: category.id, parentServiceId: item.id, page })))
        else services.push(item)
        if (services.length > 200) throw new Error('catalog exceeds supported bound')
      }
    }
    return services.map(item => ({ id: item.id, name: item.name, durationMinutes: item.durationMinutes, price: item.price, priceMode: item.priceMode,
      requiresConsultation: item.requiresConsultation || item.bookingPolicy?.attentionMode !== 'DIRECT_BOOKING' || Boolean(item.bookingPolicy?.requiresPhoto || item.bookingPolicy?.validationEnabled)
    }))
  }
  return { context, cacheDiagnostics, port: {
    information: actions => cached(!actions || actions.includes('HOURS') ? 'information:hours' : 'information:public', source => loadBusinessFacts(source, context, actions)),
    catalog: () => cached('catalog', loadCatalog),
    async availability(selected: DialogueService, date: string, professionalId?: string) {
      const service = await catalog.getService({ businessId, serviceId: selected.id })
      if (!service || service.requiresConsultation || service.bookingPolicy?.attentionMode !== 'DIRECT_BOOKING' || service.bookingPolicy?.requiresPhoto || service.bookingPolicy?.validationEnabled || !service.durationMinutes || service.durationMinutes <= 0) throw new Error('service requires domain consultation')
      const today = localDateKey(dbNow, settings.timezone)
      const last = localDateKey(dbNow, settings.timezone, settings.horizonDays)
      if (date < today || date >= last) return { professionals: [], slots: [] }
      // Search each compatible professional: unfiltered search balances away alternatives at the same time.
      const professionals = await availability.compatibleProfessionals({ businessId, serviceIds: [service.id] })
      if (professionals.length > 50) throw new Error('professional catalog exceeds supported bound')
      const selectedProfessionals = professionalId ? professionals.filter(p => p.id === professionalId) : professionals
      const slots = []
      for (const professional of selectedProfessionals) {
        const result = await availability.search({ businessId, serviceIds: [service.id], durationMinutes: service.durationMinutes, dbNow, settings, professionalId: professional.id })
        slots.push(...result.slots.filter(slot => slot.date === date && slot.professionalId === professional.id))
        if (slots.length > 500) throw new Error('availability exceeds supported bound')
      }
      return { professionals, slots: slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.professionalId.localeCompare(b.professionalId)) }
    }
  } }
}
