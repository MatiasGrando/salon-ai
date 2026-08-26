export type BotOptionsConfig = {
  shadowAdmissionEnabled: boolean
  authoritativeProcessingEnabled: boolean
  workersEnabled: boolean
  senderEnabled: boolean
  bookingCapabilityEnabled: boolean
  depositsCapabilityEnabled: boolean
  appointmentManagementCapabilityEnabled: boolean
  handoffCapabilityEnabled: boolean
  legacyDispatchCoverageComplete: boolean
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>

function strictBoolean(env: Env, name: string): boolean {
  const value = env[name]
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be exactly "true" or "false"`)
}

export function resolveBotOptionsConfig(env: Env): BotOptionsConfig {
  const config: BotOptionsConfig = {
    shadowAdmissionEnabled: strictBoolean(env, 'BOT_OPTIONS_SHADOW_ADMISSION_ENABLED'),
    authoritativeProcessingEnabled: strictBoolean(env, 'BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED'),
    workersEnabled: strictBoolean(env, 'BOT_OPTIONS_WORKERS_ENABLED'),
    senderEnabled: strictBoolean(env, 'BOT_OPTIONS_SENDER_ENABLED'),
    bookingCapabilityEnabled: strictBoolean(env, 'BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED'),
    depositsCapabilityEnabled: strictBoolean(env, 'BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED'),
    appointmentManagementCapabilityEnabled: strictBoolean(env, 'BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED'),
    handoffCapabilityEnabled: strictBoolean(env, 'BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED'),
    legacyDispatchCoverageComplete: strictBoolean(env, 'BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE')
  }

  if (!config.authoritativeProcessingEnabled) {
    const dependentFlags: Array<[string, boolean]> = [
      ['BOT_OPTIONS_WORKERS_ENABLED', config.workersEnabled],
      ['BOT_OPTIONS_SENDER_ENABLED', config.senderEnabled],
      ['BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED', config.bookingCapabilityEnabled],
      ['BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED', config.depositsCapabilityEnabled],
      ['BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED', config.appointmentManagementCapabilityEnabled],
      ['BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED', config.handoffCapabilityEnabled]
    ]
    const invalid = dependentFlags.filter(([, enabled]) => enabled).map(([name]) => name)

    if (invalid.length > 0) {
      throw new Error(`${invalid.join(', ')} require BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=true`)
    }
  }

  if (config.senderEnabled && !config.legacyDispatchCoverageComplete) {
    throw new Error('BOT_OPTIONS_SENDER_ENABLED requires BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE=true')
  }

  return config
}
