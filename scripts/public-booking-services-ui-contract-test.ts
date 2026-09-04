import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log('Public booking services UI contract: OK')
