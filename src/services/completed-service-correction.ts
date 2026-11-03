import { assertMoney } from './cash-domain.js'

export type CompletedServiceCorrectionImpact = {
  previousTotal: number
  newTotal: number
  refundAmount: number
  balanceAmount: number
}

export function calculateCompletedServiceCorrection(input: {
  previousServiceAmount: number
  newServiceAmount: number
  paidAmount: number
}): CompletedServiceCorrectionImpact {
  const previousTotal = assertMoney(input.previousServiceAmount)
  const newTotal = assertMoney(input.newServiceAmount)
  const paidAmount = assertMoney(input.paidAmount)
  if (paidAmount < newTotal) {
    return { previousTotal, newTotal, refundAmount: 0, balanceAmount: newTotal - paidAmount }
  }
  return { previousTotal, newTotal, refundAmount: paidAmount - newTotal, balanceAmount: 0 }
}
