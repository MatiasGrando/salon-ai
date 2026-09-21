import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const campaignRoute = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const scheduler = readFileSync(new URL('../src/services/marketing-scheduler.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const migrationsRoot = join(process.cwd(), 'prisma', 'migrations')
const migrationName = readdirSync(migrationsRoot).find((name) => name.endsWith('_add_campaign_delivery_mode'))

assert.match(schema, /enum CampaignDeliveryMode\s*\{[\s\S]*MANUAL_ASSISTED[\s\S]*AUTOMATIC_API[\s\S]*\}/)
assert.match(schema, /deliveryMode\s+CampaignDeliveryMode\s+@default\(MANUAL_ASSISTED\)/)

assert.ok(migrationName, 'debe existir una migración segura para Campaign.deliveryMode')
const migration = readFileSync(join(migrationsRoot, migrationName!, 'migration.sql'), 'utf8')
assert.match(migration, /CREATE TYPE "CampaignDeliveryMode" AS ENUM \('MANUAL_ASSISTED', 'AUTOMATIC_API'\)/)
assert.match(migration, /EXISTS\s*\([\s\S]*"CampaignRun"[\s\S]*"mode" = 'REAL'/)
assert.match(migration, /EXISTS\s*\([\s\S]*"CampaignDelivery"[\s\S]*NOT IN \('FAILED', 'CANCELLED'\)/)
assert.match(migration, /SET "deliveryMode" = 'MANUAL_ASSISTED'/)
assert.match(migration, /SET "status" = 'PAUSED'[\s\S]*"deliveryMode" = 'MANUAL_ASSISTED'/, 'las campañas ambiguas no deben quedar activas')
assert.match(migration, /SET NOT NULL/)
assert.match(migration, /SET DEFAULT 'MANUAL_ASSISTED'/)

assert.match(campaignRoute, /const CAMPAIGN_DELIVERY_MODES = \['MANUAL_ASSISTED', 'AUTOMATIC_API'\] as const/)
assert.match(campaignRoute, /deliveryMode\?: string/)
assert.match(campaignRoute, /Modo de env[ií]o inv[aá]lido/)
assert.match(campaignRoute, /campaign\.deliveryMode !== 'MANUAL_ASSISTED'/)
assert.match(campaignRoute, /campaign\.deliveryMode !== 'AUTOMATIC_API'/)
assert.match(campaignRoute, /deliveryMode: 'AUTOMATIC_API'/)
assert.match(campaignRoute, /normalizeWhatsAppTemplateCategory\(campaign\.whatsappTemplate\.category\) !== 'MARKETING'/)

for (const schedulerQuery of [
  /type: 'AUTOMATED',[\s\S]{0,120}deliveryMode: 'AUTOMATIC_API',[\s\S]{0,120}status: 'ACTIVE'/,
  /type: 'ONE_TIME',[\s\S]{0,120}deliveryMode: 'AUTOMATIC_API',[\s\S]{0,120}status: 'SCHEDULED'/
]) assert.match(scheduler, schedulerQuery)
assert.match(campaignRoute, /campaign:\s*\{[\s\S]{0,160}deliveryMode: 'AUTOMATIC_API'/)

assert.match(crmUi, /id="campaign-delivery-mode"/)
assert.match(crmUi, /Modalidad de env&iacute;o/)
assert.match(crmUi, /Manual asistido/)
assert.match(crmUi, /Autom&aacute;tico por Meta/)
assert.match(crmUi, /deliveryMode: els\.campaignDeliveryMode\.value/)
assert.match(crmUi, /campaign\.deliveryMode === 'MANUAL_ASSISTED'/)
assert.match(crmUi, /No se enviar&aacute; ning&uacute;n mensaje autom&aacute;ticamente/)
assert.match(crmUi, /mensajes reales/)
assert.match(crmUi, /@media \(max-width: 720px\)[\s\S]*campaign-delivery-options/)
assert.match(crmUi, /\.campaign-delivery-requirements[\s\S]*@media \(max-width: 720px\)[\s\S]*\.campaign-delivery-options/, 'la regla móvil debe quedar después de la regla base para ganar la cascada')
assert.doesNotMatch(crmUi, /<select id="campaign-status">/, 'el estado no debe activarse desde el formulario de edición')
assert.match(campaignRoute, /deliveryMode === 'MANUAL_ASSISTED' && \(type !== 'ONE_TIME' \|\| scheduleMode !== 'IMMEDIATE'\)/, 'la cola manual sólo admite campañas puntuales inmediatas en esta etapa')
assert.match(campaignRoute, /current\.deliveryMode !== normalized\.deliveryMode && current\.status !== 'DRAFT'/, 'la modalidad no debe mutar tras la activación')
assert.match(crmUi, /campaign\.deliveryMode === 'MANUAL_ASSISTED'\s*\? '<div class="campaign-activation-card campaign-activation-cost"/, 'el manual no debe mostrar precio de Meta API')
assert.doesNotMatch(crmUi, /\b(?:alert|confirm|prompt)\s*\(/)

console.log('Campaign delivery mode contract: OK')
