import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeBookingTheme } from '../src/routes/business.js'
import { defaultBookingTheme, resolveBookingTheme } from '../src/routes/landing-ui.js'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260904173000_add_business_booking_theme/migration.sql', import.meta.url), 'utf8')
const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const bookingUi = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')

assert.match(schema, /bookingTheme\s+String\?/, 'booking theme must be persisted separately from landing content')
assert.match(migration, /ADD COLUMN "bookingTheme" TEXT/, 'migration must add the dedicated booking theme field')
assert.match(businessRoute, /normalizeBookingTheme\(body\.bookingTheme\)/, 'the business endpoint must validate booking themes')
assert.match(businessRoute, /bookingTheme: bookingTheme/, 'the business endpoint must persist the selected theme')

for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) {
  assert.match(crmUi, new RegExp('name="booking-theme" value="' + theme + '"'), `settings must offer the ${theme} theme`)
  assert.match(bookingUi, new RegExp('booking-theme-' + theme), `public booking must style the ${theme} theme`)
}

assert.match(crmUi, /class="booking-theme-grid"/, 'themes should be presented as visual swatches')
assert.match(crmUi, /id="booking-theme-preview"/, 'settings should include an immediate theme preview')
assert.match(crmUi, /bookingTheme: selectedBookingTheme/, 'settings must send the selected booking theme')
assert.match(crmUi, /renderBookingThemePreview/, 'theme choice must update the preview immediately')
assert.match(crmUi, /bookingThemeDirty/, 'manual theme selection must be tracked before save')
assert.match(crmUi, /bookingThemeDirty\s*=\s*true/, 'manual theme selection must mark the selector dirty')
assert.match(crmUi, /if \(!state\.business\?\.bookingTheme && !state\.bookingThemeDirty\)/, 'template changes must not overwrite an unsaved manual theme')

for (const property of ['--theme-summary', '--theme-summary-ink', '--theme-cta', '--theme-on-cta']) {
  assert.match(crmUi, new RegExp(property), `settings preview must model ${property}`)
}
assert.match(crmUi, /booking-theme-light[^}]*--theme-cta:#111111/, 'light preview must render the real black CTA')
assert.match(crmUi, /booking-theme-preview-summary[^}]*background:\s*var\(--theme-summary\)/, 'preview summary must use its real themed surface')
assert.match(crmUi, /booking-theme-preview-summary::after[^}]*background:\s*var\(--theme-cta\)/, 'preview CTA must use its real themed action color')

for (const token of [
  '--booking-bg', '--booking-surface', '--booking-ink', '--booking-muted', '--booking-border',
  '--booking-accent', '--booking-accent-soft', '--booking-summary-bg', '--booking-summary-ink', '--booking-cta'
]) {
  assert.match(bookingUi, new RegExp(token), `public booking must expose ${token}`)
}

assert.match(bookingUi, /class="crumb-number"/, 'booking progress should use numbered steps')
assert.match(bookingUi, /summary-eyebrow/, 'summary should have a compact reservation hierarchy')
assert.match(bookingUi, /summary-subtotal/, 'summary should distinguish subtotal from the amount due now')
assert.match(bookingUi, /summary-deposit/, 'summary should expose the deposit as a separate amount')
assert.match(bookingUi, /position:\s*sticky/, 'desktop summary should remain visible while browsing services')
assert.match(bookingUi, /class="booking-mobile-bar"/, 'mobile booking must expose a persistent action bar')
assert.match(bookingUi, /id="booking-mobile-count"/, 'mobile action bar must show selected service count')
assert.match(bookingUi, /id="booking-mobile-total"/, 'mobile action bar must show the current total')
assert.match(bookingUi, /@media \(max-width: 820px\)[\s\S]*?\.booking-mobile-bar\s*\{[\s\S]*?position:\s*fixed/, 'mobile action bar must remain fixed during long service selection')

for (const selector of [
  'booking-detail-card', 'booking-itinerary', 'date-chip', 'slot', 'booking-deposit-card',
  'booking-gate-card', 'booking-proof-action', 'success-check', 'loading-spinner'
]) {
  assert.match(bookingUi, new RegExp('body\\[class\\*="booking-theme-"\\][\\s\\S]*?\\.' + selector + '[^}]*var\\(--booking-'), `${selector} must consume semantic booking tokens`)
}

assert.match(businessRoute, /BOOKING_THEMES = new Set\(\['light', 'dark', 'rose', 'sage', 'blue', 'violet'\]\)/, 'only the six approved themes are accepted')
assert.match(businessRoute, /if \(value === null \|\| !value\.trim\(\)\) return null/, 'PATCH must support clearing the explicit theme')

assert.equal(defaultBookingTheme('classic'), 'dark')
assert.equal(defaultBookingTheme('editorial'), 'light')
assert.equal(defaultBookingTheme('salon-white'), 'rose')
assert.equal(defaultBookingTheme('luxe-nails'), 'violet')
for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) {
  assert.equal(normalizeBookingTheme(theme), theme, `PATCH normalization must preserve ${theme}`)
  assert.equal(resolveBookingTheme(theme, 'classic'), theme, `public rendering must preserve explicit ${theme}`)
}
assert.equal(normalizeBookingTheme('neon'), undefined, 'PATCH must reject themes outside the approved set')
assert.equal(normalizeBookingTheme(null), null, 'PATCH must allow clearing the explicit theme')
assert.equal(resolveBookingTheme(null, 'salon-white'), 'rose', 'cleared themes must fall back to the landing-compatible default')

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exactCssRule(source: string, selector: string) {
  const match = source.match(new RegExp(escaped(selector) + '\\s*\\{([^}]*)\\}'))
  assert.ok(match, `missing exact CSS rule: ${selector}`)
  return match[1]
}

assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .option-left strong'), /color:\s*var\(--booking-ink\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .option-left small'), /color:\s*var\(--booking-muted\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected .booking-itinerary-time strong'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected .booking-itinerary-segments'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected small'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .success-link'), /color:\s*var\(--booking-on-cta\)[\s\S]*background:\s*var\(--booking-cta\)[\s\S]*border-color:\s*var\(--booking-cta\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .success-link.secondary'), /color:\s*var\(--booking-accent\)[\s\S]*background:\s*var\(--booking-surface\)[\s\S]*border-color:\s*var\(--booking-border\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-booking'), /padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-mobile-bar'), /bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/)
assert.match(exactCssRule(bookingUi, '.booking-mobile-continue'), /white-space:\s*nowrap/)
assert.match(bookingUi, /els\.mobileContinueLabel\.textContent = currentStepId\(\) === 'service' \? 'Continuar' : label/, 'mobile CTA must use compact copy because total is displayed separately')

const landingSaveBlock = crmUi.match(/async function saveLandingSettings\(event\) \{([\s\S]*?)\n    async function saveBusinessSettings/)?.[1] || ''
assert.match(landingSaveBlock, /getJson\('\/businesses\/' \+ state\.businessId,[\s\S]*method:\s*'PATCH'/, 'landing settings must persist through the business PATCH endpoint')
assert.match(landingSaveBlock, /body:\s*JSON\.stringify\(\{[\s\S]*bookingTheme:\s*selectedBookingTheme/, 'the structured PATCH payload must persist the validated selected theme')

console.log('Booking theme UI contract: OK')
