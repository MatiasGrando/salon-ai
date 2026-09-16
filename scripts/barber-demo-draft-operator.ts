import { BARBER_DEMO_FORM_PILOT } from '../src/services/barber-demo-lead-form-pilot.js'
import { validateLeadFormSchema } from '../src/services/lead-form-domain.js'

const businessId = 'cmpvr0oqo0000o0vcnhgyv054'
const initialStageId = 'cmtz97ga10000ysvcogdoaixp'

type ReadClient = {
  business: { findFirst(args: object): Promise<any> }
  businessFeatureSettings: { findUnique(args: object): Promise<any> }
  pipeline: { findUnique(args: object): Promise<any> }
  pipelineStage: { findFirst(args: object): Promise<any> }
  leadCaptureForm: { findMany(args: object): Promise<any[]> }
}
type CreateService = { create(input: Record<string, unknown> & { businessId: string }): Promise<any> }

export async function prepareBarberDemoDraft(client: ReadClient, service: CreateService, apply = false) {
  const payload = {
    businessId,
    publicSlug: BARBER_DEMO_FORM_PILOT.publicSlug,
    name: BARBER_DEMO_FORM_PILOT.name,
    initialStageId,
    defaultAssigneeUserId: null,
    rewardMode: BARBER_DEMO_FORM_PILOT.rewardMode,
    fields: BARBER_DEMO_FORM_PILOT.fields
  }
  const expectedSchema = validateLeadFormSchema({ schemaVersion: BARBER_DEMO_FORM_PILOT.schemaVersion, fields: payload.fields })
  if (!expectedSchema.ok) throw new Error('PILOT_SCHEMA_INVALID')
  const [business, flags, pipeline] = await Promise.all([
    client.business.findFirst({ where: { id: businessId, customerCode: BARBER_DEMO_FORM_PILOT.businessCustomerCode }, select: { id: true, customerCode: true } }),
    client.businessFeatureSettings.findUnique({ where: { businessId }, select: { pipelineEnabled: true, leadCaptureFormsEnabled: true } }),
    client.pipeline.findUnique({ where: { businessId }, select: { id: true } })
  ])
  if (business?.id !== businessId || business.customerCode !== BARBER_DEMO_FORM_PILOT.businessCustomerCode || !flags?.pipelineEnabled || flags.leadCaptureFormsEnabled !== false || !pipeline?.id) throw new Error('PILOT_PREREQUISITE_MISMATCH')
  const stage = await client.pipelineStage.findFirst({ where: { id: initialStageId, businessId, pipelineId: pipeline.id, archivedAt: null }, select: { id: true, name: true, archivedAt: true } })
  if (stage?.id !== initialStageId || stage.name !== 'INICIAL' || stage.archivedAt !== null) throw new Error('PILOT_STAGE_MISMATCH')

  const inspectExisting = async () => {
    const forms = await client.leadCaptureForm.findMany({ where: { businessId, publicSlug: payload.publicSlug }, select: { id: true, businessId: true, publicSlug: true, status: true, rewardMode: true, version: true, schemaVersion: true, initialStageId: true, fields: true } })
    if (forms.length === 0) return null
    if (forms.length !== 1) throw new Error('EXISTING_FORM_CONFLICT')
    const form = forms[0]
    const persistedSchema = validateLeadFormSchema({ schemaVersion: form.schemaVersion, fields: form.fields })
    if (form.businessId !== businessId || form.publicSlug !== payload.publicSlug || form.status !== 'DRAFT' || form.rewardMode !== 'NONE' || form.version !== 1 || form.schemaVersion !== BARBER_DEMO_FORM_PILOT.schemaVersion || form.initialStageId !== initialStageId || !persistedSchema.ok || JSON.stringify(persistedSchema.schema.fields) !== JSON.stringify(expectedSchema.schema.fields)) throw new Error('EXISTING_FORM_CONFLICT')
    return form.id as string
  }
  const existingId = await inspectExisting()
  if (existingId) return { action: 'already-exists' as const, id: existingId, payload }
  if (!apply) return { action: 'ready' as const, payload }
  try {
    const created = await service.create(payload)
    return { action: 'created' as const, id: created.id as string, payload }
  } catch (error) {
    if ((error as { code?: string }).code !== 'FORM_SLUG_ALREADY_EXISTS') throw error
    const racedId = await inspectExisting()
    if (!racedId) throw error
    return { action: 'already-exists' as const, id: racedId, payload }
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/barber-demo-draft-operator.ts')) {
  const apply = process.argv.slice(2).includes('--apply')
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('UNKNOWN_ARGUMENT')
  const { prisma } = await import('../src/config/prisma.js')
  const { PipelineFormsService } = await import('../src/services/pipeline-forms-service.js')
  try {
    const result = await prepareBarberDemoDraft(prisma, new PipelineFormsService(prisma), apply)
    console.log(JSON.stringify({ action: result.action, id: 'id' in result ? result.id : undefined, slug: result.payload.publicSlug, status: 'DRAFT', rewardMode: 'NONE', applied: apply }))
  } finally {
    await prisma.$disconnect()
  }
}
