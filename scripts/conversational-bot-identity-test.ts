import assert from 'node:assert/strict'
import { normalizeAssistantPersonality, DEFAULT_ASSISTANT_PERSONALITY, assistantPersonalityPreview, personalityForPreset, applyAssistantPersonalityToReply, buildAssistantPersonalityInstructions } from '../src/services/assistant-personality-config.js'
import { introduceDialogue, type DialogueIdentity } from '../src/conversational-bot/dialogue-identity.js'
import { loadDialogueIdentity, type DialogueIdentityClient } from '../src/conversational-bot/prisma-dialogue-identity.js'

globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
async function main() {
  assert.deepEqual(normalizeAssistantPersonality(null), DEFAULT_ASSISTANT_PERSONALITY)
  assert.deepEqual(normalizeAssistantPersonality({ name: '  Alba   Sol  ', preset: 'direct' }), { ...personalityForPreset('direct', 'Alba Sol') })
  assert.equal(normalizeAssistantPersonality({ name: 'N'.repeat(100) }).name.length, 40)
  for (const preset of ['warm', 'elegant', 'relaxed', 'direct', 'neutral'] as const) {
    const profile = personalityForPreset(preset, 'Alba')
    assert.match(assistantPersonalityPreview(profile), /Alba/)
    assert.match(buildAssistantPersonalityInstructions(profile), /Tu nombre es Alba/)
    assert.match(applyAssistantPersonalityToReply('Hola Cami, ¿Querés ayuda? 😊', profile), /Alba/)
  }
  const calls: unknown[] = []
  const client: DialogueIdentityClient = {
    business: { async findFirst(args) { calls.push(args); return { id: 'tenant', name: 'Nombre público' } } },
    businessFeatureSettings: { async findUnique(args) { calls.push(args); return { businessId: 'tenant', assistantPersonality: { name: '  Alba  ', customInstructions: 'PRIVATE', secret: 'NEVER' } } } }
  }
  const identity = await loadDialogueIdentity(client, 'tenant')
  assert.deepEqual(identity, { businessId: 'tenant', businessName: 'Nombre público', assistantName: 'Alba', treatment: 'vos', greetingEmoji: '😊' })
  assert.deepEqual(calls, [
    { where: { id: 'tenant' }, select: { id: true, name: true } },
    { where: { businessId: 'tenant' }, select: { businessId: true, assistantPersonality: true } }
  ])
  assert.equal(JSON.stringify(identity).includes('PRIVATE'), false)
  calls.length = 0
  await loadDialogueIdentity(client, 'tenant', { businessId: 'tenant', businessName: 'Ya cargado' })
  assert.equal(calls.length, 1, 'reuse public business name instead of another query')
  await assert.rejects(() => loadDialogueIdentity(client, 'foreign', { businessId: 'tenant', businessName: 'wrong' }), /identity scope/)
  await assert.rejects(() => loadDialogueIdentity({ ...client, business: { async findFirst() { return { id: 'foreign', name: 'Wrong' } } } }, 'tenant'), /identity scope/)
  await assert.rejects(() => loadDialogueIdentity({ ...client, businessFeatureSettings: { async findUnique() { return { businessId: 'foreign', assistantPersonality: null } } } }, 'tenant'), /identity scope/)
  const absent = await loadDialogueIdentity({ ...client, businessFeatureSettings: { async findUnique() { return null } } }, 'tenant')
  assert.equal(absent.assistantName, DEFAULT_ASSISTANT_PERSONALITY.name, 'official editor default, not a per-business literal')
  const first = introduceDialogue({ identity, introduced: false, kind: 'social', customerName: 'Matías' })
  assert.match(first.reply, /¡Holaa, Matías! 😊/); assert.match(first.reply, /Alba/); assert.match(first.reply, /Nombre público/)
  assert.match(first.reply, /Matías/); assert.match(first.reply, /¿En qué te puedo ayudar\?/)
  assert.doesNotMatch(first.reply, /servicio|reservar|turno/i)
  assert.equal(first.introduced, true)
  const repeated = introduceDialogue({ identity, introduced: first.introduced, kind: 'social' })
  assert.doesNotMatch(repeated.reply, /Alba|Nombre público/)
  const concrete = introduceDialogue({ identity, introduced: false, kind: 'concrete', reply: 'El servicio cuesta $ 2500. ¿Querés ver sus detalles?' })
  assert.match(concrete.reply, /Alba/); assert.match(concrete.reply, /2500/)
  assert.doesNotMatch(concrete.reply, /En qué.*ayudar/)
  assert.equal((concrete.reply.match(/¿/g) ?? []).length, 1)
  assert.equal(introduceDialogue({ identity, introduced: true, kind: 'concrete', reply: 'Respuesta directa.' }).reply, 'Respuesta directa.')
  assert.throws(() => introduceDialogue({ identity, introduced: false, kind: 'concrete', reply: '' }), /concrete reply/)
  assert.throws(() => introduceDialogue({ identity: { ...identity, assistantName: 'bad\nname' }, introduced: false, kind: 'social' }), /identity/)
  const noEmoji = await loadDialogueIdentity({ ...client, businessFeatureSettings: { async findUnique() { return { businessId: 'tenant', assistantPersonality: { name: 'Alba', emojiLevel: 'none' } } } } }, 'tenant')
  assert.doesNotMatch(introduceDialogue({ identity: noEmoji, introduced: false, kind: 'social' }).reply, /😊/)
  const formal: DialogueIdentity = { ...identity, treatment: 'usted' }
  assert.match(introduceDialogue({ identity: formal, introduced: false, kind: 'social' }).reply, /¿En qué puedo ayudarle\?/)
  const freshConversation = introduceDialogue({ identity, introduced: false, kind: 'social' })
  assert.match(freshConversation.reply, /Alba/, 'existing reset decides when marker is absent; no new inactivity policy')
  console.log('PASS configured identity, official parity, scoped loader, once-only introduction and direct intent')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
