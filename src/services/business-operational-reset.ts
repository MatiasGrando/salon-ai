import { prisma } from '../config/prisma.js'

export const OPERATIONAL_RESET_PHRASE = 'BORRAR DATOS DE PRUEBA'

export function operationalResetConfirmationMatches(input: {
  businessName: string
  confirmation: string
  phrase: string
}) {
  return input.confirmation.trim() === input.businessName.trim() &&
    input.phrase.trim() === OPERATIONAL_RESET_PHRASE
}

export type BusinessOperationalResetResult = {
  appointments: number
  bookingDeposits: number
  cashEntries: number
  treasuryMovements: number
  productSales: number
  professionalEntries: number
  cashSessions: number
  cashRegisterDays: number
  resetAt: string
}

export async function getBusinessOperationalResetPreview(businessId: string) {
  const [
    appointments,
    bookingDeposits,
    cashEntries,
    treasuryMovements,
    productSales,
    professionalEntries,
    cashSessions,
    cashRegisterDays
  ] = await Promise.all([
    prisma.appointment.count({ where: { businessId } }),
    prisma.bookingDeposit.count({ where: { businessId } }),
    prisma.cashEntry.count({ where: { businessId } }),
    prisma.treasuryMovement.count({ where: { businessId } }),
    prisma.productSale.count({ where: { businessId } }),
    prisma.professionalAccountEntry.count({ where: { businessId } }),
    prisma.cashSession.count({ where: { businessId } }),
    prisma.cashRegisterDay.count({ where: { businessId } })
  ])
  return {
    appointments,
    bookingDeposits,
    cashEntries,
    treasuryMovements,
    productSales,
    professionalEntries,
    cashSessions,
    cashRegisterDays
  }
}
export async function resetBusinessOperationalData(input: {
  businessId: string
  actorUserId: string
  actorName: string
  requestPath: string
}): Promise<BusinessOperationalResetResult> {
  return prisma.$transaction(async (transaction) => {
    const business = await transaction.business.findUnique({
      where: { id: input.businessId },
      select: { id: true }
    })
    if (!business) throw new Error('BUSINESS_NOT_FOUND')

    const counts = {
      appointments: await transaction.appointment.count({ where: { businessId: input.businessId } }),
      bookingDeposits: await transaction.bookingDeposit.count({ where: { businessId: input.businessId } }),
      cashEntries: await transaction.cashEntry.count({ where: { businessId: input.businessId } }),
      treasuryMovements: await transaction.treasuryMovement.count({ where: { businessId: input.businessId } }),
      productSales: await transaction.productSale.count({ where: { businessId: input.businessId } }),
      professionalEntries: await transaction.professionalAccountEntry.count({ where: { businessId: input.businessId } }),
      cashSessions: await transaction.cashSession.count({ where: { businessId: input.businessId } }),
      cashRegisterDays: await transaction.cashRegisterDay.count({ where: { businessId: input.businessId } })
    }

    // Cancel durable work before deleting the entities it references.
    await transaction.bookingDepositReviewOutbox.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDepositLateProofHandoff.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDepositReviewAudit.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDepositExpiryAudit.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDepositProof.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDepositLine.deleteMany({ where: { businessId: input.businessId } })

    // Remove dependent ledgers before their source documents.
    await transaction.appointmentChangeHistory.deleteMany({
      where: { appointment: { businessId: input.businessId } }
    })
    await transaction.professionalAccountEntry.deleteMany({ where: { businessId: input.businessId } })
    await transaction.treasuryMovement.deleteMany({ where: { businessId: input.businessId } })
    await transaction.cashEntry.deleteMany({ where: { businessId: input.businessId } })

    await transaction.productSaleAudit.deleteMany({ where: { businessId: input.businessId } })
    await transaction.productSaleLine.deleteMany({ where: { businessId: input.businessId } })
    await transaction.productSale.deleteMany({ where: { businessId: input.businessId } })

    await transaction.appointmentTotalAdjustment.deleteMany({ where: { businessId: input.businessId } })
    await transaction.appointmentAccountLink.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingDeposit.deleteMany({ where: { businessId: input.businessId } })
    await transaction.reminderDelivery.deleteMany({ where: { businessId: input.businessId } })
    await transaction.postSaleDelivery.deleteMany({ where: { businessId: input.businessId } })
    await transaction.appointmentServiceItem.deleteMany({
      where: { appointment: { businessId: input.businessId } }
    })

    // Preserve conversations and usage history, but remove pointers to deleted appointments.
    await transaction.conversation.updateMany({
      where: { businessId: input.businessId, opportunityAppointmentId: { not: null } },
      data: { opportunityAppointmentId: null }
    })
    await transaction.conversationOpportunityEvent.updateMany({
      where: { conversation: { businessId: input.businessId }, appointmentId: { not: null } },
      data: { appointmentId: null }
    })
    await transaction.aiUsageEvent.updateMany({
      where: { businessId: input.businessId, appointmentId: { not: null } },
      data: { appointmentId: null }
    })

    await transaction.appointment.deleteMany({ where: { businessId: input.businessId } })
    await transaction.bookingVisit.deleteMany({ where: { businessId: input.businessId } })
    await transaction.appointmentAccount.deleteMany({ where: { businessId: input.businessId } })
    await transaction.cashSession.deleteMany({ where: { businessId: input.businessId } })
    await transaction.cashRegisterDay.deleteMany({ where: { businessId: input.businessId } })

    const audit = await transaction.staffAuditLog.create({
      data: {
        businessId: input.businessId,
        userId: input.actorUserId,
        action: 'OPERATIONAL_TEST_DATA_RESET',
        entityType: 'Business',
        entityId: input.businessId,
        method: 'POST',
        path: input.requestPath
      },
      select: { createdAt: true }
    })

    return {
      ...counts,
      resetAt: audit.createdAt.toISOString()
    }
  }, { timeout: 30_000 })
}