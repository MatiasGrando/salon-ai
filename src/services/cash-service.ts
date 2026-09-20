import { createHash, randomUUID } from 'node:crypto'
import {
  assertIanaTimezone,
  assertEntryAmount,
  assertMoney,
  calculateAppointmentDiscountAmount,
  calculateAccountTotals,
  resolveRegisterOpeningCash,
  signedAmount,
  summarizeCashRegister
} from './cash-domain.js'
import type {
  AppointmentBackfillEvidence,
  CashEntryForSummary,
  CashRepository,
  CashRegisterDayRecord,
  CashSessionRecord,
  CashTransactionRepository
} from '../repositories/prisma-cash-repository.js'

export class CashServiceError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'CashServiceError'
  }
}

export function normalizeCashPeriodRange(from: string, to: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CashServiceError('INVALID_CASH_PERIOD')
    const [year, month, day] = value.split('-').map(Number)
    const instant = new Date(Date.UTC(year!, month! - 1, day!))
    if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month! - 1 || instant.getUTCDate() !== day) {
      throw new CashServiceError('INVALID_CASH_PERIOD')
    }
    return instant.getTime()
  }
  const fromMs = parse(from)
  const toMs = parse(to)
  const days = Math.floor((toMs - fromMs) / 86_400_000) + 1
  if (days < 1) throw new CashServiceError('INVALID_CASH_PERIOD')
  if (days > 31) throw new CashServiceError('CASH_PERIOD_TOO_LONG')
  return { from, to, days }
}

export class CashService {
  constructor(private readonly repository: CashRepository) {}

  async openRegisterDay(input: {
    businessId: string
    responsibleUserId: string
    openingCash?: number | null
  }) {
    const firstOpeningCash = input.openingCash === undefined || input.openingCash === null
      ? null
      : assertMoney(input.openingCash)

    return this.repository.transaction(async (transaction) => {
      const context = await requireBusinessContext(transaction, input.businessId)
      const responsible = await requireResponsible(transaction, input.businessId, input.responsibleUserId)
      if (await transaction.findOpenDay(input.businessId)) throw new CashServiceError('OPEN_DAY_EXISTS')

      const previousCountedCash = await transaction.findPreviousCountedCash(input.businessId)
      const openingCash = resolveRegisterOpeningCash({ previousCountedCash, firstOpeningCash })
      const day = await transaction.createDay({
        id: randomUUID(),
        businessId: input.businessId,
        openedAt: context.dbNow,
        openingCash
      })
      const session = await transaction.createSession({
        id: randomUUID(),
        businessId: input.businessId,
        registerDayId: day.id,
        responsibleUserId: responsible.id,
        responsibleName: responsible.name,
        openedAt: context.dbNow
      })
      return { day, session }
    })
  }

  async startNewSession(input: {
    businessId: string
    currentSessionId: string
    responsibleUserId: string
    countedCash: number
    acknowledgeDifference?: boolean
  }) {
    const countedCash = assertMoney(input.countedCash)
    return this.repository.transaction(async (transaction) => {
      const context = await requireBusinessContext(transaction, input.businessId)
      const { day, session } = await requireCurrentState(transaction, input.businessId, input.currentSessionId)
      const responsible = await requireResponsible(transaction, input.businessId, input.responsibleUserId)
      const [entries, sessions] = await Promise.all([
        transaction.listDayEntries(input.businessId, day.id),
        transaction.listDaySessions(input.businessId, day.id)
      ])
      const expectedCash = expectedCashForSession(day, session, sessions, entries)
      if (countedCash !== expectedCash && input.acknowledgeDifference !== true) {
        throw new CashServiceError('CASH_DIFFERENCE_CONFIRMATION_REQUIRED')
      }
      const closedSession = await transaction.closeSession({
        businessId: input.businessId,
        sessionId: session.id,
        closedAt: context.dbNow,
        expectedCash,
        countedCash,
        cashDifference: countedCash - expectedCash
      })
      const nextSession = await transaction.createSession({
        id: randomUUID(),
        businessId: input.businessId,
        registerDayId: day.id,
        responsibleUserId: responsible.id,
        responsibleName: responsible.name,
        openedAt: context.dbNow
      })
      return { day, closedSession, session: nextSession }
    })
  }

  async closeRegisterDay(input: {
    businessId: string
    currentSessionId: string
    countedCash: number
    acknowledgeDifference?: boolean
  }) {
    const countedCash = assertMoney(input.countedCash)
    return this.repository.transaction(async (transaction) => {
      const context = await requireBusinessContext(transaction, input.businessId)
      const { day, session } = await requireCurrentState(transaction, input.businessId, input.currentSessionId)
      const [entries, sessions] = await Promise.all([
        transaction.listDayEntries(input.businessId, day.id),
        transaction.listDaySessions(input.businessId, day.id)
      ])
      const sessionExpectedCash = expectedCashForSession(day, session, sessions, entries)
      const dayExpectedCash = summarizeCashRegister({ openingCash: day.openingCash, entries }).expectedCash
      const sessionCashDifference = countedCash - sessionExpectedCash
      const dayCashDifference = countedCash - dayExpectedCash
      if (sessionCashDifference !== 0 && input.acknowledgeDifference !== true) {
        throw new CashServiceError('CASH_DIFFERENCE_CONFIRMATION_REQUIRED')
      }
      const closedSession = await transaction.closeSession({
        businessId: input.businessId,
        sessionId: session.id,
        closedAt: context.dbNow,
        expectedCash: sessionExpectedCash,
        countedCash,
        cashDifference: sessionCashDifference
      })
      const closedDay = await transaction.closeDay({
        businessId: input.businessId,
        registerDayId: day.id,
        closedAt: context.dbNow,
        expectedClosingCash: dayExpectedCash,
        countedClosingCash: countedCash,
        closingDifference: dayCashDifference
      })
      return { day: closedDay, session: closedSession }
    })
  }

  async backfillAppointmentAccounts(input: {
    businessId: string
    batchSize?: number
    afterAppointmentId?: string | null
  }) {
    const batchSize = input.batchSize ?? 100
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new CashServiceError('INVALID_BACKFILL_BATCH_SIZE')
    }
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const appointmentIds = await transaction.findUnlinkedAppointmentIds(
        input.businessId,
        input.afterAppointmentId ?? null,
        batchSize
      )
      const report = {
        scanned: appointmentIds.length,
        accountsCreated: 0,
        linksCreated: 0,
        legacyEntriesCreated: 0,
        conflicts: [] as Array<{ code: string; appointmentIds: string[] }>,
        nextCursor: appointmentIds.length === batchSize ? appointmentIds.at(-1)! : null as string | null
      }
      const handledSources = new Set<string>()

      for (const appointmentId of appointmentIds) {
        const evidence = await transaction.loadAppointmentBackfillGroup(input.businessId, appointmentId)
        const plan = buildAppointmentAccountBackfillPlan(evidence)
        if (!plan.ok) {
          report.conflicts.push({ code: plan.code, appointmentIds: plan.appointmentIds })
          continue
        }
        if (handledSources.has(plan.sourceKey)) continue
        handledSources.add(plan.sourceKey)

        const accountId = deterministicFinancialId('cash_account', input.businessId, plan.sourceKey)
        const existingLinks = await Promise.all(plan.appointmentIds.map((linkedAppointmentId) => (
          transaction.resolveAppointmentAccount(input.businessId, linkedAppointmentId)
        )))
        if (existingLinks.some((account) => account !== null && account.id !== accountId)) {
          report.conflicts.push({ code: 'APPOINTMENT_LINK_CONFLICT', appointmentIds: plan.appointmentIds })
          continue
        }
        const ensured = await transaction.ensureAppointmentAccount({
          id: accountId,
          businessId: input.businessId,
          pricingMode: plan.pricingMode,
          agreedAmount: plan.agreedAmount,
          originalAmount: plan.originalAmount,
          minimumAmount: plan.minimumAmount
        })
        if (
          ensured.account.pricingMode !== plan.pricingMode
          || ensured.account.agreedAmount !== plan.agreedAmount
          || ensured.account.originalAmount !== plan.originalAmount
          || ensured.account.minimumAmount !== plan.minimumAmount
        ) {
          report.conflicts.push({ code: 'ACCOUNT_SNAPSHOT_CONFLICT', appointmentIds: plan.appointmentIds })
          continue
        }
        if (ensured.created) report.accountsCreated += 1

        let linksValid = true
        for (const linkedAppointmentId of plan.appointmentIds) {
          const link = await transaction.ensureAppointmentAccountLink({
            businessId: input.businessId,
            appointmentId: linkedAppointmentId,
            accountId
          })
          if (!link.linked) {
            linksValid = false
            report.conflicts.push({ code: 'APPOINTMENT_LINK_CONFLICT', appointmentIds: [linkedAppointmentId] })
          } else if (link.created) {
            report.linksCreated += 1
          }
        }
        if (!linksValid) continue

        for (const payment of plan.legacyPayments) {
          const created = await transaction.ensureLegacyPayment({
            id: legacyPaymentEntryId(input.businessId, payment.appointmentId),
            businessId: input.businessId,
            appointmentId: payment.appointmentId,
            accountId,
            amount: payment.amount
          })
          if (created) report.legacyEntriesCreated += 1
        }
      }
      return report
    })
  }

  async backfillApprovedDeposits(input: {
    businessId: string
    batchSize?: number
    afterDepositId?: string | null
  }) {
    const batchSize = input.batchSize ?? 100
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new CashServiceError('INVALID_BACKFILL_BATCH_SIZE')
    }
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const deposits = await transaction.findApprovedDepositsForBackfill(
        input.businessId,
        input.afterDepositId ?? null,
        batchSize
      )
      const report = {
        scanned: deposits.length,
        created: 0,
        replayed: 0,
        conflicts: [] as Array<{ depositId: string; code: string }>,
        nextCursor: deposits.length === batchSize ? deposits.at(-1)!.id : null as string | null
      }
      for (const deposit of deposits) {
        try {
          const projected = await transaction.projectApprovedDeposit({
            businessId: input.businessId,
            bookingDepositId: deposit.id,
            origin: deposit.origin
          })
          if (projected.created) report.created += 1
          else report.replayed += 1
        } catch (error) {
          report.conflicts.push({
            depositId: deposit.id,
            code: error instanceof Error ? error.message : 'APPROVED_DEPOSIT_NOT_PROJECTABLE'
          })
        }
      }
      return report
    })
  }

  async resolveAppointmentAccount(input: { businessId: string; appointmentId: string }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) return null
      return transaction.resolveAppointmentAccount(input.businessId, input.appointmentId)
    })
  }

  async listAppointmentFinanceSummaries(input: { businessId: string; appointmentIds: string[] }) {
    const appointmentIds = Array.from(new Set(input.appointmentIds.filter(Boolean)))
    if (!appointmentIds.length) return []
    return this.repository.transaction(async (transaction) => {
      const rows = await transaction.listAppointmentFinanceSummaryRows(input.businessId, appointmentIds)
      return rows.flatMap((row) => {
        if (row.agreedAmount === null) return []
        const totals = calculateAccountTotals({
          agreedAmount: row.agreedAmount,
          discountAmount: row.discountAmount,
          entries: row.paidAmount > 0
            ? [{ type: 'PAYMENT', direction: 'INFLOW', amount: row.paidAmount }]
            : []
        })
        return [{
          appointmentId: row.appointmentId,
          accountId: row.accountId,
          pricingMode: row.pricingMode,
          originalAmount: row.originalAmount,
          minimumAmount: row.minimumAmount,
          ...totals
        }]
      })
    })
  }

  async getAppointmentFinance(input: { businessId: string; appointmentId: string }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const account = await ensureAppointmentAccountForPayment(transaction, input.businessId, input.appointmentId)
      return accountFinance(transaction, account)
    })
  }

  async setEstimatedAppointmentTotal(input: {
    businessId: string
    appointmentId: string
    agreedAmount: number
    actorUserId?: string | null
    actorName?: string
    reason?: string
  }) {
    const agreedAmount = assertMoney(input.agreedAmount)
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const account = await ensureAppointmentAccountForPayment(transaction, input.businessId, input.appointmentId)
      if (account.pricingMode !== 'ESTIMATED') throw new CashServiceError('FIXED_PRICE_IMMUTABLE')
      if (account.agreedAmount === agreedAmount) return account
      return adjustAppointmentTotalInTransaction(transaction, account, {
        businessId: input.businessId,
        newAmount: agreedAmount,
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName?.trim() || 'Sistema',
        reason: input.reason?.trim() || 'Definición del total estimado'
      })
    })
  }

  async adjustAppointmentTotal(input: {
    businessId: string
    appointmentId: string
    newAmount: number
    reason: string
    actorUserId: string
    actorName: string
  }) {
    const reason = input.reason.trim()
    if (!reason || reason.length > 300) throw new CashServiceError('TOTAL_ADJUSTMENT_REASON_REQUIRED')
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const account = await ensureAppointmentAccountForPayment(transaction, input.businessId, input.appointmentId)
      return adjustAppointmentTotalInTransaction(transaction, account, {
        businessId: input.businessId,
        newAmount: input.newAmount,
        actorUserId: input.actorUserId,
        actorName: input.actorName.trim() || 'Usuario',
        reason
      })
    })
  }

  async setAppointmentDiscount(input: {
    businessId: string
    appointmentId: string
    discountAmount?: number
    discountType?: 'AMOUNT' | 'PERCENTAGE'
    discountValue?: number
  }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const account = await ensureAppointmentAccountForPayment(transaction, input.businessId, input.appointmentId)
      if (account.agreedAmount === null) throw new CashServiceError('ESTIMATED_TOTAL_REQUIRED')
      const discountAmount = input.discountAmount !== undefined
        ? assertMoney(input.discountAmount, 'INVALID_DISCOUNT_AMOUNT')
        : calculateAppointmentDiscountAmount({
            agreedAmount: account.agreedAmount,
            discountType: input.discountType as 'AMOUNT' | 'PERCENTAGE',
            discountValue: input.discountValue as number
          })
      const entries = await transaction.listAccountEntries(input.businessId, account.id)
      calculateAccountTotals({ agreedAmount: account.agreedAmount, discountAmount, entries })
      return transaction.updateDiscount(input.businessId, account.id, discountAmount)
    })
  }

  async recordAppointmentPayment(input: {
    businessId: string
    appointmentId: string
    cashSessionId: string
    origin: 'AGENDA' | 'CASH_REGISTER'
    lines: Array<{ amount: number; method: 'CASH' | 'TRANSFER' | 'CARD' }>
    observation?: string | null
    completeAppointment?: boolean
    actorUserId?: string
    actorName?: string
  }) {
    if (!input.lines.length) throw new CashServiceError('PAYMENT_LINES_REQUIRED')
    if (input.completeAppointment && (!input.actorUserId?.trim() || !input.actorName?.trim())) {
      throw new CashServiceError('APPOINTMENT_COMPLETION_ACTOR_REQUIRED')
    }
    const lines = input.lines.map((line) => ({ amount: assertEntryAmount(line.amount), method: line.method }))
    if (lines.some((line) => !['CASH', 'TRANSFER', 'CARD'].includes(line.method))) {
      throw new CashServiceError('INVALID_PAYMENT_METHOD')
    }
    return this.repository.transaction(async (transaction) => {
      const context = await transaction.lockBusiness(input.businessId)
      if (!context) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const { day, session } = await requireCurrentState(transaction, input.businessId, input.cashSessionId)
      const account = await ensureAppointmentAccountForPayment(transaction, input.businessId, input.appointmentId)
      if (account.agreedAmount === null) throw new CashServiceError('ESTIMATED_TOTAL_REQUIRED')
      const currentEntries = await transaction.listAccountEntries(input.businessId, account.id)
      const paymentTotal = lines.reduce((total, line) => total + line.amount, 0)
      const current = calculateAccountTotals({ agreedAmount: account.agreedAmount, discountAmount: account.discountAmount, entries: currentEntries })
      if (paymentTotal > current.balanceAmount) throw new CashServiceError('OVERPAYMENT')
      if (input.completeAppointment && paymentTotal !== current.balanceAmount) {
        throw new CashServiceError('APPOINTMENT_COMPLETION_REQUIRES_FULL_PAYMENT')
      }
      const entries = await transaction.insertManualPayments({
        ids: lines.map(() => randomUUID()),
        businessId: input.businessId,
        accountId: account.id,
        registerDayId: day.id,
        cashSessionId: session.id,
        origin: input.origin,
        observation: input.observation?.trim() || null,
        effectiveAt: context.dbNow,
        lines
      })
      const completion = input.completeAppointment
        ? await transaction.completeAppointmentFromPayment({
            businessId: input.businessId,
            appointmentId: input.appointmentId,
            completedAt: context.dbNow,
            actorUserId: input.actorUserId!.trim(),
            actorName: input.actorName!.trim()
          })
        : null
      if (input.completeAppointment && !completion) throw new CashServiceError('APPOINTMENT_COMPLETION_NOT_ALLOWED')
      return {
        entries,
        completion,
        finance: calculateAccountTotals({
          agreedAmount: account.agreedAmount,
          discountAmount: account.discountAmount,
          entries: [...currentEntries, ...lines.map((line) => ({ ...line, type: 'PAYMENT' as const, direction: 'INFLOW' as const }))]
        })
      }
    })
  }

  async projectApprovedDeposit(input: {
    businessId: string
    bookingDepositId: string
    origin: 'WEB_DEPOSIT' | 'BOT_DEPOSIT'
  }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      return transaction.projectApprovedDeposit(input)
    })
  }

  async recordCashOperation(input: CashOperationInput) {
    const normalized = normalizeCashOperation(input)
    return this.repository.transaction(async (transaction) => {
      const context = await transaction.lockBusiness(input.businessId)
      if (!context) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const { day, session } = await requireCurrentState(transaction, input.businessId, input.cashSessionId)
      let expenseCategoryId: string | null = null
      if (input.type === 'EXPENSE') {
        const fallback = await transaction.ensureDefaultExpenseCategory({ id: randomUUID(), businessId: input.businessId })
        const category = input.categoryId
          ? await transaction.findExpenseCategory(input.businessId, requiredText(input.categoryId, 'EXPENSE_CATEGORY_REQUIRED'))
          : fallback
        if (!category) throw new CashServiceError('EXPENSE_CATEGORY_NOT_FOUND')
        if (!category.isActive) throw new CashServiceError('EXPENSE_CATEGORY_INACTIVE')
        expenseCategoryId = category.id
      }
      return transaction.insertCashOperation({
        id: randomUUID(),
        businessId: input.businessId,
        registerDayId: day.id,
        cashSessionId: session.id,
        effectiveAt: context.dbNow,
        expenseCategoryId,
        ...normalized
      })
    })
  }

  async listExpenseCategories(input: { businessId: string; includeInactive?: boolean }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      await transaction.ensureDefaultExpenseCategory({ id: randomUUID(), businessId: input.businessId })
      return transaction.listExpenseCategories(input.businessId, input.includeInactive === true)
    })
  }

  async createExpenseCategory(input: { businessId: string; name: string; position?: number }) {
    const name = normalizeExpenseCategoryName(input.name)
    const normalizedName = expenseCategoryKey(name)
    const position = normalizeCategoryPosition(input.position)
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      await transaction.ensureDefaultExpenseCategory({ id: randomUUID(), businessId: input.businessId })
      const category = await transaction.createExpenseCategory({ id: randomUUID(), businessId: input.businessId, name, normalizedName, position })
      if (!category) throw new CashServiceError('EXPENSE_CATEGORY_DUPLICATE')
      return category
    })
  }

  async updateExpenseCategory(input: { businessId: string; categoryId: string; name: string; position?: number; isActive?: boolean }) {
    const categoryId = requiredText(input.categoryId, 'EXPENSE_CATEGORY_REQUIRED')
    const name = normalizeExpenseCategoryName(input.name)
    const normalizedName = expenseCategoryKey(name)
    const position = normalizeCategoryPosition(input.position)
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      await transaction.ensureDefaultExpenseCategory({ id: randomUUID(), businessId: input.businessId })
      const current = await transaction.findExpenseCategory(input.businessId, categoryId)
      if (!current) throw new CashServiceError('EXPENSE_CATEGORY_NOT_FOUND')
      const isActive = input.isActive ?? current.isActive
      if (current.isDefault && (name !== 'Otros' || !isActive)) {
        throw new CashServiceError('DEFAULT_EXPENSE_CATEGORY_PROTECTED')
      }
      const updated = await transaction.updateExpenseCategory({ businessId: input.businessId, categoryId, name, normalizedName, position, isActive })
      if (!updated) throw new CashServiceError('EXPENSE_CATEGORY_DUPLICATE')
      return updated
    })
  }

  async reverseCashEntry(input: {
    businessId: string
    cashSessionId: string
    entryId: string
    observation?: string | null
    allowedSourceTypes?: CashEntryForSummary['type'][]
  }) {
    const entryId = requiredText(input.entryId, 'ENTRY_ID_REQUIRED')
    const observation = optionalText(input.observation)
    return this.repository.transaction(async (transaction) => {
      const context = await transaction.lockBusiness(input.businessId)
      if (!context) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const { day, session } = await requireCurrentState(transaction, input.businessId, input.cashSessionId)
      const source = await transaction.lockCashEntry(input.businessId, entryId)
      if (!source) throw new CashServiceError('ENTRY_NOT_FOUND')
      if (input.allowedSourceTypes && !input.allowedSourceTypes.includes(source.type)) {
        throw new CashServiceError('CASH_PERMISSION_REQUIRED')
      }
      if (source.type === 'REVERSAL' || source.reversedById) throw new CashServiceError('ENTRY_NOT_REVERSIBLE')
      return transaction.insertCashReversal({
        id: randomUUID(),
        businessId: input.businessId,
        registerDayId: day.id,
        cashSessionId: session.id,
        source,
        observation,
        effectiveAt: context.dbNow
      })
    })
  }

  async getCurrentCashRegister(input: { businessId: string }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const day = await transaction.findOpenDay(input.businessId)
      if (!day) return { day: null, session: null, summary: null }
      const session = await transaction.findOpenSession(input.businessId, day.id)
      if (!session) throw new CashServiceError('CASH_CLOSED')
      const [entries, sessions] = await Promise.all([
        transaction.listDayEntries(input.businessId, day.id),
        transaction.listDaySessions(input.businessId, day.id)
      ])
      return {
        day,
        session,
        sessions,
        sessionExpectedCash: expectedCashForSession(day, session, sessions, entries),
        summary: summarizeCashRegister({ openingCash: day.openingCash, entries })
      }
    })
  }

  async getCurrentPaymentContext(input: { businessId: string }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const day = await transaction.findOpenDay(input.businessId)
      if (!day) return { day: null, session: null }
      const session = await transaction.findOpenSession(input.businessId, day.id)
      return {
        day: { id: day.id },
        session: session ? { id: session.id } : null
      }
    })
  }

  async listCashRegisterDays(input: { businessId: string; limit?: number }) {
    const limit = input.limit ?? 100
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CashServiceError('INVALID_LIMIT')
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      return transaction.listRegisterDays(input.businessId, limit)
    })
  }

  async getCashRegisterDaySummary(input: { businessId: string; registerDayId: string }) {
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      const day = await transaction.findRegisterDay(input.businessId, input.registerDayId)
      if (!day) throw new CashServiceError('REGISTER_DAY_NOT_FOUND')
      const [entries, sessions] = await Promise.all([
        transaction.listDayEntries(input.businessId, day.id),
        transaction.listDaySessions(input.businessId, day.id)
      ])
      return { day, sessions, summary: summarizeCashRegister({ openingCash: day.openingCash, entries }) }
    })
  }

  async listCashEntries(input: {
    businessId: string
    registerDayId: string
    cursor?: string | null
    limit?: number
    type?: CashEntryForSummary['type'] | null
    method?: CashEntryForSummary['method'] | null
    expenseCategoryId?: string | null
    cashSessionId?: string | null
    query?: string | null
  }) {
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CashServiceError('INVALID_LIMIT')
    const cursor = input.cursor ? decodeCashCursor(input.cursor) : null
    return this.repository.transaction(async (transaction) => {
      if (!await transaction.lockBusiness(input.businessId)) throw new CashServiceError('BUSINESS_NOT_FOUND')
      if (!await transaction.findRegisterDay(input.businessId, input.registerDayId)) {
        throw new CashServiceError('REGISTER_DAY_NOT_FOUND')
      }
      const expenseCategoryId = input.expenseCategoryId?.trim() || null
      if (expenseCategoryId && !await transaction.findExpenseCategory(input.businessId, expenseCategoryId)) {
        throw new CashServiceError('EXPENSE_CATEGORY_NOT_FOUND')
      }
      const rows = await transaction.listCashEntries({
        businessId: input.businessId,
        registerDayId: input.registerDayId,
        cursor,
        limit: limit + 1,
        type: input.type ?? null,
        method: input.method ?? null,
        expenseCategoryId,
        cashSessionId: input.cashSessionId?.trim() || null,
        query: input.query?.trim() || null
      })
      const hasMore = rows.length > limit
      const entries = hasMore ? rows.slice(0, limit) : rows
      const last = entries.at(-1)
      return {
        entries,
        nextCursor: hasMore && last?.effectiveAt ? encodeCashCursor(last.effectiveAt, last.id) : null
      }
    })
  }

  async getCashPeriodSummary(input: { businessId: string; from: string; to: string }) {
    const period = normalizeCashPeriodRange(input.from, input.to)
    return this.repository.transaction(async (transaction) => {
      const context = await requireBusinessContext(transaction, input.businessId)
      const timezone = assertIanaTimezone(context.timezone)
      const entries = await transaction.listPeriodEntries(input.businessId, { ...period, timezone })
      const base = summarizeCashRegister({ openingCash: 0, entries })
      const expenseByCategory = new Map<string, number>()
      for (const entry of entries) {
        const effectiveType = entry.type === 'REVERSAL' ? entry.reversedEntryType : entry.type
        if (effectiveType !== 'EXPENSE') continue
        const name = entry.expenseCategoryName?.trim() || 'Otros'
        expenseByCategory.set(name, (expenseByCategory.get(name) ?? 0) - signedAmount(entry))
      }
      const netSales = base.grossCollected - base.refunds
      return {
        period,
        summary: {
          grossCollected: base.grossCollected,
          collectedByMethod: base.collectedByMethod,
          refunds: base.refunds,
          netSales,
          expenses: base.expenses,
          operatingResult: netSales - base.expenses,
          withdrawals: base.withdrawals,
          cashIn: base.cashIn,
          adjustments: base.adjustments,
          expenseByCategory: Array.from(expenseByCategory, ([name, amount]) => ({ name, amount }))
            .filter((item) => item.amount !== 0)
            .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name))
        }
      }
    })
  }

  async listCashPeriodExpenses(input: {
    businessId: string
    from: string
    to: string
    page?: number
    pageSize?: number
    method?: CashEntryForSummary['method'] | null
    expenseCategoryId?: string | null
    query?: string | null
  }) {
    const period = normalizeCashPeriodRange(input.from, input.to)
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 10
    if (!Number.isInteger(page) || page < 1) throw new CashServiceError('INVALID_PAGE')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new CashServiceError('INVALID_PAGE_SIZE')
    return this.repository.transaction(async (transaction) => {
      const context = await requireBusinessContext(transaction, input.businessId)
      const timezone = assertIanaTimezone(context.timezone)
      const expenseCategoryId = input.expenseCategoryId?.trim() || null
      if (expenseCategoryId && !await transaction.findExpenseCategory(input.businessId, expenseCategoryId)) {
        throw new CashServiceError('EXPENSE_CATEGORY_NOT_FOUND')
      }
      const rows = await transaction.listPeriodExpenses({
        businessId: input.businessId,
        ...period,
        timezone,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        method: input.method ?? null,
        expenseCategoryId,
        query: input.query?.trim() || null
      })
      const total = rows[0]?.totalCount ?? 0
      return {
        period,
        entries: rows.map(({ totalCount: _totalCount, ...entry }) => entry),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    })
  }
}

export type CashOperationInput = {
  businessId: string
  cashSessionId: string
} & (
  | { type: 'EXPENSE'; amount: number; method?: 'CASH' | 'TRANSFER' | 'CARD'; description: string; categoryId?: string | null; observation?: string | null }
  | { type: 'WITHDRAWAL'; amount: number; counterparty: string; observation?: string | null }
  | { type: 'CASH_IN'; amount: number; description: string; observation?: string | null }
  | { type: 'ADJUSTMENT'; delta: number; observation: string }
  | { type: 'REFUND'; amount: number; method: 'CASH' | 'TRANSFER' | 'CARD'; description: string; observation?: string | null }
)

function normalizeCashOperation(input: CashOperationInput) {
  if (input.type === 'ADJUSTMENT') {
    const delta = input.delta
    if (!Number.isSafeInteger(delta) || delta === 0) throw new CashServiceError('INVALID_ADJUSTMENT_DELTA')
    return {
      type: input.type,
      direction: delta > 0 ? 'INFLOW' as const : 'OUTFLOW' as const,
      amount: assertEntryAmount(Math.abs(delta)),
      method: 'CASH' as const,
      description: null,
      counterparty: null,
      observation: requiredText(input.observation, 'OBSERVATION_REQUIRED')
    }
  }
  const amount = assertEntryAmount(input.amount)
  const observation = optionalText(input.observation)
  if (input.type === 'WITHDRAWAL') {
    return {
      type: input.type,
      direction: 'OUTFLOW' as const,
      amount,
      method: 'CASH' as const,
      description: null,
      counterparty: requiredText(input.counterparty, 'COUNTERPARTY_REQUIRED'),
      observation
    }
  }
  if (input.type === 'CASH_IN') {
    return {
      type: input.type,
      direction: 'INFLOW' as const,
      amount,
      method: 'CASH' as const,
      description: requiredText(input.description, 'DESCRIPTION_REQUIRED'),
      counterparty: null,
      observation
    }
  }
  const method = input.method ?? 'CASH'
  if (!['CASH', 'TRANSFER', 'CARD'].includes(method)) throw new CashServiceError('INVALID_PAYMENT_METHOD')
  return {
    type: input.type,
    direction: 'OUTFLOW' as const,
    amount,
    method,
    description: requiredText(input.description, 'DESCRIPTION_REQUIRED'),
    counterparty: null,
    observation
  }
}

function requiredText(value: string, code: string) {
  const normalized = value?.trim()
  if (!normalized) throw new CashServiceError(code)
  return normalized
}

function optionalText(value: string | null | undefined) {
  return value?.trim() || null
}

function normalizeExpenseCategoryName(value: string) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 60) throw new CashServiceError('INVALID_EXPENSE_CATEGORY_NAME')
  return normalized
}

function expenseCategoryKey(name: string) {
  return name.toLocaleLowerCase('es-AR')
}

function normalizeCategoryPosition(value: number | undefined) {
  const position = value ?? 0
  if (!Number.isSafeInteger(position) || position < 0 || position > 10_000) {
    throw new CashServiceError('INVALID_EXPENSE_CATEGORY_POSITION')
  }
  return position
}

function encodeCashCursor(effectiveAt: Date, id: string) {
  return Buffer.from(JSON.stringify([effectiveAt.toISOString(), id]), 'utf8').toString('base64url')
}

function decodeCashCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw new Error('invalid shape')
    }
    const effectiveAt = new Date(parsed[0])
    if (Number.isNaN(effectiveAt.getTime()) || !parsed[1]) throw new Error('invalid values')
    return { effectiveAt, id: parsed[1] }
  } catch {
    throw new CashServiceError('INVALID_CURSOR')
  }
}

export type AppointmentAccountBackfillPlan = {
  ok: true
  sourceKey: string
  pricingMode: 'FIXED' | 'ESTIMATED'
  agreedAmount: number | null
  originalAmount: number | null
  minimumAmount: number
  appointmentIds: string[]
  legacyPayments: Array<{ appointmentId: string; amount: number }>
} | {
  ok: false
  code: 'MISSING_APPOINTMENT_EVIDENCE' | 'TENANT_MISMATCH' | 'INCONSISTENT_VISIT' | 'INCONSISTENT_COORDINATION_GROUP' | 'AMBIGUOUS_APPOINTMENT_GROUP' | 'INVALID_LEGACY_PAYMENT'
  appointmentIds: string[]
}

export function buildAppointmentAccountBackfillPlan(
  evidence: AppointmentBackfillEvidence[]
): AppointmentAccountBackfillPlan {
  const rows = [...evidence].sort((left, right) => left.appointmentId.localeCompare(right.appointmentId))
  const appointmentIds = rows.map((row) => row.appointmentId)
  if (!rows[0]) return { ok: false, code: 'MISSING_APPOINTMENT_EVIDENCE', appointmentIds }
  if (rows.some((row) => row.businessId !== rows[0]!.businessId || !row.tenantConsistent)) {
    return { ok: false, code: 'TENANT_MISMATCH', appointmentIds }
  }

  const visitId = rows[0].visitId
  const coordinationGroupId = rows[0].coordinationGroupId
  let sourceKey: string
  if (visitId !== null) {
    if (rows.some((row) => row.visitId !== visitId || row.visitBusinessId !== row.businessId)) {
      return { ok: false, code: 'INCONSISTENT_VISIT', appointmentIds }
    }
    sourceKey = `visit:${visitId}`
  } else if (coordinationGroupId !== null && rows.length > 1) {
    if (rows.some((row) => row.visitId !== null || row.coordinationGroupId !== coordinationGroupId || row.origin !== 'WEB')) {
      return { ok: false, code: 'INCONSISTENT_COORDINATION_GROUP', appointmentIds }
    }
    sourceKey = `coordination:${coordinationGroupId}`
  } else if (rows.length === 1) {
    sourceKey = `appointment:${rows[0].appointmentId}`
  } else {
    return { ok: false, code: 'AMBIGUOUS_APPOINTMENT_GROUP', appointmentIds }
  }

  const amounts = rows.map(resolveBackfillAmount)
  const agreedAmount = visitId !== null
    ? rows[0].visitTotalPrice
    : amounts.every((amount): amount is number => amount !== null)
      ? amounts.reduce((total, amount) => total + amount, 0)
      : null
  const pricingMode = rows.some((row) => row.estimated) || agreedAmount === null ? 'ESTIMATED' : 'FIXED'
  const minimumAmounts = rows.map((row) => row.minimumPrice ?? row.primaryPrice)
  const estimatedMinimum = minimumAmounts.every((amount): amount is number => amount !== null)
    ? minimumAmounts.reduce((total, amount) => total + amount, 0)
    : agreedAmount ?? 0
  const originalAmount = agreedAmount
  const minimumAmount = pricingMode === 'ESTIMATED' ? estimatedMinimum : 0
  const legacyPayments: Array<{ appointmentId: string; amount: number }> = []
  for (const row of rows) {
    if (!row.manualDepositPaid) continue
    if (!Number.isSafeInteger(row.manualDepositAmount) || (row.manualDepositAmount ?? 0) <= 0) {
      return { ok: false, code: 'INVALID_LEGACY_PAYMENT', appointmentIds }
    }
    legacyPayments.push({ appointmentId: row.appointmentId, amount: row.manualDepositAmount! })
  }
  if (agreedAmount !== null && legacyPayments.reduce((total, payment) => total + payment.amount, 0) > agreedAmount) {
    return { ok: false, code: 'INVALID_LEGACY_PAYMENT', appointmentIds }
  }

  return { ok: true, sourceKey, pricingMode, agreedAmount, originalAmount, minimumAmount, appointmentIds, legacyPayments }
}

function resolveBackfillAmount(row: AppointmentBackfillEvidence) {
  if (row.visitId !== null) return row.visitTotalPrice
  if (row.quotedPrice !== null) return row.quotedPrice
  if (row.itemCount > 0) return row.pricedItemCount === row.itemCount ? row.itemTotal : null
  return row.primaryPrice
}

function deterministicFinancialId(prefix: string, businessId: string, sourceKey: string) {
  const digest = createHash('sha256').update(`${businessId}\u0000${sourceKey}`).digest('hex').slice(0, 40)
  return `${prefix}_${digest}`
}

export function legacyPaymentEntryId(businessId: string, appointmentId: string) {
  return deterministicFinancialId('cash_legacy', businessId, appointmentId)
}

async function requireBusinessContext(transaction: CashTransactionRepository, businessId: string) {
  const context = await transaction.lockBusiness(businessId)
  if (!context) throw new CashServiceError('BUSINESS_NOT_FOUND')
  assertIanaTimezone(context.timezone)
  return context
}

async function requireResponsible(
  transaction: CashTransactionRepository,
  businessId: string,
  responsibleUserId: string
) {
  const responsible = await transaction.findResponsible(businessId, responsibleUserId)
  if (!responsible) throw new CashServiceError('RESPONSIBLE_NOT_FOUND')
  return responsible
}

async function requireCurrentState(
  transaction: CashTransactionRepository,
  businessId: string,
  currentSessionId: string
) {
  const day = await transaction.findOpenDay(businessId)
  if (!day) throw new CashServiceError('CASH_CLOSED')
  const session = await transaction.findOpenSession(businessId, day.id)
  if (!session) throw new CashServiceError('CASH_CLOSED')
  if (session.id !== currentSessionId) throw new CashServiceError('STALE_SESSION')
  return { day, session }
}

function expectedCashForSession(
  day: CashRegisterDayRecord,
  session: CashSessionRecord,
  sessions: CashSessionRecord[],
  entries: CashEntryForSummary[]
) {
  const sessionIndex = sessions.findIndex((candidate) => candidate.id === session.id)
  const previousSession = sessionIndex > 0 ? sessions[sessionIndex - 1] : null
  const openingCash = previousSession?.countedCash ?? previousSession?.expectedCash ?? day.openingCash
  const sessionEntries = entries.filter((entry) => entry.cashSessionId === session.id)
  return summarizeCashRegister({ openingCash, entries: sessionEntries }).expectedCash
}

async function requireAppointmentAccount(
  transaction: CashTransactionRepository,
  businessId: string,
  appointmentId: string
) {
  const account = await transaction.lockAppointmentAccount(businessId, appointmentId)
  if (!account) throw new CashServiceError('APPOINTMENT_ACCOUNT_NOT_FOUND')
  return account
}

export async function ensureAppointmentAccountForPayment(
  transaction: CashTransactionRepository,
  businessId: string,
  appointmentId: string
) {
  const existing = await transaction.lockAppointmentAccount(businessId, appointmentId)
  if (existing) return existing
  const plan = buildAppointmentAccountBackfillPlan(await transaction.loadAppointmentBackfillGroup(businessId, appointmentId))
  if (!plan.ok) throw new CashServiceError(plan.code)
  const accountId = deterministicFinancialId('cash_account', businessId, plan.sourceKey)
  const existingLinks = await Promise.all(plan.appointmentIds.map((id) => transaction.resolveAppointmentAccount(businessId, id)))
  if (existingLinks.some((account) => account !== null && account.id !== accountId)) {
    throw new CashServiceError('APPOINTMENT_LINK_CONFLICT')
  }
  await transaction.ensureAppointmentAccount({
    id: accountId,
    businessId,
    pricingMode: plan.pricingMode,
    agreedAmount: plan.agreedAmount,
    originalAmount: plan.originalAmount,
    minimumAmount: plan.minimumAmount
  })
  for (const id of plan.appointmentIds) {
    const link = await transaction.ensureAppointmentAccountLink({ businessId, appointmentId: id, accountId })
    if (!link.linked) throw new CashServiceError('APPOINTMENT_LINK_CONFLICT')
  }
  return requireAppointmentAccount(transaction, businessId, appointmentId)
}

async function accountFinance(
  transaction: CashTransactionRepository,
  account: { id: string; businessId: string; pricingMode: 'FIXED' | 'ESTIMATED'; agreedAmount: number | null; originalAmount: number | null; minimumAmount: number; discountAmount: number }
) {
  if (account.agreedAmount === null) throw new CashServiceError('ESTIMATED_TOTAL_REQUIRED')
  const [entries, totalAdjustments, productSubtotal] = await Promise.all([
    transaction.listAccountEntries(account.businessId, account.id),
    transaction.listTotalAdjustments(account.businessId, account.id),
    transaction.resolveAccountProductSubtotal(account.businessId, account.id)
  ])
  return {
    accountId: account.id,
    pricingMode: account.pricingMode,
    originalAmount: account.originalAmount,
    minimumAmount: account.minimumAmount,
    serviceSubtotal: account.agreedAmount - productSubtotal,
    productSubtotal,
    ...calculateAccountTotals({ agreedAmount: account.agreedAmount, discountAmount: account.discountAmount, entries }),
    entries,
    totalAdjustments
  }
}

async function adjustAppointmentTotalInTransaction(
  transaction: CashTransactionRepository,
  account: { id: string; businessId: string; pricingMode: 'FIXED' | 'ESTIMATED'; agreedAmount: number | null; originalAmount: number | null; minimumAmount: number; discountAmount: number },
  input: { businessId: string; newAmount: number; reason: string; actorUserId: string | null; actorName: string }
) {
  const newAmount = assertMoney(input.newAmount)
  if (newAmount === account.agreedAmount) throw new CashServiceError('TOTAL_UNCHANGED')
  if (newAmount < account.minimumAmount) {
    throw new CashServiceError('TOTAL_BELOW_MINIMUM')
  }
  const entries = await transaction.listAccountEntries(input.businessId, account.id)
  const totals = account.agreedAmount === null
    ? { paidAmount: 0 }
    : calculateAccountTotals({
        agreedAmount: account.agreedAmount,
        discountAmount: account.discountAmount,
        entries
      })
  if (newAmount < totals.paidAmount) throw new CashServiceError('TOTAL_BELOW_PAID')
  calculateAccountTotals({ agreedAmount: newAmount, discountAmount: account.discountAmount, entries })
  await transaction.insertTotalAdjustment({
    id: randomUUID(),
    businessId: input.businessId,
    accountId: account.id,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    reason: input.reason,
    previousAmount: account.agreedAmount,
    newAmount
  })
  return transaction.updateAdjustedTotal(input.businessId, account.id, newAmount)
}

export type CashRegisterState = {
  day: CashRegisterDayRecord
  session: CashSessionRecord
}
