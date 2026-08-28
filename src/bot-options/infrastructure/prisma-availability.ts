import { Prisma } from '../../generated/prisma/client.js'
import {
  BOOKING_GRID_MINUTES, bandForMinute, chooseBalancedProfessional, localDateKey,
  localDateTimeToInstants, parseMinutes, validateAvailabilitySettings, weekdayInTimezone,
  type AvailabilityProfessional, type AvailabilitySettings, type AvailabilitySlot
} from '../application/availability-queries.js'

type AvailabilityClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }
type HoursRow = { ownerId: string; dayOfWeek: number; startTime: string; endTime: string }
type BusyRow = { professionalId: string; startAt: Date; duration: number }
type BlockRow = { professionalId: string | null; startAt: Date; endAt: Date }

export class PrismaAvailabilityRepository {
  constructor(private readonly client: AvailabilityClient) {}

  async loadSettings(businessId: string): Promise<AvailabilitySettings> {
    const rows = await this.client.$queryRaw<Array<{
      timezone: string; bookingHorizonDays: number; bookingLeadTimeHours: number; morningCutTime: string; eveningCutTime: string
    }>>(Prisma.sql`
      SELECT "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime"
      FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}
    `)
    const row = rows[0]
    if (!row) throw new Error('bot availability settings unavailable for tenant')
    return validateAvailabilitySettings({
      timezone: row.timezone, horizonDays: row.bookingHorizonDays, leadTimeHours: row.bookingLeadTimeHours,
      morningCutTime: row.morningCutTime, eveningCutTime: row.eveningCutTime
    })
  }

  async compatibleProfessionals(input: { businessId: string; serviceIds: readonly string[] }): Promise<AvailabilityProfessional[]> {
    const ids = [...new Set(input.serviceIds)]
    if (!ids.length) return []
    return this.client.$queryRaw<AvailabilityProfessional[]>(Prisma.sql`
      SELECT p."id", p."name", p."botBookingPriority" AS "priority"
      FROM "Professional" p JOIN "ProfessionalService" ps ON ps."professionalId" = p."id"
      JOIN "Service" s ON s."id" = ps."serviceId" AND s."businessId" = p."businessId"
      WHERE p."businessId" = ${input.businessId} AND p."isActive" = true AND p."acceptsBotBookings" = true
        AND s."id" IN (${Prisma.join(ids)}) AND s."isBookable" = true
      GROUP BY p."id", p."name", p."botBookingPriority"
      HAVING count(DISTINCT s."id") = ${ids.length}
      ORDER BY p."botBookingPriority", p."id"
    `)
  }

  async search(input: {
    businessId: string; serviceIds: readonly string[]; durationMinutes: number; dbNow: Date
    settings: AvailabilitySettings; professionalId?: string | null
  }): Promise<{ professionals: AvailabilityProfessional[]; slots: AvailabilitySlot[] }> {
    const allProfessionals = await this.compatibleProfessionals(input)
    const professionals = input.professionalId ? allProfessionals.filter((item) => item.id === input.professionalId) : allProfessionals
    if (!professionals.length) return { professionals, slots: [] }
    const professionalIds = professionals.map((item) => item.id)
    const firstDate = localDateKey(input.dbNow, input.settings.timezone, 0)
    const lastDate = localDateKey(input.dbNow, input.settings.timezone, input.settings.horizonDays)
    const from = localDateTimeToInstants(firstDate, 0, input.settings.timezone)[0]
    const to = localDateTimeToInstants(lastDate, 0, input.settings.timezone)[0]
    if (!from || !to) throw new Error('availability horizon cannot be represented in tenant timezone')
    const [businessHours, professionalHours, blocks, busy] = await Promise.all([
      this.client.$queryRaw<HoursRow[]>(Prisma.sql`SELECT "businessId" AS "ownerId", "dayOfWeek", "startTime", "endTime" FROM "BusinessHours" WHERE "businessId" = ${input.businessId}`),
      this.client.$queryRaw<HoursRow[]>(Prisma.sql`SELECT "professionalId" AS "ownerId", "dayOfWeek", "startTime", "endTime" FROM "ProfessionalHours" WHERE "professionalId" IN (${Prisma.join(professionalIds)})`),
      this.client.$queryRaw<BlockRow[]>(Prisma.sql`SELECT "professionalId", "startAt", "endAt" FROM "ScheduleBlock" WHERE "businessId" = ${input.businessId} AND "startAt" < ${to} AND "endAt" > ${from} AND ("professionalId" IS NULL OR "professionalId" IN (${Prisma.join(professionalIds)}))`),
      this.client.$queryRaw<BusyRow[]>(Prisma.sql`
        SELECT a."professionalId", a."startAt", a."totalDurationMinutes" AS "duration"
        FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${input.businessId}
        LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
        WHERE a."professionalId" IN (${Prisma.join(professionalIds)}) AND a."startAt" < ${to}
          AND a."startAt" + make_interval(mins => a."totalDurationMinutes") > ${from}
          AND a."status" IN ('CONFIRMED'::"AppointmentStatus", 'PENDING'::"AppointmentStatus")
          AND NOT (a."status" = 'PENDING'::"AppointmentStatus" AND d."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND d."expiresAt" <= ${input.dbNow})
      `)
    ])
    const leadInstant = input.dbNow.getTime() + input.settings.leadTimeHours * 3_600_000
    const perStart = new Map<string, Array<{ professional: AvailabilityProfessional; occupiedMinutes: number; date: string; time: string; instant: Date; minute: number }>>()
    for (let offset = 0; offset < input.settings.horizonDays; offset += 1) {
      const date = localDateKey(input.dbNow, input.settings.timezone, offset)
      const noon = localDateTimeToInstants(date, 12 * 60, input.settings.timezone)[0]
      if (!noon) continue
      const weekday = weekdayInTimezone(noon, input.settings.timezone)
      const businessWindows = businessHours.filter((row) => row.dayOfWeek === weekday)
      for (const professional of professionals) {
        const proWindows = professionalHours.filter((row) => row.ownerId === professional.id && row.dayOfWeek === weekday)
        const dayBusy = busy.filter((row) => row.professionalId === professional.id && localDateKey(row.startAt, input.settings.timezone) === date)
        const occupiedMinutes = dayBusy.reduce((sum, row) => sum + row.duration, 0)
        for (const businessWindow of businessWindows) for (const proWindow of proWindows) {
          const start = Math.max(parseMinutes(businessWindow.startTime) ?? 1440, parseMinutes(proWindow.startTime) ?? 1440)
          const end = Math.min(parseMinutes(businessWindow.endTime) ?? 0, parseMinutes(proWindow.endTime) ?? 0)
          for (let minute = Math.ceil(start / BOOKING_GRID_MINUTES) * BOOKING_GRID_MINUTES; minute + input.durationMinutes <= end; minute += BOOKING_GRID_MINUTES) {
            for (const instant of localDateTimeToInstants(date, minute, input.settings.timezone)) {
              const finish = new Date(instant.getTime() + input.durationMinutes * 60_000)
              if (instant.getTime() < leadInstant) continue
              if (blocks.some((block) => (block.professionalId === null || block.professionalId === professional.id) && block.startAt < finish && block.endAt > instant)) continue
              if (dayBusy.some((row) => row.startAt < finish && new Date(row.startAt.getTime() + row.duration * 60_000) > instant)) continue
              const key = instant.toISOString()
              const candidates = perStart.get(key) ?? []
              candidates.push({ professional, occupiedMinutes, date, time: `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`, instant, minute })
              perStart.set(key, candidates)
            }
          }
        }
      }
    }
    const slots = [...perStart.values()].flatMap((candidates) => {
      const chosen = chooseBalancedProfessional(candidates)
      const source = chosen && candidates.find((item) => item.professional.id === chosen.professional.id)
      return source ? [{
        startAt: source.instant.toISOString(), date: source.date, time: source.time,
        band: bandForMinute(source.minute, input.settings), professionalId: source.professional.id,
        professionalName: source.professional.name, occupiedMinutes: source.occupiedMinutes
      } satisfies AvailabilitySlot] : []
    }).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.professionalId.localeCompare(b.professionalId))
    return { professionals, slots }
  }
}
