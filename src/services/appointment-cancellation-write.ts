import type { Prisma } from '../generated/prisma/client.js'

/** Caller owns authorization, agenda locks and the transaction; this writes no financial state. */
export async function cancelAppointmentAgendaRowInTransaction(
  tx: Pick<Prisma.TransactionClient, 'appointment'>,
  input: { businessId: string; appointmentId: string; authorizedWhere?: Prisma.AppointmentWhereInput; expectedVersion?: number; confirmedOnly?: true; incrementVersion?: true }
): Promise<number> {
  const result=await tx.appointment.updateMany({
    where:{AND:[{id:input.appointmentId,businessId:input.businessId},...(input.authorizedWhere?[input.authorizedWhere]:[]),
      ...(input.expectedVersion===undefined?[]:[{version:input.expectedVersion}]),...(input.confirmedOnly?[{status:'CONFIRMED' as const}]:[])]},
    data:{status:'CANCELLED',...(input.incrementVersion?{version:{increment:1}}:{})}
  })
  return result.count
}
