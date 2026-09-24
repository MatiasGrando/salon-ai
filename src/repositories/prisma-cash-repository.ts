import { Prisma } from '../generated/prisma/client.js'
import { ensureProfessionalEarningForCompletedAppointment } from '../services/professional-compensation.js'

export type CashBusinessContext = {
  businessId: string
  timezone: string | null
  dbNow: Date
}

export type CashResponsible = {
  id: string
  name: string
}

export type AppointmentCompletionRecord = {
  appointmentId: string
  previousStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
  status: 'COMPLETED'
  completedAt: Date
  completedByUserId: string | null
  completedByName: string
  completionSource: 'FULL_PAYMENT'
}

export type CashRegisterDayRecord = {
  id: string
  businessId: string
  openedAt: Date
  closedAt: Date | null
  openingCash: number
  expectedClosingCash: number | null
  countedClosingCash: number | null
  closingDifference: number | null
}

export type CashSessionRecord = {
  id: string
  businessId: string
  registerDayId: string
  responsibleUserId: string | null
  responsibleAdministratorUserId: string | null
  responsibleName: string
  openedAt: Date
  closedAt: Date | null
  expectedCash: number | null
  countedCash: number | null
  cashDifference: number | null
}

export type CashEntryForSummary = {
  type: 'PAYMENT' | 'LEGACY_PAYMENT' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND' | 'REVERSAL'
  direction: 'INFLOW' | 'OUTFLOW'
  amount: number
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'UNSPECIFIED'
  cashSessionId?: string | null
  reversedEntryType?: CashEntryForSummary['type']
  expenseCategoryName?: string | null
}

export type AppointmentBackfillEvidence = {
  businessId: string
  appointmentId: string
  origin: 'BOT' | 'WEB' | 'MANUAL' | 'UNKNOWN'
  coordinationGroupId: string | null
  visitId: string | null
  visitBusinessId: string | null
  visitTotalPrice: number | null
  quotedPrice: number | null
  primaryPrice: number | null
  itemCount: number
  pricedItemCount: number
  itemTotal: number | null
  minimumPrice?: number | null
  estimated: boolean
  tenantConsistent: boolean
  manualDepositPaid: boolean
  manualDepositAmount: number | null
}

export type AppointmentAccountRecord = {
  id: string
  businessId: string
  pricingMode: 'FIXED' | 'ESTIMATED'
  agreedAmount: number | null
  originalAmount: number | null
  minimumAmount: number
  discountAmount: number
}

export type AppointmentTotalAdjustmentRecord = {
  id: string
  previousAmount: number | null
  newAmount: number
  reason: string
  actorUserId: string | null
  actorName: string
  createdAt: Date
}

export type AppointmentFinanceSummaryRow = AppointmentAccountRecord & {
  appointmentId: string
  accountId: string
  paidAmount: number
}

export type AppointmentAccountEntryRecord = CashEntryForSummary & {
  id: string
  origin: 'AGENDA' | 'CASH_REGISTER' | 'WEB_DEPOSIT' | 'BOT_DEPOSIT' | 'MIGRATION'
  observation: string | null
  effectiveAt: Date | null
}
export type ManualPaymentMethod = 'CASH' | 'TRANSFER' | 'CARD'
export type CashEntryRecord = AppointmentAccountEntryRecord & {
  businessId: string
  accountId: string | null
  registerDayId: string | null
  cashSessionId: string | null
  origin: 'AGENDA' | 'CASH_REGISTER' | 'WEB_DEPOSIT' | 'BOT_DEPOSIT' | 'MIGRATION'
  description: string | null
  counterparty: string | null
  observation: string | null
  reversesEntryId: string | null
  reversedById?: string | null
  effectiveAt: Date | null
  customerNames?: string[]
  expenseCategoryId?: string | null
  expenseCategoryName?: string | null
  expenseSubcategoryId?: string | null
  expenseSubcategoryName?: string | null
}
export type CashEntryCursor = { effectiveAt: Date; id: string }
export type CashPeriodExpenseRecord = CashEntryRecord & {
  totalCount: number
  reversedEntryType?: CashEntryForSummary['type'] | null
}

export type CashExpenseCategoryRecord = {
  id: string
  businessId: string
  name: string
  normalizedName: string
  position: number
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type CashExpenseSubcategoryRecord = {
  id: string
  businessId: string
  categoryId: string
  name: string
  normalizedName: string
  position: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CashTransactionRepository {
  lockBusiness(businessId: string): Promise<CashBusinessContext | null>
  findResponsible(businessId: string, userId: string): Promise<CashResponsible | null>
  findOpenDay(businessId: string): Promise<CashRegisterDayRecord | null>
  findOpenSession(businessId: string, registerDayId: string): Promise<CashSessionRecord | null>
  findPreviousCountedCash(businessId: string): Promise<number | null>
  listDayEntries(businessId: string, registerDayId: string): Promise<CashEntryForSummary[]>
  listDaySessions(businessId: string, registerDayId: string): Promise<CashSessionRecord[]>
  createDay(input: { id: string; businessId: string; openedAt: Date; openingCash: number }): Promise<CashRegisterDayRecord>
  createSession(input: {
    id: string
    businessId: string
    registerDayId: string
    responsibleUserId: string | null
    responsibleAdministratorUserId: string | null
    responsibleName: string
    openedAt: Date
  }): Promise<CashSessionRecord>
  closeSession(input: {
    businessId: string
    sessionId: string
    closedAt: Date
    expectedCash: number
    countedCash: number
    cashDifference: number
  }): Promise<CashSessionRecord>
  closeDay(input: {
    businessId: string
    registerDayId: string
    closedAt: Date
    expectedClosingCash: number
    countedClosingCash: number
    closingDifference: number
  }): Promise<CashRegisterDayRecord>
  findUnlinkedAppointmentIds(businessId: string, afterId: string | null, limit: number): Promise<string[]>
  findApprovedDepositsForBackfill(
    businessId: string,
    afterId: string | null,
    limit: number
  ): Promise<Array<{ id: string; origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT' }>>
  loadAppointmentBackfillGroup(businessId: string, appointmentId: string): Promise<AppointmentBackfillEvidence[]>
  ensureAppointmentAccount(input: {
    id: string
    businessId: string
    pricingMode: 'FIXED' | 'ESTIMATED'
    agreedAmount: number | null
    originalAmount: number | null
    minimumAmount: number
  }): Promise<{ account: AppointmentAccountRecord; created: boolean }>
  ensureAppointmentAccountLink(input: {
    businessId: string
    appointmentId: string
    accountId: string
  }): Promise<{ linked: boolean; created: boolean }>
  ensureLegacyPayment(input: {
    id: string
    businessId: string
    appointmentId: string
    accountId: string
    amount: number
  }): Promise<boolean>
  resolveAppointmentAccount(businessId: string, appointmentId: string): Promise<AppointmentAccountRecord | null>
  listAppointmentFinanceSummaryRows(businessId: string, appointmentIds: string[]): Promise<AppointmentFinanceSummaryRow[]>
  lockAppointmentAccount(businessId: string, appointmentId: string): Promise<AppointmentAccountRecord | null>
  listAccountEntries(businessId: string, accountId: string): Promise<AppointmentAccountEntryRecord[]>
  resolveAccountProductSubtotal(businessId: string, accountId: string): Promise<number>
  insertTotalAdjustment(input: {
    id: string
    businessId: string
    accountId: string
    actorUserId: string | null
    actorName: string
    reason: string
    previousAmount: number | null
    newAmount: number
  }): Promise<AppointmentTotalAdjustmentRecord>
  updateAdjustedTotal(businessId: string, accountId: string, agreedAmount: number): Promise<AppointmentAccountRecord>
  listTotalAdjustments(businessId: string, accountId: string): Promise<AppointmentTotalAdjustmentRecord[]>
  updateDiscount(businessId: string, accountId: string, discountAmount: number): Promise<AppointmentAccountRecord>
  insertManualPayments(input: {
    ids: string[]
    businessId: string
    accountId: string
    registerDayId: string
    cashSessionId: string
    origin: 'AGENDA' | 'CASH_REGISTER'
    observation: string | null
    effectiveAt: Date
    lines: Array<{ amount: number; method: ManualPaymentMethod }>
  }): Promise<Array<{ id: string; amount: number; method: ManualPaymentMethod }>>
  completeAppointmentFromPayment(input: {
    businessId: string
    appointmentId: string
    completedAt: Date
    actorUserId: string
    actorName: string
  }): Promise<AppointmentCompletionRecord | null>
  projectApprovedDeposit(input: {
    businessId: string
    bookingDepositId: string
    origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT'
  }): Promise<{ created: boolean; cashSessionId: string | null }>
  findTreasuryCashAccount(businessId: string): Promise<{ id: string } | null>
  insertTreasuryMovement(input: {
    id: string
    businessId: string
    accountId: string
    amount: number
    cashEntryId: string
    actorUserId: string
    actorName: string
  }): Promise<{ id: string }>
  listExpenseSubcategories(businessId: string, categoryId: string | null, includeInactive: boolean): Promise<CashExpenseSubcategoryRecord[]>
  findExpenseSubcategory(businessId: string, subcategoryId: string): Promise<CashExpenseSubcategoryRecord | null>
  createExpenseSubcategory(input: { id: string; businessId: string; categoryId: string; name: string; normalizedName: string; position: number }): Promise<CashExpenseSubcategoryRecord | null>
  updateExpenseSubcategory(input: { businessId: string; subcategoryId: string; name: string; normalizedName: string; position: number; isActive: boolean }): Promise<CashExpenseSubcategoryRecord | null>
  insertCashOperation(input: {
    id: string
    businessId: string
    registerDayId: string
    cashSessionId: string
    type: 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'
    direction: 'INFLOW' | 'OUTFLOW'
    amount: number
    method: ManualPaymentMethod
    description: string | null
    counterparty: string | null
    observation: string | null
    expenseCategoryId: string | null
    expenseSubcategoryId?: string | null
    effectiveAt: Date
  }): Promise<CashEntryRecord>
  ensureDefaultExpenseCategory(input: { id: string; businessId: string }): Promise<CashExpenseCategoryRecord>
  listExpenseCategories(businessId: string, includeInactive: boolean): Promise<CashExpenseCategoryRecord[]>
  findExpenseCategory(businessId: string, categoryId: string): Promise<CashExpenseCategoryRecord | null>
  createExpenseCategory(input: { id: string; businessId: string; name: string; normalizedName: string; position: number }): Promise<CashExpenseCategoryRecord | null>
  updateExpenseCategory(input: { businessId: string; categoryId: string; name: string; normalizedName: string; position: number; isActive: boolean }): Promise<CashExpenseCategoryRecord | null>
  lockCashEntry(businessId: string, entryId: string): Promise<CashEntryRecord | null>
  insertCashReversal(input: {
    id: string
    businessId: string
    registerDayId: string
    cashSessionId: string
    source: CashEntryRecord
    observation: string | null
    effectiveAt: Date
  }): Promise<CashEntryRecord>
  findRegisterDay(businessId: string, registerDayId: string): Promise<CashRegisterDayRecord | null>
  listRegisterDays(businessId: string, limit: number): Promise<CashRegisterDayRecord[]>
  listCashEntries(input: {
    businessId: string
    registerDayId: string
    cursor: CashEntryCursor | null
    limit: number
    type: CashEntryForSummary['type'] | null
    method: CashEntryForSummary['method'] | null
    expenseCategoryId: string | null
    expenseSubcategoryId?: string | null
    cashSessionId: string | null
    query: string | null
  }): Promise<CashEntryRecord[]>
  listPeriodEntries(businessId: string, input: { from: string; to: string; days: number; timezone: string; registerOnly?: boolean }): Promise<CashEntryForSummary[]>
  listPeriodExpenses(input: {
    businessId: string
    from: string
    to: string
    days: number
    timezone: string
    registerOnly?: boolean
    offset: number
    limit: number
    method: CashEntryForSummary['method'] | null
    expenseCategoryId: string | null
    expenseSubcategoryId?: string | null
    query: string | null
  }): Promise<CashPeriodExpenseRecord[]>
}

type PrismaTransactionRunner = {
  $transaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
}

export interface CashRepository {
  transaction<T>(work: (repository: CashTransactionRepository) => Promise<T>): Promise<T>
}

export class PrismaCashRepository implements CashRepository {
  constructor(
    private readonly prisma: PrismaTransactionRunner | Prisma.TransactionClient,
    private readonly alreadyInTransaction = false
  ) {}

  transaction<T>(work: (repository: CashTransactionRepository) => Promise<T>) {
    if (this.alreadyInTransaction) {
      return work(new PrismaCashTransactionRepository(this.prisma as Prisma.TransactionClient))
    }
    return (this.prisma as PrismaTransactionRunner).$transaction(
      (transaction) => work(new PrismaCashTransactionRepository(transaction))
    )
  }
}

class PrismaCashTransactionRepository implements CashTransactionRepository {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async lockBusiness(businessId: string) {
    await this.transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${`cash-register:${businessId}`}, 0))
    `)
    const rows = await this.transaction.$queryRaw<CashBusinessContext[]>(Prisma.sql`
      SELECT "id" AS "businessId", "timezone", clock_timestamp() AS "dbNow"
      FROM "Business"
      WHERE "id" = ${businessId}
      FOR UPDATE
    `)
    return rows[0] ?? null
  }

  async findResponsible(businessId: string, userId: string) {
    const rows = await this.transaction.$queryRaw<CashResponsible[]>(Prisma.sql`
      SELECT "id", "name"
      FROM "User"
      WHERE "businessId" = ${businessId}
        AND "id" = ${userId}
        AND "isActive" = true
      FOR KEY SHARE
    `)
    return rows[0] ?? null
  }

  async findOpenDay(businessId: string) {
    const rows = await this.transaction.$queryRaw<CashRegisterDayRecord[]>(Prisma.sql`
      SELECT day."id", day."businessId", day."openedAt", day."closedAt", day."openingCash",
        day."expectedClosingCash", day."countedClosingCash", day."closingDifference"
      FROM "CashRegisterDay" AS day
      WHERE day."businessId" = ${businessId}
        AND day."closedAt" IS NULL
      FOR UPDATE OF day
    `)
    return rows[0] ?? null
  }

  async findOpenSession(businessId: string, registerDayId: string) {
    const rows = await this.transaction.$queryRaw<CashSessionRecord[]>(Prisma.sql`
      SELECT session."id", session."businessId", session."registerDayId", session."responsibleUserId", session."responsibleAdministratorUserId",
        session."responsibleName", session."openedAt", session."closedAt", session."expectedCash",
        session."countedCash", session."cashDifference"
      FROM "CashSession" AS session
      WHERE session."businessId" = ${businessId}
        AND session."registerDayId" = ${registerDayId}
        AND session."closedAt" IS NULL
      FOR UPDATE OF session
    `)
    return rows[0] ?? null
  }

  async findPreviousCountedCash(businessId: string) {
    const rows = await this.transaction.$queryRaw<Array<{ countedCash: number }>>(Prisma.sql`
      SELECT day."countedClosingCash" AS "countedCash"
      FROM "CashRegisterDay" AS day
      WHERE day."businessId" = ${businessId}
        AND day."closedAt" IS NOT NULL
        AND day."countedClosingCash" IS NOT NULL
      ORDER BY day."closedAt" DESC, day."id" DESC
      LIMIT 1
      FOR SHARE OF day
    `)
    return rows[0]?.countedCash ?? null
  }

  async listDayEntries(businessId: string, registerDayId: string) {
    const rows = await this.transaction.$queryRaw<Array<{
      type: CashEntryForSummary['type']
      direction: CashEntryForSummary['direction']
      amount: number
      method: CashEntryForSummary['method']
      cashSessionId: string | null
      reversedEntryType: CashEntryForSummary['type'] | null
    }>>(Prisma.sql`
      SELECT entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."cashSessionId",
        original."type"::text AS "reversedEntryType"
      FROM "CashEntry" AS entry
      LEFT JOIN "CashEntry" AS original
        ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      WHERE entry."businessId" = ${businessId}
        AND entry."registerDayId" = ${registerDayId}
      ORDER BY entry."effectiveAt", entry."id"
    `)
    return rows.map((row) => ({
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      method: row.method,
      cashSessionId: row.cashSessionId,
      ...(row.reversedEntryType ? { reversedEntryType: row.reversedEntryType } : {})
    }))
  }

  async listDaySessions(businessId: string, registerDayId: string) {
    return this.transaction.$queryRaw<CashSessionRecord[]>(Prisma.sql`
      SELECT session."id", session."businessId", session."registerDayId", session."responsibleUserId", session."responsibleAdministratorUserId",
        session."responsibleName", session."openedAt", session."closedAt", session."expectedCash",
        session."countedCash", session."cashDifference"
      FROM "CashSession" AS session
      WHERE session."businessId" = ${businessId}
        AND session."registerDayId" = ${registerDayId}
      ORDER BY session."openedAt", session."id"
    `)
  }

  async findUnlinkedAppointmentIds(businessId: string, afterId: string | null, limit: number) {
    const cursor = afterId === null ? Prisma.empty : Prisma.sql`AND appointment."id" > ${afterId}`
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT appointment."id"
      FROM "Appointment" AS appointment
      LEFT JOIN "AppointmentAccountLink" AS link
        ON link."businessId" = appointment."businessId" AND link."appointmentId" = appointment."id"
      WHERE appointment."businessId" = ${businessId}
        AND link."appointmentId" IS NULL
        ${cursor}
      ORDER BY appointment."id"
      LIMIT ${limit}
      FOR UPDATE OF appointment
    `)
    return rows.map((row) => row.id)
  }

  async findApprovedDepositsForBackfill(businessId: string, afterId: string | null, limit: number) {
    return this.transaction.$queryRaw<Array<{ id: string; origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT' }>>(Prisma.sql`
      SELECT deposit."id",
        CASE WHEN deposit."source" = 'WEB'::"BookingDepositSource"
          THEN 'WEB_DEPOSIT' ELSE 'BOT_DEPOSIT' END AS "origin"
      FROM "BookingDeposit" AS deposit
      WHERE deposit."businessId" = ${businessId}
        AND deposit."status" = 'APPROVED'::"BookingDepositStatus"
        AND (${afterId}::text IS NULL OR deposit."id" > ${afterId})
      ORDER BY deposit."id" ASC
      LIMIT ${limit}
    `)
  }

  async loadAppointmentBackfillGroup(businessId: string, appointmentId: string) {
    return this.transaction.$queryRaw<AppointmentBackfillEvidence[]>(Prisma.sql`
      WITH anchor AS (
        SELECT "id", "visitId", "coordinationGroupId"
        FROM "Appointment"
        WHERE "businessId" = ${businessId} AND "id" = ${appointmentId}
      )
      SELECT appointment."businessId", appointment."id" AS "appointmentId", appointment."origin"::text AS "origin",
        appointment."coordinationGroupId", appointment."visitId", visit."businessId" AS "visitBusinessId",
        visit."totalPrice" AS "visitTotalPrice", appointment."quotedPrice", primary_service."price" AS "primaryPrice",
        coalesce(items."itemCount", 0)::int AS "itemCount", coalesce(items."pricedItemCount", 0)::int AS "pricedItemCount",
        items."itemTotal", coalesce(items."minimumPrice", primary_service."price") AS "minimumPrice", (
          primary_service."priceMode" = 'STARTING_AT'::"ServicePriceMode"
          OR coalesce(items."hasEstimated", false)
        ) AS "estimated",
        NOT coalesce(items."hasForeignService", false) AS "tenantConsistent",
        appointment."manualDepositPaid", appointment."manualDepositAmount"
      FROM anchor
      JOIN "Appointment" AS appointment ON appointment."businessId" = ${businessId} AND (
        (anchor."visitId" IS NOT NULL AND appointment."visitId" = anchor."visitId")
        OR (anchor."visitId" IS NULL AND anchor."coordinationGroupId" IS NOT NULL AND appointment."coordinationGroupId" = anchor."coordinationGroupId")
        OR (anchor."visitId" IS NULL AND anchor."coordinationGroupId" IS NULL AND appointment."id" = anchor."id")
      )
      JOIN "Service" AS primary_service
        ON primary_service."id" = appointment."serviceId" AND primary_service."businessId" = appointment."businessId"
      LEFT JOIN "BookingVisit" AS visit ON visit."id" = appointment."visitId"
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS "itemCount", count(item."price")::int AS "pricedItemCount",
          sum(item."price")::int AS "itemTotal", sum(service."price")::int AS "minimumPrice",
          bool_or(service."priceMode" = 'STARTING_AT'::"ServicePriceMode") AS "hasEstimated",
          bool_or(service."id" IS NULL) AS "hasForeignService"
        FROM "AppointmentServiceItem" AS item
        LEFT JOIN "Service" AS service
          ON service."id" = item."serviceId" AND service."businessId" = appointment."businessId"
        WHERE item."appointmentId" = appointment."id"
      ) AS items ON true
      ORDER BY appointment."id"
      FOR UPDATE OF appointment
    `)
  }

  async ensureAppointmentAccount(input: {
    id: string
    businessId: string
    pricingMode: 'FIXED' | 'ESTIMATED'
    agreedAmount: number | null
    originalAmount: number | null
    minimumAmount: number
  }) {
    const inserted = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "AppointmentAccount" ("id", "businessId", "pricingMode", "agreedAmount", "originalAmount", "minimumAmount", "updatedAt")
      VALUES (${input.id}, ${input.businessId}, ${input.pricingMode}::"AppointmentPricingMode", ${input.agreedAmount}, ${input.originalAmount}, ${input.minimumAmount}, clock_timestamp())
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `)
    const rows = await this.transaction.$queryRaw<AppointmentAccountRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "pricingMode"::text AS "pricingMode", "agreedAmount", "originalAmount", "minimumAmount", "discountAmount"
      FROM "AppointmentAccount"
      WHERE "businessId" = ${input.businessId} AND "id" = ${input.id}
      FOR SHARE
    `)
    if (!rows[0]) throw new Error('appointment account id collision outside tenant')
    return { account: rows[0], created: inserted.length === 1 }
  }

  async ensureAppointmentAccountLink(input: { businessId: string; appointmentId: string; accountId: string }) {
    const inserted = await this.transaction.$queryRaw<Array<{ appointmentId: string }>>(Prisma.sql`
      INSERT INTO "AppointmentAccountLink" ("businessId", "appointmentId", "accountId")
      VALUES (${input.businessId}, ${input.appointmentId}, ${input.accountId})
      ON CONFLICT ("appointmentId") DO NOTHING
      RETURNING "appointmentId"
    `)
    const rows = await this.transaction.$queryRaw<Array<{ businessId: string; accountId: string }>>(Prisma.sql`
      SELECT "businessId", "accountId"
      FROM "AppointmentAccountLink"
      WHERE "appointmentId" = ${input.appointmentId}
      FOR SHARE
    `)
    return {
      linked: rows[0]?.businessId === input.businessId && rows[0]?.accountId === input.accountId,
      created: inserted.length === 1
    }
  }

  async ensureLegacyPayment(input: {
    id: string
    businessId: string
    appointmentId: string
    accountId: string
    amount: number
  }) {
    const inserted = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "CashEntry" (
        "id", "businessId", "accountId", "type", "direction", "amount", "paymentMethod", "origin", "description", "effectiveAt"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.accountId}, 'LEGACY_PAYMENT'::"CashEntryType",
        'INFLOW'::"CashDirection", ${input.amount}, 'UNSPECIFIED'::"CashPaymentMethod",
        'MIGRATION'::"CashEntryOrigin", 'Pago anterior sin especificar', NULL
      )
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `)
    return inserted.length === 1
  }

  async resolveAppointmentAccount(businessId: string, appointmentId: string) {
    const rows = await this.transaction.$queryRaw<AppointmentAccountRecord[]>(Prisma.sql`
      SELECT account."id", account."businessId", account."pricingMode"::text AS "pricingMode",
        account."agreedAmount", account."originalAmount", account."minimumAmount", account."discountAmount"
      FROM "AppointmentAccountLink" AS link
      JOIN "AppointmentAccount" AS account
        ON account."businessId" = link."businessId" AND account."id" = link."accountId"
      WHERE link."businessId" = ${businessId} AND link."appointmentId" = ${appointmentId}
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async listAppointmentFinanceSummaryRows(businessId: string, appointmentIds: string[]) {
    if (!appointmentIds.length) return []
    return this.transaction.$queryRaw<AppointmentFinanceSummaryRow[]>(Prisma.sql`
      SELECT link."appointmentId", account."id" AS "accountId", account."id", account."businessId",
        account."pricingMode"::text AS "pricingMode", account."agreedAmount", account."originalAmount", account."minimumAmount", account."discountAmount",
        coalesce(sum(
          CASE
            WHEN entry."type" IN ('PAYMENT'::"CashEntryType", 'LEGACY_PAYMENT'::"CashEntryType")
              OR (entry."type" = 'REVERSAL'::"CashEntryType"
                AND original."type" IN ('PAYMENT'::"CashEntryType", 'LEGACY_PAYMENT'::"CashEntryType"))
            THEN CASE WHEN entry."direction" = 'INFLOW'::"CashDirection" THEN entry."amount" ELSE -entry."amount" END
            ELSE 0
          END
        ), 0)::integer AS "paidAmount"
      FROM "AppointmentAccountLink" AS link
      JOIN "AppointmentAccount" AS account
        ON account."businessId" = link."businessId" AND account."id" = link."accountId"
      LEFT JOIN "CashEntry" AS entry
        ON entry."businessId" = account."businessId" AND entry."accountId" = account."id"
      LEFT JOIN "CashEntry" AS original
        ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      WHERE link."businessId" = ${businessId}
        AND link."appointmentId" IN (${Prisma.join(appointmentIds)})
      GROUP BY link."appointmentId", account."id", account."businessId", account."pricingMode",
        account."agreedAmount", account."originalAmount", account."minimumAmount", account."discountAmount"
    `)
  }

  async lockAppointmentAccount(businessId: string, appointmentId: string) {
    const rows = await this.transaction.$queryRaw<AppointmentAccountRecord[]>(Prisma.sql`
      SELECT account."id", account."businessId", account."pricingMode"::text AS "pricingMode",
        account."agreedAmount", account."originalAmount", account."minimumAmount", account."discountAmount"
      FROM "AppointmentAccountLink" AS link
      JOIN "AppointmentAccount" AS account
        ON account."businessId" = link."businessId" AND account."id" = link."accountId"
      WHERE link."businessId" = ${businessId} AND link."appointmentId" = ${appointmentId}
      FOR UPDATE OF account
    `)
    return rows[0] ?? null
  }

  async listAccountEntries(businessId: string, accountId: string) {
    const rows = await this.transaction.$queryRaw<Array<AppointmentAccountEntryRecord & { reversedEntryType: CashEntryForSummary['type'] | null }>>(Prisma.sql`
      SELECT entry."id", entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."origin"::text AS "origin", entry."observation",
        entry."effectiveAt", original."type"::text AS "reversedEntryType"
      FROM "CashEntry" AS entry
      LEFT JOIN "CashEntry" AS original
        ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      WHERE entry."businessId" = ${businessId} AND entry."accountId" = ${accountId}
      ORDER BY entry."effectiveAt" NULLS FIRST, entry."id"
    `)
    return rows.map((row) => ({ ...row, ...(row.reversedEntryType ? { reversedEntryType: row.reversedEntryType } : {}) }))
  }

  async resolveAccountProductSubtotal(businessId: string, accountId: string) {
    const rows = await this.transaction.$queryRaw<Array<{ subtotal: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(sale."productSubtotal"), 0)::integer AS "subtotal"
      FROM "ProductSale" AS sale
      INNER JOIN "AppointmentAccountLink" AS link
        ON link."businessId" = sale."businessId" AND link."appointmentId" = sale."appointmentId"
      WHERE sale."businessId" = ${businessId}
        AND link."accountId" = ${accountId}
        AND sale."status" IN ('DRAFT', 'COMPLETED')
    `)
    return rows[0]?.subtotal ?? 0
  }

  async insertTotalAdjustment(input: {
    id: string
    businessId: string
    accountId: string
    actorUserId: string | null
    actorName: string
    reason: string
    previousAmount: number | null
    newAmount: number
  }) {
    const rows = await this.transaction.$queryRaw<AppointmentTotalAdjustmentRecord[]>(Prisma.sql`
      INSERT INTO "AppointmentTotalAdjustment" (
        "id", "businessId", "accountId", "actorUserId", "actorName", "reason", "previousAmount", "newAmount", "createdAt"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.accountId}, ${input.actorUserId}, ${input.actorName}, ${input.reason},
        ${input.previousAmount}, ${input.newAmount}, clock_timestamp()
      )
      RETURNING "id", "previousAmount", "newAmount", "reason", "actorUserId", "actorName", "createdAt"
    `)
    if (!rows[0]) throw new Error('appointment total adjustment audit was not created')
    return rows[0]
  }

  async updateAdjustedTotal(businessId: string, accountId: string, agreedAmount: number) {
    const rows = await this.transaction.$queryRaw<AppointmentAccountRecord[]>(Prisma.sql`
      UPDATE "AppointmentAccount"
      SET "agreedAmount" = ${agreedAmount}, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${businessId} AND "id" = ${accountId}
      RETURNING "id", "businessId", "pricingMode"::text AS "pricingMode", "agreedAmount", "originalAmount", "minimumAmount", "discountAmount"
    `)
    if (!rows[0]) throw new Error('appointment account disappeared while locked')
    return rows[0]
  }

  async listTotalAdjustments(businessId: string, accountId: string) {
    return this.transaction.$queryRaw<AppointmentTotalAdjustmentRecord[]>(Prisma.sql`
      SELECT "id", "previousAmount", "newAmount", "reason", "actorUserId", "actorName", "createdAt"
      FROM "AppointmentTotalAdjustment"
      WHERE "businessId" = ${businessId} AND "accountId" = ${accountId}
      ORDER BY "createdAt" ASC, "id" ASC
    `)
  }

  async updateDiscount(businessId: string, accountId: string, discountAmount: number) {
    const rows = await this.transaction.$queryRaw<AppointmentAccountRecord[]>(Prisma.sql`
      UPDATE "AppointmentAccount"
      SET "discountAmount" = ${discountAmount}, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${businessId} AND "id" = ${accountId}
      RETURNING "id", "businessId", "pricingMode"::text AS "pricingMode", "agreedAmount", "originalAmount", "minimumAmount", "discountAmount"
    `)
    if (!rows[0]) throw new Error('appointment account disappeared while locked')
    return rows[0]
  }

  async insertManualPayments(input: {
    ids: string[]
    businessId: string
    accountId: string
    registerDayId: string
    cashSessionId: string
    origin: 'AGENDA' | 'CASH_REGISTER'
    observation: string | null
    effectiveAt: Date
    lines: Array<{ amount: number; method: ManualPaymentMethod }>
  }) {
    const created: Array<{ id: string; amount: number; method: ManualPaymentMethod }> = []
    for (const [index, line] of input.lines.entries()) {
      const id = input.ids[index]!
      await this.transaction.$executeRaw(Prisma.sql`
        INSERT INTO "CashEntry" (
          "id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction",
          "amount", "paymentMethod", "origin", "observation", "effectiveAt"
        ) VALUES (
          ${id}, ${input.businessId}, ${input.accountId}, ${input.registerDayId}, ${input.cashSessionId},
          'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", ${line.amount}, ${line.method}::"CashPaymentMethod",
          ${input.origin}::"CashEntryOrigin", ${input.observation}, ${input.effectiveAt}
        )
      `)
      created.push({ id, amount: line.amount, method: line.method })
    }
    return created
  }

  async completeAppointmentFromPayment(input: {
    businessId: string
    appointmentId: string
    completedAt: Date
    actorUserId: string
    actorName: string
  }) {
    const rows = await this.transaction.$queryRaw<AppointmentCompletionRecord[]>(Prisma.sql`
      WITH locked AS (
        SELECT appointment."status", appointment."startAt"
        FROM "Appointment" appointment
        WHERE appointment."businessId" = ${input.businessId} AND appointment."id" = ${input.appointmentId}
        FOR UPDATE
      ), updated AS (
        UPDATE "Appointment" appointment
        SET "status" = 'COMPLETED'::"AppointmentStatus",
          "completedAt" = COALESCE(appointment."completedAt", ${input.completedAt}),
          "completedByUserId" = COALESCE(appointment."completedByUserId", ${input.actorUserId}),
          "completedByName" = COALESCE(appointment."completedByName", ${input.actorName}),
          "completionSource" = COALESCE(appointment."completionSource", 'FULL_PAYMENT'::"AppointmentCompletionSource")
        FROM locked
        WHERE appointment."businessId" = ${input.businessId} AND appointment."id" = ${input.appointmentId}
          AND locked."startAt" <= ${input.completedAt}
          AND locked."status" IN ('PENDING'::"AppointmentStatus", 'CONFIRMED'::"AppointmentStatus", 'COMPLETED'::"AppointmentStatus")
        RETURNING appointment."id" AS "appointmentId", locked."status"::text AS "previousStatus",
          appointment."status"::text AS "status", appointment."completedAt", appointment."completedByUserId",
          appointment."completedByName", appointment."completionSource"::text AS "completionSource"
      )
      SELECT * FROM updated
    `)
    const completion = rows[0] ?? null
    if (completion) {
      await ensureProfessionalEarningForCompletedAppointment(this.transaction, {
        businessId: input.businessId,
        appointmentId: input.appointmentId,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        effectiveAt: input.completedAt
      })
    }
    return completion
  }

  async projectApprovedDeposit(input: {
    businessId: string
    bookingDepositId: string
    origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT'
  }) {
    if (!await this.lockBusiness(input.businessId)) throw new Error('BUSINESS_NOT_FOUND')
    const target = await this.transaction.$queryRaw<Array<{
      depositId: string
      amount: number
      accountId: string
      agreedAmount: number
      discountAmount: number
      registerDayId: string | null
      cashSessionId: string | null
    }>>(Prisma.sql`
      SELECT deposit."id" AS "depositId", deposit."amount", account."id" AS "accountId",
        account."agreedAmount", account."discountAmount", day."id" AS "registerDayId", session."id" AS "cashSessionId"
      FROM "BookingDeposit" AS deposit
      JOIN "AppointmentAccountLink" AS link
        ON link."businessId" = deposit."businessId" AND link."appointmentId" = deposit."appointmentId"
      JOIN "AppointmentAccount" AS account
        ON account."businessId" = link."businessId" AND account."id" = link."accountId"
      LEFT JOIN LATERAL (
        SELECT "id" FROM "CashRegisterDay"
        WHERE "businessId" = deposit."businessId" AND "closedAt" IS NULL LIMIT 1
      ) AS day ON true
      LEFT JOIN LATERAL (
        SELECT "id" FROM "CashSession"
        WHERE "businessId" = deposit."businessId" AND "registerDayId" = day."id" AND "closedAt" IS NULL LIMIT 1
      ) AS session ON true
      WHERE deposit."businessId" = ${input.businessId} AND deposit."id" = ${input.bookingDepositId}
        AND deposit."status" = 'APPROVED'::"BookingDepositStatus" AND account."agreedAmount" IS NOT NULL
      FOR UPDATE OF deposit, account
    `)
    if (!target[0]) throw new Error('APPROVED_DEPOSIT_NOT_PROJECTABLE')
    const existingProjection = await this.transaction.$queryRaw<Array<{ cashSessionId: string | null }>>(Prisma.sql`
      SELECT "cashSessionId" FROM "CashEntry"
      WHERE "businessId" = ${input.businessId} AND "bookingDepositId" = ${input.bookingDepositId}
    `)
    if (existingProjection[0]) {
      return { created: false, cashSessionId: existingProjection[0].cashSessionId }
    }
    const prior = await this.listAccountEntries(input.businessId, target[0].accountId)
    const paid = prior.reduce((total, entry) => {
      if (!['PAYMENT', 'LEGACY_PAYMENT', 'REVERSAL'].includes(entry.type)) return total
      return total + (entry.direction === 'INFLOW' ? entry.amount : -entry.amount)
    }, 0)
    if (target[0].amount > target[0].agreedAmount - target[0].discountAmount - paid) {
      throw new Error('APPROVED_DEPOSIT_OVERPAYMENT')
    }
    const inserted = await this.transaction.$queryRaw<Array<{ cashSessionId: string | null }>>(Prisma.sql`
      INSERT INTO "CashEntry" (
        "id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount",
        "paymentMethod", "origin", "bookingDepositId", "effectiveAt"
      )
      VALUES (${`cash_deposit_${input.bookingDepositId}`}, ${input.businessId}, ${target[0].accountId},
        ${target[0].registerDayId}, ${target[0].cashSessionId}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection",
        ${target[0].amount}, 'TRANSFER'::"CashPaymentMethod", ${input.origin}::"CashEntryOrigin",
        ${target[0].depositId}, clock_timestamp())
      ON CONFLICT ("bookingDepositId") DO NOTHING
      RETURNING "cashSessionId"
    `)
    if (inserted[0]) return { created: true, cashSessionId: inserted[0].cashSessionId }
    const existing = await this.transaction.$queryRaw<Array<{ cashSessionId: string | null }>>(Prisma.sql`
      SELECT "cashSessionId" FROM "CashEntry"
      WHERE "businessId" = ${input.businessId} AND "bookingDepositId" = ${input.bookingDepositId}
    `)
    if (existing[0]) return { created: false, cashSessionId: existing[0].cashSessionId }
    throw new Error('APPROVED_DEPOSIT_NOT_PROJECTABLE')
  }

  async findTreasuryCashAccount(businessId: string) {
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "TreasuryAccount"
      WHERE "businessId" = ${businessId} AND "method" = 'CASH'
      FOR KEY SHARE
    `)
    return rows[0] ?? null
  }

  async insertTreasuryMovement(input: {
    id: string
    businessId: string
    accountId: string
    amount: number
    cashEntryId: string
    actorUserId: string
    actorName: string
  }) {
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "TreasuryMovement" (
        "id", "businessId", "accountId", "kind", "direction", "amount", "description",
        "actorUserId", "actorName", "cashEntryId"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.accountId}, 'DAILY_TRANSFER',
        'INFLOW'::"CashDirection", ${input.amount}, 'Desde cierre de Caja',
        ${input.actorUserId}, ${input.actorName}, ${input.cashEntryId}
      ) RETURNING "id"
    `)
    return rows[0]!
  }

  async listExpenseSubcategories(businessId: string, categoryId: string | null, includeInactive: boolean) {
    return this.transaction.$queryRaw<CashExpenseSubcategoryRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "categoryId", "name", "normalizedName", "position", "isActive", "createdAt", "updatedAt"
      FROM "CashExpenseSubcategory"
      WHERE "businessId" = ${businessId}
        ${categoryId ? Prisma.sql`AND "categoryId" = ${categoryId}` : Prisma.empty}
        ${includeInactive ? Prisma.empty : Prisma.sql`AND "isActive" = true`}
      ORDER BY "categoryId", "position", "name", "id"
    `)
  }

  async findExpenseSubcategory(businessId: string, subcategoryId: string) {
    const rows = await this.transaction.$queryRaw<CashExpenseSubcategoryRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "categoryId", "name", "normalizedName", "position", "isActive", "createdAt", "updatedAt"
      FROM "CashExpenseSubcategory"
      WHERE "businessId" = ${businessId} AND "id" = ${subcategoryId}
      FOR KEY SHARE
    `)
    return rows[0] ?? null
  }

  async createExpenseSubcategory(input: { id: string; businessId: string; categoryId: string; name: string; normalizedName: string; position: number }) {
    const rows = await this.transaction.$queryRaw<CashExpenseSubcategoryRecord[]>(Prisma.sql`
      INSERT INTO "CashExpenseSubcategory" ("id", "businessId", "categoryId", "name", "normalizedName", "position", "createdAt", "updatedAt")
      VALUES (${input.id}, ${input.businessId}, ${input.categoryId}, ${input.name}, ${input.normalizedName}, ${input.position}, clock_timestamp(), clock_timestamp())
      ON CONFLICT ("businessId", "categoryId", "normalizedName") DO NOTHING
      RETURNING "id", "businessId", "categoryId", "name", "normalizedName", "position", "isActive", "createdAt", "updatedAt"
    `)
    return rows[0] ?? null
  }

  async updateExpenseSubcategory(input: { businessId: string; subcategoryId: string; name: string; normalizedName: string; position: number; isActive: boolean }) {
    const rows = await this.transaction.$queryRaw<CashExpenseSubcategoryRecord[]>(Prisma.sql`
      UPDATE "CashExpenseSubcategory" subcategory
      SET "name" = ${input.name}, "normalizedName" = ${input.normalizedName}, "position" = ${input.position},
        "isActive" = ${input.isActive}, "updatedAt" = clock_timestamp()
      WHERE subcategory."businessId" = ${input.businessId} AND subcategory."id" = ${input.subcategoryId}
        AND NOT EXISTS (
          SELECT 1 FROM "CashExpenseSubcategory" duplicate
          WHERE duplicate."businessId" = subcategory."businessId" AND duplicate."categoryId" = subcategory."categoryId"
            AND duplicate."normalizedName" = ${input.normalizedName} AND duplicate."id" <> subcategory."id"
        )
      RETURNING "id", "businessId", "categoryId", "name", "normalizedName", "position", "isActive", "createdAt", "updatedAt"
    `)
    return rows[0] ?? null
  }

  async insertCashOperation(input: {
    id: string
    businessId: string
    registerDayId: string
    cashSessionId: string
    type: 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'
    direction: 'INFLOW' | 'OUTFLOW'
    amount: number
    method: ManualPaymentMethod
    description: string | null
    counterparty: string | null
    observation: string | null
    expenseCategoryId: string | null
    effectiveAt: Date
  }) {
    const rows = await this.transaction.$queryRaw<CashEntryRecord[]>(Prisma.sql`
      INSERT INTO "CashEntry" (
        "id", "businessId", "registerDayId", "cashSessionId", "type", "direction", "amount",
        "paymentMethod", "origin", "description", "counterparty", "observation", "expenseCategoryId", "expenseSubcategoryId", "effectiveAt"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.registerDayId}, ${input.cashSessionId},
        ${input.type}::"CashEntryType", ${input.direction}::"CashDirection", ${input.amount},
        ${input.method}::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin", ${input.description},
        ${input.counterparty}, ${input.observation}, ${input.expenseCategoryId}, ${input.expenseSubcategoryId ?? null}, ${input.effectiveAt}
      )
      RETURNING "id", "businessId", "accountId", "registerDayId", "cashSessionId",
        "type"::text AS "type", "direction"::text AS "direction", "amount",
        "paymentMethod"::text AS "method", "origin"::text AS "origin", "description",
        "counterparty", "observation", "expenseCategoryId", "expenseSubcategoryId", "reversesEntryId", "effectiveAt"
    `)
    return rows[0]!
  }

  async ensureDefaultExpenseCategory(input: { id: string; businessId: string }) {
    const rows = await this.transaction.$queryRaw<CashExpenseCategoryRecord[]>(Prisma.sql`
      INSERT INTO "CashExpenseCategory" (
        "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
      ) VALUES (${input.id}, ${input.businessId}, 'Otros', 'otros', 0, true, true, clock_timestamp(), clock_timestamp())
      ON CONFLICT ("businessId", "normalizedName") DO UPDATE
      SET "name" = 'Otros', "isDefault" = true, "isActive" = true, "updatedAt" = clock_timestamp()
      RETURNING "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
    `)
    return rows[0]!
  }

  async listExpenseCategories(businessId: string, includeInactive: boolean) {
    const active = includeInactive ? Prisma.empty : Prisma.sql`AND "isActive" = true`
    return this.transaction.$queryRaw<CashExpenseCategoryRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
      FROM "CashExpenseCategory"
      WHERE "businessId" = ${businessId} ${active}
      ORDER BY "isDefault" DESC, "position" ASC, "name" ASC, "id" ASC
    `)
  }

  async findExpenseCategory(businessId: string, categoryId: string) {
    const rows = await this.transaction.$queryRaw<CashExpenseCategoryRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
      FROM "CashExpenseCategory"
      WHERE "businessId" = ${businessId} AND "id" = ${categoryId}
      FOR KEY SHARE
    `)
    return rows[0] ?? null
  }

  async createExpenseCategory(input: { id: string; businessId: string; name: string; normalizedName: string; position: number }) {
    const rows = await this.transaction.$queryRaw<CashExpenseCategoryRecord[]>(Prisma.sql`
      INSERT INTO "CashExpenseCategory" (
        "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
      ) VALUES (${input.id}, ${input.businessId}, ${input.name}, ${input.normalizedName}, ${input.position}, false, true, clock_timestamp(), clock_timestamp())
      ON CONFLICT ("businessId", "normalizedName") DO NOTHING
      RETURNING "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
    `)
    return rows[0] ?? null
  }

  async updateExpenseCategory(input: { businessId: string; categoryId: string; name: string; normalizedName: string; position: number; isActive: boolean }) {
    const rows = await this.transaction.$queryRaw<CashExpenseCategoryRecord[]>(Prisma.sql`
      UPDATE "CashExpenseCategory"
      SET "name" = ${input.name}, "normalizedName" = ${input.normalizedName}, "position" = ${input.position},
        "isActive" = ${input.isActive}, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${input.businessId} AND "id" = ${input.categoryId}
        AND NOT EXISTS (
          SELECT 1 FROM "CashExpenseCategory" duplicate
          WHERE duplicate."businessId" = ${input.businessId}
            AND duplicate."normalizedName" = ${input.normalizedName}
            AND duplicate."id" <> ${input.categoryId}
        )
      RETURNING "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
    `)
    return rows[0] ?? null
  }

  async lockCashEntry(businessId: string, entryId: string) {
    const rows = await this.transaction.$queryRaw<CashEntryRecord[]>(Prisma.sql`
      SELECT entry."id", entry."businessId", entry."accountId", entry."registerDayId", entry."cashSessionId",
        entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."origin"::text AS "origin", entry."description",
        entry."counterparty", entry."observation", entry."reversesEntryId", entry."effectiveAt",
        reversal."id" AS "reversedById"
      FROM "CashEntry" AS entry
      LEFT JOIN "CashEntry" AS reversal
        ON reversal."businessId" = entry."businessId" AND reversal."reversesEntryId" = entry."id"
      WHERE entry."businessId" = ${businessId} AND entry."id" = ${entryId}
      FOR UPDATE OF entry
    `)
    return rows[0] ?? null
  }

  async insertCashReversal(input: {
    id: string
    businessId: string
    registerDayId: string
    cashSessionId: string
    source: CashEntryRecord
    observation: string | null
    effectiveAt: Date
  }) {
    const rows = await this.transaction.$queryRaw<CashEntryRecord[]>(Prisma.sql`
      INSERT INTO "CashEntry" (
        "id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction",
        "amount", "paymentMethod", "origin", "observation", "reversesEntryId", "effectiveAt"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.source.accountId}, ${input.registerDayId}, ${input.cashSessionId},
        'REVERSAL'::"CashEntryType",
        ${input.source.direction === 'INFLOW' ? 'OUTFLOW' : 'INFLOW'}::"CashDirection",
        ${input.source.amount}, ${input.source.method}::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin",
        ${input.observation}, ${input.source.id}, ${input.effectiveAt}
      )
      RETURNING "id", "businessId", "accountId", "registerDayId", "cashSessionId",
        "type"::text AS "type", "direction"::text AS "direction", "amount",
        "paymentMethod"::text AS "method", "origin"::text AS "origin", "description",
        "counterparty", "observation", "reversesEntryId", "effectiveAt"
    `)
    return rows[0]!
  }

  async findRegisterDay(businessId: string, registerDayId: string) {
    const rows = await this.transaction.$queryRaw<CashRegisterDayRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "openedAt", "closedAt", "openingCash",
        "expectedClosingCash", "countedClosingCash", "closingDifference"
      FROM "CashRegisterDay"
      WHERE "businessId" = ${businessId} AND "id" = ${registerDayId}
    `)
    return rows[0] ?? null
  }

  async listRegisterDays(businessId: string, limit: number) {
    return this.transaction.$queryRaw<CashRegisterDayRecord[]>(Prisma.sql`
      SELECT "id", "businessId", "openedAt", "closedAt", "openingCash",
        "expectedClosingCash", "countedClosingCash", "closingDifference"
      FROM "CashRegisterDay"
      WHERE "businessId" = ${businessId}
      ORDER BY "openedAt" DESC, "id" DESC
      LIMIT ${limit}
    `)
  }

  async listCashEntries(input: {
    businessId: string
    registerDayId: string
    cursor: CashEntryCursor | null
    limit: number
    type: CashEntryForSummary['type'] | null
    method: CashEntryForSummary['method'] | null
    expenseCategoryId: string | null
    expenseSubcategoryId?: string | null
    cashSessionId: string | null
    query: string | null
  }) {
    const cursor = input.cursor
      ? Prisma.sql`AND (entry."effectiveAt", entry."id") < (${input.cursor.effectiveAt}, ${input.cursor.id})`
      : Prisma.empty
    const type = input.type ? Prisma.sql`AND entry."type" = ${input.type}::"CashEntryType"` : Prisma.empty
    const method = input.method ? Prisma.sql`AND entry."paymentMethod" = ${input.method}::"CashPaymentMethod"` : Prisma.empty
    const category = input.expenseCategoryId ? Prisma.sql`AND COALESCE(entry."expenseCategoryId", original."expenseCategoryId") = ${input.expenseCategoryId}` : Prisma.empty
    const subcategory = input.expenseSubcategoryId ? Prisma.sql`AND COALESCE(entry."expenseSubcategoryId", original."expenseSubcategoryId") = ${input.expenseSubcategoryId}` : Prisma.empty
    const session = input.cashSessionId ? Prisma.sql`AND entry."cashSessionId" = ${input.cashSessionId}` : Prisma.empty
    const query = input.query ? Prisma.sql`AND (
      entry."description" ILIKE ${`%${input.query}%`}
      OR entry."counterparty" ILIKE ${`%${input.query}%`}
      OR entry."observation" ILIKE ${`%${input.query}%`}
      OR COALESCE(subcategory."name", original_subcategory."name") ILIKE ${`%${input.query}%`}
      OR EXISTS (
        SELECT 1 FROM "AppointmentAccountLink" account_link
        JOIN "Appointment" appointment
          ON appointment."businessId" = account_link."businessId" AND appointment."id" = account_link."appointmentId"
        JOIN "Customer" customer
          ON customer."businessId" = appointment."businessId" AND customer."id" = appointment."customerId"
        WHERE account_link."businessId" = entry."businessId" AND account_link."accountId" = entry."accountId"
          AND customer."name" ILIKE ${`%${input.query}%`}
      )
    )` : Prisma.empty
    return this.transaction.$queryRaw<CashEntryRecord[]>(Prisma.sql`
      SELECT entry."id", entry."businessId", entry."accountId", entry."registerDayId", entry."cashSessionId",
        entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."origin"::text AS "origin", entry."description",
        entry."counterparty", entry."observation", COALESCE(entry."expenseCategoryId", original."expenseCategoryId") AS "expenseCategoryId",
        COALESCE(category."name", original_category."name") AS "expenseCategoryName",
        COALESCE(entry."expenseSubcategoryId", original."expenseSubcategoryId") AS "expenseSubcategoryId",
        COALESCE(subcategory."name", original_subcategory."name") AS "expenseSubcategoryName", entry."reversesEntryId", entry."effectiveAt",
        coalesce(customers.names, ARRAY[]::text[]) AS "customerNames"
      FROM "CashEntry" entry
      LEFT JOIN "CashEntry" original ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      LEFT JOIN "CashExpenseCategory" category
        ON category."businessId" = entry."businessId" AND category."id" = entry."expenseCategoryId"
      LEFT JOIN "CashExpenseSubcategory" subcategory
        ON subcategory."businessId" = entry."businessId" AND subcategory."categoryId" = entry."expenseCategoryId" AND subcategory."id" = entry."expenseSubcategoryId"
      LEFT JOIN "CashExpenseCategory" original_category
        ON original_category."businessId" = original."businessId" AND original_category."id" = original."expenseCategoryId"
      LEFT JOIN "CashExpenseSubcategory" original_subcategory
        ON original_subcategory."businessId" = original."businessId" AND original_subcategory."categoryId" = original."expenseCategoryId" AND original_subcategory."id" = original."expenseSubcategoryId"
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT customer."name" ORDER BY customer."name") AS names
        FROM "AppointmentAccountLink" account_link
        JOIN "Appointment" appointment
          ON appointment."businessId" = account_link."businessId" AND appointment."id" = account_link."appointmentId"
        JOIN "Customer" customer
          ON customer."businessId" = appointment."businessId" AND customer."id" = appointment."customerId"
        WHERE account_link."businessId" = entry."businessId" AND account_link."accountId" = entry."accountId"
      ) customers ON true
      WHERE entry."businessId" = ${input.businessId} AND entry."registerDayId" = ${input.registerDayId}
        ${cursor} ${type} ${method} ${category} ${subcategory} ${session} ${query}
      ORDER BY entry."effectiveAt" DESC, entry."id" DESC
      LIMIT ${input.limit}
    `)
  }

  async listPeriodEntries(businessId: string, input: { from: string; to: string; days: number; timezone: string; registerOnly?: boolean }) {
    const rows = await this.transaction.$queryRaw<Array<CashEntryForSummary & { reversedEntryType: CashEntryForSummary['type'] | null }>>(Prisma.sql`
      SELECT entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."cashSessionId",
        original."type"::text AS "reversedEntryType",
        COALESCE(category."name", original_category."name") AS "expenseCategoryName"
      FROM "CashEntry" entry
      LEFT JOIN "CashEntry" original
        ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      LEFT JOIN "CashExpenseCategory" category
        ON category."businessId" = entry."businessId" AND category."id" = entry."expenseCategoryId"
      LEFT JOIN "CashExpenseCategory" original_category
        ON original_category."businessId" = original."businessId" AND original_category."id" = original."expenseCategoryId"
      WHERE entry."businessId" = ${businessId}
        ${input.registerOnly ? Prisma.sql`AND entry."registerDayId" IS NOT NULL` : Prisma.empty}
        AND COALESCE(entry."effectiveAt", entry."createdAt") >= (${input.from}::date::timestamp AT TIME ZONE ${input.timezone})
        AND COALESCE(entry."effectiveAt", entry."createdAt") < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${input.timezone})
      ORDER BY COALESCE(entry."effectiveAt", entry."createdAt"), entry."id"
    `)
    return rows.map((row) => ({
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      method: row.method,
      cashSessionId: row.cashSessionId ?? null,
      expenseCategoryName: row.expenseCategoryName ?? null,
      ...(row.reversedEntryType ? { reversedEntryType: row.reversedEntryType } : {})
    }))
  }

  async listPeriodExpenses(input: {
    businessId: string
    from: string
    to: string
    days: number
    timezone: string
    registerOnly?: boolean
    offset: number
    limit: number
    method: CashEntryForSummary['method'] | null
    expenseCategoryId: string | null
    expenseSubcategoryId?: string | null
    query: string | null
  }) {
    const method = input.method ? Prisma.sql`AND entry."paymentMethod" = ${input.method}::"CashPaymentMethod"` : Prisma.empty
    const category = input.expenseCategoryId ? Prisma.sql`AND COALESCE(entry."expenseCategoryId", original."expenseCategoryId") = ${input.expenseCategoryId}` : Prisma.empty
    const subcategory = input.expenseSubcategoryId ? Prisma.sql`AND COALESCE(entry."expenseSubcategoryId", original."expenseSubcategoryId") = ${input.expenseSubcategoryId}` : Prisma.empty
    const query = input.query ? Prisma.sql`AND (
      entry."description" ILIKE ${`%${input.query}%`}
      OR entry."observation" ILIKE ${`%${input.query}%`}
      OR COALESCE(category."name", original_category."name") ILIKE ${`%${input.query}%`}
      OR COALESCE(subcategory."name", original_subcategory."name") ILIKE ${`%${input.query}%`}
    )` : Prisma.empty
    return this.transaction.$queryRaw<CashPeriodExpenseRecord[]>(Prisma.sql`
      SELECT entry."id", entry."businessId", entry."accountId", entry."registerDayId", entry."cashSessionId",
        entry."type"::text AS "type", entry."direction"::text AS "direction", entry."amount",
        entry."paymentMethod"::text AS "method", entry."origin"::text AS "origin", entry."description",
        entry."counterparty", entry."observation", COALESCE(entry."expenseCategoryId", original."expenseCategoryId") AS "expenseCategoryId",
        COALESCE(category."name", original_category."name") AS "expenseCategoryName",
        COALESCE(entry."expenseSubcategoryId", original."expenseSubcategoryId") AS "expenseSubcategoryId",
        COALESCE(subcategory."name", original_subcategory."name") AS "expenseSubcategoryName", entry."reversesEntryId",
        original."type"::text AS "reversedEntryType", entry."effectiveAt",
        ARRAY[]::text[] AS "customerNames", count(*) OVER()::integer AS "totalCount"
      FROM "CashEntry" entry
      LEFT JOIN "CashEntry" original
        ON original."businessId" = entry."businessId" AND original."id" = entry."reversesEntryId"
      LEFT JOIN "CashExpenseCategory" category
        ON category."businessId" = entry."businessId" AND category."id" = entry."expenseCategoryId"
      LEFT JOIN "CashExpenseCategory" original_category
        ON original_category."businessId" = original."businessId" AND original_category."id" = original."expenseCategoryId"
      LEFT JOIN "CashExpenseSubcategory" subcategory
        ON subcategory."businessId" = entry."businessId" AND subcategory."categoryId" = entry."expenseCategoryId" AND subcategory."id" = entry."expenseSubcategoryId"
      LEFT JOIN "CashExpenseSubcategory" original_subcategory
        ON original_subcategory."businessId" = original."businessId" AND original_subcategory."categoryId" = original."expenseCategoryId" AND original_subcategory."id" = original."expenseSubcategoryId"
      WHERE entry."businessId" = ${input.businessId}
        ${input.registerOnly ? Prisma.sql`AND entry."registerDayId" IS NOT NULL` : Prisma.empty}
        AND (entry."type" = 'EXPENSE'::"CashEntryType" OR (entry."type" = 'REVERSAL'::"CashEntryType" AND original."type" = 'EXPENSE'::"CashEntryType"))
        AND COALESCE(entry."effectiveAt", entry."createdAt") >= (${input.from}::date::timestamp AT TIME ZONE ${input.timezone})
        AND COALESCE(entry."effectiveAt", entry."createdAt") < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${input.timezone})
        ${method} ${category} ${subcategory} ${query}
      ORDER BY COALESCE(entry."effectiveAt", entry."createdAt") DESC, entry."id" DESC
      OFFSET ${input.offset}
      LIMIT ${input.limit}
    `)
  }

  async createDay(input: { id: string; businessId: string; openedAt: Date; openingCash: number }) {
    const rows = await this.transaction.$queryRaw<CashRegisterDayRecord[]>(Prisma.sql`
      INSERT INTO "CashRegisterDay" ("id", "businessId", "openedAt", "openingCash")
      VALUES (${input.id}, ${input.businessId}, ${input.openedAt}, ${input.openingCash})
      RETURNING "id", "businessId", "openedAt", "closedAt", "openingCash",
        "expectedClosingCash", "countedClosingCash", "closingDifference"
    `)
    return rows[0]!
  }

  async createSession(input: {
    id: string
    businessId: string
    registerDayId: string
    responsibleUserId: string | null
    responsibleAdministratorUserId: string | null
    responsibleName: string
    openedAt: Date
  }) {
    const rows = await this.transaction.$queryRaw<CashSessionRecord[]>(Prisma.sql`
      INSERT INTO "CashSession" (
        "id", "businessId", "registerDayId", "responsibleUserId", "responsibleAdministratorUserId", "responsibleName", "openedAt"
      ) VALUES (
        ${input.id}, ${input.businessId}, ${input.registerDayId}, ${input.responsibleUserId}, ${input.responsibleAdministratorUserId}, ${input.responsibleName}, ${input.openedAt}
      )
      RETURNING "id", "businessId", "registerDayId", "responsibleUserId", "responsibleAdministratorUserId", "responsibleName",
        "openedAt", "closedAt", "expectedCash", "countedCash", "cashDifference"
    `)
    return rows[0]!
  }

  async closeSession(input: {
    businessId: string
    sessionId: string
    closedAt: Date
    expectedCash: number
    countedCash: number
    cashDifference: number
  }) {
    const rows = await this.transaction.$queryRaw<CashSessionRecord[]>(Prisma.sql`
      UPDATE "CashSession"
      SET "closedAt" = ${input.closedAt}, "expectedCash" = ${input.expectedCash},
        "countedCash" = ${input.countedCash}, "cashDifference" = ${input.cashDifference}
      WHERE "businessId" = ${input.businessId} AND "id" = ${input.sessionId} AND "closedAt" IS NULL
      RETURNING "id", "businessId", "registerDayId", "responsibleUserId", "responsibleAdministratorUserId", "responsibleName",
        "openedAt", "closedAt", "expectedCash", "countedCash", "cashDifference"
    `)
    if (!rows[0]) throw new Error('cash session disappeared while locked')
    return rows[0]
  }

  async closeDay(input: {
    businessId: string
    registerDayId: string
    closedAt: Date
    expectedClosingCash: number
    countedClosingCash: number
    closingDifference: number
  }) {
    const rows = await this.transaction.$queryRaw<CashRegisterDayRecord[]>(Prisma.sql`
      UPDATE "CashRegisterDay"
      SET "closedAt" = ${input.closedAt}, "expectedClosingCash" = ${input.expectedClosingCash},
        "countedClosingCash" = ${input.countedClosingCash}, "closingDifference" = ${input.closingDifference}
      WHERE "businessId" = ${input.businessId} AND "id" = ${input.registerDayId} AND "closedAt" IS NULL
      RETURNING "id", "businessId", "openedAt", "closedAt", "openingCash",
        "expectedClosingCash", "countedClosingCash", "closingDifference"
    `)
    if (!rows[0]) throw new Error('cash register day disappeared while locked')
    return rows[0]
  }
}

export function projectApprovedDepositPaymentInTransaction(
  transaction: Prisma.TransactionClient,
  input: { businessId: string; bookingDepositId: string; origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT' }
) {
  return new PrismaCashTransactionRepository(transaction).projectApprovedDeposit(input)
}

export function createCashTransactionRepository(transaction: Prisma.TransactionClient): CashTransactionRepository {
  return new PrismaCashTransactionRepository(transaction)
}
