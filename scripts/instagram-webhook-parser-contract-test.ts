import assert from 'node:assert/strict'
import { parseInstagramWebhookPayload } from '../src/services/instagram-webhook-parser.js'

// Fixture kept intentionally explicit and narrow: it mirrors Meta's documented
// `comments` change shape. The parser is isolated so sandbox payload differences
// can be adjusted without touching ingress or delivery behavior.
const payload = {
  object: 'instagram',
  entry: [{
    id: 'ig-business-1',
    time: 1_725_000_000,
    messaging: [{
      sender: { id: 'ig-user-dm' },
      recipient: { id: 'ig-business-1' },
      timestamp: 1_725_000_001,
      message: { mid: 'mid-1', text: '  Hola  ' }
    }],
    changes: [{
      field: 'comments',
      value: {
        id: 'comment-1',
        text: 'Quiero PRECIO',
        from: { id: 'ig-user-comment', username: 'ana' },
        media: { id: 'reel-1', media_product_type: 'REELS' }
      }
    }]
  }]
}

const parsed = parseInstagramWebhookPayload(payload)
assert.deepEqual(parsed.messaging, [{
  kind: 'messaging',
  instagramAccountIds: ['ig-business-1'],
  senderId: 'ig-user-dm',
  messageId: 'mid-1',
  text: 'Hola',
  timestamp: 1_725_000_001
}])
assert.deepEqual(parsed.comments, [{
  kind: 'comment',
  instagramAccountIds: ['ig-business-1'],
  providerCommentId: 'comment-1',
  commenterInstagramUserId: 'ig-user-comment',
  commenterUsername: 'ana',
  text: 'Quiero PRECIO',
  verb: null,
  parentCommentId: null,
  mediaId: 'reel-1',
  mediaProductType: 'REELS',
  timestamp: 1_725_000_000
}])

const ignored = parseInstagramWebhookPayload({
  object: 'instagram',
  entry: [{
    id: 'ig-business-1',
    messaging: [
      { sender: { id: 'u' }, message: { mid: 'echo', text: 'x', is_echo: true } },
      { sender: { id: 'u' }, message: { mid: 'deleted', text: 'x', is_deleted: true } }
    ],
    changes: [{ field: 'likes', value: { id: 'not-a-comment' } }]
  }]
})
assert.deepEqual(ignored, { messaging: [], comments: [] })

console.log('Instagram webhook parser contract: OK')
