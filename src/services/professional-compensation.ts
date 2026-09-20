import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'

export type ProfessionalCompensationRuleInput = { mode?: 'NONE' | 'PERCENTAGE' | 'FIXED' | null; percentage?: number | null; fixedAmount?: number | null }
export type ProfessionalCompensationRule = { mode: 'NONE' | 'PERCENTAGE' | 'FIXED'; percentage: number | null; fixedAmount: number | null }

export function normalizeProfessionalCompensationRule(input: ProfessionalCompensationRuleInput): ProfessionalCompensationRule {
  const mode = input.mode ?? 'NONE'
  if (!['NONE', 'PERCENTAGE', 'FIXED'].includes(mode)) throw new Error('El tipo de comisión es inválido')
  if (mode === 'PERCENTAGE') {
    const percentage = Number(input.percentage)
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error('El porcentaje debe estar entre 0 y 100')
    return { mode, percentage, fixedAmount: null }
  }
  if (mode === 'FIXED') {
    const fixedAmount = Number(input.fixedAmount)
    if (!Number.isSafeInteger(fixedAmount) || fixedAmount < 0) throw new Error('El monto fijo debe ser un entero mayor o igual a cero')
    return { mode, percentage: null, fixedAmount }
  }
  return { mode: 'NONE', percentage: null, fixedAmount: null }
}

export function calculateProfessionalCompensation(input: { baseAmount: number; rule: ProfessionalCompensationRule }) {
  const baseAmount = Math.max(0, Math.trunc(input.baseAmount))
  if (input.rule.mode === 'PERCENTAGE') return Math.round(baseAmount * (input.rule.percentage ?? 0) / 100)
  if (input.rule.mode === 'FIXED') return Math.max(0, input.rule.fixedAmount ?? 0)
  return 0
}

type CompensationSource = { businessId: string; appointmentId: string; professionalId: string; serviceId: string; serviceSubtotal: number | null; agreedAmount: number | null; quotedPrice: number | null; servicePrice: number | null; commissionMode: ProfessionalCompensationRule['mode']; commissionPercentage: Prisma.Decimal | number | null; commissionFixedAmount: number | null }

export async function ensureProfessionalEarningForCompletedAppointment(transaction: Prisma.TransactionClient, input: { businessId: string; appointmentId: string; actorUserId: string | null; actorName: string; effectiveAt?: Date }) {
  const rows = await transaction.$queryRaw<CompensationSource[]>(Prisma.sql`
    SELECT appointment."businessId", appointment."id" AS "appointmentId", appointment."professionalId", appointment."serviceId",
      product_sale."serviceSubtotal", account."agreedAmount", appointment."quotedPrice", service."price" AS "servicePrice",
      professional."commissionMode"::text AS "commissionMode", professional."commissionPercentage", professional."commissionFixedAmount"
    FROM "Appointment" appointment
    JOIN "Professional" professional ON professional."id" = appointment."professionalId"
    JOIN "Service" service ON service."id" = appointment."serviceId"
    LEFT JOIN "AppointmentAccountLink" link ON link."businessId" = appointment."businessId" AND link."appointmentId" = appointment."id"
    LEFT JOIN "AppointmentAccount" account ON account."businessId" = link."businessId" AND account."id" = link."accountId"
    LEFT JOIN "ProductSale" product_sale ON product_sale."businessId" = appointment."businessId" AND product_sale."appointmentId" = appointment."id"
    WHERE appointment."businessId" = ${input.businessId} AND appointment."id" = ${input.appointmentId}
      AND appointment."status" = 'COMPLETED'::"AppointmentStatus" LIMIT 1
  `)
  const source = rows[0]
  if (!source) return null
  const overrides = await transaction.$queryRaw<Array<{ commissionMode: ProfessionalCompensationRule['mode'] | null; commissionPercentage: Prisma.Decimal | number | null; commissionFixedAmount: number | null }>>(Prisma.sql`
    SELECT "commissionMode"::text AS "commissionMode", "commissionPercentage", "commissionFixedAmount"
    FROM "ProfessionalService" WHERE "professionalId" = ${source.professionalId} AND "serviceId" = ${source.serviceId} LIMIT 1
  `)
  const override = overrides[0]
  const rule = normalizeProfessionalCompensationRule({
    mode: override?.commissionMode ?? source.commissionMode,
    percentage: override?.commissionMode ? Number(override.commissionPercentage) : Number(source.commissionPercentage),
    fixedAmount: override?.commissionMode ? override.commissionFixedAmount : source.commissionFixedAmount
  })
  const baseAmount = source.serviceSubtotal ?? source.agreedAmount ?? source.quotedPrice ?? source.servicePrice ?? 0
  const amount = calculateProfessionalCompensation({ baseAmount, rule })
  const inserted = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "ProfessionalAccountEntry" ("id", "businessId", "professionalId", "appointmentId", "type", "direction", "amount", "baseAmount", "ruleMode", "rulePercentage", "ruleFixedAmount", "description", "actorUserId", "actorName", "effectiveAt")
    VALUES (${randomUUID()}, ${input.businessId}, ${source.professionalId}, ${source.appointmentId}, 'EARNING'::"ProfessionalAccountEntryType", 'CREDIT'::"ProfessionalAccountDirection", ${amount}, ${baseAmount}, ${rule.mode}::"ProfessionalCompensationMode", ${rule.percentage}, ${rule.fixedAmount}, ${rule.mode === 'NONE' ? 'Servicio realizado sin liquidación' : 'Servicio realizado'}, ${input.actorUserId}, ${input.actorName}, ${input.effectiveAt ?? new Date()})
    ON CONFLICT ("businessId", "appointmentId") DO NOTHING RETURNING "id"
  `)
  return inserted[0] ?? null
}
