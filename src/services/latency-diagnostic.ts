import { performance } from 'node:perf_hooks'
import { normalizeText } from './message-understanding-service.js'

type Now = () => number

export type LatencyDiagnosticReport = {
  name: string
  totalMs: number
  stages: Record<string, number>
  slowestStages: Array<{ stage: string; durationMs: number }>
  alerts: string[]
}

export class LatencyDiagnostic {
  private readonly startedAt: number
  private checkpointAt: number
  private readonly stages = new Map<string, number>()

  constructor(
    private readonly name: string,
    private readonly now: Now = () => performance.now()
  ) {
    this.startedAt = this.now()
    this.checkpointAt = this.startedAt
  }

  checkpoint(stage: string) {
    const current = this.now()
    this.add(stage, current - this.checkpointAt)
    this.checkpointAt = current
  }

  async measure<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.now()
    try {
      return await operation()
    } finally {
      this.add(stage, this.now() - startedAt)
      this.checkpointAt = this.now()
    }
  }

  report(): LatencyDiagnosticReport {
    const totalMs = rounded(this.now() - this.startedAt)
    const stages = Object.fromEntries(
      Array.from(this.stages.entries()).map(([stage, duration]) => [stage, rounded(duration)])
    )
    const slowestStages = Object.entries(stages)
      .map(([stage, durationMs]) => ({ stage, durationMs }))
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 3)
    const alerts = slowestStages
      .filter((item) => item.durationMs >= 2_000)
      .map((item) => `${item.stage} demoro ${item.durationMs} ms`)
    if (totalMs >= 8_000) alerts.unshift(`tiempo total critico: ${totalMs} ms`)
    else if (totalMs >= 5_000) alerts.unshift(`tiempo total alto: ${totalMs} ms`)

    return { name: this.name, totalMs, stages, slowestStages, alerts }
  }

  private add(stage: string, durationMs: number) {
    this.stages.set(stage, (this.stages.get(stage) ?? 0) + Math.max(0, durationMs))
  }
}

export function isGreetingLatencyDiagnosticMessage(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [
    'hola',
    'holaa',
    'hola cami',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'hola como estas',
    'como estas',
    'como va',
    'que tal',
    'todo bien'
  ].includes(normalized)
}

function rounded(value: number) {
  return Math.round(value * 100) / 100
}
