import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { formatWeexSupportBotForWhatsApp } from '../src/services/business-support-bot-runtime.js'
import { WeexSupportBotV1 } from '../src/services/weex-support-bot-v1.js'

const [schema, migration, webhook, activation] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260811164500_add_exclusive_support_bot_runtime/migration.sql', 'utf8'),
  readFile('src/services/whatsapp-webhook-service.ts', 'utf8'),
  readFile('scripts/activate-weex-support-bot-v1.ts', 'utf8')
])

const welcome = formatWeexSupportBotForWhatsApp(new WeexSupportBotV1().start())
assert.match(welcome, /1 · Soy cliente/)
assert.match(welcome, /5 · Hablar con un asesor/)
assert.match(schema, /supportBotState\s+Json\?/)
assert.match(migration, /ADD COLUMN "supportBotState" JSONB/)
assert.match(webhook, /handleExclusiveBusinessSupportBotMessage/)
assert.match(activation, /routingMode: 'EXCLUSIVE'/)
assert.match(activation, /aiEnabled: false/)
assert.match(activation, /bookingV2Enabled: false/)
assert.match(activation, /realWhatsappEnabled: true/)

console.log('Exclusive Weex bot routing contract: OK (WhatsApp único, sin IA y con estado persistente)')
