import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deterministicConversationRouting } from '../src/services/conversation-router.js'
import { renderBusinessKnowledgeAnswers } from '../src/services/business-knowledge-service.js'

const [schema, migration, businessRoute, crmUi, landingUi, router, routerContext, instagramContext, knowledge] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260814133000_add_business_tiktok_url/migration.sql', 'utf8'),
  readFile('src/routes/business.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8'),
  readFile('src/routes/landing-ui.ts', 'utf8'),
  readFile('src/services/conversation-router.ts', 'utf8'),
  readFile('src/services/conversation-router-context-service.ts', 'utf8'),
  readFile('src/services/instagram-webhook-service.ts', 'utf8'),
  readFile('src/services/business-knowledge-service.ts', 'utf8')
])

assert.match(schema, /tiktokUrl\s+String\?/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS "tiktokUrl" TEXT/)

assert.match(businessRoute, /const tiktokUrl = normalizeOptionalUrl\(body\.tiktokUrl\)/)
assert.match(businessRoute, /El link de TikTok debe ser una URL valida/)
assert.match(businessRoute, /\.\.\.\(tiktokUrl !== undefined \? \{ tiktokUrl \} : \{\}\)/)

assert.match(crmUi, /id="business-tiktok"/)
assert.match(crmUi, /state\.business\?\.tiktokUrl/)
assert.match(crmUi, /tiktokUrl: tiktokUrl \|\| null/)

assert.match(landingUi, /siTiktok/)
assert.match(landingUi, /business\.tiktokUrl \? \{ label: 'TikTok'/)
assert.match(landingUi, /aria-label="TikTok"/)

assert.match(router, /'tiktok'/)
assert.match(router, /\['tiktok', 'tik tok', 'tik-tok'\]/)
for (const source of [routerContext, instagramContext]) {
  assert.match(source, /tiktokUrl: true/)
  assert.match(source, /topics\.push\('tiktok'\)/)
}
assert.match(knowledge, /El TikTok de \$\{business\.name\} es \$\{business\.tiktokUrl\}/)

const routing = deterministicConversationRouting('¿Cuál es el TikTok del local?')
assert.equal(routing.intents.some((intent) => intent.topic === 'tiktok'), true)

const [tiktokAnswer] = renderBusinessKnowledgeAnswers({
  name: 'Salón Demo',
  slug: 'salon-demo',
  landingEnabled: true,
  publicWhatsapp: null,
  contactEmail: null,
  publicAddress: null,
  publicAddressArea: null,
  publicMapsUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: 'https://tiktok.com/@salondemo',
  businessHours: [],
  services: [],
  professionals: []
}, ['tiktok'])
assert.equal(tiktokAnswer, 'El TikTok de Salón Demo es https://tiktok.com/@salondemo')

console.log('TikTok social link contract: OK (CRM, bot y landing conectados)')
