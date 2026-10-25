import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
const { InstagramApi } = await import('../src/integrations/instagram-api.js')
const { instagramConfig } = await import('../src/config/instagram.js')
const { emptyInsights, parseInsights, INSTAGRAM_INSIGHT_METRICS } = await import('../src/services/instagram-media-domain.js')
const captured: Array<{ url: URL; init?: RequestInit | undefined }> = []
let body: unknown = {}
let status = 200
const secret = 'fixture-token-never-rendered'
const api = new InstagramApi(async (input, init) => {
  captured.push({ url: new URL(String(input)), init })
  return new Response(JSON.stringify(body), { status })
})
const reel = { id: 'reel-1', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'Corte', timestamp: '2026-01-01T00:00:00Z', permalink: 'https://www.instagram.com/reel/abc/', thumbnail_url: 'https://scontent.cdninstagram.com/thumbnail.jpg' }
body = { data: [reel, reel, { id: '../escape' }, { id: 'ordinary-video', media_type: 'VIDEO', media_product_type: 'FEED' }], paging: { next: 'https://untrusted.example/steal?access_token=' + secret, cursors: { after: 'abc+/=?:#' } } }
let page = await api.listMedia({ accountId: 'account-1', accessToken: secret })
assert.equal(page.media.length, 2, 'duplicate provider IDs are imported once and malformed IDs skipped')
assert.equal(page.skipped, 2)
assert.equal(page.media[1]?.mediaProductType, 'FEED', 'VIDEO alone must not become a Reel')
assert.equal(page.nextCursor, 'abc+/=?:#', 'provider cursors are opaque, not an invented base64 alphabet')
await api.listMedia({ accountId: 'account-1', accessToken: secret, after: page.nextCursor })
assert.equal(captured[1]?.url.host, 'graph.instagram.com')
assert.equal(captured[1]?.url.pathname, '/v25.0/account-1/media')
assert.equal(captured[1]?.url.searchParams.get('after'), 'abc+/=?:#')
assert.equal(captured[0]?.url.searchParams.get('limit'), '5')
assert.ok(captured.every((request) => !request.url.href.includes(secret)))
assert.equal((captured[0]?.init?.headers as any).Authorization, 'Bearer ' + secret)
assert.ok(captured[0]?.init?.signal instanceof AbortSignal, 'every new provider request has a finite abort deadline')
for (const accountId of ['..', 'https://evil.test', 'account/path', 'id?access_token=stolen']) {
  const before = captured.length
  await assert.rejects(api.listMedia({ accountId, accessToken: secret }), /Identificador/)
  await assert.rejects(api.getReelInsights({ mediaId: accountId, accessToken: secret }), /Identificador/)
  assert.equal(captured.length, before, 'invalid resource IDs cannot create any request')
}
body = { data: [reel], paging: { cursors: { after: 'terminal' } } }
assert.equal((await api.listMedia({ accountId: 'account-1', accessToken: secret })).nextCursor, null, 'an after cursor without another page is terminal')
for (const malformed of [{}, { data: {} }, { data: Array(6).fill(reel) }, { data: [], paging: { next: 'https://evil.test', cursors: {} } }, { data: [], paging: { next: 'x', cursors: { after: secret } } }]) {
  body = malformed
  await assert.rejects(api.listMedia({ accountId: 'account-1', accessToken: secret }))
}
body = { data: [{ ...reel, permalink: 'javascript:alert(1)', thumbnail_url: 'https://evil.test/' + secret }] }
page = await api.listMedia({ accountId: 'account-1', accessToken: secret })
assert.equal(page.media[0]?.permalink, null)
assert.equal(page.media[0]?.thumbnailUrl, null)

body = { data: INSTAGRAM_INSIGHT_METRICS.map((name, index) => ({ name, period: 'lifetime', values: [{ value: index }] })) }
let metrics = await api.getReelInsights({ mediaId: 'reel-1', accessToken: secret })
assert.equal(metrics.values.views, 0, 'observed zero is a known count')
assert.equal(metrics.values.reach, 1, 'reach is never aliased to views')
assert.equal(metrics.periods.reach, 'lifetime')
assert.equal(captured.at(-1)?.url.searchParams.get('metric'), INSTAGRAM_INSIGHT_METRICS.join(','))
for (const [sample, expectedPeriod] of [
  [{ name: 'views', period: 'day', values: [{ value: 900 }] }, 'day'],
  [{ name: 'views', period: 'lifetime', values: [{ value: 1 }, { value: 2 }] }, 'lifetime'],
  [{ name: 'views', values: [{ value: 1 }] }, null],
  [{ name: 'views', period: 'lifetime', values: [{ value: '300' }] }, 'lifetime'],
  [{ name: 'views', period: 'lifetime', values: [{ value: -1 }] }, 'lifetime']
] as const) {
  metrics = parseInsights({ data: [sample] })
  assert.equal(metrics.values.views, null, 'unsupported periods, series or malformed counts cannot become lifetime totals')
  assert.equal(metrics.periods.views, expectedPeriod)
}
assert.equal(parseInsights({ data: [{ name: 'views', period: 'lifetime', values: [{ value: 1 }] }, { name: 'views', period: 'lifetime', values: [{ value: 2 }] }] }).values.views, null, 'duplicate metrics are ambiguous')
assert.deepEqual(parseInsights({ data: [] }).values, emptyInsights())
const version = instagramConfig.apiVersion
try {
  instagramConfig.apiVersion = 'v21.0'
  const before = captured.length
  await assert.rejects(api.getReelInsights({ mediaId: 'reel-1', accessToken: secret }), /unsupported_api_version/)
  assert.equal(captured.length, before, 'incompatible configured versions are not silently upgraded')
} finally { instagramConfig.apiVersion = version }
status = 429
body = { error: { message: 'Throttled ' + secret, code: 4 } }
await assert.rejects(api.getReelInsights({ mediaId: 'reel-1', accessToken: secret }))
console.log('OK: bounded media adapter, untrusted pagination, resource IDs, lifetime/partial/malformed insights and configured API compatibility')
