import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const scheduler = readFileSync(new URL('../src/services/marketing-scheduler.ts', import.meta.url), 'utf8')

const campaignChannel = ui.slice(ui.indexOf('<select id="campaign-channel">'), ui.indexOf('</select>', ui.indexOf('<select id="campaign-channel">')))
const reminderChannel = ui.slice(ui.indexOf('<select id="reminder-channel">'), ui.indexOf('</select>', ui.indexOf('<select id="reminder-channel">')))
assert.match(campaignChannel, /value="EMAIL"[^>]*disabled/)
assert.match(campaignChannel, /value="BOTH"[^>]*disabled/)
assert.match(reminderChannel, /value="EMAIL"[^>]*disabled/)
assert.match(ui, /Email y WhatsApp \+ Email.*pr&oacute;ximamente/)
assert.match(ui, /const unsupportedChannel = campaign.channel !== 'WHATSAPP'/, 'la confirmación debe bloquear campañas heredadas de canales no disponibles')
assert.match(routes, /const CAMPAIGN_CHANNELS = \['WHATSAPP'\] as const/)
assert.match(routes, /if \(channel !== 'WHATSAPP'\)/)
assert.match(routes, /if \(campaign\.channel !== 'WHATSAPP'\)/)
assert.match(routes, /if \(input\.campaign\.channel !== 'WHATSAPP'\)/)
assert.match(routes, /campaign:\s*\{[\s\S]{0,120}channel: 'WHATSAPP'/)
assert.match(scheduler, /type: 'AUTOMATED',[\s\S]{0,120}channel: 'WHATSAPP'/)
assert.match(scheduler, /type: 'ONE_TIME',[\s\S]{0,120}channel: 'WHATSAPP'/)

const migration = readFileSync(new URL('../prisma/migrations/20260921170000_pause_unsupported_marketing_channels/migration.sql', import.meta.url), 'utf8')
assert.match(migration, /UPDATE "Campaign"[\s\S]*SET "status" = 'PAUSED'[\s\S]*"channel" <> 'WHATSAPP'/)
assert.match(migration, /UPDATE "ReminderAutomation"[\s\S]*"mode" = 'PAUSED'[\s\S]*"enabled" = false[\s\S]*"channel" <> 'WHATSAPP'/)
console.log('Marketing WhatsApp-only channels: OK')