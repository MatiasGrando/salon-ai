import assert from 'node:assert/strict'
import {
  canTransitionInstagramCommentExecution,
  canTransitionInstagramPublication,
  matchInstagramKeywords,
  normalizeInstagramKeyword,
  validateInstagramReelDraft
} from '../src/services/instagram-automation-domain.js'

assert.equal(normalizeInstagramKeyword('  PRÉCIO\t del   Día '), 'precio del dia')
assert.equal(normalizeInstagramKeyword('TURŃO'), 'turno')

assert.deepEqual(
  matchInstagramKeywords('¡Hola! Quiero conocer el PRÉCIO del corte.', ['turno', 'precio']),
  { matched: true, keyword: 'precio' }
)
assert.deepEqual(
  matchInstagramKeywords('Necesito un turno para mañana', ['turno para mañana']),
  { matched: true, keyword: 'turno para manana' }
)
assert.deepEqual(matchInstagramKeywords('Ese desprecio fue innecesario', ['precio']), { matched: false })
assert.deepEqual(matchInstagramKeywords('turnos disponibles', ['turno']), { matched: false })
assert.deepEqual(matchInstagramKeywords('turno, por favor', ['', ' TURNO ', 'turno']), {
  matched: true,
  keyword: 'turno'
})

const valid = validateInstagramReelDraft({
  businessId: 'business-a',
  videoObjectPath: 'business-a/instagram-reels/video-1.mp4',
  videoMimeType: 'video/mp4',
  videoSizeBytes: 1234,
  caption: 'Nuevo look',
  privateReplyText: 'Te mando la información por acá.',
  keywords: [' Precio ', 'PRÉCIO', 'turno para mañana']
})
assert.deepEqual(valid, {
  ok: true,
  normalizedKeywords: [
    { value: 'Precio', normalizedValue: 'precio' },
    { value: 'turno para mañana', normalizedValue: 'turno para manana' }
  ]
})

for (const invalid of [
  validateInstagramReelDraft({ businessId: '', videoObjectPath: 'x', videoMimeType: 'video/mp4', videoSizeBytes: 1, caption: '', privateReplyText: 'ok', keywords: ['precio'] }),
  validateInstagramReelDraft({ businessId: 'b', videoObjectPath: '', videoMimeType: 'video/mp4', videoSizeBytes: 1, caption: '', privateReplyText: 'ok', keywords: ['precio'] }),
  validateInstagramReelDraft({ businessId: 'b', videoObjectPath: 'x', videoMimeType: 'image/png', videoSizeBytes: 1, caption: '', privateReplyText: 'ok', keywords: ['precio'] }),
  validateInstagramReelDraft({ businessId: 'b', videoObjectPath: 'x', videoMimeType: 'video/mp4', videoSizeBytes: 0, caption: '', privateReplyText: '', keywords: [] })
]) assert.equal(invalid.ok, false)

assert.equal(canTransitionInstagramPublication('DRAFT', 'READY'), true)
assert.equal(canTransitionInstagramPublication('READY', 'CREATING_CONTAINER'), true)
assert.equal(canTransitionInstagramPublication('CREATING_CONTAINER', 'PROCESSING'), true)
assert.equal(canTransitionInstagramPublication('PROCESSING', 'PUBLISHING'), true)
assert.equal(canTransitionInstagramPublication('PUBLISHING', 'PUBLISHED'), true)
assert.equal(canTransitionInstagramPublication('PUBLISHED', 'READY'), false)
assert.equal(canTransitionInstagramPublication('PUBLISHING', 'UNKNOWN'), true)
assert.equal(canTransitionInstagramPublication('UNKNOWN', 'PUBLISHING'), false)

assert.equal(canTransitionInstagramCommentExecution('READY', 'CLAIMED'), true)
assert.equal(canTransitionInstagramCommentExecution('CLAIMED', 'SENDING'), true)
assert.equal(canTransitionInstagramCommentExecution('SENDING', 'SENT'), true)
assert.equal(canTransitionInstagramCommentExecution('SENDING', 'UNKNOWN'), true)
assert.equal(canTransitionInstagramCommentExecution('SENDING', 'RETRY'), true)
assert.equal(canTransitionInstagramCommentExecution('RETRY', 'CLAIMED'), true)
assert.equal(canTransitionInstagramCommentExecution('SENT', 'READY'), false)

console.log('Instagram Reel domain contract: OK')
