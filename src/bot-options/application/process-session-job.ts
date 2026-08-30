import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { createInitialBotOptionsState, parseBotOptionsState, type BotOptionsState } from '../domain/state.js'
import { renderCurrentView, transition, type TransitionContext } from '../domain/transition.js'
import type { BotOptionsActionPayload, BotOptionsEntityRef } from '../domain/actions.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { menuView, textView, type BotOptionsViewModel } from '../domain/views.js'
import { generatePromptToken } from '../domain/prompt-tokens.js'
import { renderWhatsAppScreen, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS } from '../infrastructure/whatsapp-renderer.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, retargetClaimedBotJobTx, type ClaimedBotJob } from '../infrastructure/postgres-worker.js'
import { acquireDispatchClaim, assertDispatchClaimTx, completeDispatchClaimTx, withDispatchClaimCleanup } from '../infrastructure/dispatch-claims.js'
import {
  collectInboundConversationMessage,
  flushInboundConversationMessages,
  type InboundConversationMessageProjection
} from '../../services/crm-realtime-events.js'
import { upsertJob } from '../infrastructure/prisma-admission.js'
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.js'
import {
  prismaBotOptionsEffectExecutor,
  type BotOptionsEffectExecutionResult
} from '../infrastructure/prisma-bot-options-effect-executor.js'
import type { BotOptionsActionType } from '../domain/actions.js'
import { botOptionsMetrics, type BotOptionsStage } from '../observability/metrics.js'
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
import {
  classifyAppointmentManagementPolicy,
  isWithinAppointmentManagementLeadWindow,
  listManageableAppointments,
  type AppointmentManagementCursor
} from './appointment-management.js'

type RuntimeClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

// Per-session processing only. 10s allows a bounded recovery budget while staying
// well below the 30s job/dispatch leases; global Prisma defaults remain unchanged.
export const PROCESS_SESSION_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const
export const PROCESS_INBOX_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const

export async function runProcessSessionTransaction<T>(
  client: RuntimeClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return client.$transaction(operation, PROCESS_SESSION_TRANSACTION_OPTIONS)
}

export async function runProcessInboxTransaction<T>(
  client: RuntimeClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return client.$transaction(operation, PROCESS_INBOX_TRANSACTION_OPTIONS)
}

export async function settleProcessedSessionTx(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: {
    inboxId: string | null
    operationKey: string
    dispatchToken: string
    job: ClaimedBotJob
  }
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ inboxCount: bigint; dispatchCount: bigint; jobCount: bigint }>>(Prisma.sql`
    WITH inbox AS (
      ${input.inboxId ? Prisma.sql`
        UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "operationKey" = ${input.operationKey}
        WHERE "id" = ${input.inboxId} AND "status" = 'SELECTED'::"BotInboxStatus"
        RETURNING "id"
      ` : Prisma.sql`SELECT NULL::text AS "id" WHERE FALSE`}
    ), dispatch AS (
      UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      WHERE "claimToken" = ${input.dispatchToken} AND "status" = 'CLAIMED'::"BotDispatchStatus"
      RETURNING "id"
    ), job AS (
      UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${input.job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${input.job.claimToken}
      RETURNING "id"
    )
    SELECT (SELECT count(*) FROM inbox)::bigint AS "inboxCount",
      (SELECT count(*) FROM dispatch)::bigint AS "dispatchCount",
      (SELECT count(*) FROM job)::bigint AS "jobCount"
  `)
  const expectedInboxCount = input.inboxId ? 1n : 0n
  if (
    rows[0]?.inboxCount !== expectedInboxCount
    || rows[0]?.dispatchCount !== 1n
    || rows[0]?.jobCount !== 1n
  ) throw new Error('cannot atomically settle processed session')
}

/**
 * Exact WhatsApp text commands that deliberately discard the in-progress
 * conversational draft and start again from the main menu.
 */
export function isConversationRestartCommand(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const command = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/g, ' ')
  return command === 'reiniciar'
    || command === '/reiniciar'
    || command === 'reiniciar conversacion'
    || command === '/reiniciar conversacion'
}

/** Runs post-commit work only after the interactive transaction resolved. */
export async function runCommittedProcessSession<T>(input: {
  client: RuntimeClient
  operation: (tx: Prisma.TransactionClient) => Promise<T>
  onCommitted?: () => void
  postCommit: (result: T) => void | Promise<void>
}): Promise<T> {
  const result = await runProcessSessionTransaction(input.client, input.operation)
  input.onCommitted?.()
  await input.postCommit(result)
  return result
}

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
    /** Phone read alongside the locked session; undefined preserves legacy lookup. */
    conversationPhone?: string | null
  }
) => Promise<TransitionContext>

export type TransitionEffectExecutor = (
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; operationKey: string; effects: readonly BotOptionsEffect[] }
) => Promise<void | BotOptionsEffectExecutionResult>

export const unavailableEffectExecutor: TransitionEffectExecutor = async (_tx, input) => {
  if (input.effects.length > 0) {
    throw new Error(`effect executor unavailable: ${input.effects.map((effect) => effect.kind).join(',')}`)
  }
}

async function measureSessionStage<T>(stage: Extract<BotOptionsStage, 'session_context_load' | 'session_effects' | 'session_persist_view'>, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await operation()
    botOptionsMetrics.observe(stage, performance.now() - startedAt)
    return result
  } catch (error) {
    botOptionsMetrics.observe(stage, performance.now() - startedAt, 'error')
    throw error
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
    appointmentListPage: null,
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
    // PROCESS_SESSION already read this tenant-scoped phone while locking its
    // session. Reuse that fresh statement result instead of rejoining Session.
    const conversationRow = input.conversationPhone === undefined
      ? await tx.$queryRaw<Array<{ phone: string | null }>>(Prisma.sql`
          SELECT c."phone" FROM "BotSession" s
          JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
          WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId} LIMIT 1
        `)
      : [{ phone: input.conversationPhone }]
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
    input.actionType === 'professional.next_page' || input.actionType === 'professional.previous_page' ||
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
      if (input.actionType === 'booking.confirm') {
        base.slotStillAvailableAtConfirm = selectedSlot !== null
        const depositServices = await tx.service.count({
          where: { id: { in: bookingCartIds }, businessId: input.businessId, depositMode: { not: 'NONE' } }
        })
        base.depositRequired = depositServices > 0
      }
    }
  }

  // F9.7 — La lista y los pasos de gestión se reconstruyen desde F9.1 con el
  // teléfono canónico de la conversación actual. La sesión puede ser nueva: la
  // pertenencia se prueba por negocio + teléfono, nunca por la sesión creadora.
  const needsAppointmentContext = input.actionType === 'menu.manage_appointment' ||
    input.state.flow.startsWith('APPOINTMENT') || input.actionType === 'appointment.slot_conflict' || input.actionType === 'appointment.stale'
  if (needsAppointmentContext) {
    const identity = input.conversationPhone === undefined
      ? await tx.$queryRaw<Array<{ phone: string | null }>>(Prisma.sql`
          SELECT c."phone" FROM "BotSession" s
          JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
          WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
        `)
      : [{ phone: input.conversationPhone }]
    const canonicalPhone = identity[0]?.phone ? normalizePhone(identity[0].phone) : ''
    if (!canonicalPhone) throw new Error('appointment management identity is unavailable in tenant')
    const presentation = input.state.presentation.kind === 'appointment_list_page' ? input.state.presentation : null
    const requestedAfter = input.actionType === 'appointment.next_page'
      ? presentation?.next ?? null
      : presentation?.after ?? null
    if (input.actionType !== 'appointment.next_page' || requestedAfter) {
      const cursor: AppointmentManagementCursor | undefined = requestedAfter
        ? { startAt: new Date(requestedAfter.startAt), appointmentId: requestedAfter.appointmentId }
        : undefined
      const page = await listManageableAppointments(tx, {
        businessId: input.businessId, normalizedPhone: canonicalPhone, cursor, pageSize: 7
      })
      const after = requestedAfter ? { ...requestedAfter } : null
      const next = page.nextCursor ? { startAt: page.nextCursor.startAt.toISOString(), appointmentId: page.nextCursor.appointmentId } : null
      base.appointmentListPage = { after, next }
      base.appointmentsExist = page.items.length > 0
      base.appointmentsCanNext = next !== null
      base.labels.manageableAppointments = page.items.map((item) => ({
        appointmentId: item.appointmentId,
        label: formatManagedAppointment(item.startAt, item.category, page.timezone)
      }))

      const selectedAppointmentId = input.entityRef?.type === 'APPOINTMENT'
        ? input.entityRef.id
        : input.state.selections.appointmentId
      const selected = selectedAppointmentId ? page.items.find((item) => item.appointmentId === selectedAppointmentId) : null
      if (selected) {
        const policy = classifyAppointmentManagementPolicy(selected.financialState)
        base.appointmentOwnedAndFuture = true
        base.cancellationAllowed = policy.cancel === 'AUTOMATIC' &&
          isWithinAppointmentManagementLeadWindow(selected.startAt, page.dbNow, page.cancellationLeadMinutes)
        base.rescheduleAllowed = policy.reschedule !== 'HANDOFF' &&
          isWithinAppointmentManagementLeadWindow(selected.startAt, page.dbNow, page.rescheduleLeadMinutes)
        base.approvedDepositTransferable = policy.reschedule === 'REQUIRES_DEPOSIT_MATCH'
        base.labels.appointmentSummary = formatManagedAppointment(selected.startAt, selected.category, page.timezone)

        const needsRescheduleAvailability = input.state.flow === 'APPOINTMENT_RESCHEDULE_DATE' ||
          input.state.flow === 'APPOINTMENT_RESCHEDULE_SLOT' || input.state.flow === 'APPOINTMENT_RESCHEDULE_SUMMARY'
        if (needsRescheduleAvailability) {
          const aggregate = await tx.$queryRaw<Array<{ professionalId: string; durationMinutes: number; primaryServiceId: string }>>(Prisma.sql`
            SELECT a."professionalId", a."totalDurationMinutes" AS "durationMinutes", a."serviceId" AS "primaryServiceId"
            FROM "Appointment" a WHERE a."id" = ${selected.appointmentId}
          `)
          const row = aggregate[0]
          if (!row || !Number.isInteger(row.durationMinutes) || row.durationMinutes <= 0) throw new Error('appointment reschedule aggregate is unavailable')
          const items = await tx.$queryRaw<Array<{ serviceId: string }>>(Prisma.sql`
            SELECT "serviceId" FROM "AppointmentServiceItem" WHERE "appointmentId" = ${selected.appointmentId} ORDER BY "sortOrder", "serviceId"
          `)
          const serviceIds = items.length ? items.map((item) => item.serviceId) : [row.primaryServiceId]
          const availability = new PrismaAvailabilityRepository(tx)
          const settings = await availability.loadSettings(input.businessId)
          if (settings.timezone !== page.timezone) throw new Error('appointment management timezone does not match availability settings')
          const search = await availability.search({
            businessId: input.businessId, serviceIds, durationMinutes: row.durationMinutes,
            dbNow: page.dbNow, settings, professionalId: row.professionalId, excludeAppointmentId: selected.appointmentId
          })
          const effectiveDate = input.actionType === 'appointment.date_select' ? input.payload?.date : input.state.selections.date
          const slots = effectiveDate ? search.slots.filter((slot) => slot.date === effectiveDate) : search.slots
          const dates = [...new Set(search.slots.map((slot) => slot.date))]
          base.labels.availableDates = dates.map((date) => ({ date, label: formatDateChoice(date, settings.timezone) }))
          base.labels.availableSlots = slots.map((slot) => ({
            startAt: slot.startAt, label: `${slot.time} · ${slot.professionalName}`, band: slot.band, professionalId: slot.professionalId
          }))
          base.rescheduleDateAvailable = Boolean(effectiveDate && dates.includes(effectiveDate))
          const requestedStartAt = input.actionType === 'appointment.slot_select' ? input.payload?.startAt : input.state.selections.slotStartAt
          base.rescheduleSlotAvailable = Boolean(requestedStartAt && slots.some((slot) => slot.startAt === requestedStartAt))
        }
      }
    }
  }

  return base
}

function formatManagedAppointment(startAt: Date, category: string, timezone: string): string {
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(startAt)
  return `${date} · ${category}`
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
  const pendingCrmEvents: InboundConversationMessageProjection[] = []
  return withDispatchClaimCleanup(input.client, dispatchToken, async (markSettled) => {
    const criticalTransactionStartedAt = performance.now()
    try {
      const result = await runCommittedProcessSession({ client: input.client, operation: async (tx) => {
        await assertClaimedBotJobTx(tx, input.job)
        await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
      const sessions = await tx.$queryRaw<Array<{
        id: string; businessId: string; deploymentId: string; deploymentGeneration: number
        revision: bigint; state: Prisma.JsonValue; status: string; dbNow: Date; toPhone: string | null; conversationId: string | null
        businessTimezone: string
      }>>(Prisma.sql`
        SELECT s."id", s."businessId", s."deploymentId", s."deploymentGeneration", s."revision", s."state", s."conversationId",
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
        promptId: string | null; providerEventId: string; providerMessageId: string | null; providerPayload: Prisma.JsonValue; status: string
      }>>(Prisma.sql`
        SELECT i."id", i."actionType", i."entityRef", i."payload", i."promptId", i."providerEventId", i."providerMessageId",
          e."payload" AS "providerPayload", i."status"::text AS "status"
        FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id"=i."providerEventId" AND e."businessId"=i."businessId"
        WHERE i."id" = ${input.job.aggregateId} FOR UPDATE OF i
      `)
      let actionType: string
      let view: BotOptionsViewModel
      let nextState = parsedState.state
      let outcome = 'CONFLICT'
      let effects: readonly BotOptionsEffect[] = []
      let promptId: string | null = null
      let providerEventId: string | null = null
      let transitionContext: TransitionContext | null = null
      if (selected.length === 1) {
        const action = selected[0]!
        if (action.status !== 'SELECTED' || !action.actionType) throw new Error('session action is not selected')
        // La admisión/reconciliación es la frontera canónica del actionType. No se
        // amplía ese contrato en F5.5; sí se valida la forma de datos JSON antes
        // de entregarlos al provider y a la transición.
        const selectedActionType = action.actionType as BotOptionsActionType
        const selectedEntityRef = parseSelectedEntityRef(action.entityRef)
        const selectedPayload = parseSelectedPayload(action.payload)
        const inbound = action.providerPayload as { fromPhone?: unknown; textBody?: unknown; messageType?: unknown }
        if (session.conversationId && typeof inbound.fromPhone === 'string' && inbound.fromPhone) {
          await projectInboundMessage(tx, {
            businessId: session.businessId,
            conversationId: session.conversationId,
            phone: inbound.fromPhone,
            providerMessageId: action.providerMessageId,
            body: inboundBody(inbound),
            messageType: inbound.messageType
          }, pendingCrmEvents)
        }
        actionType = selectedActionType
        promptId = action.promptId
        providerEventId = action.providerEventId
        const context = await measureSessionStage('session_context_load', () => (input.contextProvider ?? defaultContextProvider)(tx, {
          businessId: session.businessId, sessionId: session.id, state: parsedState.state, actionType: selectedActionType,
          entityRef: selectedEntityRef, payload: selectedPayload, dbNow: session.dbNow,
          businessTimezone: session.businessTimezone, conversationPhone: session.toPhone
        }))
        transitionContext = context
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
      const effectResult = await measureSessionStage('session_effects', () => (input.effectExecutor ?? prismaBotOptionsEffectExecutor)(tx, {
        businessId: session.businessId, sessionId: session.id, operationKey, effects
      }))
      if (effectResult?.kind === 'SLOT_CONFLICT') {
        if (!transitionContext) throw new Error('booking conflict has no transition context')
        const freshContext = await measureSessionStage('session_context_load', () => (input.contextProvider ?? defaultContextProvider)(tx, {
          businessId: session.businessId,
          sessionId: session.id,
          state: parsedState.state,
          actionType: 'booking.slot_conflict',
          entityRef: null,
          payload: null,
          dbNow: session.dbNow,
          businessTimezone: session.businessTimezone, conversationPhone: session.toPhone
        }))
        const recovery = transition(parsedState.state, {
          actionType: 'booking.slot_conflict', entityRef: null, payload: null
        }, freshContext)
        nextState = recovery.state
        view = recovery.view
        outcome = recovery.outcome
        effects = 'effects' in recovery ? recovery.effects : []
        if (effects.length) throw new Error('booking slot recovery must not emit effects')
      } else if (effectResult?.kind === 'CONFIRMED') {
        nextState = {
          ...nextState,
          selections: {
            ...nextState.selections,
            provisionalProfessionalId: effectResult.professional.professionalId
          }
        }
        view = textView(`Listo, tu turno quedó confirmado con ${effectResult.professional.name}. Te esperamos.`)
      } else if (effectResult?.kind === 'APPOINTMENT_SLOT_CONFLICT' || effectResult?.kind === 'APPOINTMENT_STALE') {
        if (!transitionContext) throw new Error('appointment recovery has no transition context')
        const recoveryAction = effectResult.kind === 'APPOINTMENT_SLOT_CONFLICT' ? 'appointment.slot_conflict' : 'appointment.stale'
        const freshContext = await measureSessionStage('session_context_load', () => (input.contextProvider ?? defaultContextProvider)(tx, {
          businessId: session.businessId,
          sessionId: session.id,
          state: parsedState.state,
          actionType: recoveryAction,
          entityRef: { type: 'APPOINTMENT', id: effectResult.appointmentId },
          payload: null,
          dbNow: session.dbNow,
          businessTimezone: session.businessTimezone, conversationPhone: session.toPhone
        }))
        const recovery = transition(parsedState.state, {
          actionType: recoveryAction,
          entityRef: { type: 'APPOINTMENT', id: effectResult.appointmentId },
          payload: null
        }, freshContext)
        nextState = recovery.state
        view = recovery.view
        outcome = recovery.outcome
        effects = 'effects' in recovery ? recovery.effects : []
        if (effects.length) throw new Error('appointment recovery must not emit effects')
      } else if (effectResult?.kind === 'APPOINTMENT_HANDOFF') {
        if (!transitionContext) throw new Error('appointment handoff has no transition context')
        const handoff = transition(parsedState.state, {
          actionType: 'handoff.request', entityRef: null, payload: null
        }, transitionContext)
        nextState = handoff.state
        view = handoff.view
        outcome = handoff.outcome
        effects = 'effects' in handoff ? handoff.effects : []
        if (!effects.some((effect) => effect.kind === 'REQUEST_HUMAN_HANDOFF')) {
          throw new Error('appointment handoff recovery must enqueue human attention')
        }
        await measureSessionStage('session_effects', () => (input.effectExecutor ?? prismaBotOptionsEffectExecutor)(tx, {
          businessId: session.businessId, sessionId: session.id, operationKey, effects
        }))
      }
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
      await measureSessionStage('session_persist_view', () => persistView(tx, {
        businessId: session.businessId, sessionId: session.id, revision: nextRevision,
        transitionId: operationKey, toPhone: session.toPhone, view, dbNow: session.dbNow
      }))
      await settleProcessedSessionTx(tx, {
        inboxId: selected[0]?.id ?? null,
        operationKey,
        dispatchToken,
        job: input.job
      })
      return 'PROCESSED'
      }, onCommitted: markSettled, postCommit: () => flushInboundConversationMessages(pendingCrmEvents) })
      botOptionsMetrics.observe('session_critical_transaction', performance.now() - criticalTransactionStartedAt)
      return result
    } catch (error) {
      botOptionsMetrics.observe('session_critical_transaction', performance.now() - criticalTransactionStartedAt, 'error')
      throw error
    }
  })
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
  return withDispatchClaimCleanup(input.client, dispatchToken, async (markSettled) => {
    const result = await processInitialInboxUnderClaim(input, false, dispatchToken, markSettled)
    if (result === 'STALE_CUTOVER') await scheduleCurrentRecovery(input.client, input.job)
    return result
  })
}

async function processInitialInboxUnderClaim(
  input: { client: RuntimeClient; job: ClaimedBotJob },
  forceFreshView = false,
  dispatchToken: string,
  onCommitted?: () => void
): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  const pendingCrmEvents: InboundConversationMessageProjection[] = []
  const result = await runProcessInboxTransaction(input.client, async (tx) => {
    await assertClaimedBotJobTx(tx, input.job)
    await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
    const rows = await tx.$queryRaw<Array<{ id: string; businessId: string; deploymentId: string; deploymentGeneration: number; payload: Prisma.JsonValue; providerEventId: string; providerMessageId: string | null; status: string; dbNow: Date; businessTimezone: string }>>(Prisma.sql`
      SELECT i."id", e."businessId", i."deploymentId", i."deploymentGeneration", i."payload", i."providerEventId", i."providerMessageId", i."status"::text AS "status",
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
    const payload = row.payload as { fromPhone?: unknown; textBody?: unknown; messageType?: unknown }
    if (typeof payload.fromPhone !== 'string' || !payload.fromPhone) throw new Error('initial inbound has no phone')
    const existingSession = await lockExistingInitialSession(tx, row.businessId, payload.fromPhone)
    if (existingSession) {
      if (existingSession.status !== 'HUMAN_TAKEN') {
        const body = inboundBody(payload)
        await projectInboundMessage(tx, {
          businessId: row.businessId,
          conversationId: existingSession.conversationId,
          phone: payload.fromPhone,
          providerMessageId: row.providerMessageId,
          body,
          messageType: payload.messageType
        }, pendingCrmEvents)
        const state = parseBotOptionsState(existingSession.state)
        if (!state.ok) throw new Error(`unknown/corrupt state: ${state.invariant}`)
        if (isConversationRestartCommand(payload.textBody)) {
          const nextState = createInitialBotOptionsState()
          const nextRevision = existingSession.revision + 1n
          await tx.$executeRaw(Prisma.sql`
            UPDATE "BotSession" SET "state"=${JSON.stringify(nextState)}::jsonb, "revision"=${nextRevision}, "updatedAt"=clock_timestamp()
            WHERE "id"=${existingSession.sessionId} AND "businessId"=${row.businessId} AND "revision"=${existingSession.revision}
          `)
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome")
            VALUES (${randomUUID()}, ${row.businessId}, ${existingSession.sessionId}, ${row.deploymentId}, ${row.deploymentGeneration},
              ${existingSession.revision}, ${nextRevision}, 'system.conversation_restart', 'APPLIED')
            ON CONFLICT ("sessionId", "revisionTo") DO NOTHING
          `)
          await tx.$executeRaw(Prisma.sql`
            UPDATE "BotActionInbox" SET "sessionId"=${existingSession.sessionId}, "expectedRevision"=${existingSession.revision},
              "status"='PROCESSED'::"BotInboxStatus", "error"='EXISTING_SESSION_RESTARTED'
            WHERE "id"=${row.id} AND "status"='ADMITTED'::"BotInboxStatus"
          `)
          await persistView(tx, {
            businessId: row.businessId,
            sessionId: existingSession.sessionId,
            revision: nextRevision,
            transitionId: `restart:${existingSession.sessionId}:${row.id}`,
            toPhone: payload.fromPhone,
            view: renderCurrentView(nextState, await defaultContextProvider(tx, {
              businessId: row.businessId,
              sessionId: existingSession.sessionId,
              state: nextState,
              actionType: 'system.reprompt',
              entityRef: null,
              payload: null,
              dbNow: row.dbNow,
              businessTimezone: existingSession.businessTimezone
            })),
            dbNow: row.dbNow
          })
          await completeDispatchClaimTx(tx, dispatchToken)
          await completeClaimedBotJobTx(tx, input.job)
          return 'PROCESSED'
        }
        await tx.$executeRaw(Prisma.sql`
          UPDATE "BotActionInbox" SET "sessionId"=${existingSession.sessionId},"expectedRevision"=${existingSession.revision},
            "status"='PROCESSED'::"BotInboxStatus", "error"='EXISTING_SESSION_REPROMPTED'
          WHERE "id"=${row.id} AND "status"='ADMITTED'::"BotInboxStatus"
        `)
        await persistView(tx, {
          businessId: row.businessId,
          sessionId: existingSession.sessionId,
          revision: existingSession.revision,
          transitionId: `reprompt:${existingSession.sessionId}:${row.id}`,
          toPhone: payload.fromPhone,
          view: renderCurrentView(state.state, await defaultContextProvider(tx, {
            businessId: row.businessId,
            sessionId: existingSession.sessionId,
            state: state.state,
            actionType: 'system.reprompt',
            entityRef: null,
            payload: null,
            dbNow: row.dbNow,
            businessTimezone: existingSession.businessTimezone
          })),
          dbNow: row.dbNow
        })
        await completeDispatchClaimTx(tx, dispatchToken)
        await completeClaimedBotJobTx(tx, input.job)
        return 'PROCESSED'
      }
      await projectInboundMessage(tx, {
        businessId: row.businessId,
        conversationId: existingSession.conversationId,
        phone: payload.fromPhone,
        providerMessageId: row.providerMessageId,
        body: inboundBody(payload),
        messageType: payload.messageType,
        source: 'bot-options-handoff-recovery'
      }, pendingCrmEvents)
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotActionInbox" SET "sessionId"=${existingSession.sessionId},"status"='PROCESSED'::"BotInboxStatus",
          "error"='HUMAN_TAKEN_SILENCED'
        WHERE "id"=${row.id} AND "status"='ADMITTED'::"BotInboxStatus"
      `)
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotProviderEvent" SET "status"='PROCESSED'::"BotProviderEventStatus"
        WHERE "id"=${row.providerEventId} AND "status"='ADMITTED'::"BotProviderEventStatus"
      `)
      await completeDispatchClaimTx(tx, dispatchToken)
      await completeClaimedBotJobTx(tx, input.job)
      return 'PROCESSED'
    }
    const conversationId = randomUUID()
    const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
      VALUES (${conversationId}, ${payload.fromPhone}, ${row.businessId}, clock_timestamp())
      ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt"
      RETURNING "id"
    `)
    await projectInboundMessage(tx, {
      businessId: row.businessId,
      conversationId: conversations[0]!.id,
      phone: payload.fromPhone,
      providerMessageId: row.providerMessageId,
      body: inboundBody(payload),
      messageType: payload.messageType
    }, pendingCrmEvents)
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
  onCommitted?.()
  // After-commit delivery: notify the CRM only once the inbound Message
  // projection is durably committed (covers PROCESS_INBOX and cutover recovery).
  flushInboundConversationMessages(pendingCrmEvents)
  return result
}

/**
 * Serializes initial inbox handling with the pre-existing conversation session.
 * This avoids creating a second ACTIVE session while TAKE changes ownership.
 */
async function lockExistingInitialSession(tx: Prisma.TransactionClient, businessId: string, phone: string) {
  const sessions = await tx.$queryRaw<Array<{ sessionId: string; conversationId: string; revision: bigint; status: string; state: Prisma.JsonValue; businessTimezone: string }>>(Prisma.sql`
    SELECT s."id" AS "sessionId", c."id" AS "conversationId", s."revision", s."status"::text AS "status", s."state", s."businessTimezone"
    FROM "Conversation" c
    JOIN "BotSession" s ON s."conversationId"=c."id" AND s."businessId"=c."businessId"
    WHERE c."businessId"=${businessId} AND c."phone"=${phone} AND s."status" <> 'CLOSED'::"BotSessionStatus"
    ORDER BY CASE s."status" WHEN 'HUMAN_TAKEN'::"BotSessionStatus" THEN 0 WHEN 'HUMAN_QUEUED'::"BotSessionStatus" THEN 1 ELSE 2 END,
      s."updatedAt" DESC, s."id" DESC
    FOR UPDATE OF s
  `)
  const session = sessions[0]
  if (!session) return null
  if (session.status !== 'HUMAN_TAKEN') return session
  const handoffs = await tx.$queryRaw<Array<{ handoffId: string }>>(Prisma.sql`
    SELECT "id" AS "handoffId" FROM "BotHandoff" WHERE "businessId"=${businessId} AND "sessionId"=${session.sessionId}
      AND "status"='TAKEN'::"BotHandoffStatus" FOR UPDATE
  `)
  if (handoffs.length !== 1) throw new Error('human-owned session lacks taken handoff')
  const conversations = await tx.$queryRaw<Array<{ conversationId: string }>>(Prisma.sql`
    SELECT "id" AS "conversationId" FROM "Conversation" WHERE "id"=${session.conversationId} AND "businessId"=${businessId} FOR UPDATE
  `)
  if (conversations.length !== 1) throw new Error('human-owned session lacks conversation')
  return session
}

function inboundBody(payload: { textBody?: unknown; messageType?: unknown }) {
  return typeof payload.textBody === 'string' && payload.textBody.trim()
    ? payload.textBody.trim()
    : `[${typeof payload.messageType === 'string' ? payload.messageType : 'message'}]`
}

async function projectInboundMessage(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string; conversationId: string; phone: string; providerMessageId: string | null
    body: string; messageType: unknown; source?: string
  },
  pendingCrmEvents: InboundConversationMessageProjection[]
) {
  const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "Message" ("id", "conversationId", "phone", "direction", "body", "providerMessageId", "status", "metadata")
    VALUES (${randomUUID()}, ${input.conversationId}, ${input.phone}, 'INBOUND'::"MessageDirection", ${input.body},
      ${input.providerMessageId}, 'received', ${JSON.stringify({
        provider: 'whatsapp', source: input.source ?? 'bot-options', messageType: input.messageType
      })}::jsonb)
    ON CONFLICT ("providerMessageId") DO NOTHING
    RETURNING "id"
  `)
  if (inserted.length === 1) {
    // Recorded only after a row was actually committed-capable. The flush
    // happens outside the transaction, so the CRM is notified strictly
    // after-commit and never for a rolled-back or duplicate (ON CONFLICT) row.
    collectInboundConversationMessage(pendingCrmEvents, {
      businessId: input.businessId,
      conversationId: input.conversationId,
      messageId: inserted[0]!.id
    })
  }
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Conversation" SET "lastMessage"=${input.body},"archivedAt"=NULL,"updatedAt"=clock_timestamp()
    WHERE "id"=${input.conversationId} AND "businessId"=${input.businessId}
  `)
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
  return withDispatchClaimCleanup(input.client, dispatchToken, async (markSettled) => {
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
    const result = await processInitialInboxUnderClaim({ client: input.client, job: synthetic }, true, dispatchToken, markSettled)
    if (result === 'STALE_CUTOVER') throw new Error('deployment changed during cutover recovery')
    return result
  })
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

export function planPersistedView(input: {
  view: BotOptionsViewModel
  transitionId: string
  toPhone: string
  promptToken: string
  idFactory: () => string
}) {
  const id = input.idFactory ?? randomUUID
  const rendered = renderWhatsAppScreen(input.view, { promptToken: input.promptToken })
  const promptId = rendered.choiceMappings.length > 0 ? id() : null
  const choiceRows = promptId ? rendered.choiceMappings.map((choice) => ({
    id: id(), promptId, choiceToken: choice.choiceToken, actionType: choice.actionType,
    entityType: choice.entityType, entityId: choice.entityId, payload: choice.payload,
    labelSnapshot: choice.labelSnapshot, sortOrder: choice.sortOrder
  })) : []
  const deliveryGroupId = id()
  let sequence = 0
  const outboxRows = rendered.items.flatMap((item) => {
    if (item.type === 'none') return []
    const row = {
      id: id(), deliveryGroupId, sequence, kind: item.type, item,
      idempotencyKey: `${input.transitionId}:${sequence}`,
      dependsOnSequence: sequence > 0 && rendered.interactiveDependsOnPrevious ? sequence - 1 : null
    }
    sequence += 1
    return [row]
  })
  return {
    promptId, choiceRows, outboxRows,
    interactiveOutboxId: promptId ? outboxRows.find((row) => row.kind === 'interactive')?.id ?? null : null
  }
}

export async function persistView(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string; sessionId: string; revision: bigint; transitionId: string; toPhone: string | null; view: BotOptionsViewModel; dbNow: Date
    promptToken?: string; idFactory?: () => string
  }
) {
  if (!input.toPhone) throw new Error('cannot render outbox without destination phone')
  const promptToken = input.promptToken ?? generatePromptToken()
  const plan = planPersistedView({
    view: input.view, transitionId: input.transitionId, toPhone: input.toPhone, promptToken, idFactory: input.idFactory ?? randomUUID
  })
  if (plan.promptId) {
    // Keep these as ordered statements: a sibling data-modifying CTE would not
    // guarantee invalidation before the partial unique OPEN-prompt check.
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotPrompt" SET "status" = 'INVALIDATED'::"BotPromptStatus", "resolvedAt" = clock_timestamp()
      WHERE "sessionId" = ${input.sessionId} AND "status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
    `)
    const promptCount = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "mode", "status", "openedAt", "outboxMessageId")
      VALUES (${plan.promptId}, ${input.sessionId}, ${promptToken}, ${input.revision}, 'FUNCTIONAL'::"BotPromptMode", 'OPEN'::"BotPromptStatus", ${input.dbNow}, ${plan.interactiveOutboxId})
    `)
    if (promptCount !== 1) throw new Error('persist view prompt row count mismatch')
  }
  const persisted = await tx.$queryRaw<Array<{ choiceCount: bigint; outboxCount: bigint }>>(Prisma.sql`
    WITH invalidated AS (
      ${plan.promptId ? Prisma.sql`
        SELECT NULL::text AS "id" WHERE FALSE
      ` : Prisma.sql`
        UPDATE "BotPrompt" SET "status" = 'INVALIDATED'::"BotPromptStatus", "resolvedAt" = clock_timestamp()
        WHERE "sessionId" = ${input.sessionId} AND "status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
        RETURNING "id"
      `}
    ), inserted_choices AS (
      ${plan.choiceRows.length > 0 ? Prisma.sql`
        INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "entityType", "entityId", "payload", "labelSnapshot", "sortOrder")
        VALUES ${Prisma.join(plan.choiceRows.map((choice) => Prisma.sql`(
          ${choice.id}, ${choice.promptId}, ${choice.choiceToken}, ${choice.actionType}, ${choice.entityType}, ${choice.entityId},
          ${choice.payload === null ? null : JSON.stringify(choice.payload)}::jsonb, ${choice.labelSnapshot}, ${choice.sortOrder}
        )`))}
        RETURNING "id"
      ` : Prisma.sql`SELECT NULL::text AS "id" WHERE FALSE`}
    ), inserted_outbox AS (
      ${plan.outboxRows.length > 0 ? Prisma.sql`
        INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
          "idempotencyKey", "status", "dependsOnSequence", "availableAt", "updatedAt")
        VALUES ${Prisma.join(plan.outboxRows.map((row) => Prisma.sql`(
          ${row.id}, ${input.businessId}, ${input.sessionId}, ${input.transitionId}, ${row.deliveryGroupId}, ${row.sequence}, ${row.kind},
          ${JSON.stringify({ to: input.toPhone, item: row.item })}::jsonb, ${row.idempotencyKey}, 'PENDING'::"BotOutboxStatus",
          ${row.dependsOnSequence}, ${input.dbNow}, clock_timestamp()
        )`))}
        RETURNING "id"
      ` : Prisma.sql`SELECT NULL::text AS "id" WHERE FALSE`}
    )
    SELECT (SELECT count(*) FROM inserted_choices)::bigint AS "choiceCount",
      (SELECT count(*) FROM inserted_outbox)::bigint AS "outboxCount"
  `)
  if (persisted[0]?.choiceCount !== BigInt(plan.choiceRows.length) || persisted[0]?.outboxCount !== BigInt(plan.outboxRows.length)) {
    throw new Error('persist view row count mismatch')
  }
}
