import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const campaign = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const repository = readFileSync(new URL('../src/infrastructure/communications/prisma-communication-repository.ts', import.meta.url), 'utf8')
const view = readFileSync(new URL('../src/routes/view-models/communication-view-model.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260923010000_manual_communication_queue_index/migration.sql', import.meta.url), 'utf8')
const route = campaign.split("app.post('/campaigns/:id/manual-executions'")[1]?.split("app.patch('/campaigns/:campaignId/manual-executions")[0] || ''
assert.ok(route)
assert.doesNotMatch(route, /await buildTemplateVariableContext\(/, 'la audiencia ya contiene los datos del destinatario')
assert.match(route, /customer: \{ id: customer\.id, name: customer\.name, phone: customer\.phone \}/)
assert.match(route, /lastVisitAt: customer\.lastVisitAt/)
assert.match(repository, /communicationRecipient\.createManyAndReturn\(/)
assert.match(repository, /communicationEvent\.createMany\(/)
assert.doesNotMatch(repository, /recipients: \{\s*create: input\.recipients/)
assert.match(campaign, /loadManualCampaignExecutionViewModel/)
assert.match(view, /recipients: current \? \[\{[\s\S]*?\}\] : \[\]/)
assert.match(schema, /@@index\(\[executionId, status, createdAt\]\)/)
assert.match(migration, /CommunicationRecipient_executionId_status_createdAt_idx/)
console.log('Campaign manual preparation contract: OK')
