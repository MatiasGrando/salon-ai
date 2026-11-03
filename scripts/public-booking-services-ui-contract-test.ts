import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const route = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')

assert.match(
  route,
  /class=\"fresha-option booking-service-option /,
  'service cards should have their own visual component class'
)
assert.match(
  route,
  /class=\"service-check\"/,
  'multi-service selection should use a check indicator instead of a radio indicator'
)
assert.match(
  route,
  /class=\"service-meta\"/,
  'service duration and category should use a dedicated metadata row'
)
assert.match(
  route,
  /class=\"service-price\"/,
  'service price should have a dedicated visual hierarchy'
)
assert.match(
  route,
  /\.booking-service-option\.selected \.service-check::after/,
  'selected service cards should expose a visible check mark'
)
assert.match(
  route,
  /@media \(max-width: 560px\)[\s\S]*?\.booking-service-option/,
  'service cards should define a mobile-specific layout'
)
assert.match(
  route,
  /serviceSearch: ''/,
  'service browsing should retain the active search between renders'
)
assert.match(
  route,
  /serviceCategory: 'all'/,
  'the All category should be the default catalog view'
)
assert.match(
  route,
  /data-service-search/,
  'customers should have a text search control'
)
assert.match(
  route,
  /data-service-category="all"/,
  'the category controls should expose an All filter first'
)
assert.match(
  route,
  /function visibleServiceGroups\(\)/,
  'services should be grouped by category in the All view'
)
assert.match(
  route,
  /booking-service-group/,
  'grouped categories should have dedicated markup and styling'
)
assert.match(
  route,
  /data-service-category\]/,
  'category controls should respond to customer interaction'
)

// Compile the helper through the same outer template escaping as emitted client JS.
const thumbnailSource = route.slice(route.indexOf('          function renderServiceThumbnail('), route.indexOf('          function renderServiceGroups('))
assert.ok(thumbnailSource.startsWith('          function renderServiceThumbnail('))
const emittedThumbnail = runInNewContext('`' + thumbnailSource + '`')
const thumbnail = runInNewContext(emittedThumbnail + '; renderServiceThumbnail', { URL, escapeHtml: (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;') })
const rendersPhoto = (imageUrl: unknown) => /<img src=/.test(thumbnail({ imageUrl }))
for (const imageUrl of ['https://images.test/photo.png', 'http://images.test/photo.jpg', '/landing-assets/real-photo.png', 'data:image/png;base64,AAAA']) {
  assert.equal(rendersPhoto(imageUrl), true, 'published legacy format remains usable: ' + imageUrl)
}
for (const imageUrl of [null, '', 'javascript:alert(1)', '//images.test/photo.png', '/unknown/photo.png', 'https://user:secret@images.test/photo.png', 'https://images.test/\nphoto.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAAA']) {
  assert.equal(rendersPhoto(imageUrl), false, 'unsafe or malformed image must use neutral fallback')
}
for (const size of [4 * 1024 * 1024, 4 * 1024 * 1024 + 1]) {
  const imageUrl = 'data:image/png;base64,' + Buffer.alloc(size).toString('base64')
  assert.equal(rendersPhoto(imageUrl), size === 4 * 1024 * 1024, 'the legacy limit is decoded bytes, not URL character count')
}
assert.match(thumbnail({ imageUrl: null }), /data-service-thumbnail/, 'fallback keeps the same reserved footprint')

console.log('Public booking services UI contract: OK')
