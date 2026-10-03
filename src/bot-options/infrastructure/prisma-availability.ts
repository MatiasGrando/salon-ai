import { explainAvailabilityDay, type AvailabilityRejections, type AvailabilitySearchEvidence } from '../application/availability-evidence.js'
import { reservationFitsAvailabilityWindow } from '../../services/service-duration.js'
import { measureAttemptStage } from '../observability/attempt-metrics.js'
import { Prisma } from '../../generated/prisma/client.js'
import {
  BOOKING_GRID_MINUTES, bandForMinute, chooseBalancedProfessional, localDateKey,
  localDateTimeToInstants, parseMinutes, validateAvailabilitySettings, weekdayInTimezone,
  type AvailabilityProfessional, type AvailabilitySettings, type AvailabilitySlot
} from '../application/availability-queries.js'

type AvailabilityClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }
type SettingsRow = {
  timezone: string; bookingHorizonDays: number; bookingLeadTimeHours: number; morningCutTime: string; eveningCutTime: string
}
function settingsFromRow(row: SettingsRow | undefined): AvailabilitySettings {
  if (!row) throw new Error('bot availability settings unavailable for tenant')
  return validateAvailabilitySettings({
    timezone: row.timezone, horizonDays: row.bookingHorizonDays, leadTimeHours: row.bookingLeadTimeHours,
    morningCutTime: row.morningCutTime, eveningCutTime: row.eveningCutTime
  })
}
type HoursRow = { ownerId: string; dayOfWeek: number; startTime: string; endTime: string }
type BusyRow = { professionalId: string; startAt: Date; duration: number }
type BlockRow = { professionalId: string | null; startAt: Date; endAt: Date }

export class PrismaAvailabilityRepository {
  private readonly verifiedEligibility = new WeakMap<readonly AvailabilityProfessional[], { scope: string; signature: string }>()
  private eligibilityScope(input: { businessId: string; serviceIds: readonly string[] }): string { return JSON.stringify([input.businessId, [...new Set(input.serviceIds)].sort()]) }
  constructor(private readonly client: AvailabilityClient) {}

  async loadSettings(businessId: string): Promise<AvailabilitySettings> {
    return measureAttemptStage('availability_settings', async () => {
      const rows = await this.client.$queryRaw<SettingsRow[]>(Prisma.sql`
        SELECT "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime"
        FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}
      `)
      return settingsFromRow(rows[0])
    })
  }

  /** A single tenant-scoped snapshot supplies validated settings and the database clock. */
  async loadSettingsWithClock(businessId: string): Promise<{ settings: AvailabilitySettings; dbNow: Date }> {
    return measureAttemptStage('availability_settings', async () => {
      const rows = await this.client.$queryRaw<Array<SettingsRow & { now: Date }>>(Prisma.sql`
        SELECT "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime",
          CURRENT_TIMESTAMP AS now
        FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}
      `)
      const row = rows[0]
      const settings = settingsFromRow(row)
      const dbNow = row?.now
      if (!(dbNow instanceof Date) || !Number.isFinite(dbNow.getTime())) throw new Error('database clock unavailable')
      return { settings, dbNow }
    })
  }

  async compatibleProfessionals(input: { businessId: string; serviceIds: readonly string[] }): Promise<AvailabilityProfessional[]> {
    return measureAttemptStage('availability_compatible_professionals', async () => {
      const ids = [...new Set(input.serviceIds)]
      if (!ids.length) return []
      const professionals = await this.client.$queryRaw<AvailabilityProfessional[]>(Prisma.sql`
        SELECT p."id", p."name", p."botBookingPriority" AS "priority"
        FROM "Professional" p JOIN "ProfessionalService" ps ON ps."professionalId" = p."id"
        JOIN "Service" s ON s."id" = ps."serviceId" AND s."businessId" = p."businessId"
        WHERE p."businessId" = ${input.businessId} AND p."isActive" = true AND p."acceptsBotBookings" = true
          AND s."id" IN (${Prisma.join(ids)}) AND s."isBookable" = true
        GROUP BY p."id", p."name", p."botBookingPriority"
        HAVING count(DISTINCT s."id") = ${ids.length}
        ORDER BY p."botBookingPriority", p."id"
      `)
      this.verifiedEligibility.set(professionals, { scope: this.eligibilityScope(input), signature: JSON.stringify(professionals) })
      return professionals
    })
  }

  async search(input: {
    businessId: string; serviceIds: readonly string[]; durationMinutes: number; dbNow: Date
    settings: AvailabilitySettings; professionalId?: string | null
    /** Optional customer occupancy; legacy callers keep the professional interval. */
    customerDurationMinutes?: number
    /** Reprogramación: el turno que se moverá no ocupa su propio nuevo slot. */
    excludeAppointmentId?: string
    /** Default legacy balance stays unchanged; conversational callers preserve verified alternatives. */
    allocation?: 'balanced' | 'all'
    diagnostics?: boolean
  }, verifiedProfessionals?: readonly AvailabilityProfessional[]): Promise<{ professionals: AvailabilityProfessional[]; slots: AvailabilitySlot[]; evidence?: AvailabilitySearchEvidence }> {
    return measureAttemptStage('availability_search', async () => {
      if (input.customerDurationMinutes !== undefined && (!Number.isSafeInteger(input.customerDurationMinutes) || input.customerDurationMinutes <= 0 || input.customerDurationMinutes > 1440)) throw new Error('invalid availability customer duration')
      const customerDurationMinutes = Math.max(input.durationMinutes, input.customerDurationMinutes ?? input.durationMinutes)
      const proof = verifiedProfessionals ? this.verifiedEligibility.get(verifiedProfessionals) : undefined
      if (verifiedProfessionals && (proof?.scope !== this.eligibilityScope(input) || proof.signature !== JSON.stringify(verifiedProfessionals))) throw new Error('invalid verified eligibility scope')
      const allProfessionals = verifiedProfessionals ? [...verifiedProfessionals] : await this.compatibleProfessionals(input)
      if (verifiedProfessionals && (allProfessionals.length > 50 || new Set(allProfessionals.map(pro => pro.id)).size !== allProfessionals.length || allProfessionals.some(pro => !pro.id || pro.id.length > 128 || !pro.name || pro.name.length > 200 || !Number.isSafeInteger(pro.priority)))) throw new Error('invalid verified professionals')
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
            AND (${input.excludeAppointmentId ?? null}::text IS NULL OR a."id" <> ${input.excludeAppointmentId ?? null})
            AND NOT (a."status" = 'PENDING'::"AppointmentStatus" AND d."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND d."expiresAt" <= ${input.dbNow})
        `)
      ])
      const leadInstant = input.dbNow.getTime() + input.settings.leadTimeHours * 3_600_000
      const perStart = new Map<string, Array<{ professional: AvailabilityProfessional; occupiedMinutes: number; date: string; time: string; instant: Date; minute: number }>>()
      const days: AvailabilitySearchEvidence['days'] = []
      for (let offset = 0; offset < input.settings.horizonDays; offset += 1) {
        const date = localDateKey(input.dbNow, input.settings.timezone, offset)
        const noon = localDateTimeToInstants(date, 12 * 60, input.settings.timezone)[0]
        if (!noon) continue
        const weekday = weekdayInTimezone(noon, input.settings.timezone)
        const businessWindows = businessHours.filter((row) => row.dayOfWeek === weekday)
        const evidenceRows: AvailabilityRejections[] = []
        for (const professional of professionals) {
          const proWindows = professionalHours.filter((row) => row.ownerId === professional.id && row.dayOfWeek === weekday)
          const dayBusy = busy.filter((row) => row.professionalId === professional.id && localDateKey(row.startAt, input.settings.timezone) === date)
          const occupiedMinutes = dayBusy.reduce((sum, row) => sum + row.duration, 0)
          const evidence: AvailabilityRejections = { professionalId: professional.id, hasWorkingHours: proWindows.length > 0, hasJointWindow: false, intervalCount: 0, leadTime: 0, blocked: 0, busy: 0, slotCount: 0 }
          const accepted = new Set<string>()
          for (const businessWindow of businessWindows) for (const proWindow of proWindows) {
            const start = Math.max(parseMinutes(businessWindow.startTime) ?? 1440, parseMinutes(proWindow.startTime) ?? 1440)
            const businessEnd = parseMinutes(businessWindow.endTime) ?? 0
            const professionalEnd = parseMinutes(proWindow.endTime) ?? 0
            if (start < Math.min(businessEnd, professionalEnd)) evidence.hasJointWindow = true
            for (let minute = Math.ceil(start / BOOKING_GRID_MINUTES) * BOOKING_GRID_MINUTES;
              reservationFitsAvailabilityWindow({
                service: { duration: input.durationMinutes, customerDurationMin: customerDurationMinutes, customerDurationMax: customerDurationMinutes },
                startMinutes: minute, professionalEndMinutes: professionalEnd, businessEndMinutes: businessEnd
              }); minute += BOOKING_GRID_MINUTES) {
              for (const instant of localDateTimeToInstants(date, minute, input.settings.timezone)) {
                const finish = new Date(instant.getTime() + input.durationMinutes * 60_000)
                const customerFinish = new Date(instant.getTime() + customerDurationMinutes * 60_000)
                evidence.intervalCount++
                if (instant.getTime() < leadInstant) { evidence.leadTime++; continue }
                if (blocks.some((block) => (block.professionalId === null || block.professionalId === professional.id) && block.startAt < (block.professionalId === null ? customerFinish : finish) && block.endAt > instant)) { evidence.blocked++; continue }
                if (dayBusy.some((row) => row.startAt < finish && new Date(row.startAt.getTime() + row.duration * 60_000) > instant)) { evidence.busy++; continue }
                const key = instant.toISOString()
                accepted.add(key)
                const candidates = perStart.get(key) ?? []
                candidates.push({ professional, occupiedMinutes, date, time: `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`, instant, minute })
                perStart.set(key, candidates)
              }
            }
          }
          evidence.slotCount = accepted.size
          evidenceRows.push(evidence)
        }
        if (input.diagnostics) days.push(explainAvailabilityDay(date, businessWindows.length > 0, evidenceRows))
      }
      const slots = [...perStart.values()].flatMap((candidates) => {
        if (input.allocation === 'all') return [...new Map(candidates.map(source => [source.professional.id, source])).values()].map(source => ({
          startAt: source.instant.toISOString(), date: source.date, time: source.time, band: bandForMinute(source.minute, input.settings),
          professionalId: source.professional.id, professionalName: source.professional.name, occupiedMinutes: source.occupiedMinutes
        } satisfies AvailabilitySlot))
        const chosen = chooseBalancedProfessional(candidates)
        const source = chosen && candidates.find((item) => item.professional.id === chosen.professional.id)
        return source ? [{
          startAt: source.instant.toISOString(), date: source.date, time: source.time,
          band: bandForMinute(source.minute, input.settings), professionalId: source.professional.id,
          professionalName: source.professional.name, occupiedMinutes: source.occupiedMinutes
        } satisfies AvailabilitySlot] : []
      }).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.professionalId.localeCompare(b.professionalId))
      return { professionals, slots, ...(input.diagnostics ? { evidence: { version: 1 as const, days } } : {}) }
    })
  }
}
