/**
 * F5.6 — Adaptador Prisma para consultas tenant-scoped de horarios del negocio.
 *
 * Lee BusinessHours y ScheduleBlock (excepciones operativas nivel negocio)
 * para alimentar el read model informativo de horas.
 *
 * NO crea draft, NO consulta appointments, NO revela agenda profesional.
 */

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import {
  computeExceptionWindow,
  type BusinessOperationalException,
  type BusinessWeeklyHourRow
} from '../application/hours-queries.js'

type HoursClient = Pick<PrismaClient, 'businessHours' | 'scheduleBlock' | 'business'> | Prisma.TransactionClient

const businessHoursSelect = {
  dayOfWeek: true,
  startTime: true,
  endTime: true
} as const

const scheduleBlockSelect = {
  startAt: true,
  endAt: true,
  reason: true,
  title: true,
  note: true,
  professionalId: true
} as const

export class PrismaHoursRepository {
  readonly #client: HoursClient

  constructor(client: HoursClient) {
    this.#client = client
  }

  /**
   * Carga los horarios regulares del negocio (BusinessHours).
   * Tenant-scoped: filtra por businessId.
   */
  async loadBusinessWeeklyHours(input: {
    businessId: string
  }): Promise<readonly BusinessWeeklyHourRow[]> {
    const rows = await this.#client.businessHours.findMany({
      where: { businessId: input.businessId },
      select: businessHoursSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })
    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime
    }))
  }

  /**
   * Carga las excepciones operativas a nivel negocio (ScheduleBlock sin profesional).
   * Tenant-scoped: filtra por businessId y professionalId = NULL.
   * Ventana: dbNow → +30 días (truncado a inicio del día en timezone del negocio).
   */
  async loadBusinessOperationalExceptions(input: {
    businessId: string
    dbNow: Date
    timezone: string
  }): Promise<readonly BusinessOperationalException[]> {
    const { from, to } = computeExceptionWindow(input.dbNow, input.timezone)

    const rows = await this.#client.scheduleBlock.findMany({
      where: {
        businessId: input.businessId,
        professionalId: null,
        startAt: { lt: to },
        endAt: { gt: from }
      },
      select: scheduleBlockSelect,
      orderBy: { startAt: 'asc' }
    })

    return rows.map((row) => ({
      startAt: row.startAt,
      endAt: row.endAt,
      reason: row.reason,
      title: row.title,
      note: row.note
    }))
  }

  // NOTA: La timezone del negocio se lee de BotSession.businessTimezone
  // (columna persistida en la sesión). NO existe un campo timezone en el modelo
  // Business. El context provider la extrae de la sesión y la pasa a este repository.
}
