import assert from 'node:assert/strict'
import { prepareBarberDemoDraft } from './barber-demo-draft-operator.js'
import { validateLeadFormSchema } from '../src/services/lead-form-domain.js'

const businessId = 'cmpvr0oqo0000o0vcnhgyv054'
const stageId = 'cmtz97ga10000ysvcogdoaixp'
let creates = 0
const fake = {
  business: { findFirst: async () => ({ id: businessId, customerCode: 'WX-38N6UG' }) },
  businessFeatureSettings: { findUnique: async () => ({ pipelineEnabled: true, leadCaptureFormsEnabled: false }) },
  pipeline: { findUnique: async () => ({ id: 'pipeline-a' }) },
  pipelineStage: { findFirst: async () => ({ id: stageId, name: 'INICIAL', archivedAt: null }) },
  leadCaptureForm: { findMany: async () => [] }
}
const service = {
  create: async (input: Record<string, unknown>) => {
    creates++
    assert.equal(input.businessId, businessId)
    assert.equal(input.initialStageId, stageId)
    assert.equal(input.rewardMode, 'NONE')
    return { id: 'form-a', status: 'DRAFT', rewardMode: 'NONE', initialStageId: stageId, ...input }
  }
}

const dry = await prepareBarberDemoDraft(fake as never, service as never, false)
assert.equal(dry.action, 'ready')
assert.equal(creates, 0)
assert.equal(dry.payload.rewardMode, 'NONE')
const applied = await prepareBarberDemoDraft(fake as never, service as never, true)
assert.equal(applied.action, 'created')
assert.equal(creates, 1)

const normalized = validateLeadFormSchema({ schemaVersion: 1, fields: dry.payload.fields })
assert.equal(normalized.ok, true)
if (!normalized.ok) throw new Error('fixture invalid')
const persisted = {
  ...fake,
  leadCaptureForm: { findMany: async () => [{ id: 'cmu3esuxb0000govccelzrslf', businessId, publicSlug: dry.payload.publicSlug, status: 'DRAFT', rewardMode: 'NONE', version: 1, schemaVersion: 1, initialStageId: stageId, fields: normalized.schema.fields }] }
}
const persistedRepeat = await prepareBarberDemoDraft(persisted as never, service as never, false)
assert.equal(persistedRepeat.action, 'already-exists')
assert.equal(creates, 1)

let raced = false
const raceClient = {
  ...fake,
  leadCaptureForm: { findMany: async () => raced ? [{ id: 'form-race', businessId, publicSlug: dry.payload.publicSlug, status: 'DRAFT', rewardMode: 'NONE', version: 1, schemaVersion: 1, initialStageId: stageId, fields: dry.payload.fields }] : [] }
}
const raceService = { create: async () => { raced = true; throw Object.assign(new Error('duplicate'), { code: 'FORM_SLUG_ALREADY_EXISTS' }) } }
const raceResult = await prepareBarberDemoDraft(raceClient as never, raceService as never, true)
assert.equal(raceResult.action, 'already-exists')

const existing = {
  ...fake,
  leadCaptureForm: { findMany: async () => [{ id: 'form-a', businessId, publicSlug: 'barber-demo-course-lead', status: 'DRAFT', rewardMode: 'NONE', version: 1, schemaVersion: 1, initialStageId: stageId, fields: dry.payload.fields }] }
}
const repeat = await prepareBarberDemoDraft(existing as never, service as never, true)
assert.equal(repeat.action, 'already-exists')
assert.equal(creates, 1)

const wrong = {
  ...fake,
  leadCaptureForm: { findMany: async () => [{ id: 'form-other', businessId, publicSlug: 'barber-demo-course-lead', status: 'PUBLISHED', rewardMode: 'BENEFIT', version: 1, schemaVersion: 1, initialStageId: stageId, fields: dry.payload.fields }] }
}
await assert.rejects(() => prepareBarberDemoDraft(wrong as never, service as never, true), /EXISTING_FORM_CONFLICT/)
const changed = {
  ...fake,
  leadCaptureForm: { findMany: async () => [{ id: 'form-changed', businessId, publicSlug: dry.payload.publicSlug, status: 'DRAFT', rewardMode: 'NONE', version: 1, schemaVersion: 1, initialStageId: stageId, fields: normalized.schema.fields.map((field, index) => index === 0 ? { ...field, label: 'Otro nombre' } : field) }] }
}
await assert.rejects(() => prepareBarberDemoDraft(changed as never, service as never, false), /EXISTING_FORM_CONFLICT/)
assert.equal(creates, 1)

console.log('barber-demo-draft-operator-contract-test: PASS')
