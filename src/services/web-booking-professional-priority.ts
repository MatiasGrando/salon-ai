import { Prisma } from '../generated/prisma/client.js'
import { localDateKey, localDateTimeToInstants } from '../bot-options/application/availability-queries.js'
import { assertIanaTimezone, CashDomainError } from './cash-domain.js'

type WorkloadClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }

// A civil date can start after 00:00 during a timezone transition. In a fold,
// use the earliest instant so the whole first date belongs to the window.
function startOfCivilDate(date: string, timezone: string): Date {
  for (let minute = 0; minute < 1440; minute++) {
    const first = localDateTimeToInstants(date, minute, timezone)[0]
    if (first) return first
  }
  throw new CashDomainError('WEB_BOOKING_DATE_BOUNDARY_UNAVAILABLE')
}

export function webBookingWorkloadWindow(now: Date, timezone: unknown) {
  const zone = assertIanaTimezone(timezone)
  return {
    from: startOfCivilDate(localDateKey(now, zone, -5), zone),
    to: startOfCivilDate(localDateKey(now, zone, 3), zone)
  }
}

export async function orderWebBookingProfessionals<T extends { id: string; name: string }>(
  client: WorkloadClient,
  business: { id: string; timezone: string | null; webBookingPrioritizeLeastBooked?: boolean },
  professionals: readonly T[],
  now = new Date(Date.now())
): Promise<readonly T[]> {
  // Preserve the existing database order, and do no extra work for existing businesses.
  if (business.webBookingPrioritizeLeastBooked !== true || professionals.length === 0) return professionals
  const { from, to } = webBookingWorkloadWindow(now, business.timezone)
  const counts = await client.$queryRaw<Array<{ professionalId: string; appointmentCount: number }>>(Prisma.sql`
    SELECT a."professionalId", count(*)::int AS "appointmentCount"
    FROM "Appointment" a
    JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${business.id}
    WHERE a."businessId" = ${business.id}
      AND a."professionalId" IN (${Prisma.join(professionals.map(professional => professional.id))})
      AND a."startAt" >= ${from} AND a."startAt" < ${to}
      AND (
        a."status" IN ('CONFIRMED'::"AppointmentStatus", 'COMPLETED'::"AppointmentStatus")
        OR (a."status" = 'PENDING'::"AppointmentStatus"
          AND NOT EXISTS (
            SELECT 1 FROM "BookingDeposit" d WHERE d."appointmentId" = a."id" AND d."businessId" = ${business.id}
              AND (d."status" = 'EXPIRED'::"BookingDepositStatus"
                OR (d."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND d."expiresAt" <= ${now}))
          )
          AND NOT EXISTS (
            SELECT 1 FROM "BookingVisit" held WHERE held."id" = a."visitId" AND held."businessId" = ${business.id}
              AND held."status" = 'HELD'::"BookingVisitStatus" AND held."holdExpiresAt" <= ${now}
          )
        )
      )
    GROUP BY a."professionalId"
  `)
  const byProfessional = new Map(counts.map(row => [row.professionalId, row.appointmentCount]))
  return [...professionals].sort((left, right) =>
    (byProfessional.get(left.id) ?? 0) - (byProfessional.get(right.id) ?? 0) ||
    left.name.localeCompare(right.name, 'es') || left.id.localeCompare(right.id, 'en'))
}
