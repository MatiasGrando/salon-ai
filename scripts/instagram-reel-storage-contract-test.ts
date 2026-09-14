import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_INSTAGRAM_REELS_BUCKET: process.env.SUPABASE_INSTAGRAM_REELS_BUCKET,
  INSTAGRAM_REEL_MAX_BYTES: process.env.INSTAGRAM_REEL_MAX_BYTES,
  INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS: process.env.INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS
}

try {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-service-role'
  process.env.SUPABASE_INSTAGRAM_REELS_BUCKET = 'instagram-reels-private'
  process.env.INSTAGRAM_REEL_MAX_BYTES = '1048576'
  process.env.INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS = '21600'

  const {
    createInstagramReelUpload,
    deleteInstagramReelVideo,
    verifyAndSignInstagramReelVideo
  } = await import('../src/services/instagram-video-storage-service.js')

  const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method || 'GET'
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? init.body : ''
    requests.push({ url, method, headers, body })

    if (method === 'POST' && url.includes('/object/upload/sign/')) {
      const signedPath = new URL(url).pathname.replace('/storage/v1', '')
      return Response.json({ url: `${signedPath}?token=upload-token` })
    }
    if (method === 'GET' && url.includes('/object/info/')) {
      return Response.json({ metadata: { size: 345678, mimetype: 'video/mp4' } })
    }
    if (method === 'POST' && url.includes('/object/sign/')) {
      const signedPath = new URL(url).pathname.replace('/storage/v1', '').replace('/object/sign/', '/object/sign/')
      return Response.json({ signedURL: `${signedPath}?token=read-token` })
    }
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': '345678', 'content-type': 'video/mp4' }
      })
    }
    if (method === 'DELETE') return Response.json([])
    return new Response('unexpected request', { status: 500 })
  }

  const upload = await createInstagramReelUpload({
    businessId: 'business-123',
    mimeType: 'video/mp4',
    sizeBytes: 345678
  })

  assert.equal(upload.bucket, 'instagram-reels-private')
  assert.match(upload.objectPath, /^business-123\/instagram\/reels\/[0-9a-f-]{36}\.mp4$/)
  assert.match(upload.uploadUrl, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/instagram-reels-private\/business-123\/instagram\/reels\/[0-9a-f-]{36}\.mp4\?token=upload-token$/)
  assert.equal(upload.uploadToken, 'upload-token')
  assert.equal(upload.expiresInSeconds, 7200)
  assert.deepEqual(upload.uploadHeaders, {
    'cache-control': 'max-age=3600',
    'content-type': 'video/mp4',
    'x-upsert': 'false'
  })

  const uploadRequest = requests[0]
  assert.equal(uploadRequest?.method, 'POST')
  assert.equal(uploadRequest?.headers.get('apikey'), 'server-only-service-role')
  assert.equal(uploadRequest?.headers.get('authorization'), 'Bearer server-only-service-role')
  assert.doesNotMatch(JSON.stringify(upload), /server-only-service-role/)

  const signed = await verifyAndSignInstagramReelVideo({
    businessId: 'business-123',
    objectPath: upload.objectPath,
    expectedMimeType: 'video/mp4',
    expectedSizeBytes: 345678
  })

  assert.match(signed.signedUrl, /\/storage\/v1\/object\/sign\/instagram-reels-private\/business-123\/instagram\/reels\/.+\?token=read-token$/)
  assert.equal(signed.expiresInSeconds, 21600)
  assert.equal(signed.sizeBytes, 345678)
  assert.equal(signed.mimeType, 'video/mp4')
  assert.equal(requests[1]?.method, 'GET', 'debe consultar metadata autenticada después de la subida')
  assert.match(requests[1]?.url || '', /\/storage\/v1\/object\/info\/instagram-reels-private\//)
  assert.equal(requests[2]?.method, 'POST', 'debe firmar una URL temporal de lectura')
  assert.deepEqual(JSON.parse(requests[2]?.body || '{}'), { expiresIn: 21600 })
  assert.equal(requests[3]?.method, 'HEAD', 'debe comprobar que la URL firmada responde sin credenciales')
  assert.equal(requests[3]?.headers.has('authorization'), false)
  assert.equal(requests[3]?.headers.has('apikey'), false)

  await deleteInstagramReelVideo({ businessId: 'business-123', objectPath: upload.objectPath })
  const deleteRequest = requests[4]
  assert.equal(deleteRequest?.method, 'DELETE')
  assert.deepEqual(JSON.parse(deleteRequest?.body || '{}'), { prefixes: [upload.objectPath] })
  assert.equal(deleteRequest?.headers.get('authorization'), 'Bearer server-only-service-role')

  await assert.rejects(
    createInstagramReelUpload({ businessId: 'business-123', mimeType: 'video/webm', sizeBytes: 100 }),
    /tipo de video/i
  )
  await assert.rejects(
    createInstagramReelUpload({ businessId: 'business-123', mimeType: 'video/mp4', sizeBytes: 1048577 }),
    /tamaño/i
  )
  await assert.rejects(
    deleteInstagramReelVideo({ businessId: 'another-business', objectPath: upload.objectPath }),
    /no pertenece/i
  )
} finally {
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

console.log('Instagram Reel storage contract: OK')
