import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'

export type AppointmentMutationRequestRecord = {
  businessId: string
  requestId: string
  operation: 'CREATE' | 'PAYMENT'
  appointmentId: string
  actorUserId: string
  requestFingerprint: string
  result: unknown
}

export class AppointmentMutationRequestError extends Error {
  constructor(public readonly code: 'APPOINTMENT_REQUEST_INVALID' | 'APPOINTMENT_REQUEST_CONFLICT') {
    super(code)
    this.name = 'AppointmentMutationRequestError'
  }
}

export function normalizeAppointmentRequestId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AppointmentMutationRequestError('APPOINTMENT_REQUEST_INVALID')
  }
  return value.trim()
}

/** Stable object key ordering; array order remains part of the submitted intent. */
export function appointmentRequestFingerprint(value: unknown): string {
  const canonical = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonical)
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate).filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
    }
    return candidate
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function assertAppointmentMutationReplay(record: AppointmentMutationRequestRecord, intent: {
  operation: 'CREATE' | 'PAYMENT'; actorUserId: string; requestFingerprint: string; appointmentId?: string
}): void {
  if (record.operation !== intent.operation || record.actorUserId !== intent.actorUserId ||
      record.requestFingerprint !== intent.requestFingerprint ||
      (intent.appointmentId !== undefined && record.appointmentId !== intent.appointmentId)) {
    throw new AppointmentMutationRequestError('APPOINTMENT_REQUEST_CONFLICT')
  }
}

export async function lockAppointmentMutationRequest(tx: Prisma.TransactionClient, businessId: string, requestId: string): Promise<void> {
  // The same key lock is always first, before Agenda/Caja resource locks.
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${'appointment-mutation:' + businessId + ':' + requestId}, 0))
  `)
}

export async function findAppointmentMutationRequest(tx: Prisma.TransactionClient, businessId: string, requestId: string) {
  const rows = await tx.$queryRaw<AppointmentMutationRequestRecord[]>(Prisma.sql`
    SELECT "businessId", "requestId", operation, "appointmentId", "actorUserId", "requestFingerprint", result
    FROM "AppointmentMutationRequest" WHERE "businessId" = ${businessId} AND "requestId" = ${requestId}
  `)
  return rows[0] ?? null
}

export async function createAppointmentMutationRequest(tx: Prisma.TransactionClient, record: AppointmentMutationRequestRecord): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "AppointmentMutationRequest" ("businessId", "requestId", operation, "appointmentId", "actorUserId", "requestFingerprint", result)
    VALUES (${record.businessId}, ${record.requestId}, ${record.operation}, ${record.appointmentId},
      ${record.actorUserId}, ${record.requestFingerprint}, ${JSON.stringify(record.result)}::jsonb)
  `)
}

export type AppointmentMutationActorInput = {
  businessId: string; actorUserId: string; professionalId?: string; appointmentId?: string
  operation: 'CREATE' | 'PAYMENT'; requirePayment?: boolean; requireDiscount?: boolean; completeAppointment?: boolean
  authorizedBusinessIdOverride?: string
}

/** Re-read current permissions under resource locks, including retries after revocation. */
export async function authorizeAppointmentMutationActor(tx: Prisma.TransactionClient, input: AppointmentMutationActorInput): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ authorized: boolean }>>(Prisma.sql`
    SELECT true AS authorized FROM "User" actor JOIN "Business" business ON business.id = ${input.businessId}
    WHERE actor.id = ${input.actorUserId} AND actor."isActive" = true
      AND (actor.role = 'SUPER_ADMIN' OR (actor.role = 'ACCOUNT_ADMIN' AND business."accountAdminId" = actor.id)
        OR (actor.role IN ('BUSINESS_ADMIN', 'STAFF') AND actor."businessId" = business.id)
        OR (${input.authorizedBusinessIdOverride ?? null}::text = business.id AND actor.role IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'BUSINESS_ADMIN')))
      AND (actor.role IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'BUSINESS_ADMIN') OR (actor.role = 'STAFF'
        AND (${input.operation !== 'CREATE'} OR actor."canCreateAppointments" = true)
        AND (${input.operation !== 'PAYMENT' && input.requirePayment !== true} OR actor."canRecordAppointmentPayments" = true)
        AND (${input.requireDiscount !== true} OR actor."canApplyDiscounts" = true)
        AND (${input.completeAppointment !== true} OR actor."canCompleteAppointments" = true)
        AND (actor."agendaScope" = 'ALL' OR actor."professionalId" = COALESCE(${input.professionalId ?? null}::text,
          (SELECT "professionalId" FROM "Appointment" WHERE "businessId" = business.id AND id = ${input.appointmentId ?? null}))))
      )
    FOR SHARE OF actor
  `)
  return rows.length === 1
}
