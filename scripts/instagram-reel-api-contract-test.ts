import assert from 'node:assert/strict'
import { InstagramApi, InstagramApiRequestError } from '../src/integrations/instagram-api.js'

type CapturedRequest = {
  url: string
  init: RequestInit | undefined
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
})

const requests: CapturedRequest[] = []
const replies: Response[] = []
const fetchStub: typeof fetch = async (input, init) => {
  requests.push({ url: String(input), init })
  const next = replies.shift()
  assert.ok(next, 'Cada request debe tener una respuesta preparada')
  return next
}

const api = new InstagramApi(fetchStub)

replies.push(response({ id: 'container-1' }))
assert.deepEqual(await api.createReelContainer({
  accountId: 'ig-account',
  accessToken: 'secret',
  videoUrl: 'https://cdn.example.com/reel.mp4',
  caption: 'Nuevo look',
  shareToFeed: true
}), { containerId: 'container-1' })
assert.equal(requests[0]?.url, 'https://graph.instagram.com/v25.0/ig-account/media')
assert.equal(requests[0]?.init?.method, 'POST')
assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
  media_type: 'REELS',
  video_url: 'https://cdn.example.com/reel.mp4',
  caption: 'Nuevo look',
  share_to_feed: true
})

replies.push(response({ status_code: 'FINISHED' }))
assert.deepEqual(await api.getContainerStatus({
  containerId: 'container-1',
  accessToken: 'secret'
}), { statusCode: 'FINISHED' })
assert.equal(requests[1]?.url, 'https://graph.instagram.com/v25.0/container-1?fields=status_code')

replies.push(response({ id: 'media-1' }))
assert.deepEqual(await api.publishContainer({
  accountId: 'ig-account',
  accessToken: 'secret',
  containerId: 'container-1'
}), { mediaId: 'media-1' })
assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), { creation_id: 'container-1' })

replies.push(response({ data: [{ quota_usage: 4, config: { quota_total: 50, quota_duration: 86400 } }] }))
assert.deepEqual(await api.getContentPublishingLimit({
  accountId: 'ig-account',
  accessToken: 'secret'
}), { quotaUsage: 4, config: { quota_total: 50, quota_duration: 86400 } })
assert.equal(
  requests[3]?.url,
  'https://graph.instagram.com/v25.0/ig-account/content_publishing_limit?fields=quota_usage%2Cconfig'
)

replies.push(response({ message_id: 'message-1', recipient_id: 'comment-author' }))
assert.deepEqual(await api.sendPrivateReply({
  accountId: 'ig-account',
  accessToken: 'secret',
  commentId: 'comment-1',
  text: 'Te enviamos la información por privado.'
}), { messageId: 'message-1', recipientId: 'comment-author' })
assert.deepEqual(JSON.parse(String(requests[4]?.init?.body)), {
  recipient: { comment_id: 'comment-1' },
  message: { text: 'Te enviamos la información por privado.' }
})

replies.push(response({ message_id: 'message-2' }))
assert.deepEqual(await api.sendTextMessage({
  instagramAccountId: 'ig-account',
  accessToken: 'secret',
  recipientId: 'user-1',
  text: 'Hola'
}), { messageId: 'message-2', recipientId: 'user-1' })
assert.deepEqual(JSON.parse(String(requests[5]?.init?.body)), {
  recipient: { id: 'user-1' },
  message: { text: 'Hola' }
})

await assert.rejects(
  api.createReelContainer({
    accountId: 'ig-account',
    accessToken: 'secret',
    videoUrl: 'http://cdn.example.com/reel.mp4',
    caption: '',
    shareToFeed: false
  }),
  /HTTPS/
)

const metaErrorApi = new InstagramApi(async () => response({
  error: {
    message: 'Rate limited',
    code: 4,
    error_subcode: 2207051,
    is_transient: true
  }
}, 429))
await assert.rejects(
  metaErrorApi.publishContainer({ accountId: 'ig-account', accessToken: 'secret', containerId: 'container-1' }),
  (error: unknown) => {
    assert.ok(error instanceof InstagramApiRequestError)
    assert.equal(error.httpStatus, 429)
    assert.equal(error.metaCode, 4)
    assert.equal(error.metaSubcode, 2207051)
    assert.equal(error.transient, true)
    assert.equal(error.ambiguous, false)
    return true
  }
)

const networkErrorApi = new InstagramApi(async () => {
  throw new TypeError('fetch failed')
})
await assert.rejects(
  networkErrorApi.publishContainer({ accountId: 'ig-account', accessToken: 'secret', containerId: 'container-1' }),
  (error: unknown) => {
    assert.ok(error instanceof InstagramApiRequestError)
    assert.equal(error.httpStatus, null)
    assert.equal(error.transient, true)
    assert.equal(error.ambiguous, true)
    return true
  }
)

for (const status of [200, 502]) {
  const invalidJsonPostApi = new InstagramApi(async () => new Response('<html>truncated upstream response', {
    status,
    headers: { 'Content-Type': 'text/html' }
  }))
  await assert.rejects(
    invalidJsonPostApi.sendPrivateReply({
      accountId: 'ig-account', accessToken: 'secret', commentId: 'comment-1', text: 'Hola'
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstagramApiRequestError)
      assert.equal(error.httpStatus, status)
      assert.equal(error.ambiguous, true)
      return true
    }
  )
}

const opaqueServerPostApi = new InstagramApi(async () => response({}, 502))
await assert.rejects(
  opaqueServerPostApi.sendPrivateReply({
    accountId: 'ig-account', accessToken: 'secret', commentId: 'comment-1', text: 'Hola'
  }),
  (error: unknown) => {
    assert.ok(error instanceof InstagramApiRequestError)
    assert.equal(error.httpStatus, 502)
    assert.equal(error.ambiguous, true)
    return true
  }
)

console.log('OK: contrato del adaptador de publicación de Reels y respuestas privadas')
