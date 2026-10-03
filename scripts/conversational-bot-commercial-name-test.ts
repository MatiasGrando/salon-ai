import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeAssistantPersonality, assistantPersonalityPreview } from '../src/services/assistant-personality-config.js'
import { introduceDialogue } from '../src/conversational-bot/dialogue-identity.js'
import { loadDialogueIdentity } from '../src/conversational-bot/prisma-dialogue-identity.js'
import { loadBusinessFacts } from '../src/conversational-bot/prisma-business-facts.js'
const context = { businessId: 'tenant', timezone: 'UTC', dbNow: new Date('2026-10-03T15:00:00Z') }
const base = { id: 'tenant', name: 'Peluquería Glow · QA aislado', publicAddress: 'Av. Siempre Viva 123', publicAddressArea: null, publicMapsUrl: 'https://maps.google.com/?q=Glow', publicWhatsapp: null, contactEmail: null, workshopPublicSiteUrl: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, landingDescription: null }
let businessReads = 0, settingsReads = 0
const client: any = {
  business: { findFirst: async (args: any) => { businessReads++; assert.deepEqual(args.where, { id: 'tenant' }); assert.equal(args.select.featureSettings.select.assistantPersonality, true); return { ...base, featureSettings: { businessId: 'tenant', assistantPersonality: { commercialName: 'Glow', name: 'Cami' } } } } },
  businessFeatureSettings: { findUnique: async ({ where }: any) => { settingsReads++; assert.deepEqual(where, { businessId: 'tenant' }); return { businessId: 'tenant', assistantPersonality: { commercialName: 'Glow', name: 'Cami' } } } },
  businessHours: {}, scheduleBlock: {}, $queryRaw: async () => []
}
assert.equal(normalizeAssistantPersonality({ commercialName: '  Glow   Studio  ' }).commercialName, 'Glow Studio')
assert.equal(normalizeAssistantPersonality({ commercialName: ' \u0000  ' }).commercialName, undefined)
assert.equal(normalizeAssistantPersonality({ commercialName: 'Á'.repeat(150) }).commercialName?.length, 80)
assert.equal(Array.from(normalizeAssistantPersonality({ commercialName: '😊'.repeat(100) }).commercialName ?? '').length, 80, 'Unicode name is not cut inside a surrogate pair')
assert.equal(normalizeAssistantPersonality({ commercialName: 'A\u202eB' }).commercialName, 'A B', 'format controls cannot alter visible order')
const submittedProfile = normalizeAssistantPersonality({ name: 'Nora', commercialName: ' Glow  Studio ' })
const persistedJson = JSON.parse(JSON.stringify(submittedProfile))
assert.equal(persistedJson.commercialName, 'Glow Studio', 'normalized PATCH payload retains the optional field in JSON')
assert.equal(normalizeAssistantPersonality(persistedJson).commercialName, 'Glow Studio', 'GET normalization retains saved commercial name')
assert.equal(normalizeAssistantPersonality({ ...persistedJson, commercialName: '' }).commercialName, undefined, 'clearing input removes the optional alias')
assert.match(assistantPersonalityPreview(normalizeAssistantPersonality({ name: 'Nora', commercialName: 'Glow' }), base.name), /Nora, de Glow/)
const profileForPreview = normalizeAssistantPersonality({ name: 'Nora', commercialName: 'Glow' })
const actualIntroduction = introduceDialogue({ identity: { businessId: 'tenant', businessName: 'Glow', assistantName: 'Nora', treatment: 'vos', greetingEmoji: '😊' }, introduced: false, kind: 'social' }).reply
assert.equal(assistantPersonalityPreview(profileForPreview, base.name), actualIntroduction, 'API editor preview must exactly match verified first social reply')
const quietFormal = normalizeAssistantPersonality({ name: 'Nora', commercialName: 'Glow', treatment: 'usted', emojiLevel: 'none' })
const actualQuietFormal = introduceDialogue({ identity: { businessId: 'tenant', businessName: 'Glow', assistantName: 'Nora', treatment: 'usted', greetingEmoji: null }, introduced: false, kind: 'social' }).reply
assert.equal(assistantPersonalityPreview(quietFormal, base.name), actualQuietFormal, 'no-emoji formal preview matches actual verified introduction')
assert.match(assistantPersonalityPreview(normalizeAssistantPersonality({ name: 'Nora' }), base.name), /Nora, de Peluquería Glow/)
assert.equal(normalizeAssistantPersonality({ commercialName: '<script>alert(1)</script>' }).commercialName, '<script>alert(1)</script>', 'plain text is preserved; UI must use textContent, not HTML')
const facts = await loadBusinessFacts(client, context, ['BUSINESS_INFO'])
assert.equal(facts.name, 'Glow')
assert.equal(businessReads, 1, 'facts must not add a second business query')
assert.equal(settingsReads, 0, 'facts reuse Business.featureSettings relation in same query')
const identity = await loadDialogueIdentity(client, 'tenant', { businessId: facts.businessId, businessName: facts.name })
assert.equal(identity.businessName, 'Glow')
assert.equal(businessReads, 1, 'identity reuses loaded public business')
assert.equal(settingsReads, 1, 'identity keeps its existing personality read, no extra query')
const identityDuringEdit = await loadDialogueIdentity({ ...client, businessFeatureSettings: { findUnique: async () => ({ businessId: 'tenant', assistantPersonality: { commercialName: 'Changed during turn', name: 'Cami' } }) } }, 'tenant', { businessId: facts.businessId, businessName: facts.name })
assert.equal(identityDuringEdit.businessName, facts.name, 'a turn cannot introduce a different brand than the verified facts snapshot')
assert.equal(facts.mapsUrl, base.publicMapsUrl, 'Maps stays associated with the same public business facts')
assert.equal(JSON.stringify(facts).includes('customInstructions'), false, 'private personality JSON does not escape into public facts')
const legacyClient: any = { ...client, business: { findFirst: async () => ({ ...base, featureSettings: { businessId: 'tenant', assistantPersonality: { name: 'Cami' } } }) }, businessFeatureSettings: { findUnique: async () => ({ businessId: 'tenant', assistantPersonality: { name: 'Cami' } }) } }
assert.equal((await loadBusinessFacts(legacyClient, context, ['BUSINESS_INFO'])).name, base.name)
await assert.rejects(() => loadBusinessFacts({ ...client, business: { findFirst: async () => ({ ...base, featureSettings: { businessId: 'foreign', assistantPersonality: { commercialName: 'Foreign' } } }) } }, context, ['BUSINESS_INFO']), /scope/, 'forged cross-tenant settings are rejected')
assert.equal((await loadDialogueIdentity(legacyClient, 'tenant')).businessName, base.name)
const stamp = readFileSync('src/conversational-bot/public-source-stamp.ts', 'utf8')
assert.match(stamp, /BusinessFeatureSettings/)
assert.match(stamp, /commercialName/)
const crm = readFileSync('src/routes/crm-ui.ts', 'utf8')
assert.match(crm, /id="assistant-commercial-name" maxlength="80"/)
assert.match(crm, /assistantPersonalityPreview\.textContent = greeting/)
assert.doesNotMatch(crm, /assistantPersonalityPreview\.textContent = greeting \+ \(brand/, 'brand appears once, inside the greeting')
assert.match(crm, /'¡Holaa!' \+ emoji \+ ' Soy '/, 'inline CRM preview must place emoji before assistant name like the verified introduction')
const settingsRoute = readFileSync('src/routes/crm.ts', 'utf8')
assert.equal((settingsRoute.match(/assistantPersonalityPreview\(assistantPersonality, business\?\.name\)/g) ?? []).length, 2, 'GET/PATCH editor previews share configured display name')
assert.equal((settingsRoute.match(/select: \{ id: true, name: true, botEnabled: true, aiEnabled: true \}/g) ?? []).length, 2, 'existing business resolver selects name for both GET and PATCH preview fallback')
assert.match(settingsRoute, /assistantPersonality\?: unknown/, 'PATCH accepts the existing JSON personality body')
assert.match(settingsRoute, /normalizeAssistantPersonality\(body\.assistantPersonality\)/, 'PATCH normalizes the submitted profile')
assert.equal((settingsRoute.match(/assistantPersonality: assistantPersonality as Prisma\.InputJsonValue/g) ?? []).length, 2, 'create/update persist the same normalized profile')
assert.equal((settingsRoute.match(/featureSettings\?\.assistantPersonality/g) ?? []).length >= 2, true, 'GET/PATCH reload the stored JSON field')
assert.match(crm, /commercialName: els\.assistantCommercialName\.value\.trim\(\)/)
assert.match(crm, /assistantCommercialName: document\.getElementById/)
console.log('commercial name configured identity/facts/editor: PASS')
