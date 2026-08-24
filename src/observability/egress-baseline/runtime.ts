import { performance } from 'node:perf_hooks'
import type { Clock, RandomSource, Scheduler, TimerHandle } from './types.js'

export const productionClock: Clock = {
  monotonicNow: () => performance.now(),
  utcNow: () => new Date()
}

export const productionRandomSource: RandomSource = { nextUnit: () => Math.random() }

export const productionScheduler: Scheduler = {
  setTimeout(callback, delayMs) { return setTimeout(callback, delayMs) as unknown as TimerHandle },
  clearTimeout(handle) { clearTimeout(handle as unknown as NodeJS.Timeout) },
  setImmediate(callback) { return setImmediate(callback) as unknown as TimerHandle }
}

export function nextWindowDelay(windowMs: number, jitterMs: number, randomSource: RandomSource) {
  const unit = randomSource.nextUnit()
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new Error('invalid random source')
  return windowMs + Math.floor(unit * (jitterMs + 1))
}
