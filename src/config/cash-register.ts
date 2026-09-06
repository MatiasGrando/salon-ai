export type CashRegisterConfig = {
  enabled: boolean
  legacyFallbackEnabled: boolean
}

type CashRegisterEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>

function strictBoolean(environment: CashRegisterEnvironment, name: string, fallback: boolean) {
  const value = environment[name]
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be exactly "true" or "false"`)
}

export function resolveCashRegisterConfig(environment: CashRegisterEnvironment): CashRegisterConfig {
  const config = {
    enabled: strictBoolean(environment, 'CASH_REGISTER_ENABLED', false),
    legacyFallbackEnabled: strictBoolean(environment, 'CASH_REGISTER_LEGACY_FALLBACK_ENABLED', true)
  }
  if (!config.legacyFallbackEnabled) {
    throw new Error('Cash register legacy fallback must remain enabled throughout the Caja MVP rollout')
  }
  return config
}
