import { resolveInstagramSessionSubjectTx } from './conversation-subject.js'
import { prepareGroupRescheduleOffers } from './prisma-appointment-management.js'
import { createHash, randomUUID } from 'node:crypto'
import { loadActiveServiceContent, serviceContentFromPublicSnapshot } from './prisma-service-content.js'
import { explanationForDate, parseAvailabilityExplanation } from '../bot-options/application/availability-evidence.js'
import { attachServiceContent, type ServiceContentConfiguration } from '../bot-options/domain/service-content.js'
import { loadPrismaBasketAvailability, loadPrismaVerifiedDateChoices, projectDialogueService } from './prisma-basket-availability.js'
import { loadPublicProfessionalFacts, type PublicProfessionalClient } from './prisma-public-professional-facts.js'
import { queryPublicProfessionalFacts } from './public-professional-facts.js'
import { loadDialogueAssistantProfile, type DialogueIdentityClient } from './prisma-dialogue-identity.js'
import type { DialoguePersonalityPort } from './dialogue-identity.js'
import { publicCacheFor, type PublicCacheDiagnostics } from './public-data-cache.js'
import { projectBusinessTimeContext, projectBusinessHoursContext } from './business-time-context.js'
import { readPublicSourceSnapshot, loadReadonlyPublicSnapshot, PublicSourceIntegrityError, type PublicSnapshotClient, type PublicSourceSnapshot } from './public-source-stamp.js'
import { loadBusinessFacts, type FactsClient } from './prisma-business-facts.js'
import { PrismaCatalogRepository } from '../bot-options/infrastructure/prisma-catalog.js'
import { PrismaAvailabilityRepository } from '../bot-options/infrastructure/prisma-availability.js'
import { localDateKey } from '../bot-options/application/availability-queries.js'
import { parseDialogueState, type DialogueContext, type DialoguePort, type DialogueService, type DialogueState } from './engine.js'
import { Prisma } from '../generated/prisma/client.js'
import { isDeepStrictEqual } from 'node:util'
import { basketServiceIds } from './service-basket.js'
import { hasBookingPriorityOrder } from './booking-priority.js'
import { coordinationKey, type CoordinatedSegment, type DialogueAvailabilitySlot } from './coordinated-booking.js'
import { reservationDurationLimits } from '../services/service-duration.js'
import { parseEstimateOptions, resolveServiceEstimate, serviceConfigurationKey } from '../bot-options/domain/service-booking.js'
import { prepareRuntimeDeposit, runtimeDepositsEnabled, type RuntimeBookingPreparation, parseRuntimePresentedBooking, runtimeServiceConfigurationHash, runtimeBookingFingerprint, type RuntimeBookingSegment, type RuntimeBookingTerms, type RuntimePresentedBooking, type RuntimeShownScope } from './prisma-conversational-booking.js'

export type RuntimeBookingReadPort = { prepareRuntimeBooking(state: DialogueState, scope: RuntimeShownScope): Promise<RuntimeBookingPreparation> }

type DialogueClient = FactsClient & PublicProfessionalClient & DialogueIdentityClient & ConstructorParameters<typeof PrismaCatalogRepository>[0] & ConstructorParameters<typeof PrismaAvailabilityRepository>[0]
/** All identity, settings and clock values come from the caller's trusted tenant/client. */
export async function createPrismaDialoguePort(client: DialogueClient, businessId: string, serviceContent: ServiceContentConfiguration | null = null, contentOptions: { qaPreview?: boolean } = {}): Promise<{ context: DialogueContext; port: DialoguePort & RuntimeBookingReadPort & DialoguePersonalityPort; cacheDiagnostics?: PublicCacheDiagnostics }> {
  if (!businessId || businessId.length > 128) throw new Error('invalid tenant')
  const availability = new PrismaAvailabilityRepository(client)
  const { settings, dbNow } = await availability.loadSettingsWithClock(businessId)
  const context = { businessId, timezone: settings.timezone, dbNow }
  const cacheDiagnostics: PublicCacheDiagnostics = { hits: 0, misses: 0, bypasses: 0, stampReads: 0, stampMs: 0, loadMs: 0 }
  const cache = publicCacheFor(client)
  let commercialSnapshot: PublicSourceSnapshot | undefined
  const readSnapshot = async (source: DialogueClient = client): Promise<PublicSourceSnapshot> => {
    const started = performance.now(); cacheDiagnostics.stampReads++
    try { const loaded = await readPublicSourceSnapshot(source, context); commercialSnapshot = loaded; return loaded }
    catch (error) { commercialSnapshot = undefined; throw error }
    finally { cacheDiagnostics.stampMs += performance.now() - started }
  }
  const readStamp = async (source: DialogueClient = client) => (await readSnapshot(source)).stamp
  const snapshotClient = client as DialogueClient & Partial<PublicSnapshotClient<DialogueClient>>
  const snapshot = async <T>(load: (source: DialogueClient) => Promise<T>): Promise<T> => {
    if (!snapshotClient.$transaction) return load(client)
    return loadReadonlyPublicSnapshot(snapshotClient as PublicSnapshotClient<DialogueClient>, load)
  }
  const bypass = async <T>(load: (source: DialogueClient) => Promise<T>): Promise<T> => {
    commercialSnapshot = undefined
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
  const cached = async <T>(kind: string, load: (source: DialogueClient, publicSnapshot?: PublicSourceSnapshot) => Promise<T>): Promise<T> => {
    if (!snapshotClient.$transaction) return bypass(load)
    try {
      return await cache.read({
        key: JSON.stringify([businessId, settings.timezone, localDateKey(dbNow, settings.timezone), kind]),
        stamp: await readStamp(), readStamp, load: () => load(client), diagnostics: cacheDiagnostics,
        loadSnapshot: () => snapshot(async source => {
          const publicSnapshot = await readSnapshot(source)
          return { stamp: publicSnapshot.stamp, value: await load(source, publicSnapshot) }
        })
      })
    } catch (error) {
      if (error instanceof PublicSourceIntegrityError) throw error
      return bypass(load)
    }
  }
  const hasContentSource = contentOptions.qaPreview === true && 'businessBotConfiguration' in client && Boolean(client.businessBotConfiguration)
  const catalogKind = (contentOptions.qaPreview ? 'catalog:qa-preview' : 'catalog') + (!hasContentSource && serviceContent ? ':' + createHash('sha256').update(JSON.stringify(serviceContent)).digest('hex') : '')
  const currentContent = (source: DialogueClient) => hasContentSource
    ? loadActiveServiceContent(source, businessId, false, contentOptions) : Promise.resolve(serviceContent)
  const loadCatalog = async (source: DialogueClient, publicSnapshot?: PublicSourceSnapshot) => {
    const catalog = new PrismaCatalogRepository(source)
    const services = await catalog.loadPublicCatalogSnapshot(businessId)
    const content = hasContentSource ? publicSnapshot ? serviceContentFromPublicSnapshot(publicSnapshot.serviceContentRows, businessId, contentOptions) : await currentContent(source) : serviceContent
    return services.map(projectDialogueService).map(service => service.bookingPolicy ? { ...service, bookingPolicy: attachServiceContent(service.bookingPolicy, businessId, content) } : service)
  }
  let publicBusiness: { businessId: string; businessName: string } | undefined
  // Each interpretation requests a fresh profile; its introduction reuses that same scoped read.
  let assistantSnapshot: ReturnType<typeof loadDialogueAssistantProfile> | undefined
  const readAssistant = () => loadDialogueAssistantProfile(client, businessId, publicBusiness)
  return { context, cacheDiagnostics, port: {
    /** Uncached server-only presentation proof. The write adapter still revalidates agenda atomically. */
    prepareRuntimeBooking: (previous, scope) => snapshot(async source => {
      try {
        if(scope.businessId!==businessId || !/^[1-9]\d*$/.test(scope.revision)) return null
        const state=parseDialogueState(previous,businessId,context.timezone)
        if(state.pending!=='proposal' || !state.slot || !state.customerName || !state.professional || state.professionalReference ||
          state.professionalNameHint || state.referral || state.serviceRequest || state.editRequest || state.timeMeaningClarification) return null
        const ids=basketServiceIds(state)
        if(!ids.length || ids.length>8 || new Set(ids).size!==ids.length || state.basket?.members.some(m=>m.mode!=='single' || m.serviceIds.length!==1)) return null
        const scopes=await source.$queryRaw<Array<{phone:string|null;timezone:string;channel:string}>>(Prisma.sql`
          /* runtime-booking-presentation-scope */
          SELECT c."phone",s.channel::text,s."businessTimezone" AS timezone FROM "BotSession" s
          LEFT JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
          JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
          JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=d."businessId"
          JOIN "Business" b ON b.id=s."businessId"
          WHERE s.id=${scope.sessionId} AND s."businessId"=${businessId} AND s.revision=${BigInt(scope.revision)-1n}
            AND s.status='ACTIVE' AND s."handoffClaimsPausedAt" IS NULL AND s."handoffFenceEpoch"=${scope.handoffFenceEpoch}
            AND s."deploymentId"=${scope.deploymentId} AND s."deploymentGeneration"=${scope.generation}
            AND d.generation=${scope.generation} AND d."dispatchFenceEpoch"=${scope.dispatchFenceEpoch} AND d."claimsPausedAt" IS NULL
            AND d.channel=s.channel AND d.channel IN ('WHATSAPP','INSTAGRAM') AND d."activeConfigurationId"=${scope.configurationId} AND cfg.status='ACTIVE'
            AND d."legacyDispatchCoverageVersion">=1 AND b."botEnabled"=true
            AND s.state->>'deposit'='NONE' AND s.state->>'handoff'='NONE' AND s.state->>'booking' IN ('NONE','DRAFT')
        `)
        if(scopes.length!==1 || scopes[0]!.timezone!==context.timezone)return null
        const actor=scopes[0]!.channel==='INSTAGRAM'?await resolveInstagramSessionSubjectTx(source,{businessId,sessionId:scope.sessionId}):null
        if(scopes[0]!.channel==='INSTAGRAM'?!actor||!actor.aiEnabled:!scopes[0]!.phone||!/^\+?[\d\s().-]+$/.test(scopes[0]!.phone!))return null
        const rows=await source.$queryRaw<Prisma.ServiceGetPayload<undefined>[]>(Prisma.sql`
          /* runtime-booking-presentation-services */
          SELECT s.* FROM "Service" s JOIN "ServiceCategory" c ON c.id=s."catalogCategoryId" AND c."businessId"=s."businessId" AND c."isActive"=true
          WHERE s."businessId"=${businessId} AND s.id IN (${Prisma.join(ids)}) AND s."isActive"=true AND s."isBookable"=true
        `)
        if(rows.length!==ids.length || new Set(rows.map(s=>s.id)).size!==ids.length || rows.some(s=>s.businessId!==businessId || !ids.includes(s.id))) return null
        const ordered=ids.map(id=>rows.find(s=>s.id===id)!)
        if(!hasBookingPriorityOrder(ids,ordered))return null
        if(ordered.some(s=>s.requiresPhoto || s.validationEnabled || !['DIRECT_BOOKING','GUIDED_ESTIMATE'].includes(s.attentionMode))) return null
        const depositRequired=ordered.some(s=>s.depositMode!=='NONE')
        if(depositRequired && !runtimeDepositsEnabled(actor?{businessId,subject:actor}:undefined))return {unavailable:'DEPOSITS_DISABLED'}
        let slot=structuredClone(state.slot)
        const assigned=slot.coordination?.segments.map(s=>s.professionalId) ?? ids.map(()=>slot.professionalId)
        const professionals=await source.$queryRaw<Array<{serviceId:string;professionalId:string;professionalName:string}>>(Prisma.sql`
          /* runtime-booking-presentation-professionals */
          SELECT ps."serviceId",p.id AS "professionalId",p.name AS "professionalName" FROM "Professional" p
          JOIN "ProfessionalService" ps ON ps."professionalId"=p.id
          WHERE p."businessId"=${businessId} AND p.id IN (${Prisma.join([...new Set(assigned)])}) AND ps."serviceId" IN (${Prisma.join(ids)})
            AND p."isActive"=true AND p."acceptsBotBookings"=true
        `)
        if(assigned.length!==ids.length) return null
        const canonical:CoordinatedSegment[]=[]
        let next=slot.startAt
        for(const [index,s] of ordered.entries()) {
          const p=professionals.filter(p=>p.serviceId===s.id && p.professionalId===assigned[index])
          if(p.length!==1 || (slot.coordination ? slot.coordination.segments[index]!.professionalName : slot.professionalName)!==p[0]!.professionalName) return null
          const durations=reservationDurationLimits(s)
          const segment={serviceId:s.id,serviceName:s.name,professionalId:p[0]!.professionalId,professionalName:p[0]!.professionalName,
            startAt:next,endAt:new Date(Date.parse(next)+Math.max(durations.professional,durations.business)*60000).toISOString(),
            durationMinutes:durations.professional,customerDurationMinutes:durations.business}
          if(slot.coordination && !isDeepStrictEqual(segment,slot.coordination.segments[index])) return null
          canonical.push(segment);next=segment.endAt
        }
        // occupiedMinutes is the professional's daily load, not this booking's duration.
        if(ids.length>1) slot={...slot,occupiedMinutes:(Date.parse(next)-Date.parse(slot.startAt))/60000,coordination:{key:coordinationKey(businessId,canonical),segments:canonical}}
        const segments:RuntimeBookingSegment[]=[]
        for(const [index,s] of ordered.entries()) {
          const estimate=s.attentionMode==='GUIDED_ESTIMATE' ? resolveServiceEstimate({...s,estimateOptions:parseEstimateOptions(s.estimateOptions)},state.serviceEstimates?.[s.id]?.optionId??null) : null
          if(s.attentionMode==='GUIDED_ESTIMATE') {
            const policy=attachServiceContent({...s,attentionMode:'GUIDED_ESTIMATE' as const,estimateOptions:parseEstimateOptions(s.estimateOptions)},businessId,serviceContent)
            if(!s.estimateAllowsBooking || !estimate || state.serviceEstimates?.[s.id]?.configurationKey!==serviceConfigurationKey(policy)) return null
          }
          segments.push({...canonical[index]!,priceMinor:estimate?.priceMin??s.price,priceMode:estimate?'STARTING_AT':s.priceMode,
            configurationHash:runtimeServiceConfigurationHash(s),...(estimate?{estimate}:{})})
        }
        const terms:RuntimeBookingTerms={version:1,businessId,timezone:context.timezone,date:state.date!,customerName:state.customerName,
          preference:state.professional,segments,totalPriceMinor:segments.every(s=>s.priceMode==='FIXED' && s.priceMinor!==null)?segments.reduce((sum,s)=>sum+s.priceMinor!,0):null}
        if(depositRequired){const deposit=await prepareRuntimeDeposit(source,businessId,ordered,segments);if(!deposit)return {unavailable:'PAYMENT_UNAVAILABLE'};terms.deposit=deposit}
        const presented=parseRuntimePresentedBooking({scope,version:1,nonce:randomUUID(),fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true,terms})
        return presented ? {presented,slot} : null
      } catch(error) {
        if(error instanceof PublicSourceIntegrityError) throw error
        return null
      }
    }),

    businessTimeContext: (date,times) => projectBusinessTimeContext(commercialSnapshot,date,times),
    businessHoursContext: date => projectBusinessHoursContext(commercialSnapshot,date),
    ...('businessFeatureSettings' in client && client.businessFeatureSettings ? {
      personality: async () => {
        assistantSnapshot = readAssistant()
        const { profile } = await assistantSnapshot
        return { businessId, profile }
      },
      identity: async () => {
        const current = await (assistantSnapshot ??= readAssistant())
        return { ...current.identity, preset: current.profile.preset }
      }
    } : {}),
    async information(actions) {
      const facts = await cached(!actions || actions.includes('HOURS') ? 'information:hours' : 'information:public', source => loadBusinessFacts(source, context, actions))
      publicBusiness = {businessId:facts.businessId,businessName:facts.name}
      return facts
    },
    professionalInformation: async target => queryPublicProfessionalFacts(await cached('professionals',source => loadPublicProfessionalFacts(source,context)),target),
    verifiedDateChoices: (services,professionalId,estimates,temporal) => snapshot(async source => loadPrismaVerifiedDateChoices(source,context,settings,services,professionalId,estimates,temporal,await currentContent(source))),
    catalog: () => cached(catalogKind, loadCatalog),
    managementRescheduleOffers: (group, date, professionalChange) => snapshot(async source => {
      if (group.scope.businessId !== businessId) throw new Error('foreign management availability scope')
      return prepareGroupRescheduleOffers(group, date, async (member, _date, targetProfessionalId) => {
        const catalog = await loadCatalog(source)
        const selected = member.serviceIds.map(id => catalog.find(service => service.id === id))
        if (selected.some(service => !service)) throw new Error('management service unavailable')
        const result = await loadPrismaBasketAvailability(source, context, settings, selected as DialogueService[], date, targetProfessionalId, {}, await currentContent(source))
        if (!result.ok) return []
        if (result.durationMinutes !== member.durationMinutes || (result.customerDurationMinutes ?? result.durationMinutes) !== (member.customerDurationMinutes ?? member.durationMinutes)) throw new Error('management duration changed; new review required')
        return result.slots.filter(slot => slot.date === date && slot.professionalId === targetProfessionalId).map(slot => ({ date, startAt: slot.startAt, professionalId: slot.professionalId, serviceIds: [...member.serviceIds], durationMinutes: result.durationMinutes, customerDurationMinutes: result.customerDurationMinutes ?? result.durationMinutes }))
      }, professionalChange)
    }),    availabilityBasket: (services, date, professionalId, estimates, temporal) => snapshot(async source => loadPrismaBasketAvailability(source, context, settings, services, date, professionalId, estimates, await currentContent(source), temporal)),
    async availability(selected: DialogueService, date: string, professionalId?: string, temporal?: import('./prisma-basket-availability.js').VerifiedDateTemporal) {
      return snapshot(async source => {
        if (professionalId) {
          // Preferred singular bookings use the same fresh guard/eligibility proof as complete baskets.
          const guarded = await loadPrismaBasketAvailability(source, context, settings, [selected], date, professionalId, {}, await currentContent(source), temporal)
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
