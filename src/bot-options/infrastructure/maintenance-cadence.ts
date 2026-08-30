export function createMaintenanceCadence(input: {
  intervalMs: number
  now?: () => number
  run: () => Promise<void>
}) {
  if (!Number.isFinite(input.intervalMs) || input.intervalMs <= 0) throw new Error('maintenance interval must be positive')
  const now = input.now ?? Date.now
  let nextRunAt = Number.NEGATIVE_INFINITY
  return {
    async runIfDue(): Promise<boolean> {
      const attemptedAt = now()
      if (attemptedAt < nextRunAt) return false
      // Advance before I/O: an outage must not turn 250ms polling into a
      // maintenance write storm. The next periodic attempt remains bounded.
      nextRunAt = attemptedAt + input.intervalMs
      await input.run()
      return true
    }
  }
}
