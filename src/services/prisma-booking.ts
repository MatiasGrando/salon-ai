import { Prisma } from '../generated/prisma/client.js'
import { insidePublishedProfessionalHours } from './weekly-availability.js'

export type BookingRepositoryClient = Prisma.TransactionClient

export function createAppointmentRecord<T extends Prisma.AppointmentCreateArgs>(
  tx: BookingRepositoryClient,
  args: Prisma.SelectSubset<T, Prisma.AppointmentCreateArgs>
) {
  return tx.appointment.create<T>(args)
}

export function updateAppointmentRecord(
  tx: BookingRepositoryClient,
  args: Prisma.AppointmentUpdateArgs
) {
  return tx.appointment.update(args)
}

export async function professionalOffersServices(
  tx: BookingRepositoryClient,
  professionalId: string,
  serviceIds: readonly string[]
) {
  const count = await tx.professionalService.count({
    where: { professionalId, serviceId: { in: [...serviceIds] } }
  })
  return count === serviceIds.length
}

export async function isInsideBusinessHours(tx: BookingRepositoryClient, input: {
  businessId: string
  startAt: Date
  endAt: Date
  timezone?: string
}) {
  const interval = localInterval(input.startAt, input.endAt, input.timezone)
  if (!interval) return false
  const hours = await tx.businessHours.findMany({
    where: { businessId: input.businessId, dayOfWeek: interval.weekday }
  })
  return containsMinuteInterval(hours, interval.startMinute, interval.endMinute)
}

export async function isInsideProfessionalHours(tx: BookingRepositoryClient, input: {
  professionalId: string
  startAt: Date
  endAt: Date
  timezone?: string
}) {
  const published = await insidePublishedProfessionalHours(tx, input)
  if (published !== null) return published
  const interval = localInterval(input.startAt, input.endAt, input.timezone)
  if (!interval) return false
  const hours = await tx.professionalHours.findMany({
    where: { professionalId: input.professionalId, dayOfWeek: interval.weekday }
  })
  return containsMinuteInterval(hours, interval.startMinute, interval.endMinute)
}

export async function hasScheduleBlockOverlap(tx: BookingRepositoryClient, input: {
  businessId: string
  professionalId: string
  startAt: Date
  endAt: Date
}) {
  return (await tx.scheduleBlock.findFirst({
    where: {
      businessId: input.businessId,
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
      OR: [{ professionalId: input.professionalId }, { professionalId: null }]
    },
    select: { id: true }
  })) !== null
}

type AppointmentOverlapInput = {
  professionalId: string
  startAt: Date
  endAt: Date
  excludeAppointmentId?: string
  excludeAppointmentIds?: readonly string[]
  overlapPolicy?: 'appointment-edit'
  dbNow?: Date
}

export async function hasAppointmentOverlap(tx: BookingRepositoryClient, input: AppointmentOverlapInput) {
  const rows = await tx.$queryRaw<Array<{ overlaps: boolean }>>(Prisma.sql`
    SELECT ${appointmentOverlapExpression(input)} AS "overlaps"
  `)
  return rows[0]?.overlaps === true
}

function appointmentOverlapExpression(input: AppointmentOverlapInput) {
  const excludedIds = [...new Set([...(input.excludeAppointmentIds ?? []), ...(input.excludeAppointmentId ? [input.excludeAppointmentId] : [])])]
  const excluded = input.excludeAppointmentIds?.length
    ? Prisma.sql`AND a."id" NOT IN (${Prisma.join(excludedIds)})`
    : input.excludeAppointmentId ? Prisma.sql`AND a."id" <> ${input.excludeAppointmentId}` : Prisma.empty
  const now = input.dbNow ? Prisma.sql`${input.dbNow}` : Prisma.sql`clock_timestamp()`
  // An edit retains the CRM's existing conflicts with completed turns and held visits.
  const isAppointmentEdit = input.overlapPolicy === 'appointment-edit'
  const completedOverlap = isAppointmentEdit
    ? Prisma.sql`OR a."status" = 'COMPLETED'::"AppointmentStatus"`
    : Prisma.empty
  const activeHold = isAppointmentEdit ? Prisma.empty : Prisma.sql`
    AND NOT EXISTS (SELECT 1 FROM "BookingVisit" held WHERE held.id=a."visitId" AND held."businessId"=a."businessId" AND held.status='HELD'::"BookingVisitStatus" AND held."holdExpiresAt"<=${now})
  `
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "Appointment" a
      LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
      WHERE a."professionalId" = ${input.professionalId}
        ${excluded}
        AND a."startAt" < ${input.endAt}
        AND a."startAt" + make_interval(mins => a."totalDurationMinutes") > ${input.startAt}
        AND (
          a."status" = 'CONFIRMED'::"AppointmentStatus"
          ${completedOverlap}
          OR (
            a."status" = 'PENDING'::"AppointmentStatus"
            AND NOT COALESCE((
              d."status" = 'PENDING_PROOF'::"BookingDepositStatus"
              AND d."expiresAt" <= ${now}
            ), false)
            ${activeHold}
          )
        )
    )
  `
}

type HoursInterval = { startTime: string; endTime: string }

export async function readManualBookingAvailability(tx: BookingRepositoryClient, input: {
  businessId: string
  professionalId: string
  serviceIds: readonly string[]
  availabilityMode: string
  startAt: Date
  professionalEndAt: Date
  customerEndAt: Date
}) {
  const businessInterval = localInterval(input.startAt, input.customerEndAt)
  const professionalInterval = localInterval(input.startAt, input.professionalEndAt)
  const usesPublishedHours = input.availabilityMode === 'MANUAL'
  const [row] = await tx.$queryRaw<Array<{
    offersServices: boolean
    businessHours: HoursInterval[]
    professionalHours: HoursInterval[]
    scheduleBlock: boolean
    overlaps: boolean
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) = ${input.serviceIds.length} FROM "ProfessionalService"
        WHERE "professionalId" = ${input.professionalId} AND "serviceId" IN (${Prisma.join(input.serviceIds)})) AS "offersServices",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime', "startTime", 'endTime', "endTime"))
        FROM "BusinessHours" WHERE "businessId" = ${input.businessId}
          AND "dayOfWeek" = ${businessInterval?.weekday ?? null}::integer), '[]'::jsonb) AS "businessHours",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime', "startTime", 'endTime', "endTime"))
        FROM "ProfessionalHours" WHERE "professionalId" = ${input.professionalId}
          AND "dayOfWeek" = ${!usesPublishedHours ? professionalInterval?.weekday ?? null : null}::integer), '[]'::jsonb) AS "professionalHours",
      EXISTS (SELECT 1 FROM "ScheduleBlock" WHERE "businessId" = ${input.businessId}
        AND ("professionalId" = ${input.professionalId} OR "professionalId" IS NULL)
        AND "startAt" < ${input.professionalEndAt} AND "endAt" > ${input.startAt}) AS "scheduleBlock",
      ${appointmentOverlapExpression({
        professionalId: input.professionalId,
        startAt: input.startAt,
        endAt: input.professionalEndAt,
        overlapPolicy: 'appointment-edit'
      })} AS "overlaps"
  `)
  if (!row) throw new Error('Could not read booking availability')
  const insideProfessionalHours = usesPublishedHours
    ? await insidePublishedProfessionalHours(tx, { ...input, endAt: input.professionalEndAt })
    : null
  return {
    offersServices: row.offersServices,
    insideBusinessHours: Boolean(businessInterval &&
      containsMinuteInterval(row.businessHours, businessInterval.startMinute, businessInterval.endMinute)),
    insideProfessionalHours: insideProfessionalHours ?? Boolean(professionalInterval &&
      containsMinuteInterval(row.professionalHours, professionalInterval.startMinute, professionalInterval.endMinute)),
    scheduleBlock: row.scheduleBlock,
    appointmentOverlap: row.overlaps
  }
}

function containsMinuteInterval(
  hours: HoursInterval[],
  start: number,
  end: number
) {
  return hours.some((item) => start >= parseTime(item.startTime) && end <= parseTime(item.endTime))
}

function localInterval(startAt: Date, endAt: Date, timezone?: string) {
  if (!timezone) {
    if (startAt.toDateString() !== endAt.toDateString()) return null
    return {
      weekday: startAt.getDay(),
      startMinute: startAt.getHours() * 60 + startAt.getMinutes(),
      endMinute: endAt.getHours() * 60 + endAt.getMinutes()
    }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, hourCycle: 'h23'
  })
  const decompose = (value: Date) => {
    const parts = formatter.formatToParts(value)
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'))
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      weekday,
      minute: (Number(part('hour')) % 24) * 60 + Number(part('minute'))
    }
  }
  const start = decompose(startAt)
  const end = decompose(endAt)
  if (start.weekday < 0 || start.date !== end.date) return null
  return { weekday: start.weekday, startMinute: start.minute, endMinute: end.minute }
}

function parseTime(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}
