import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { createInitialBotOptionsState, parseBotOptionsState, type BotOptionsState } from '../domain/state.js'
import { renderCurrentView, transition, type TransitionContext } from '../domain/transition.js'
import type { BotOptionsActionPayload, BotOptionsEntityRef } from '../domain/actions.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { menuView, type BotOptionsViewModel } from '../domain/views.js'
import { generatePromptToken } from '../domain/prompt-tokens.js'
import { renderWhatsAppScreen, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS } from '../infrastructure/whatsapp-renderer.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, retargetClaimedBotJobTx, type ClaimedBotJob } from '../infrastructure/postgres-worker.js'
import { acquireDispatchClaim, assertDispatchClaimTx, completeDispatchClaimTx, releaseDispatchClaim } from '../infrastructure/dispatch-claims.js'
import { upsertJob } from '../infrastructure/prisma-admission.js'
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.js'
import { prismaHandoffEffectExecutor } from '../infrastructure/prisma-handoff-effect-executor.js'
import type { BotOptionsActionType } from '../domain/actions.js'
import { botOptionsMetrics } from '../observability/metrics.js'
import { PrismaHoursRepository } from '../infrastructure/prisma-hours.js'
import { PrismaProfessionalHoursRepository } from '../infrastructure/prisma-professional-hours.js'
import { formatBusinessWeeklySchedule, formatProfessionalWeeklySchedule, formatProfessionalListLabel } from './hours-queries.js'
import { catalogEntryRowLabel, catalogServiceDetailView } from './catalog-queries.js'
import { PrismaCustomerLookupRepository } from '../infrastructure/prisma-customer-lookup.js'
import { normalizePhone, phoneSearchVariants } from '../../services/phone-normalization-service.js'
import { validateCustomerName } from '../domain/customer-name-validation.js'
import { PrismaCartRepository } from '../infrastructure/prisma-cart.js'
import { formatCartSummary } from './cart-operations.js'
import { PrismaAvailabilityRepository } from '../infrastructure/prisma-availability.js'
import { BOOKING_DATE_PAGE_SIZE, BOOKING_SLOT_PAGE_SIZE, formatDateChoice, formatSlotOffset, paginate } from './availability-queries.js'

type RuntimeClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

export type TransitionContextProvider = (
  tx: Prisma.TransactionClient,
  input: {
    businessId: string
    sessionId: string
    state: BotOptionsState
    actionType: string
    entityRef: BotOptionsEntityRef | null
    payload: BotOptionsActionPayload | null
    dbNow: Date
    businessTimezone: string
  }
) => Promise<TransitionContext>

export type TransitionEffectExecutor = (
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; operationKey: string; effects: readonly BotOptionsEffect[] }
) => Promise<void>

export const unavailableEffectExecutor: TransitionEffectExecutor = async (_tx, input) => {
  if (input.effects.length > 0) {
    throw new Error(`effect executor unavailable: ${input.effects.map((effect) => effect.kind).join(',')}`)
  }
}

/**
 * Provider de contexto real que revalida entidades contra DB tenant-scoped.
 * Para acciones que involucran un SERVICE entityRef, busca el servicio vía
 * PrismaCatalogRepository.getService (isBookable + category active) y deriva
 * serviceActive / serviceBookable / requiresConsultation / labels desde la fila.
 *
 * Para menu.business_hours, carga BusinessHours + ScheduleBlock (excepciones
 * nivel negocio, professionalId=null) y formatea el texto semanal informativo.
 *
 * serviceCompatibleWithCart se asume true para el primer servicio (F6.3
 * intersección multiprofesional se implementa después).
 */
const defaultContextProvider: TransitionContextProvider = async (tx, input) => {
  const base: TransitionContext = {
    dbNowIso: input.dbNow.toISOString(), customerNameOnFile: null,
    draftExists: false, draftHasProgress: false, categoryActive: false, categoryHasServices: false,
    subcategoryActive: false, subcategoryHasServices: false,
    serviceActive: false, serviceBookable: false, requiresConsultation: false,
    serviceCompatibleWithCart: input.state.cart.length === 0, serviceInCart: false,
    hasRecommendations: false, recommendedServiceAvailable: false, recommendedCompatibleWithCart: false, recommendedServiceId: null,
      professionalCommonExists: false, professionalSelectable: false,
      professionalActive: false, professionalBookable: false,
      dateAvailable: false, slotAvailable: false,
    bandHasAvailability: false, catalogCanNext: false, catalogCanPrevious: false, catalogPageMoveAllowed: false,
    professionalCatalogCanNext: false, professionalCatalogCanPrevious: false, dateCanNext: false,
    dateCanPrevious: false, slotCanNext: false, noAvailabilityInHorizon: false, selectedProfessionalNoAvailability: false, appointmentsExist: false, appointmentsCanNext: false,
    appointmentOwnedAndFuture: false, cancellationAllowed: false, rescheduleAllowed: false,
    rescheduleDateAvailable: false, rescheduleSlotAvailable: false, approvedDepositTransferable: false,
    slotStillAvailableAtConfirm: false, depositRequired: false, paymentConfigComplete: false,
    labels: {}, confirmVisitSnapshot: null, depositRequest: null
  }
  const contextServiceId = input.entityRef?.type === 'SERVICE'
    ? input.entityRef.id
    : input.actionType === 'name.confirm' && input.state.pendingEntityRef?.type === 'SERVICE'
      ? input.state.pendingEntityRef.id
      : null
  if (contextServiceId) {
    const repo = new PrismaCatalogRepository(tx)
    const service = await repo.getService({ businessId: input.businessId, serviceId: contextServiceId })
    if (service) {
      base.serviceActive = true
      base.serviceBookable = service.isBookable
      base.requiresConsultation = service.requiresConsultation
      base.serviceInCart = input.state.cart.some((item) => item.serviceId === service.id)
      base.labels.serviceName = service.name
      base.labels.catalogServiceDetail = catalogServiceDetailView(service, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
    }
  }

  // F5.3/F5.4 — El catálogo se carga para la VISTA RESULTANTE y cada selección
  // se revalida tenant-scoped. SUBCATEGORY es navegación explícita: nunca se
  // presenta ni se acepta como SERVICE reservable.
  const catalogRepo = new PrismaCatalogRepository(tx)
  const currentCatalogPage = input.state.presentation.kind === 'catalog_page'
    ? input.state.presentation.cursor
    : 0
  const currentParentServiceId = input.state.presentation.kind === 'catalog_page'
    ? input.state.presentation.parentServiceId ?? null
    : null
  const targetPage = input.actionType === 'catalog.next_page'
    ? currentCatalogPage + 1
    : input.actionType === 'catalog.previous_page'
      ? Math.max(0, currentCatalogPage - 1)
      : currentCatalogPage

  const applyCategoryPage = async (page: number) => {
    const categoryPage = await catalogRepo.listCategories({ businessId: input.businessId, page })
    base.labels.catalogCategories = categoryPage.items.map((category) => ({
      categoryId: category.id,
      label: category.name
    }))
    base.catalogCanNext = categoryPage.hasNext
    base.catalogCanPrevious = categoryPage.hasPrevious
    base.catalogPageMoveAllowed = categoryPage.items.length > 0
  }

  const applyServicePage = async (categoryId: string, parentServiceId: string | null, page: number) => {
    const [category, servicePage, subcategory] = await Promise.all([
      catalogRepo.getCategory({ businessId: input.businessId, categoryId }),
      catalogRepo.listServices({ businessId: input.businessId, categoryId, parentServiceId, page }),
      parentServiceId
        ? catalogRepo.getSubcategory({ businessId: input.businessId, categoryId, subcategoryId: parentServiceId })
        : Promise.resolve(null)
    ])
    base.categoryActive = category !== null
    base.categoryHasServices = servicePage !== null && servicePage.items.length > 0
    base.subcategoryActive = parentServiceId === null || subcategory !== null
    base.subcategoryHasServices = parentServiceId !== null && servicePage !== null && servicePage.items.length > 0
    if (category) base.labels.categoryName = category.name
    if (subcategory) base.labels.subcategoryName = subcategory.name
    if (servicePage) {
      base.labels.catalogEntries = servicePage.items.map((entry) => ({
        kind: entry.kind,
        entityId: entry.id,
        label: catalogEntryRowLabel(entry)
      }))
      base.catalogCanNext = servicePage.hasNext
      base.catalogCanPrevious = servicePage.hasPrevious
      base.catalogPageMoveAllowed = servicePage.items.length > 0
    }
  }

  if (input.actionType === 'category.select' && input.entityRef?.type === 'CATEGORY') {
    await applyServicePage(input.entityRef.id, null, 0)
  } else if (input.actionType === 'subcategory.select' && input.entityRef?.type === 'SUBCATEGORY' && input.state.selections.categoryId) {
    await applyServicePage(input.state.selections.categoryId, input.entityRef.id, 0)
  } else if (input.actionType === 'service.view') {
    // El detalle ya se cargó arriba mediante getService; no se confía en el label del prompt.
  } else if (input.actionType === 'catalog.next_page' || input.actionType === 'catalog.previous_page') {
    if (input.state.flow === 'CATEGORY_SELECT') {
      await applyCategoryPage(targetPage)
    } else if (input.state.flow === 'SERVICE_SELECT' && input.state.selections.categoryId) {
      await applyServicePage(input.state.selections.categoryId, currentParentServiceId, targetPage)
    }
  } else if (input.actionType === 'navigation.back' && input.state.flow === 'SERVICE_SELECT') {
    if (currentParentServiceId && input.state.selections.categoryId) {
      await applyServicePage(input.state.selections.categoryId, null, 0)
    } else {
      await applyCategoryPage(0)
    }
  } else if (
    input.state.flow === 'SERVICE_DETAIL' &&
    (input.actionType === 'navigation.back' || input.actionType === 'service.more_same_category') &&
    input.state.selections.categoryId
  ) {
    await applyServicePage(input.state.selections.categoryId, currentParentServiceId, currentCatalogPage)
  } else if (
    input.actionType === 'menu.browse_services' || input.actionType === 'menu.start_booking' ||
    input.actionType === 'name.confirm' || input.actionType === 'service.change_category' ||
    input.actionType === 'cart.add_service'
  ) {
    await applyCategoryPage(0)
  } else if (input.state.flow === 'CATEGORY_SELECT') {
    await applyCategoryPage(currentCatalogPage)
  } else if (input.state.flow === 'SERVICE_SELECT' && input.state.selections.categoryId) {
    await applyServicePage(input.state.selections.categoryId, currentParentServiceId, currentCatalogPage)
  }

  // F5.6: Vista runtime real de horarios del negocio
  // Carga BusinessHours + ScheduleBlock con businessId, session.businessTimezone y dbNow.
  // NO consulta Appointment, slots ni disponibilidad.
  if (input.actionType === 'menu.business_hours') {
    const hoursRepo = new PrismaHoursRepository(tx)
    const [weeklyHours, exceptions] = await Promise.all([
      hoursRepo.loadBusinessWeeklyHours({ businessId: input.businessId }),
      hoursRepo.loadBusinessOperationalExceptions({
        businessId: input.businessId,
        dbNow: input.dbNow,
        timezone: input.businessTimezone
      })
    ])
    base.labels.businessWeeklyHoursText = formatBusinessWeeklySchedule(
      weeklyHours, exceptions, input.dbNow, input.businessTimezone
    )
  }

  // F5.7: Profesional hours — carga datos reales del profesional para listado y detalle.
  if (input.actionType === 'hours.professional' || input.actionType === 'hours.choose_other_professional' ||
      input.actionType === 'hours.next_page' || input.actionType === 'hours.previous_page') {
    const profRepo = new PrismaProfessionalHoursRepository(tx)
    const professionals = await profRepo.listActiveProfessionals({ businessId: input.businessId })
    const PAGE_SIZE = 7
    const catalog = professionals.map((p) => ({
      professionalId: p.professionalId,
      label: formatProfessionalListLabel(p)
    }))
    base.labels.professionalCatalog = catalog
    base.professionalSelectable = catalog.length > 0
    // Compute pagination flags from current presentation cursor
    const cursor = input.state.presentation.kind === 'professional_list_page' ? input.state.presentation.cursor : 0
    const totalProfessionals = catalog.length
    base.professionalCatalogCanNext = (cursor + 1) * PAGE_SIZE < totalProfessionals
    base.professionalCatalogCanPrevious = cursor > 0
  }

  // F5.7: Professional hours detail actions — revalidate professional from state.
  // actions hours.professional_select, hours.professional_search_availability,
  // hours.professional_consult_human from PROFESSIONAL_HOURS_DETAIL all need professional context.
  const needsProfessionalDetail =
    input.actionType === 'hours.professional_select' ||
    input.actionType === 'hours.professional_search_availability' ||
    input.actionType === 'hours.professional_consult_human'

  if (needsProfessionalDetail) {
    const profRepo = new PrismaProfessionalHoursRepository(tx)
    // Prefer entityRef from action; fall back to state.pendingEntityRef for detail actions
    const profIdFromRef = input.entityRef?.type === 'PROFESSIONAL' ? input.entityRef.id : null
    const profIdFromState = input.state.pendingEntityRef?.type === 'PROFESSIONAL' ? input.state.pendingEntityRef.id : null
    const profId = profIdFromRef ?? profIdFromState
    if (profId) {
      const professional = await profRepo.getProfessional({ businessId: input.businessId, professionalId: profId })
      if (professional) {
        base.professionalActive = true
        base.professionalBookable = professional.acceptsBotBookings
        base.labels.professionalName = professional.name
        const [weeklyHours, exceptions] = await Promise.all([
          profRepo.loadProfessionalWeeklyHours({ professionalId: profId, businessId: input.businessId }),
          profRepo.loadProfessionalExceptions({
            professionalId: profId,
            businessId: input.businessId,
            dbNow: input.dbNow,
            timezone: input.businessTimezone
          })
        ])
        base.labels.professionalWeeklyHoursText = formatProfessionalWeeklySchedule(
          professional.name, weeklyHours, exceptions, input.dbNow, input.businessTimezone
        )
      }
    }
  }

  // F6.1 — La identidad se consulta únicamente al cruzar una compuerta que puede
  // preguntar nombre. Un error se propaga: la transacción hace rollback y el
  // worker aplica RETRY/POISON; jamás se degrada silenciosamente a "desconocido".
  const needsCustomerIdentity =
    input.actionType === 'menu.start_booking' ||
    input.actionType === 'service.book' ||
    input.actionType === 'hours.search_availability' ||
    input.actionType === 'hours.professional_search_availability' || input.state.cart.length > 0
  if (needsCustomerIdentity) {
    const conversationRow = await tx.$queryRaw<Array<{ phone: string | null }>>(Prisma.sql`
      SELECT c."phone"
      FROM "BotSession" s
      JOIN "Conversation" c
        ON c."id" = s."conversationId"
       AND c."businessId" = s."businessId"
      WHERE s."id" = ${input.sessionId}
        AND s."businessId" = ${input.businessId}
      LIMIT 1
    `)
    const phone = conversationRow[0]?.phone
    if (!phone) throw new Error('customer identity conversation unavailable in tenant')
    const canonicalPhone = normalizePhone(phone)
    if (!canonicalPhone) throw new Error('customer identity phone cannot be normalized')
    const variants = [...new Set([phone.trim(), canonicalPhone, `+${canonicalPhone}`, ...phoneSearchVariants(phone)])]
    const lookupRepo = new PrismaCustomerLookupRepository(tx)
    const found = await lookupRepo.findByPhone({ businessId: input.businessId, phoneVariants: variants, canonicalPhone })
    if (found) {
      const storedName = validateCustomerName(found.name)
      if (storedName.ok) base.customerNameOnFile = storedName.normalized
    }
  }

  // F6.3/F6.4 — El carrito persistido sólo conserva IDs. Cada interacción que
  // puede mostrarlo o mutarlo reconstruye sus derivados desde filas tenant-safe.
  const cartRepo = new PrismaCartRepository(tx)
  let cartIds = input.state.cart.map((item) => item.serviceId)
  let recommendationIsOffered = false
  if (input.actionType === 'recommendation.add' && contextServiceId && !input.state.rejectedRecommendationIds.includes(contextServiceId) && cartIds.length > 0) {
    const offered = await tx.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM "ServiceAddon" WHERE "addonServiceId" = ${contextServiceId} AND "sourceServiceId" IN (${Prisma.join(cartIds)})) AS "present"
    `)
    recommendationIsOffered = offered[0]?.present === true
    base.recommendedServiceAvailable = recommendationIsOffered && base.serviceActive && base.serviceBookable && !base.requiresConsultation
  }
  const proposedServiceId = contextServiceId && base.serviceActive && base.serviceBookable && !base.requiresConsultation && (
    input.actionType === 'service.select' || input.actionType === 'service.book' || input.actionType === 'name.confirm' ||
    (input.actionType === 'recommendation.add' && recommendationIsOffered)
  ) ? contextServiceId : null
  const removedServiceId = input.entityRef?.type === 'SERVICE' && input.actionType === 'cart.remove_service' ? input.entityRef.id : null
  const targetCartIds = proposedServiceId
    ? [...new Set([...cartIds, proposedServiceId])]
    : removedServiceId ? cartIds.filter((id) => id !== removedServiceId) : cartIds
  let targetCart = null as Awaited<ReturnType<PrismaCartRepository['load']>> | null
  if (targetCartIds.length > 0) {
    targetCart = await cartRepo.load({ businessId: input.businessId, serviceIds: targetCartIds })
    const restrictive = [...targetCart.policies.values()].some((policy) => policy !== 'ALLOWED')
    base.serviceCompatibleWithCart = targetCart.snapshot.commonProfessionalIds.length > 0 && !restrictive
    base.recommendedCompatibleWithCart = base.serviceCompatibleWithCart
    base.professionalCommonExists = targetCart.snapshot.commonProfessionalIds.length > 0
    base.labels.cartSummary = formatCartSummary(targetCart.snapshot)
  }
  if (cartIds.length > 0 && !targetCart) {
    targetCart = await cartRepo.load({ businessId: input.businessId, serviceIds: cartIds })
  }

  // Una recomendación es una propuesta explícita, nunca una mutación automática.
  const recommendationSourceIds = input.actionType === 'recommendation.skip' ? cartIds : proposedServiceId ? [proposedServiceId] : []
  if (targetCart && recommendationSourceIds.length > 0 && (input.actionType === 'service.select' || input.actionType === 'service.book' || input.actionType === 'name.confirm' || input.actionType === 'recommendation.skip')) {
    const rejectedFilter = input.state.rejectedRecommendationIds.length > 0
      ? Prisma.sql`AND s."id" NOT IN (${Prisma.join(input.state.rejectedRecommendationIds)})`
      : Prisma.empty
    const addons = await tx.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
      SELECT s."id", s."name" FROM "ServiceAddon" a JOIN "Service" s ON s."id" = a."addonServiceId"
      JOIN "ServiceCategory" c ON c."id" = s."catalogCategoryId" AND c."businessId" = s."businessId" AND c."isActive" = true
      WHERE a."sourceServiceId" IN (${Prisma.join(recommendationSourceIds)}) AND s."businessId" = ${input.businessId}
        AND s."isBookable" = true ${rejectedFilter}
        AND s."id" NOT IN (${Prisma.join(targetCartIds)}) ORDER BY a."sortOrder", s."id" LIMIT 1
    `)
    const recommendations = [] as Array<{ serviceId: string; label: string; compatible: boolean }>
    for (const addon of addons) {
      const proposed = await cartRepo.load({ businessId: input.businessId, serviceIds: [...targetCartIds, addon.id] })
      recommendations.push({
        serviceId: addon.id, label: addon.name,
        compatible: proposed.snapshot.commonProfessionalIds.length > 0 && ![...proposed.policies.values()].some((policy) => policy !== 'ALLOWED')
      })
    }
    base.labels.recommendations = recommendations
    base.hasRecommendations = recommendations.length > 0
    base.recommendedServiceId = recommendations[0]?.serviceId ?? null
    base.recommendedServiceAvailable = recommendations.length > 0
  }

  const bookingCartIds = targetCartIds.length > 0 ? targetCartIds : cartIds
  const needsAvailability = bookingCartIds.length > 0 && (
    input.actionType === 'cart.continue' || input.actionType === 'professional.any' || input.actionType === 'professional.select' ||
    input.actionType === 'date.next_page' || input.actionType === 'date.previous_page' || input.actionType === 'date.select' ||
    input.actionType === 'slot.band' || input.actionType === 'slot.show_all' || input.actionType === 'slot.next_page' ||
    input.actionType === 'slot.select' || input.state.flow === 'DATE_SELECT' || input.state.flow === 'SLOT_SELECT' || input.state.flow === 'BOOKING_SUMMARY'
  )
  if (needsAvailability) {
    const cart = targetCart ?? await cartRepo.load({ businessId: input.businessId, serviceIds: bookingCartIds })
    if (cart.snapshot.commonProfessionalIds.length === 0) {
      if (input.actionType === 'cart.continue') return base
      throw new Error('persisted booking step has no common professional')
    }
    const availabilityRepo = new PrismaAvailabilityRepository(tx)
    const settings = await availabilityRepo.loadSettings(input.businessId)
    if (settings.timezone !== input.businessTimezone) throw new Error('session timezone does not match tenant availability settings')
    const professionals = await availabilityRepo.compatibleProfessionals({ businessId: input.businessId, serviceIds: bookingCartIds })
    base.professionalCommonExists = professionals.length > 0
    base.labels.bookingProfessionals = professionals.map((item) => ({ professionalId: item.id, label: item.name }))
    if (input.actionType === 'professional.select' && input.entityRef?.type === 'PROFESSIONAL') {
      base.professionalSelectable = professionals.some((item) => item.id === input.entityRef!.id)
    }
    const requestedProfessionalId = input.actionType === 'professional.select' && input.entityRef?.type === 'PROFESSIONAL'
      ? input.entityRef.id
      : input.actionType === 'professional.any' ? null : input.state.selections.professionalId
    if (input.actionType !== 'cart.continue') {
      const search = await availabilityRepo.search({
        businessId: input.businessId, serviceIds: bookingCartIds, durationMinutes: cart.snapshot.totalDurationMinutes,
        dbNow: input.dbNow, settings, professionalId: requestedProfessionalId
      })
      base.selectedProfessionalNoAvailability = requestedProfessionalId !== null && search.slots.length === 0
      if (base.selectedProfessionalNoAvailability) {
        const allSearch = await availabilityRepo.search({
          businessId: input.businessId, serviceIds: bookingCartIds, durationMinutes: cart.snapshot.totalDurationMinutes,
          dbNow: input.dbNow, settings, professionalId: null
        })
        base.noAvailabilityInHorizon = allSearch.slots.length === 0
      } else {
        base.noAvailabilityInHorizon = search.slots.length === 0
      }
      const dates = [...new Set(search.slots.map((slot) => slot.date))]
      const currentDateCursor = input.state.presentation.kind === 'date_page' ? input.state.presentation.cursor : 0
      const dateCursor = input.actionType === 'date.next_page' ? currentDateCursor + 1 : input.actionType === 'date.previous_page' ? Math.max(0, currentDateCursor - 1) : currentDateCursor
      const datePage = paginate(dates, dateCursor, BOOKING_DATE_PAGE_SIZE)
      base.labels.availableDates = datePage.items.map((date) => ({ date, label: formatDateChoice(date, settings.timezone) }))
      base.dateCanNext = datePage.hasNext
      base.dateCanPrevious = datePage.hasPrevious
      const effectiveDate = input.actionType === 'date.select' ? input.payload?.date ?? null : input.state.selections.date
      base.dateAvailable = Boolean(effectiveDate && dates.includes(effectiveDate))
      const slotsForDate = effectiveDate ? search.slots.filter((slot) => slot.date === effectiveDate) : search.slots
      const repeatedWallTimes = new Set(slotsForDate.filter((slot, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.time === slot.time)).map((slot) => slot.time))
      base.labels.availableSlots = slotsForDate.map((slot) => ({
        startAt: slot.startAt, label: `${slot.time}${repeatedWallTimes.has(slot.time) ? ` (${formatSlotOffset(slot.startAt, settings.timezone)})` : ''} · ${slot.professionalName}`, band: slot.band,
        professionalId: slot.professionalId
      }))
      base.bandHasAvailability = slotsForDate.length > 0
      const slotCursor = input.state.presentation.kind === 'slot_all_pages' ? input.state.presentation.cursor : 0
      base.slotCanNext = paginate(slotsForDate, input.actionType === 'slot.next_page' ? slotCursor + 1 : slotCursor, BOOKING_SLOT_PAGE_SIZE).hasNext
      const requestedStartAt = input.actionType === 'slot.select' ? input.payload?.startAt : input.state.selections.slotStartAt
      const selectedSlot = requestedStartAt ? search.slots.find((slot) => slot.startAt === requestedStartAt && (!effectiveDate || slot.date === effectiveDate)) : null
      base.slotAvailable = selectedSlot !== null
      if (selectedSlot) {
        const assigned = search.professionals.find((professional) => professional.id === selectedSlot.professionalId)
        if (!assigned) throw new Error('provisional assignment missing from compatible professionals')
        base.confirmVisitSnapshot = {
          services: cart.snapshot.services.map((service) => ({
            serviceId: service.id, name: service.name, durationMinutes: service.durationMinutes,
            priceMinor: service.priceMinor, priceMode: service.priceMode
          })),
          professional: { professionalId: assigned.id, name: assigned.name, assignedByBalancer: requestedProfessionalId === null },
          totalDurationMinutes: cart.snapshot.totalDurationMinutes,
          totalPriceMinor: cart.snapshot.totalPriceMinor
        }
        base.labels.bookingSummary = `${base.customerNameOnFile ?? 'Cliente'}\n${formatCartSummary(cart.snapshot)}\nProfesional: ${assigned.name}\nFecha: ${selectedSlot.date}\nHorario: ${selectedSlot.time}`
      }
    }
  }

  return base
}

function parseSelectedEntityRef(value: Prisma.JsonValue | null): BotOptionsEntityRef | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid selected action entityRef')
  const type = value['type']
  const id = value['id']
  if (
    (type !== 'CATEGORY' && type !== 'SUBCATEGORY' && type !== 'SERVICE' && type !== 'PROFESSIONAL' && type !== 'APPOINTMENT') ||
    typeof id !== 'string' || id.length === 0 || id.trim() !== id
  ) {
    throw new Error('invalid selected action entityRef')
  }
  return { type, id }
}

function parseSelectedPayload(value: Prisma.JsonValue | null): BotOptionsActionPayload | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid selected action payload')
  return value as BotOptionsActionPayload
}

export async function processSessionJob(input: {
  client: RuntimeClient
  job: ClaimedBotJob
  contextProvider?: TransitionContextProvider
  effectExecutor?: TransitionEffectExecutor
}): Promise<'PROCESSED' | 'STALE_CUTOVER' | 'STALE_REVISION'> {
  const startedAt = performance.now()
  try {
    const result = await processSessionJobInternal(input)
    botOptionsMetrics.observe('transition_execution', performance.now() - startedAt)
    return result
  } catch (error) {
    botOptionsMetrics.observe('transition_execution', performance.now() - startedAt, 'error')
    throw error
  }
}

async function processSessionJobInternal(input: {
  client: RuntimeClient
  job: ClaimedBotJob
  contextProvider?: TransitionContextProvider
  effectExecutor?: TransitionEffectExecutor
}): Promise<'PROCESSED' | 'STALE_CUTOVER' | 'STALE_REVISION'> {
  if (input.job.kind === 'PROCESS_INBOX') return processInitialInbox(input)
  if (input.job.kind === 'RECOVER_CUTOVER') return processCutoverRecovery(input)
  if (input.job.kind !== 'PROCESS_SESSION') throw new Error(`unsupported session job ${input.job.kind}`)

  const target = await input.client.$queryRaw<Array<{
    sessionId: string; businessId: string; generation: number; fenceEpoch: number
  }>>(Prisma.sql`
    SELECT s."id" AS "sessionId", s."businessId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch"
    FROM "BotSession" s JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId"
    WHERE s."id" = COALESCE(
      (SELECT "sessionId" FROM "BotActionInbox" WHERE "id" = ${input.job.aggregateId}),
      (SELECT "sessionId" FROM "BotPrompt" WHERE "id" = ${input.job.aggregateId})
    )
  `)
  if (target.length !== 1) throw new Error('session job target not found')
  const dispatchToken = await acquireDispatchClaim({
    client: input.client,
    businessId: target[0]!.businessId,
    sessionId: target[0]!.sessionId,
    resourceId: input.job.id,
    generation: target[0]!.generation,
    fenceEpoch: target[0]!.fenceEpoch,
    kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('process dispatch gate closed')
  try {
    return await input.client.$transaction(async (tx) => {
      await assertClaimedBotJobTx(tx, input.job)
      await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
      const sessions = await tx.$queryRaw<Array<{
        id: string; businessId: string; deploymentId: string; deploymentGeneration: number
        revision: bigint; state: Prisma.JsonValue; status: string; dbNow: Date; toPhone: string | null
        businessTimezone: string
      }>>(Prisma.sql`
        SELECT s."id", s."businessId", s."deploymentId", s."deploymentGeneration", s."revision", s."state",
          s."status"::text AS "status", clock_timestamp() AS "dbNow", c."phone" AS "toPhone",
          s."businessTimezone"
        FROM "BotSession" s
        JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId"
        LEFT JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
        WHERE s."id" = ${target[0]!.sessionId} AND d."businessId" = s."businessId"
          AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
          AND d."claimsPausedAt" IS NULL AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
        FOR UPDATE OF s
      `)
      if (sessions.length !== 1 || sessions[0]!.deploymentGeneration !== input.job.deploymentGeneration) {
        await completeDispatchClaimTx(tx, dispatchToken)
        await completeClaimedBotJobTx(tx, input.job)
        return 'STALE_CUTOVER'
      }
      const session = sessions[0]!
      if (input.job.expectedRevision !== null && session.revision !== input.job.expectedRevision) {
        await completeDispatchClaimTx(tx, dispatchToken)
        await completeClaimedBotJobTx(tx, input.job)
        return 'STALE_REVISION'
      }
      const parsedState = parseBotOptionsState(session.state)
      if (!parsedState.ok) throw new Error(`unknown/corrupt state: ${parsedState.invariant}`)

      const selected = await tx.$queryRaw<Array<{
        id: string; actionType: string; entityRef: Prisma.JsonValue | null; payload: Prisma.JsonValue | null
        promptId: string | null; providerEventId: string; status: string
      }>>(Prisma.sql`
        SELECT "id", "actionType", "entityRef", "payload", "promptId", "providerEventId", "status"::text AS "status"
        FROM "BotActionInbox" WHERE "id" = ${input.job.aggregateId} FOR UPDATE
      `)
      let actionType: string
      let view: BotOptionsViewModel
      let nextState = parsedState.state
      let outcome = 'CONFLICT'
      let effects: readonly BotOptionsEffect[] = []
      let promptId: string | null = null
      let providerEventId: string | null = null
      if (selected.length === 1) {
        const action = selected[0]!
        if (action.status !== 'SELECTED' || !action.actionType) throw new Error('session action is not selected')
        // La admisión/reconciliación es la frontera canónica del actionType. No se
        // amplía ese contrato en F5.5; sí se valida la forma de datos JSON antes
        // de entregarlos al provider y a la transición.
        const selectedActionType = action.actionType as BotOptionsActionType
        const selectedEntityRef = parseSelectedEntityRef(action.entityRef)
        const selectedPayload = parseSelectedPayload(action.payload)
        actionType = selectedActionType
        promptId = action.promptId
        providerEventId = action.providerEventId
        const context = await (input.contextProvider ?? defaultContextProvider)(tx, {
          businessId: session.businessId, sessionId: session.id, state: parsedState.state, actionType: selectedActionType,
          entityRef: selectedEntityRef,
          payload: selectedPayload,
          dbNow: session.dbNow,
          businessTimezone: session.businessTimezone
        })
        const result = transition(parsedState.state, {
          actionType: selectedActionType,
          entityRef: selectedEntityRef,
          payload: selectedPayload
        }, context)
        nextState = result.state
        view = result.view
        outcome = result.outcome
        effects = 'effects' in result ? result.effects : []
      } else {
        actionType = 'prompt.conflict'
        promptId = input.job.aggregateId
        const choices = await tx.$queryRaw<Array<{ actionType: string; labelSnapshot: string; entityType: string | null; entityId: string | null; payload: Prisma.JsonValue | null }>>(Prisma.sql`
          SELECT DISTINCT ON (c."choiceToken") c."actionType", c."labelSnapshot", c."entityType", c."entityId",
            COALESCE(c."payload", '{}'::jsonb) || jsonb_build_object('conflictChoiceToken', c."choiceToken") AS "payload"
          FROM "BotActionInbox" i JOIN "BotPromptChoice" c ON c."promptId" = i."promptId" AND c."choiceToken" = i."choiceToken"
          WHERE i."promptId" = ${input.job.aggregateId} AND i."status" = 'CONFLICT'::"BotInboxStatus"
          ORDER BY c."choiceToken", c."sortOrder"
        `)
        view = menuView('Recibimos opciones distintas. Elegí cuál querés confirmar.', choices.map((choice) => ({
          actionType: choice.actionType as never,
          label: choice.labelSnapshot,
          ...(choice.entityType && choice.entityId ? { entityRef: { type: choice.entityType as never, id: choice.entityId } } : {}),
          payload: choice.payload as never
        })))
      }

      const operationKey = `transition:${session.id}:${session.revision + 1n}`
      await (input.effectExecutor ?? prismaHandoffEffectExecutor)(tx, {
        businessId: session.businessId, sessionId: session.id, operationKey, effects
      })
      const nextRevision = session.revision + 1n
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotSession" SET "state" = ${JSON.stringify(nextState)}::jsonb, "revision" = ${nextRevision}, "updatedAt" = clock_timestamp()
        WHERE "id" = ${session.id} AND "revision" = ${session.revision}
      `)
      const handoffEffect = effects.find((effect) => effect.kind === 'REQUEST_HUMAN_HANDOFF')
      const transitionDetail = handoffEffect ? JSON.stringify({ handoff: handoffEffect }) : null
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration",
          "revisionFrom", "revisionTo", "actionType", "outcome", "promptId", "providerEventId", "detail")
        VALUES (${randomUUID()}, ${session.businessId}, ${session.id}, ${session.deploymentId}, ${session.deploymentGeneration},
          ${session.revision}, ${nextRevision}, ${actionType}, ${outcome}, ${promptId}, ${providerEventId}, ${transitionDetail}::jsonb)
      `)
      await persistView(tx, {
        businessId: session.businessId, sessionId: session.id, revision: nextRevision,
        transitionId: operationKey, toPhone: session.toPhone, view, dbNow: session.dbNow
      })
      if (selected[0]) {
        await tx.$executeRaw`UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "operationKey" = ${operationKey} WHERE "id" = ${selected[0].id} AND "status" = 'SELECTED'::"BotInboxStatus"`
      }
      await completeDispatchClaimTx(tx, dispatchToken)
      await completeClaimedBotJobTx(tx, input.job)
      return 'PROCESSED'
    })
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function processInitialInbox(input: { client: RuntimeClient; job: ClaimedBotJob }): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  const target = await input.client.$queryRaw<Array<{ businessId: string; generation: number; fenceEpoch: number }>>(Prisma.sql`
    SELECT e."businessId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch"
    FROM "BotActionInbox" i
    JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
    JOIN "BotChannelDeployment" d ON d."id" = i."deploymentId" AND d."businessId" = e."businessId"
    WHERE i."id" = ${input.job.aggregateId}
  `)
  if (target.length !== 1) throw new Error('initial inbox target not found')
  if (target[0]!.generation !== input.job.deploymentGeneration) {
    await scheduleCurrentRecovery(input.client, input.job)
    return 'STALE_CUTOVER'
  }
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: target[0]!.businessId, sessionId: null, resourceId: input.job.id,
    generation: target[0]!.generation, fenceEpoch: target[0]!.fenceEpoch, kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('initial dispatch gate closed')
  try {
    const result = await processInitialInboxUnderClaim(input, false, dispatchToken)
    if (result === 'STALE_CUTOVER') await scheduleCurrentRecovery(input.client, input.job)
    return result
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function processInitialInboxUnderClaim(
  input: { client: RuntimeClient; job: ClaimedBotJob },
  forceFreshView = false,
  dispatchToken: string
): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  return input.client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, input.job)
    await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
    const rows = await tx.$queryRaw<Array<{ id: string; businessId: string; deploymentId: string; deploymentGeneration: number; payload: Prisma.JsonValue; status: string; dbNow: Date; businessTimezone: string }>>(Prisma.sql`
      SELECT i."id", e."businessId", i."deploymentId", i."deploymentGeneration", i."payload", i."status"::text AS "status",
        clock_timestamp() AS "dbNow", settings."timezone" AS "businessTimezone"
      FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
      JOIN "BotChannelDeployment" d ON d."id" = i."deploymentId" AND d."businessId" = e."businessId"
      JOIN "BusinessBotOptionsSettings" settings ON settings."businessId" = e."businessId"
      WHERE i."id" = ${input.job.aggregateId} AND d."generation" = i."deploymentGeneration"
        AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
       FOR UPDATE OF i FOR SHARE OF d
    `)
    if (rows.length !== 1 || rows[0]!.deploymentGeneration !== input.job.deploymentGeneration) {
      await completeDispatchClaimTx(tx, dispatchToken)
      return 'STALE_CUTOVER'
    }
    const row = rows[0]!
    if (row.status !== 'ADMITTED') {
      await completeDispatchClaimTx(tx, dispatchToken)
      await completeClaimedBotJobTx(tx, input.job)
      return 'PROCESSED'
    }
    const payload = row.payload as { fromPhone?: unknown }
    if (typeof payload.fromPhone !== 'string' || !payload.fromPhone) throw new Error('initial inbound has no phone')
    const conversationId = randomUUID()
    const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
      VALUES (${conversationId}, ${payload.fromPhone}, ${row.businessId}, clock_timestamp())
      ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt"
      RETURNING "id"
    `)
    const sessionId = randomUUID()
    const state = createInitialBotOptionsState()
    const insertedSessions = await tx.$queryRaw<Array<{ id: string; revision: bigint; deploymentGeneration: number }>>(Prisma.sql`
      INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
        "businessTimezone", "state", "revision", "updatedAt")
      VALUES (${sessionId}, ${row.businessId}, ${conversations[0]!.id}, ${row.deploymentId}, ${row.deploymentGeneration},
        ${row.businessTimezone}, ${JSON.stringify(state)}::jsonb, 1, clock_timestamp())
      ON CONFLICT ("deploymentId", "conversationId")
        WHERE "status" = 'ACTIVE'::"BotSessionStatus" AND "conversationId" IS NOT NULL
      DO NOTHING
      RETURNING "id", "revision", "deploymentGeneration"
    `)
    const inserted = insertedSessions.length === 1
    const existingSessions = inserted ? [] : await tx.$queryRaw<Array<{ id: string; revision: bigint; deploymentGeneration: number }>>(Prisma.sql`
      SELECT "id", "revision", "deploymentGeneration" FROM "BotSession"
      WHERE "deploymentId" = ${row.deploymentId} AND "conversationId" = ${conversations[0]!.id}
        AND "status" = 'ACTIVE'::"BotSessionStatus" FOR UPDATE
    `)
    const session = insertedSessions[0] ?? existingSessions[0]
    if (!session) throw new Error('active session disappeared after conflict')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotActionInbox" SET "sessionId" = ${session.id}, "expectedRevision" = ${session.revision}, "status" = 'PROCESSED'::"BotInboxStatus" WHERE "id" = ${row.id}`)
    const refreshForGeneration = session.deploymentGeneration !== row.deploymentGeneration
    if (inserted || forceFreshView || refreshForGeneration) {
      const revisionFrom = inserted ? 0n : session.revision
      const revisionTo = inserted ? 1n : session.revision + 1n
      if (!inserted) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "BotSession" SET "state" = ${JSON.stringify(state)}::jsonb, "revision" = ${revisionTo},
            "deploymentGeneration" = ${row.deploymentGeneration}, "businessTimezone" = ${row.businessTimezone}, "updatedAt" = clock_timestamp()
          WHERE "id" = ${session.id} AND "revision" = ${revisionFrom}
        `)
      }
      const transitionId = `${forceFreshView ? 'cutover-recovery' : 'initial'}:${session.id}:${revisionTo}`
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome")
        VALUES (${randomUUID()}, ${row.businessId}, ${session.id}, ${row.deploymentId}, ${row.deploymentGeneration}, ${revisionFrom}, ${revisionTo},
          ${forceFreshView ? 'system.cutover_recovery' : 'system.initial_view'}, 'APPLIED')
        ON CONFLICT ("sessionId", "revisionTo") DO NOTHING
      `)
      await persistView(tx, {
        businessId: row.businessId!, sessionId: session.id, revision: revisionTo, transitionId,
        toPhone: payload.fromPhone, view: renderCurrentView(state, await defaultContextProvider(tx, {
          businessId: row.businessId!, sessionId: session.id, state, actionType: 'system.initial_view',
          entityRef: null, payload: null, dbNow: row.dbNow,
          businessTimezone: row.businessTimezone
        })), dbNow: row.dbNow
      })
    }
    await completeDispatchClaimTx(tx, dispatchToken)
    await completeClaimedBotJobTx(tx, input.job)
    return 'PROCESSED'
  })
}

async function processCutoverRecovery(input: { client: RuntimeClient; job: ClaimedBotJob }): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  const rows = await input.client.$queryRaw<Array<{
    businessId: string; deploymentId: string; generation: number; fenceEpoch: number; payload: Prisma.JsonValue; providerMessageId: string | null
  }>>(Prisma.sql`
    SELECT e."businessId", d."id" AS "deploymentId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch",
      e."payload", e."providerMessageId"
    FROM "BotProviderEvent" e
    JOIN "BotChannelDeployment" d ON d."businessId" = e."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
    WHERE e."id" = ${input.job.aggregateId}
      AND d."engineKey" = 'deterministic-options' AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
  `)
  if (rows.length !== 1) throw new Error('current deployment unavailable for cutover recovery')
  const row = rows[0]!
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: row.businessId, sessionId: null, resourceId: input.job.id,
    generation: row.generation, fenceEpoch: row.fenceEpoch, kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('cutover recovery dispatch gate closed')
  try {
    const recoveryInboxId = `cutover-recovery:${input.job.aggregateId}`
    const retargetedJob = await input.client.$transaction(async (tx) => {
      const retargeted = await retargetClaimedBotJobTx(tx, input.job, { deploymentId: row.deploymentId, generation: row.generation })
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "providerMessageId", "actionType", "deploymentId", "deploymentGeneration", "payload", "status")
        VALUES (${recoveryInboxId}, ${row.businessId}, ${input.job.aggregateId}, ${row.providerMessageId}, 'system.cutover_recovery', ${row.deploymentId},
          ${row.generation}, ${JSON.stringify(row.payload)}::jsonb, 'ADMITTED'::"BotInboxStatus")
        ON CONFLICT ("id") DO NOTHING
      `)
      return retargeted
    })
    const synthetic = { ...retargetedJob, kind: 'PROCESS_INBOX', aggregateId: recoveryInboxId }
    const result = await processInitialInboxUnderClaim({ client: input.client, job: synthetic }, true, dispatchToken)
    if (result === 'STALE_CUTOVER') throw new Error('deployment changed during cutover recovery')
    return result
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function scheduleCurrentRecovery(client: RuntimeClient, job: ClaimedBotJob): Promise<void> {
  await client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
    const rows = await tx.$queryRaw<Array<{
      providerEventId: string; businessId: string; deploymentId: string; generation: number; dbNow: Date
    }>>(Prisma.sql`
      SELECT i."providerEventId", e."businessId", d."id" AS "deploymentId", d."generation", clock_timestamp() AS "dbNow"
      FROM "BotActionInbox" i
      JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
      JOIN "BotChannelDeployment" d ON d."businessId" = e."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
      WHERE i."id" = ${job.aggregateId} AND d."engineKey" = 'deterministic-options'
        AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
      FOR UPDATE OF i FOR SHARE OF d
    `)
    if (rows.length !== 1) throw new Error('cannot schedule cutover recovery without current deployment')
    const row = rows[0]!
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotActionInbox" SET "status" = 'STALE_CUTOVER'::"BotInboxStatus", "error" = 'STALE_CUTOVER'
      WHERE "id" = ${job.aggregateId} AND "status" IN ('ADMITTED'::"BotInboxStatus", 'CLAIMED'::"BotInboxStatus")
    `)
    await upsertJob(tx, 'RECOVER_CUTOVER', row.providerEventId, row.businessId, row.deploymentId, row.generation, null, row.dbNow)
    await completeClaimedBotJobTx(tx, job)
  })
}

async function persistView(
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; revision: bigint; transitionId: string; toPhone: string | null; view: BotOptionsViewModel; dbNow: Date }
) {
  if (!input.toPhone) throw new Error('cannot render outbox without destination phone')
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotPrompt" SET "status" = 'INVALIDATED'::"BotPromptStatus", "resolvedAt" = clock_timestamp()
    WHERE "sessionId" = ${input.sessionId} AND "status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
  `)
  const promptToken = generatePromptToken()
  const rendered = renderWhatsAppScreen(input.view, { promptToken })
  const promptId = rendered.choiceMappings.length > 0 ? randomUUID() : null
  if (promptId) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "mode", "status", "openedAt")
      VALUES (${promptId}, ${input.sessionId}, ${promptToken}, ${input.revision}, 'FUNCTIONAL'::"BotPromptMode", 'OPEN'::"BotPromptStatus", ${input.dbNow})
    `)
    for (const choice of rendered.choiceMappings) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "entityType", "entityId", "payload", "labelSnapshot", "sortOrder")
        VALUES (${randomUUID()}, ${promptId}, ${choice.choiceToken}, ${choice.actionType}, ${choice.entityType}, ${choice.entityId},
          ${choice.payload === null ? null : JSON.stringify(choice.payload)}::jsonb, ${choice.labelSnapshot}, ${choice.sortOrder})
      `)
    }
  }
  const deliveryGroupId = randomUUID()
  let sequence = 0
  for (const item of rendered.items) {
    if (item.type === 'none') continue
    const id = randomUUID()
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
        "idempotencyKey", "status", "dependsOnSequence", "availableAt", "updatedAt")
      VALUES (${id}, ${input.businessId}, ${input.sessionId}, ${input.transitionId}, ${deliveryGroupId}, ${sequence}, ${item.type},
        ${JSON.stringify({ to: input.toPhone, item })}::jsonb, ${`${input.transitionId}:${sequence}`}, 'PENDING'::"BotOutboxStatus",
        ${sequence > 0 && rendered.interactiveDependsOnPrevious ? sequence - 1 : null}, ${input.dbNow}, clock_timestamp())
    `)
    if (item.type === 'interactive' && promptId) {
      await tx.$executeRaw`UPDATE "BotPrompt" SET "outboxMessageId" = ${id} WHERE "id" = ${promptId}`
    }
    sequence += 1
  }
}
