export type BusinessAccountState = 'ONBOARDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED'

export function isBusinessAccountUnavailable(status?: string | null) {
  return status === 'PAUSED' || status === 'CANCELLED'
}

export function isBusinessAccountOperational(status?: string | null) {
  return status === 'ACTIVE'
}

export function businessAccountAccessMessage(status?: string | null) {
  if (status === 'PAUSED') return 'Esta cuenta esta pausada. Contacta a soporte para reactivarla.'
  if (status === 'CANCELLED') return 'Esta cuenta esta cancelada. Contacta a soporte si necesitas recuperarla.'
  if (status === 'ONBOARDING') return 'La cuenta todavia no fue activada.'
  return 'La cuenta no esta disponible en este momento.'
}
