import {
  redactF10_6LiveSandboxSafetyError,
  validateF10_6LiveSandboxSafety
} from './f10-6-live-sandbox-safety.js'

/**
 * Preflight only. The pure gates run before any possible Prisma/network import.
 * This deliberately contains no future-I/O branch: a successful preflight is
 * not authorization to read the scratch business or to send through Meta.
 */
try {
  validateF10_6LiveSandboxSafety(process.env)
  console.log('META_LIVE_PENDING')
} catch (error) {
  console.error(redactF10_6LiveSandboxSafetyError(error))
  process.exitCode = 1
}
