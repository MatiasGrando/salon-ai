import assert from 'node:assert/strict'
import { summarizeBotOptionsLatencyTraces } from '../src/bot-options/observability/e2e-latency-summary.js'

const report = summarizeBotOptionsLatencyTraces([
  { correlationId: 'event-1:outbox-1', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 80, transitionedAt: 100, outboxCreatedAt: 120, metaAcceptedAt: 140, deliveredAt: 240 },
  { correlationId: 'event-2:outbox-2', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 30, transitionedAt: 50, outboxCreatedAt: 70, metaAcceptedAt: 100, deliveredAt: 300 },
  { correlationId: 'event-3:outbox-3', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 90, transitionedAt: 120, outboxCreatedAt: 150, metaAcceptedAt: 180, deliveredAt: null },
  { correlationId: 'event-4:outbox-4', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 70, transitionedAt: 100, outboxCreatedAt: 120, metaAcceptedAt: 140, deliveredAt: 130 }
])

assert.deepEqual(report, {
  traceCount: 4,
  duplicateCorrelationCount: 0,
  invalidCorrelationCount: 0,
  metaAcceptedCount: 3,
  deliveredCount: 2,
  failedBeforeAcceptanceCount: 0,
  unresolvedCount: 0,
  missingStageCount: 1,
  invalidTimestampOrderCount: 1,
  stages: {
    eventJobLifecycle: { count: 3, p50Ms: 80, p95Ms: 90, p99Ms: 90 },
    eventJobCompletionToTransition: { count: 3, p50Ms: 20, p95Ms: 30, p99Ms: 30 },
    admissionToTransition: { count: 3, p50Ms: 100, p95Ms: 120, p99Ms: 120 },
    transitionToOutbox: { count: 3, p50Ms: 20, p95Ms: 30, p99Ms: 30 },
    outboxToMetaAcceptance: { count: 3, p50Ms: 30, p95Ms: 30, p99Ms: 30 },
    metaAcceptanceToDelivery: { count: 2, p50Ms: 100, p95Ms: 200, p99Ms: 200 },
    admissionToMetaAcceptance: { count: 3, p50Ms: 140, p95Ms: 180, p99Ms: 180 },
    admissionToDelivery: { count: 2, p50Ms: 240, p95Ms: 300, p99Ms: 300 }
  }
})

const invalid = summarizeBotOptionsLatencyTraces([
  { correlationId: '', admittedAt: 10, eventJobCreatedAt: null, eventJobCompletedAt: null, transitionedAt: 9, outboxCreatedAt: null, metaAcceptedAt: null, deliveredAt: null, failedBeforeAcceptance: true },
  { correlationId: 'failed', admittedAt: 10, eventJobCreatedAt: 10, eventJobCompletedAt: 11, transitionedAt: 12, outboxCreatedAt: 13, metaAcceptedAt: null, deliveredAt: null, failedBeforeAcceptance: true },
  { correlationId: 'bad-order', admittedAt: 10, eventJobCreatedAt: 10, eventJobCompletedAt: 9, transitionedAt: 12, outboxCreatedAt: 13, metaAcceptedAt: 14, deliveredAt: 15, failedBeforeAcceptance: false },
  { correlationId: 'dup', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 0.5, transitionedAt: 1, outboxCreatedAt: 2, metaAcceptedAt: 3, deliveredAt: 4 },
  { correlationId: 'dup', admittedAt: 0, eventJobCreatedAt: 0, eventJobCompletedAt: 0.5, transitionedAt: 1, outboxCreatedAt: 2, metaAcceptedAt: 3, deliveredAt: 4 }
])
assert.equal(invalid.duplicateCorrelationCount, 1)
assert.equal(invalid.invalidCorrelationCount, 1)
assert.equal(invalid.failedBeforeAcceptanceCount, 1)
assert.equal(invalid.metaAcceptedCount, 1, 'impossible timestamp-order traces are excluded from outcome counts')
assert.equal(invalid.deliveredCount, 1)
assert.equal(invalid.missingStageCount, 0)
assert.equal(invalid.unresolvedCount, 0)
assert.equal(invalid.stages.admissionToTransition.count, 2, 'invalid identifiers and impossible traces are excluded')
console.log('bot-options-e2e-latency-summary-test: OK')
console.log(JSON.stringify(report, null, 2))