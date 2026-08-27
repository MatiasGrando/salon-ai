import { Prisma } from '../generated/prisma/client.js'

export const AGENDA_LOCK_NAMESPACE = 'salon-ai:agenda:v1'

export class AgendaLockScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgendaLockScopeError'
  }
}

export function canonicalProfessionalIds(professionalIds: readonly string[]) {
  return Array.from(new Set(professionalIds.map((id) => id.trim()).filter(Boolean))).sort()
}

export function businessAgendaLockName(businessId: string) {
  return `${AGENDA_LOCK_NAMESPACE}:business:${businessId}`
}

export function professionalAgendaLockName(professionalId: string) {
  return `${AGENDA_LOCK_NAMESPACE}:professional:${professionalId}`
}

export async function acquireBusinessAgendaLock(
  tx: Prisma.TransactionClient,
  businessId: string
) {
  if (!businessId.trim()) throw new AgendaLockScopeError('businessId is required for agenda locking')
  await acquireTransactionLock(tx, businessAgendaLockName(businessId))
}

export async function acquireProfessionalAgendaLocks(
  tx: Prisma.TransactionClient,
  input: { businessId: string; professionalIds: readonly string[] }
) {
  const professionalIds = canonicalProfessionalIds(input.professionalIds)
  if (!professionalIds.length) return []

  const owned = await tx.professional.findMany({
    where: { businessId: input.businessId, id: { in: professionalIds } },
    select: { id: true }
  })
  if (owned.length !== professionalIds.length) {
    throw new AgendaLockScopeError('Every professional agenda lock must belong to the locked business')
  }

  for (const professionalId of professionalIds) {
    await acquireTransactionLock(tx, professionalAgendaLockName(professionalId))
  }
  return professionalIds
}

export async function acquireAgendaHierarchy(
  tx: Prisma.TransactionClient,
  input: { businessId: string; professionalIds?: readonly string[] }
) {
  await acquireBusinessAgendaLock(tx, input.businessId)
  const professionalIds = input.professionalIds === undefined
    ? await tx.professional.findMany({
        where: { businessId: input.businessId },
        select: { id: true },
        orderBy: { id: 'asc' }
      }).then((rows) => rows.map((row) => row.id))
    : input.professionalIds
  return acquireProfessionalAgendaLocks(tx, {
    businessId: input.businessId,
    professionalIds
  })
}

export async function lockAppointmentRows(
  tx: Prisma.TransactionClient,
  input: { businessId: string; appointmentIds: readonly string[] }
) {
  const appointmentIds = Array.from(new Set(input.appointmentIds.filter(Boolean))).sort()
  if (!appointmentIds.length) return []
  const rows = await tx.$queryRaw<Array<{ id: string; professionalId: string }>>(Prisma.sql`
    SELECT a."id", a."professionalId"
    FROM "Appointment" a
    INNER JOIN "Professional" p ON p."id" = a."professionalId"
    WHERE a."id" IN (${Prisma.join(appointmentIds)})
      AND p."businessId" = ${input.businessId}
    ORDER BY a."id"
    FOR UPDATE OF a
  `)
  if (rows.length !== appointmentIds.length) {
    throw new AgendaLockScopeError('Every target appointment must belong to the locked business')
  }
  return rows
}

export async function acquireAppointmentWriteHierarchy(
  tx: Prisma.TransactionClient,
  input: { businessId: string; appointmentIds: readonly string[] }
) {
  const ids = Array.from(new Set(input.appointmentIds.filter(Boolean))).sort()
  const candidates = await tx.appointment.findMany({
    where: {
      id: { in: ids },
      professional: { businessId: input.businessId }
    },
    select: { id: true, professionalId: true }
  })
  if (candidates.length !== ids.length) {
    throw new AgendaLockScopeError('Every appointment writer target must belong to one business')
  }
  await acquireAgendaHierarchy(tx, {
    businessId: input.businessId,
    professionalIds: candidates.map((item) => item.professionalId)
  })
  return lockAppointmentRows(tx, { businessId: input.businessId, appointmentIds: ids })
}

export async function lockScheduleBlockRows(
  tx: Prisma.TransactionClient,
  input: { businessId: string; scheduleBlockIds: readonly string[] }
) {
  const ids = Array.from(new Set(input.scheduleBlockIds.filter(Boolean))).sort()
  if (!ids.length) return []
  const rows = await tx.$queryRaw<Array<{ id: string; professionalId: string | null }>>(Prisma.sql`
    SELECT "id", "professionalId"
    FROM "ScheduleBlock"
    WHERE "id" IN (${Prisma.join(ids)})
      AND "businessId" = ${input.businessId}
    ORDER BY "id"
    FOR UPDATE
  `)
  if (rows.length !== ids.length) {
    throw new AgendaLockScopeError('Every target schedule block must belong to the locked business')
  }
  return rows
}

async function acquireTransactionLock(tx: Prisma.TransactionClient, lockName: string) {
  await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
  `)
}
