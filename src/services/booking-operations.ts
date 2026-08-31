import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { reservationDurationLimits } from './service-duration.js'
import { acquireAgendaHierarchy, lockAppointmentRows } from './agenda-locks.js'
import { calculateBookingDepositTerms, hasCompleteDepositPaymentConfiguration } from './deposit-operations.js'
import { formatServiceEstimate, parseEstimateOptions, resolveServiceEstimate, type ServiceEstimate } from '../bot-options/domain/service-booking.js'
import {
  hasAppointmentOverlap,
  hasScheduleBlockOverlap,
  isInsideBusinessHours,
  isInsideProfessionalHours,
  professionalOffersServices
} from './prisma-booking.js'

export type BookingWriteConflict =
  | 'PROFESSIONAL_INACTIVE'
  | 'PROFESSIONAL_SERVICE_MISMATCH'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'OUTSIDE_PROFESSIONAL_HOURS'
  | 'SCHEDULE_BLOCK'
  | 'APPOINTMENT_OVERLAP'

export type ConfirmBookingWithoutDepositResult =
  | {
      kind: 'CONFIRMED'
      visitId: string
      appointmentId: string
      professional: { professionalId: string; name: string; assignedByBalancer: boolean }
    }
  | { kind: 'SLOT_CONFLICT' }

export type HoldBookingWithDepositResult =
  | {
      kind: 'HELD'
      visitId: string
      appointmentId: string
      depositId: string
      expiresAt: Date
      amount: number
      professional: { professionalId: string; name: string; assignedByBalancer: boolean }
    }
  | { kind: 'SLOT_CONFLICT' }

export type ConfirmBookingWithoutDepositInput = {
  businessId: string
  sessionId: string
  operationKey: string
  newBookingAllowed: boolean
  services: ReadonlyArray<{
    serviceId: string
    name: string
    durationMinutes: number
    priceMinor: number | null
    priceMode: 'FIXED' | 'STARTING_AT' | null
    estimate?: ServiceEstimate
  }>
  professional: { professionalId: string; name: string; assignedByBalancer: boolean }
  date: string
  slotStartAt: string
  totalDurationMinutes: number
  totalPriceMinor: number | null
}

export type HoldBookingWithDepositInput = ConfirmBookingWithoutDepositInput

export async function revalidateBookingWrite(tx: Prisma.TransactionClient, input: {
  businessId: string
  professionalId: string
  professionalIdsToLock?: readonly string[]
  serviceIds: readonly string[]
  startAt: Date
  excludeAppointmentId?: string
  timezone?: string
  dbNow?: Date
}) {
  await acquireAgendaHierarchy(tx, {
    businessId: input.businessId,
    professionalIds: input.professionalIdsToLock ?? [input.professionalId]
  })
  if (input.excludeAppointmentId) {
    await lockAppointmentRows(tx, {
      businessId: input.businessId,
      appointmentIds: [input.excludeAppointmentId]
    })
  }

  const professional = await tx.professional.findFirst({
    where: { id: input.professionalId, businessId: input.businessId }
  })
  const services = await tx.service.findMany({
    where: { id: { in: [...input.serviceIds] }, businessId: input.businessId }
  })
  if (!professional) throw new Error('Professional no longer belongs to the locked business')
  if (services.length !== input.serviceIds.length) throw new Error('Services no longer belong to the locked business')

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const orderedServices = input.serviceIds.map((serviceId) => servicesById.get(serviceId)!)
  const professionalDuration = orderedServices.reduce(
    (total, service) => total + reservationDurationLimits(service).professional,
    0
  )
  const customerDuration = orderedServices.reduce(
    (total, service) => total + reservationDurationLimits(service).business,
    0
  )
  const professionalEndAt = addMinutes(input.startAt, professionalDuration)
  const customerEndAt = addMinutes(input.startAt, customerDuration)

  const offersServices = await professionalOffersServices(tx, input.professionalId, input.serviceIds)
  const insideBusinessHours = await isInsideBusinessHours(tx, {
    businessId: input.businessId,
    startAt: input.startAt,
    endAt: customerEndAt,
    ...(input.timezone ? { timezone: input.timezone } : {})
  })
  const insideProfessionalHours = await isInsideProfessionalHours(tx, {
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt,
    ...(input.timezone ? { timezone: input.timezone } : {})
  })
  const scheduleBlock = await hasScheduleBlockOverlap(tx, {
    businessId: input.businessId,
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt
  })
  const appointmentOverlap = await hasAppointmentOverlap(tx, {
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt,
    ...(input.excludeAppointmentId ? { excludeAppointmentId: input.excludeAppointmentId } : {}),
    ...(input.dbNow ? { dbNow: input.dbNow } : {})
  })

  const conflicts: BookingWriteConflict[] = [
    ...(!professional.isActive ? ['PROFESSIONAL_INACTIVE' as const] : []),
    ...(!offersServices ? ['PROFESSIONAL_SERVICE_MISMATCH' as const] : []),
    ...(!insideBusinessHours ? ['OUTSIDE_BUSINESS_HOURS' as const] : []),
    ...(!insideProfessionalHours ? ['OUTSIDE_PROFESSIONAL_HOURS' as const] : []),
    ...(scheduleBlock ? ['SCHEDULE_BLOCK' as const] : []),
    ...(appointmentOverlap ? ['APPOINTMENT_OVERLAP' as const] : [])
  ]
  return {
    professional,
    orderedServices,
    professionalDuration,
    customerDuration,
    professionalEndAt,
    customerEndAt,
    conflicts
  }
}

export async function revalidateAppointmentsForConfirmation(
  tx: Prisma.TransactionClient,
  input: { businessId: string; appointmentIds: readonly string[] }
) {
  const ids = Array.from(new Set(input.appointmentIds.filter(Boolean))).sort()
  const appointments = await tx.appointment.findMany({
    where: { id: { in: ids }, professional: { businessId: input.businessId } },
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
      startAt: true,
      serviceItems: { select: { serviceId: true }, orderBy: { sortOrder: 'asc' } }
    }
  })
  if (appointments.length !== ids.length) return false
  const professionalIds = appointments.map((appointment) => appointment.professionalId)
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds })
  await lockAppointmentRows(tx, { businessId: input.businessId, appointmentIds: ids })
  for (const appointment of appointments) {
    const validation = await revalidateBookingWrite(tx, {
      businessId: input.businessId,
      professionalId: appointment.professionalId,
      professionalIdsToLock: professionalIds,
      serviceIds: appointment.serviceItems.length
        ? appointment.serviceItems.map((item) => item.serviceId)
        : [appointment.serviceId],
      startAt: appointment.startAt,
      excludeAppointmentId: appointment.id
    })
    if (validation.conflicts.length) return false
  }
  return true
}

/**
 * F7.3/F7.4 — confirma una visita sin seña dentro de la transacción del motor.
 * No elige otro horario. Para "cualquier profesional" bloquea el conjunto
 * compatible completo y recién entonces recalcula disponibilidad y balanceo.
 */
export async function confirmBookingWithoutDeposit(
  tx: Prisma.TransactionClient,
  input: ConfirmBookingWithoutDepositInput
): Promise<ConfirmBookingWithoutDepositResult> {
  return createBookingVisit(tx, { ...input, depositRequired: false }) as Promise<ConfirmBookingWithoutDepositResult>
}

/**
 * F8.3 primitive: all financial and agenda rows are written in the caller's
 * transaction. It is deliberately not wired to a transition until F8.4/F8.5
 * safety gates permit instructions/proof handling.
 */
export async function holdBookingWithDeposit(
  tx: Prisma.TransactionClient,
  input: HoldBookingWithDepositInput
): Promise<HoldBookingWithDepositResult> {
  return createBookingVisit(tx, { ...input, depositRequired: true }) as Promise<HoldBookingWithDepositResult>
}

async function createBookingVisit(
  tx: Prisma.TransactionClient,
  input: ConfirmBookingWithoutDepositInput & { depositRequired: boolean }
): Promise<ConfirmBookingWithoutDepositResult | HoldBookingWithDepositResult> {
  const startAt = new Date(input.slotStartAt)
  if (!Number.isFinite(startAt.getTime()) || startAt.toISOString() !== input.slotStartAt) {
    throw new Error('booking confirmation slotStartAt must be a canonical ISO instant')
  }
  const serviceIds = input.services.map((service) => service.serviceId)
  if (!serviceIds.length || new Set(serviceIds).size !== serviceIds.length) {
    throw new Error('booking confirmation requires unique services')
  }
  const requestHash = hashBookingConfirmation(input)
  const replay = await loadCompletedBookingReplay(tx, input, requestHash)
  if (replay) return replay
  if (!input.newBookingAllowed) throw new Error('bot booking capability is disabled')

  // El business lock precede incluso la lectura del conjunto candidato: los
  // writers de catálogo/capacidades/agenda usan la misma raíz de jerarquía.
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [] })

  const secondReplay = await loadCompletedBookingReplay(tx, input, requestHash, true)
  if (secondReplay) return secondReplay

  const settings = await tx.$queryRaw<Array<{
    timezone: string
    dbNow: Date
    localDate: string
    insideWindow: boolean
    onGrid: boolean
    depositHoldMinutes: number | null
  }>>(Prisma.sql`
    SELECT s."timezone", s."depositHoldMinutes", clock_timestamp() AS "dbNow",
      to_char(${startAt} AT TIME ZONE s."timezone", 'YYYY-MM-DD') AS "localDate",
      (
        ${startAt} >= clock_timestamp() + make_interval(hours => s."bookingLeadTimeHours")
        AND (${startAt} AT TIME ZONE s."timezone")::date >= (clock_timestamp() AT TIME ZONE s."timezone")::date
        AND (${startAt} AT TIME ZONE s."timezone")::date < (clock_timestamp() AT TIME ZONE s."timezone")::date + s."bookingHorizonDays"
      ) AS "insideWindow",
      (
        extract(minute FROM (${startAt} AT TIME ZONE s."timezone"))::int % 30 = 0
        AND extract(second FROM (${startAt} AT TIME ZONE s."timezone")) = 0
      ) AS "onGrid"
    FROM "BusinessBotOptionsSettings" s
    WHERE s."businessId" = ${input.businessId}
  `)
  const setting = settings[0]
  if (!setting) throw new Error('bot booking settings unavailable for tenant')
  if (!setting.insideWindow || !setting.onGrid || setting.localDate !== input.date) {
    return { kind: 'SLOT_CONFLICT' }
  }

  const candidates = await tx.$queryRaw<Array<{ id: string; name: string; priority: number }>>(Prisma.sql`
    SELECT p."id", p."name", p."botBookingPriority" AS "priority"
    FROM "Professional" p
    JOIN "ProfessionalService" ps ON ps."professionalId" = p."id"
    WHERE p."businessId" = ${input.businessId}
      AND p."isActive" = true
      AND p."acceptsBotBookings" = true
      AND ps."serviceId" IN (${Prisma.join(serviceIds)})
    GROUP BY p."id", p."name", p."botBookingPriority"
    HAVING count(DISTINCT ps."serviceId") = ${serviceIds.length}
    ORDER BY p."id"
  `)
  const lockCandidates = input.professional.assignedByBalancer
    ? candidates
    : candidates.filter((candidate) => candidate.id === input.professional.professionalId)
  if (!lockCandidates.length) return { kind: 'SLOT_CONFLICT' }
  const professionalIds = lockCandidates.map((candidate) => candidate.id)
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds })

  const validCandidates: Array<{ id: string; name: string; priority: number }> = []
  let canonicalServices: Awaited<ReturnType<typeof revalidateBookingWrite>>['orderedServices'] | null = null
  for (const candidate of lockCandidates) {
    const validation = await revalidateBookingWrite(tx, {
      businessId: input.businessId,
      professionalId: candidate.id,
      professionalIdsToLock: professionalIds,
      serviceIds,
      startAt,
      timezone: setting.timezone,
      dbNow: setting.dbNow
    })
    canonicalServices ??= validation.orderedServices
    if (!validation.conflicts.length) validCandidates.push(candidate)
  }
  if (!validCandidates.length || !canonicalServices) return { kind: 'SLOT_CONFLICT' }

  const bookingServices = assertCanonicalBookingSnapshot(input, canonicalServices)
  const activeCatalogCount = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT count(*)::int AS "count"
    FROM "Service" s
    JOIN "ServiceCategory" c
      ON c."id" = s."catalogCategoryId"
     AND c."businessId" = s."businessId"
     AND c."isActive" = true
    WHERE s."businessId" = ${input.businessId}
      AND s."id" IN (${Prisma.join(serviceIds)})
      AND s."isBookable" = true
      AND (s."attentionMode" = 'DIRECT_BOOKING'::"ServiceAttentionMode"
        OR (s."attentionMode" = 'GUIDED_ESTIMATE'::"ServiceAttentionMode" AND s."estimateAllowsBooking" = true))
  `)
  if (activeCatalogCount[0]?.count !== serviceIds.length) {
    throw new Error('booking catalog changed during confirmation')
  }
  if (!input.depositRequired && canonicalServices.some((service) => service.depositMode !== 'NONE')) {
    throw new Error('refusing deposit-required service in no-deposit confirmation')
  }
  if (input.depositRequired && canonicalServices.every((service) => service.depositMode === 'NONE')) {
    throw new Error('refusing no-deposit service in deposit hold')
  }
  const depositTerms = input.depositRequired ? calculateBookingDepositTerms({
    services: bookingServices.map((service) => ({
      id: service.id, name: service.name, price: service.price, priceMode: service.priceMode,
      depositMode: service.depositMode, depositValue: service.depositValue
    })),
    businessDepositHoldMinutes: setting.depositHoldMinutes
  }) : null
  if (depositTerms) {
    const paymentRows = await tx.$queryRaw<Array<{
      transferEnabled: boolean; alias: string | null; cbu: string | null; cvu: string | null
      paymentLinkEnabled: boolean; paymentLink: string | null
    }>>(Prisma.sql`
      SELECT "transferEnabled", "alias", "cbu", "cvu", "paymentLinkEnabled", "paymentLink"
      FROM "BusinessPaymentSettings" WHERE "businessId" = ${input.businessId} FOR SHARE
    `)
    if (paymentRows.length !== 1 || !hasCompleteDepositPaymentConfiguration(paymentRows[0]!)) {
      throw new Error('deposit payment configuration unavailable for tenant')
    }
  }
  if (serviceIds.length > 1) {
    const restrictiveRules = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS "count" FROM "ServiceCombinationRule"
      WHERE "businessId" = ${input.businessId}
        AND "serviceAId" IN (${Prisma.join(serviceIds)})
        AND "serviceBId" IN (${Prisma.join(serviceIds)})
        AND "policy" <> 'ALLOWED'::"ServiceCombinationPolicy"
    `)
    if ((restrictiveRules[0]?.count ?? 0) > 0) throw new Error('booking combination policy changed during confirmation')
  }

  const occupied = await tx.$queryRaw<Array<{ professionalId: string; occupiedMinutes: number }>>(Prisma.sql`
    SELECT a."professionalId", COALESCE(sum(a."totalDurationMinutes"), 0)::int AS "occupiedMinutes"
    FROM "Appointment" a
    LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    WHERE a."professionalId" IN (${Prisma.join(validCandidates.map((candidate) => candidate.id))})
      AND (a."startAt" AT TIME ZONE ${setting.timezone})::date = (${startAt} AT TIME ZONE ${setting.timezone})::date
      AND (
        a."status" = 'CONFIRMED'::"AppointmentStatus"
        OR (
          a."status" = 'PENDING'::"AppointmentStatus"
          AND NOT (d."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND d."expiresAt" <= ${setting.dbNow})
        )
      )
    GROUP BY a."professionalId"
  `)
  const occupiedByProfessional = new Map(occupied.map((row) => [row.professionalId, row.occupiedMinutes]))
  const assigned = [...validCandidates].sort((left, right) =>
    (occupiedByProfessional.get(left.id) ?? 0) - (occupiedByProfessional.get(right.id) ?? 0) ||
    left.priority - right.priority ||
    left.id.localeCompare(right.id)
  )[0]!

  const identity = await tx.$queryRaw<Array<{ customerId: string }>>(Prisma.sql`
    SELECT customer."id" AS "customerId"
    FROM "BotSession" session
    JOIN "Conversation" conversation
      ON conversation."id" = session."conversationId"
     AND conversation."businessId" = session."businessId"
    JOIN "Customer" customer
      ON customer."businessId" = session."businessId"
     AND regexp_replace(customer."phone", '[^0-9]', '', 'g') = regexp_replace(conversation."phone", '[^0-9]', '', 'g')
    WHERE session."id" = ${input.sessionId}
      AND session."businessId" = ${input.businessId}
    ORDER BY
      CASE WHEN customer."normalizedPhone" = regexp_replace(conversation."phone", '[^0-9]', '', 'g') THEN 0 ELSE 1 END,
      customer."createdAt", customer."id"
    LIMIT 1
    FOR UPDATE OF customer
  `)
  const customerId = identity[0]?.customerId
  if (!customerId) throw new Error('booking customer identity unavailable in tenant')

  const visitId = randomUUID()
  const appointmentId = randomUUID()
  const effectOperationKey = bookingEffectOperationKey(input.operationKey, input.depositRequired)
  const insertedOperation = await tx.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    INSERT INTO "BotOperation" (
      "id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${effectOperationKey}, ${input.depositRequired ? 'HOLD_VISIT_WITH_DEPOSIT' : 'CONFIRM_VISIT'}, ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, clock_timestamp()
    )
    ON CONFLICT ("operationKey") DO NOTHING
    RETURNING "operationKey"
  `)
  if (!insertedOperation.length) {
    const concurrentReplay = await loadCompletedBookingReplay(tx, input, requestHash, true)
    if (concurrentReplay) return concurrentReplay
    throw new Error('booking operation idempotency race is not safely replayable')
  }

  const depositId = depositTerms ? randomUUID() : null
  const expiresAt = depositTerms ? new Date(setting.dbNow.getTime() + depositTerms.ttlMinutes * 60_000) : null
  const estimateNotes = bookingServices.flatMap((service) => service.estimate
    ? [`${service.name}${service.estimate.optionLabel ? ` — ${service.estimate.optionLabel}` : ''}: estimación ${formatServiceEstimate(service.estimate)}. Precio final pendiente de confirmación.`]
    : []).join('\n') || null
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BookingVisit" (
      "id", "businessId", "customerId", "professionalId", "sessionId", "status",
      "scheduledStartAt", "totalDurationMinutes", "totalPrice", "holdExpiresAt", "origin", "updatedAt"
    ) VALUES (
      ${visitId}, ${input.businessId}, ${customerId}, ${assigned.id}, ${input.sessionId},
       ${input.depositRequired ? 'HELD' : 'CONFIRMED'}::"BookingVisitStatus", ${startAt}, ${input.totalDurationMinutes},
       ${input.totalPriceMinor}, ${expiresAt}, 'BOT'::"AppointmentOrigin", clock_timestamp()
    )
  `)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "Appointment" (
      "id", "customerId", "professionalId", "serviceId", "startAt", "origin",
      "quotedPrice", "totalDurationMinutes", "status", "visitId", "notes"
    ) VALUES (
      ${appointmentId}, ${customerId}, ${assigned.id}, ${serviceIds[0]!}, ${startAt},
       'BOT'::"AppointmentOrigin", ${input.totalPriceMinor}, ${input.totalDurationMinutes},
       ${input.depositRequired ? 'PENDING' : 'CONFIRMED'}::"AppointmentStatus", ${visitId}, ${estimateNotes}
    )
  `)
  for (const [sortOrder, service] of bookingServices.entries()) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AppointmentServiceItem" (
        "appointmentId", "serviceId", "sortOrder", "durationMinutes", "price"
      ) VALUES (
        ${appointmentId}, ${service.id}, ${sortOrder}, ${service.duration}, ${service.price}
      )
    `)
  }
  if (depositTerms && depositId && expiresAt) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDeposit" (
        "id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue",
        "baseAmount", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt"
      ) VALUES (
        ${depositId}, ${input.businessId}, ${appointmentId},
        (SELECT "conversationId" FROM "BotSession" WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId}),
        ${visitId}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", ${depositTerms.amount},
        NULL, ${depositTerms.amount}, 'PENDING_PROOF'::"BookingDepositStatus", ${expiresAt},
        ${depositTerms.ttlMinutes}, ${depositTerms.ttlProvenance}::"BookingDepositTtlProvenance", clock_timestamp()
      )
    `)
    for (const line of depositTerms.lines) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BookingDepositLine" (
          "id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount"
        ) VALUES (
          ${randomUUID()}, ${input.businessId}, ${depositId}, ${line.serviceId}, ${line.sortOrder}, ${line.serviceName},
          ${line.mode}::"ServiceDepositMode", ${line.configuredValue}, ${line.baseAmount}, ${line.amount}
        )
      `)
    }
    const sealed = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDeposit"
      SET "snapshotSealedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
      WHERE "id" = ${depositId} AND "businessId" = ${input.businessId} AND "snapshotSealedAt" IS NULL
    `)
    if (sealed !== 1) throw new Error('deposit financial snapshot could not be sealed')
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotJob" (
        "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "updatedAt"
      ) SELECT ${randomUUID()}, 'EXPIRE_DEPOSIT', ${depositId}, s."businessId", s."deploymentId", s."deploymentGeneration", ${expiresAt}, clock_timestamp()
      FROM "BotSession" s WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
    `)
  }
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation"
    SET "status" = 'COMPLETED', "resultRef" = ${visitId}, "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey}
      AND "status" = 'STARTED'
      AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new Error('booking operation completion race')

  return {
    ...(depositTerms && depositId && expiresAt
      ? { kind: 'HELD' as const, visitId, appointmentId, depositId, expiresAt, amount: depositTerms.amount }
      : { kind: 'CONFIRMED' as const, visitId, appointmentId }),
    professional: {
      professionalId: assigned.id,
      name: assigned.name,
      assignedByBalancer: input.professional.assignedByBalancer
    }
  }
}

function bookingEffectOperationKey(transitionOperationKey: string, depositRequired: boolean) {
  // CONFIRM_VISIT is already persisted by F7. Keep its namespace stable so a
  // post-deploy retry replays the original turn rather than creating another.
  return `${transitionOperationKey}:${depositRequired ? 'HOLD_VISIT_WITH_DEPOSIT' : 'CONFIRM_VISIT'}`
}

function hashBookingConfirmation(input: ConfirmBookingWithoutDepositInput & { depositRequired: boolean }) {
  const legacyF7Payload = {
    services: input.services,
    professional: input.professional,
    date: input.date,
    slotStartAt: input.slotStartAt,
    totalDurationMinutes: input.totalDurationMinutes,
    totalPriceMinor: input.totalPriceMinor
  }
  // Existing F7 BotOperation rows were hashed before F8 knew about deposits.
  // Keep their byte-for-byte payload stable; only F8 holds add their variant.
  const payload = input.depositRequired
    ? { ...legacyF7Payload, depositRequired: true }
    : legacyF7Payload
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

async function loadCompletedBookingReplay(
  tx: Prisma.TransactionClient,
  input: ConfirmBookingWithoutDepositInput & { depositRequired: boolean },
  requestHash: string,
  forUpdate = false
): Promise<ConfirmBookingWithoutDepositResult | HoldBookingWithDepositResult | null> {
  const lock = forUpdate ? Prisma.sql`FOR UPDATE OF operation` : Prisma.empty
  const rows = await tx.$queryRaw<Array<{
    businessId: string
    sessionId: string
    type: string
    status: string
    requestHash: string
    visitId: string | null
    appointmentId: string | null
    professionalId: string | null
    professionalName: string | null
    depositId: string | null
    expiresAt: Date | null
    amount: number | null
  }>>(Prisma.sql`
    SELECT operation."businessId", operation."sessionId", operation."type", operation."status",
      operation."requestHash", visit."id" AS "visitId", appointment."id" AS "appointmentId",
      professional."id" AS "professionalId", professional."name" AS "professionalName",
      deposit."id" AS "depositId", deposit."expiresAt", deposit."amount"
    FROM "BotOperation" operation
    LEFT JOIN "BookingVisit" visit ON visit."id" = operation."resultRef"
    LEFT JOIN "Appointment" appointment ON appointment."visitId" = visit."id"
    LEFT JOIN "Professional" professional ON professional."id" = visit."professionalId"
    LEFT JOIN "BookingDeposit" deposit ON deposit."visitId" = visit."id" AND deposit."businessId" = operation."businessId"
    WHERE operation."operationKey" = ${bookingEffectOperationKey(input.operationKey, input.depositRequired)}
    ${lock}
  `)
  const row = rows[0]
  if (!row) return null
  if (
    row.businessId !== input.businessId || row.sessionId !== input.sessionId ||
    row.type !== (input.depositRequired ? 'HOLD_VISIT_WITH_DEPOSIT' : 'CONFIRM_VISIT') || row.requestHash !== requestHash
  ) {
    throw new Error('booking operation idempotency conflict')
  }
  if (
    row.status !== 'COMPLETED' || !row.visitId || !row.appointmentId ||
    !row.professionalId || !row.professionalName
  ) {
    throw new Error('booking operation is not safely replayable')
  }
  const professional = {
    professionalId: row.professionalId,
    name: row.professionalName,
    assignedByBalancer: input.professional.assignedByBalancer
  }
  if (input.depositRequired) {
    if (!row.depositId || !row.expiresAt || row.amount === null) {
      throw new Error('held booking operation is not safely replayable')
    }
    return {
      kind: 'HELD', visitId: row.visitId, appointmentId: row.appointmentId,
      depositId: row.depositId, expiresAt: row.expiresAt, amount: row.amount, professional
    }
  }
  return {
    kind: 'CONFIRMED', visitId: row.visitId, appointmentId: row.appointmentId,
    professional: {
      ...professional
    }
  }
}

function assertCanonicalBookingSnapshot(
  input: ConfirmBookingWithoutDepositInput,
  services: Awaited<ReturnType<typeof revalidateBookingWrite>>['orderedServices']
) {
  const byId = new Map(services.map((service) => [service.id, service]))
  const canonical = input.services.map((snapshot) => {
    const service = byId.get(snapshot.serviceId)
    if (!service) throw new Error('booking service disappeared during confirmation')
    const estimate = service.attentionMode === 'GUIDED_ESTIMATE'
      ? resolveServiceEstimate({ ...service, estimateOptions: parseEstimateOptions(service.estimateOptions) }, snapshot.estimate?.optionId ?? null)
      : null
    if (service.attentionMode === 'GUIDED_ESTIMATE') {
      if (!service.estimateAllowsBooking || !estimate || !snapshot.estimate ||
          estimate.optionId !== snapshot.estimate.optionId || estimate.optionLabel !== snapshot.estimate.optionLabel ||
          estimate.priceMin !== snapshot.estimate.priceMin || estimate.priceMax !== snapshot.estimate.priceMax ||
          !Number.isSafeInteger(estimate.priceMin) || estimate.priceMin < 0 ||
          (estimate.priceMax !== null && (!Number.isSafeInteger(estimate.priceMax) || estimate.priceMax < estimate.priceMin))) {
        throw new Error('booking estimate snapshot changed during confirmation')
      }
    } else if (snapshot.estimate) {
      throw new Error('booking estimate no longer matches service modality')
    }
    const price = estimate ? estimate.priceMin : service.price
    const priceMode = estimate ? 'STARTING_AT' as const : service.priceMode
    if (
      snapshot.name !== service.name || snapshot.durationMinutes !== service.duration ||
      snapshot.priceMinor !== price || snapshot.priceMode !== priceMode
    ) {
      throw new Error('booking service snapshot changed during confirmation')
    }
    return { ...service, price, priceMode, ...(estimate ? { estimate } : {}) }
  })
  const totalDuration = canonical.reduce((total, service) => total + service.duration, 0)
  const fixedPrice = canonical.every((service) => service.priceMode === 'FIXED' && service.price !== null)
    ? canonical.reduce((total, service) => total + service.price!, 0)
    : null
  if (totalDuration !== input.totalDurationMinutes || fixedPrice !== input.totalPriceMinor) {
    throw new Error('booking aggregate snapshot changed during confirmation')
  }
  return canonical
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}
