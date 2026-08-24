export interface MetricsSink {
  write(record: string): boolean
  readonly terminal: boolean
  readonly pressured: boolean
  readonly droppedSnapshots: number
  close(): void
}
