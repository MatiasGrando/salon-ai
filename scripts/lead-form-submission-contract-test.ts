import assert from 'node:assert/strict'
import {
  LeadFormSubmissionError,
  LeadFormSubmissionService,
  createRateLimitScopeHash
} from '../src/services/lead-form-submission-service.js'
import { createInstagramFormRef } from '../src/services/instagram-form-ref.js'

type Row = Record<string, unknown> & { id: string }

function cloneRows<T>(value: T): T {
  return structuredClone(value)
}

function createHarness(options: {
  formsEnabled?: boolean
  formStatus?: string
  stageArchived?: boolean
  failEvent?: boolean
  rewardEnabled?: boolean
  rewardMode?: 'NONE' | 'BENEFIT' | null
  rewardBusinessId?: string
  rewardFormId?: string
  rewardCount?: number
  failClaim?: boolean
  sourceMapping?: boolean
  conservativeSharedPeer?: boolean
} = {}) {
  const now = new Date('2026-09-15T18:00:00.000Z')
  const state = {
    submissions: [] as Row[],
    leads: [] as Row[],
    events: [] as Row[],
    claims: [] as Row[],
    buckets: new Map<string, Row>(),
    revision: 1n,
    transactions: [] as string[]
  }
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`
  const form = {
    id: 'form-a', businessId: 'business-a', pipelineId: 'pipeline-a', initialStageId: 'stage-a',
    defaultAssigneeUserId: null, publicSlug: 'diagnostico', name: 'Diagnóstico comercial',
    status: options.formStatus ?? 'PUBLISHED', schemaVersion: 1, version: 2,
    rewardMode: options.rewardMode === undefined ? 'BENEFIT' : options.rewardMode,
    fields: [
      { key: 'name', label: 'Nombre', type: 'TEXT', required: true, order: 0, mapping: { target: 'CONTACT_NAME' } },
      { key: 'email', label: 'Email', type: 'EMAIL', required: true, order: 1, mapping: { target: 'EMAIL' } },
      { key: 'goal', label: 'Objetivo', type: 'TEXTAREA', required: false, order: 2, mapping: { target: 'CUSTOM_DATA', customKey: 'goal' } },
      ...(options.sourceMapping ? [{ key: 'source', label: 'Origen', type: 'TEXT', required: false, order: 3, mapping: { target: 'SOURCE' } }] : [])
    ]
  }
  const reward = {
    id: 'reward-a', businessId: options.rewardBusinessId ?? 'business-a', formId: options.rewardFormId ?? 'form-a', enabled: options.rewardEnabled ?? true,
    version: 3, expiresInMinutes: 30
  }

  const tx = {
    businessFeatureSettings: {
      findUnique: async () => ({
        leadCaptureFormsEnabled: options.formsEnabled ?? true,
        pipelineEnabled: true
      })
    },
    leadCaptureForm: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.businessId === form.businessId && where.publicSlug === form.publicSlug && where.status === 'PUBLISHED' &&
        form.status === 'PUBLISHED' && !options.stageArchived ? cloneRows(form) : null
    },
    formSubmission: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const key = where.businessId_formId_idempotencyKey as Record<string, string>
        return cloneRows(state.submissions.find((row) => row.businessId === key.businessId && row.formId === key.formId && row.idempotencyKey === key.idempotencyKey) ?? null)
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.submissions.some((row) => row.businessId === data.businessId && row.formId === data.formId && row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        const row = { id: nextId('submission'), status: 'PENDING', ...cloneRows(data) }
        state.submissions.push(row)
        return cloneRows(row)
      },
      update: async ({ where, data }: { where: { businessId_id: { businessId: string; id: string } }; data: Record<string, unknown> }) => {
        const row = state.submissions.find((item) => item.id === where.businessId_id.id && item.businessId === where.businessId_id.businessId)
        if (!row) throw new Error('submission missing')
        Object.assign(row, cloneRows(data))
        return cloneRows(row)
      }
    },
    formReward: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        options.rewardEnabled === false || reward.businessId !== where.businessId || reward.formId !== where.formId
          ? []
          : Array.from({ length: options.rewardCount ?? 1 }, (_, index) => cloneRows({ ...reward, id: `reward-${index + 1}`, version: index + 1 })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        options.rewardEnabled === false || reward.businessId !== where.businessId || reward.formId !== where.formId
          ? null
          : cloneRows(reward)
    },
    instagramCommentExecution: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === 'execution-a' && where.businessId === 'business-a'
          ? { id: 'execution-a', matchedKeyword: 'INFO', publicationId: 'publication-a', commenterInstagramUserId: 'instagram-user-a' }
          : null
    },
    rewardClaim: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failClaim) throw new Error('claim failed')
        const row = { id: nextId('claim'), ...cloneRows(data) }
        state.claims.push(row)
        return cloneRows(row)
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        cloneRows(state.claims.find((row) => row.businessId === where.businessId && row.submissionId === where.submissionId) ?? null)
    },
    publicFormRateLimitBucket: {
      upsert: async ({ where, create }: { where: Record<string, Record<string, unknown>>; create: Record<string, unknown> }) => {
        const values = where.businessId_formId_scopeHash_windowStart
        const key = `${values.businessId}:${values.formId}:${values.scopeHash}:${(values.windowStart as Date).toISOString()}`
        const current = state.buckets.get(key)
        if (current) current.count = Number(current.count) + 1
        else state.buckets.set(key, { id: nextId('bucket'), ...cloneRows(create) })
        return cloneRows(state.buckets.get(key)!)
      }
    },
    pipeline: {
      findUnique: async () => ({ id: 'pipeline-a' }),
      update: async () => ({ revision: ++state.revision })
    },
    pipelineStage: {
      findFirst: async () => options.stageArchived ? null : ({ id: 'stage-a' })
    },
    user: { findFirst: async () => null },
    pipelineLead: {
      aggregate: async () => ({ _max: { position: state.leads.length - 1 } }),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        cloneRows(state.leads.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId('lead'), ...cloneRows(data) }
        state.leads.push(row)
        return cloneRows(row)
      }
    },
    pipelineLeadEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failEvent) throw new Error('event failed')
        const row = { id: nextId('event'), ...cloneRows(data) }
        state.events.push(row)
        return cloneRows(row)
      }
    }
  }

  let transactionTail = Promise.resolve()
  const client = {
    ...tx,
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>, config?: { isolationLevel?: string }) => {
      const previous = transactionTail
      let release!: () => void
      transactionTail = new Promise<void>((resolve) => { release = resolve })
      await previous
      state.transactions.push(config?.isolationLevel ?? 'default')
      const snapshot = {
        submissions: cloneRows(state.submissions), leads: cloneRows(state.leads), events: cloneRows(state.events),
        claims: cloneRows(state.claims), buckets: cloneRows(state.buckets), revision: state.revision
      }
      try {
        return await callback(tx)
      } catch (error) {
        state.submissions = snapshot.submissions
        state.leads = snapshot.leads
        state.events = snapshot.events
        state.claims = snapshot.claims
        state.buckets = snapshot.buckets
        state.revision = snapshot.revision
        throw error
      } finally {
        release()
      }
    }
  }
  const service = new LeadFormSubmissionService(client as never, {
    rateLimitSecret: '0123456789abcdef0123456789abcdef',
    rateLimitMax: 2,
    rateLimitWindowMs: 60_000,
    minimumCompletionMs: 1_500,
    conservativeSharedPeer: options.conservativeSharedPeer,
    now: () => now
  })
  const valid = {
    businessId: 'business-a', publicSlug: 'diagnostico', idempotencyKey: 'submission-key-0001',
    answers: { name: ' Ana ', email: 'ANA@EXAMPLE.COM', goal: 'Quiero vender más' },
    attribution: { utmSource: 'instagram', utmCampaign: 'reel-septiembre' },
    antiSpam: { honeypot: '', startedAt: '2026-09-15T17:59:57.000Z', ipAddress: '203.0.113.10' }
  }
  return { service, state, valid, client, form }
}

{
  const { service, state, valid } = createHarness({ rewardMode: 'NONE', rewardEnabled: false, conservativeSharedPeer: true })
  const first = await service.submit(valid)
  assert.equal(first.benefitAvailable, false)
  assert.equal(state.buckets.size, 3)
  await service.submit({ ...valid, idempotencyKey: 'submission-key-0002', answers: { ...valid.answers, email: 'other@example.com' }, antiSpam: { ...valid.antiSpam, ipAddress: '203.0.113.11' } })
  await assert.rejects(
    () => service.submit({ ...valid, idempotencyKey: 'submission-key-0003', answers: { ...valid.answers, email: 'third@example.com' }, antiSpam: { ...valid.antiSpam, ipAddress: '203.0.113.12' } }),
    (error) => isSubmissionError(error, 'RATE_LIMITED', 429)
  )
  assert.equal(state.submissions.length, 2)
  assert.equal(state.leads.length, 2)
  assert.equal(state.events.length, 2)
}

{
  const { service, state, valid } = createHarness({ rewardMode: 'BENEFIT', conservativeSharedPeer: true })
  await assert.rejects(() => service.submit(valid), (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
}

{
  const { service, state, valid } = createHarness({ rewardMode: 'BENEFIT', rewardCount: 2 })
  await assert.rejects(() => service.submit(valid), (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.claims.length, 0)
  assert.equal(state.buckets.size, 0)
}

function isSubmissionError(error: unknown, code: string, statusCode?: number) {
  return error instanceof LeadFormSubmissionError && error.code === code &&
    (statusCode === undefined || error.statusCode === statusCode)
}

assert.equal(createRateLimitScopeHash('secret', '203.0.113.10'), createRateLimitScopeHash('secret', '203.0.113.10'))
assert.notEqual(createRateLimitScopeHash('secret', '203.0.113.10'), createRateLimitScopeHash('secret', '203.0.113.11'))
assert.doesNotMatch(createRateLimitScopeHash('secret', '203.0.113.10'), /203\.0\.113\.10/)

{
  const { service, state, valid } = createHarness()
  const result = await service.submit(valid)
  assert.equal(result.replayed, false)
  assert.equal(result.submission.status, 'ACCEPTED')
  assert.equal(result.submission.leadId, result.lead.id)
  assert.equal(result.claim?.submissionId, result.submission.id)
  assert.equal(result.benefitAvailable, true)
  assert.equal(state.leads.length, 1)
  assert.equal(state.events.length, 1)
  assert.equal(state.events[0]?.actorKind, 'SYSTEM')
  assert.deepEqual(state.leads[0]?.customData, { goal: 'Quiero vender más' })
  assert.deepEqual(state.submissions[0]?.answers, { name: 'Ana', email: 'ana@example.com', goal: 'Quiero vender más' })
  assert.deepEqual(state.submissions[0]?.attribution, { utmSource: 'instagram', utmCampaign: 'reel-septiembre' })
  assert.ok(state.transactions.every((level) => level === 'Serializable'))
}

{
  const { service, state, valid, form } = createHarness({ rewardMode: 'NONE', rewardEnabled: false })
  const first = await service.submit(valid)
  assert.equal(first.benefitAvailable, false)
  assert.equal(first.claim, null)
  assert.equal(state.submissions.length, 1)
  assert.equal(state.leads.length, 1)
  assert.equal(state.events.length, 1)
  assert.equal(state.claims.length, 0)
  form.rewardMode = 'BENEFIT'
  const replay = await service.submit(valid)
  assert.equal(replay.replayed, true)
  assert.equal(replay.benefitAvailable, false)
  assert.equal(replay.claim, null)
  assert.equal(state.leads.length, 1)
  assert.equal(state.events.length, 1)
  assert.equal(state.claims.length, 0)
}

{
  const { service, state, valid, form } = createHarness({ rewardMode: 'BENEFIT' })
  const first = await service.submit(valid)
  form.rewardMode = 'NONE'
  const replay = await service.submit(valid)
  assert.equal(first.benefitAvailable, true)
  assert.equal(replay.benefitAvailable, true)
  assert.equal(replay.claim?.id, first.claim?.id)
  assert.equal(state.claims.length, 1)
}

{
  const { service, state, valid } = createHarness({ rewardMode: 'NONE' })
  await service.submit(valid)
  state.submissions[0]!.rewardMode = null
  await assert.rejects(() => service.submit(valid), (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
}

for (const options of [
  { rewardMode: null },
  { rewardMode: 'BROKEN' as never },
  { rewardMode: 'BENEFIT' as const, rewardEnabled: false },
  { rewardMode: 'BENEFIT' as const, rewardBusinessId: 'business-b' },
  { rewardMode: 'BENEFIT' as const, rewardFormId: 'form-b' }
]) {
  const { service, state, valid } = createHarness(options)
  await assert.rejects(() => service.submit(valid), (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.claims.length, 0)
  assert.equal(state.buckets.size, 0)
}

{
  const { service, state, valid } = createHarness()
  await assert.rejects(() => service.submit({ ...valid, answers: { name: '', email: 'incorrecto' } }),
    (error) => isSubmissionError(error, 'INVALID_FORM_ANSWERS', 422))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.claims.length, 0)
}

{
  const { service, state, valid } = createHarness()
  const first = await service.submit(valid)
  const replay = await service.submit(valid)
  assert.equal(replay.replayed, true)
  assert.equal(replay.submission.id, first.submission.id)
  assert.equal(replay.lead.id, first.lead.id)
  assert.equal(state.submissions.length, 1)
  assert.equal(state.leads.length, 1)
  await assert.rejects(
    () => service.submit({ ...valid, answers: { ...valid.answers, goal: 'Otro payload' } }),
    (error) => isSubmissionError(error, 'IDEMPOTENCY_CONFLICT', 409)
  )
  await assert.rejects(
    () => service.submit({ ...valid, answers: { ...valid.answers, name: 'Ana' } }),
    (error) => isSubmissionError(error, 'IDEMPOTENCY_CONFLICT', 409)
  )
}

{
  const { service, state, valid } = createHarness()
  const [left, right] = await Promise.all([service.submit(valid), service.submit(valid)])
  assert.equal(left.submission.id, right.submission.id)
  assert.equal(state.submissions.length, 1)
  assert.equal(state.leads.length, 1)
  assert.equal(state.claims.length, 1)
}

for (const options of [
  { formsEnabled: false },
  { formStatus: 'DISABLED' },
  { stageArchived: true }
]) {
  const { service, state, valid } = createHarness(options)
  await assert.rejects(() => service.submit(valid), (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE'))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
}

{
  const { service, state, valid } = createHarness({ failEvent: true })
  await assert.rejects(() => service.submit(valid), /event failed/)
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.claims.length, 0)
}

{
  const { service, state, valid } = createHarness({ failClaim: true })
  await assert.rejects(() => service.submit(valid), /claim failed/)
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.claims.length, 0)
}

{
  const { service, state, valid } = createHarness({ rewardEnabled: false })
  await assert.rejects(() => service.submit(valid),
    (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.claims.length, 0)
  assert.equal(state.leads.length, 0)
  assert.equal(state.buckets.size, 0)
}

{
  const { service, state, valid } = createHarness()
  await service.submit(valid)
  state.claims.length = 0
  await assert.rejects(() => service.submit(valid),
    (error) => isSubmissionError(error, 'FORM_NOT_AVAILABLE', 404))
  assert.equal(state.submissions.length, 1)
  assert.equal(state.leads.length, 1)
  assert.equal(state.claims.length, 0)
}

for (const antiSpam of [
  { honeypot: 'soy-un-bot', startedAt: '2026-09-15T17:59:57.000Z', ipAddress: '203.0.113.10' },
  { honeypot: '', startedAt: '2026-09-15T17:59:59.500Z', ipAddress: '203.0.113.10' }
]) {
  const { service, state, valid } = createHarness()
  await assert.rejects(() => service.submit({ ...valid, antiSpam }),
    (error) => isSubmissionError(error, 'SPAM_REJECTED', 422))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
}

{
  const { service, state, valid, client } = createHarness()
  const secondInstance = new LeadFormSubmissionService(client as never, {
    rateLimitSecret: '0123456789abcdef0123456789abcdef', rateLimitMax: 2,
    rateLimitWindowMs: 60_000, minimumCompletionMs: 1_500,
    now: () => new Date('2026-09-15T18:00:00.000Z')
  })
  await service.submit(valid)
  await secondInstance.submit({ ...valid, idempotencyKey: 'submission-key-0002', answers: { ...valid.answers, goal: 'Dos' } })
  await assert.rejects(
    () => service.submit({ ...valid, idempotencyKey: 'submission-key-0003', answers: { ...valid.answers, goal: 'Tres' } }),
    (error) => isSubmissionError(error, 'RATE_LIMITED', 429)
  )
  assert.equal(state.submissions.length, 2)
  assert.equal(state.leads.length, 2)
  assert.equal(state.buckets.size, 1)
}

{
  const { client, valid } = createHarness()
  const misconfigured = new LeadFormSubmissionService(client as never, {
    rateLimitSecret: '', now: () => new Date('2026-09-15T18:00:00.000Z')
  })
  await assert.rejects(() => misconfigured.submit(valid),
    (error) => isSubmissionError(error, 'SUBMISSION_SERVICE_UNAVAILABLE', 503))
}

for (const attribution of [
  { source: 'INSTAGRAM_COMMENT' },
  { instagramExecutionId: 'execution-other-tenant' },
  { instagramPublicationId: 'publication-other-tenant' },
  { instagramUserId: 'instagram-user-other-tenant' },
  { campaign: 'INFO' }
]) {
  const { service, state, valid } = createHarness()
  await assert.rejects(() => service.submit({ ...valid, attribution }),
    (error) => isSubmissionError(error, 'INVALID_ATTRIBUTION', 422))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
}

{
  const { service, state, valid } = createHarness({ sourceMapping: true })
  await service.submit({ ...valid, answers: { ...valid.answers, source: 'INSTAGRAM_COMMENT' } })
  assert.equal(state.leads[0]?.source, 'FORM')
}

{
  const { client, state, valid } = createHarness()
  const secret = 'instagram-form-ref-secret-32-characters-minimum'
  const service = new LeadFormSubmissionService(client as never, {
    rateLimitSecret: '0123456789abcdef0123456789abcdef',
    instagramFormRefSecret: secret,
    now: () => new Date()
  })
  const input = {
    ...valid,
    antiSpam: { ...valid.antiSpam, startedAt: new Date(Date.now() - 3000).toISOString() },
    attribution: { utmSource: 'instagram', utmCampaign: 'reel-septiembre' }
  }
  const ref = createInstagramFormRef(secret, {
    businessId: 'business-a', formId: 'form-a', executionId: 'execution-a', expiresAt: Date.now() + 60_000
  })
  const result = await service.submit({ ...input, instagramRef: ref })
  assert.equal(result.submission.status, 'ACCEPTED')
  assert.equal(state.leads[0]?.source, 'INSTAGRAM_COMMENT')
  assert.deepEqual(state.submissions[0]?.attribution, {
    utmSource: 'instagram', utmCampaign: 'reel-septiembre',
    source: 'INSTAGRAM_COMMENT', campaign: 'INFO', instagramExecutionId: 'execution-a',
    instagramPublicationId: 'publication-a', instagramUserId: 'instagram-user-a'
  })
  const replay = await service.submit({ ...input, instagramRef: ref })
  assert.equal(replay.replayed, true)
  assert.equal(state.leads.length, 1)
}

{
  const { client, state, valid } = createHarness()
  const secret = 'instagram-form-ref-secret-32-characters-minimum'
  const service = new LeadFormSubmissionService(client as never, {
    rateLimitSecret: '0123456789abcdef0123456789abcdef',
    instagramFormRefSecret: secret,
    now: () => new Date()
  })
  const wrongTenantRef = createInstagramFormRef(secret, {
    businessId: 'business-b', formId: 'form-a', executionId: 'execution-a', expiresAt: Date.now() + 60_000
  })
  await assert.rejects(() => service.submit({
    ...valid, instagramRef: wrongTenantRef,
    antiSpam: { ...valid.antiSpam, startedAt: new Date(Date.now() - 3000).toISOString() }
  }), (error) => isSubmissionError(error, 'INVALID_INSTAGRAM_REF', 422))
  assert.equal(state.submissions.length, 0)
  assert.equal(state.leads.length, 0)
}

console.log('lead-form-submission-contract-test: ok')
