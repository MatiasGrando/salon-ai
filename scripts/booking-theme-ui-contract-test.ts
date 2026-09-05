import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeBookingTheme } from '../src/routes/business.js'
import { defaultBookingTheme, resolveBookingTheme } from '../src/routes/landing-ui.js'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260904173000_add_business_booking_theme/migration.sql', import.meta.url), 'utf8')
const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const bookingUi = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')

assert.match(bookingUi, /family=Inter:wght@400;500;600;700/, 'the public page must actually load every Inter weight used by the booking hierarchy')

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
  '--booking-bg', '--booking-surface', '--booking-ink', '--booking-muted', '--booking-secondary-ink', '--booking-deposit-ink', '--booking-deposit-bg', '--booking-border',
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
assert.match(bookingUi, /class="estimate-option-price"/, 'guided estimate ranges need a semantic hook independent from legacy option colors')
const estimateOptionPrice = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .estimate-option-price')
assert.match(estimateOptionPrice, /color:\s*var\(--booking-ink\)/, 'guided estimate ranges must use the same ink token as option names')
assert.match(estimateOptionPrice, /font-family:\s*Inter, Arial, sans-serif/, 'guided estimate ranges must use the booking typeface')
assert.match(estimateOptionPrice, /font-size:\s*15px/, 'guided estimate ranges must match service price sizing')
assert.match(estimateOptionPrice, /font-weight:\s*600/, 'guided estimate ranges must use semibold monetary emphasis')
assert.doesNotMatch(estimateOptionPrice, /--booking-accent|--burgundy/, 'guided estimate ranges must not consume interaction or legacy brand colors')
const selectedEstimateOptionPrice = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-option.selected .estimate-option-price')
assert.match(selectedEstimateOptionPrice, /color:\s*var\(--booking-ink\)/, 'selected guided estimate ranges must remain the same color as option names')
assert.doesNotMatch(selectedEstimateOptionPrice, /--booking-accent|--burgundy/, 'selected ranges must not inherit interactive accent')
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected .booking-itinerary-time strong'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected .booking-itinerary-segments'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-itinerary.selected small'), /color:\s*var\(--booking-on-accent\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .success-link'), /color:\s*var\(--booking-on-cta\)[\s\S]*background:\s*var\(--booking-cta\)[\s\S]*border-color:\s*var\(--booking-cta\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .success-link.secondary'), /color:\s*var\(--booking-accent\)[\s\S]*background:\s*var\(--booking-surface\)[\s\S]*border-color:\s*var\(--booking-border\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-booking'), /padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/)
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-mobile-bar'), /bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/)
assert.match(exactCssRule(bookingUi, '.booking-mobile-continue'), /white-space:\s*nowrap/)
assert.match(bookingUi, /els\.mobileContinueLabel\.textContent = currentStepId\(\) === 'service' \? 'Continuar' : label/, 'mobile CTA must use compact copy because total is displayed separately')

assert.match(bookingUi, /class="booking-proof-selection-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/, 'local proof selection needs an accessible polite status')
assert.match(bookingUi, />Archivo seleccionado</, 'proof selection must confirm the local file state clearly')
assert.match(bookingUi, />Listo para enviar</, 'proof selection must say the file is ready rather than already uploaded')
assert.doesNotMatch(bookingUi, /Comprobante cargado/, 'local selection must never be described as an uploaded proof')
assert.match(bookingUi, /id="booking-proof-action-label">Elegir archivo</, 'proof action needs a replaceable text label')
assert.match(bookingUi, /actionLabel\.textContent = selectedFile \? 'Cambiar archivo' : 'Elegir archivo'/, 'proof action must switch between choose and change states')
assert.match(bookingUi, /selectionStatus\.hidden = !selectedFile/, 'selection status must hide again when the file input is cleared')
assert.match(bookingUi, /submit\.disabled = !selectedFile/, 'proof submit must remain disabled until a local file exists')
const selectedProofPicker = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-proof-picker.has-file')
assert.match(selectedProofPicker, /background:\s*var\(--booking-accent-soft\)/, 'selected proof picker must use the theme-aware soft state')
assert.match(selectedProofPicker, /border:\s*1px solid var\(--booking-accent\)/, 'selected proof picker must use a solid accent border')
const proofSelectionStatus = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-proof-selection-status')
assert.match(proofSelectionStatus, /display:\s*flex/, 'proof selection confirmation must be a clear visual block')
assert.match(proofSelectionStatus, /min-width:\s*0/, 'proof selection confirmation must tolerate long filenames on mobile')
assert.match(exactCssRule(bookingUi, '.booking-proof-selection-status[hidden]'), /display:\s*none !important/, 'hidden proof status must not reserve layout space')

const themedHeading = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-heading')
assert.match(themedHeading, /font-family:\s*Inter, Arial, sans-serif/, 'booking title must keep Inter')
assert.match(themedHeading, /font-size:\s*25px/, 'desktop booking title must be dominant without making the catalog feel oversized')
assert.match(themedHeading, /font-weight:\s*700/, 'booking title must be one of the two intentionally bold hierarchy levels')
assert.match(themedHeading, /margin-bottom:\s*6px/, 'booking title must keep a compact relationship with its help copy')

const themedBody = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-body')
assert.match(themedBody, /padding:\s*20px/, 'booking content must keep a compact outer gutter')
const themedMain = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .fresha-main')
assert.match(themedMain, /padding:\s*0 0 12px/, 'catalog must not add a second large inset inside the booking shell')
assert.match(themedMain, /background:\s*transparent/, 'catalog must integrate with the themed page background instead of looking like a nested card')
assert.match(themedMain, /border:\s*0/, 'catalog must remove the nested panel border while service cards retain their affordance')

const serviceBrowser = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-browser')
assert.match(serviceBrowser, /gap:\s*8px/, 'search, filters and result count must form a compact tool cluster')
assert.match(serviceBrowser, /margin-bottom:\s*16px/, 'catalog controls must stay close to the first category')
const serviceHelp = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-help')
assert.match(serviceHelp, /margin:\s*0 0 10px/, 'help copy must not create excessive whitespace')
const serviceSearch = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-search')
assert.match(serviceSearch, /min-height:\s*40px/, 'service search must use a compact control height')
const serviceFilters = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-filters')
assert.match(serviceFilters, /gap:\s*7px/, 'category chips need compact horizontal rhythm')

const groupHeading = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-group-heading')
assert.match(groupHeading, /justify-content:\s*space-between/, 'service count must align to the far edge for fast scanning')
assert.match(groupHeading, /padding-bottom:\s*6px/, 'category divider spacing must remain compact')

const groupTitle = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-group-heading h2')
assert.match(groupTitle, /font-size:\s*16px/, 'category heading must remain clearly below the page title')
assert.match(groupTitle, /font-weight:\s*700/, 'category heading must be the second intentionally bold hierarchy level')
const groupCount = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-group-heading span')
assert.match(groupCount, /font-size:\s*12px/, 'category count must remain compact')
assert.match(groupCount, /font-weight:\s*400/, 'category count must be visually light')

const serviceName = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .service-copy > strong')
assert.match(serviceName, /font-size:\s*15px/, 'service name must remain readable without competing with headings')
assert.match(serviceName, /font-weight:\s*500/, 'service name must use medium rather than bold')
const servicePrice = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-option .service-price')
assert.match(servicePrice, /color:\s*var\(--booking-ink\)/, 'service price must use the theme primary ink rather than looking washed out')
assert.doesNotMatch(servicePrice, /--booking-accent/, 'service price must remain neutral rather than becoming an interaction color')
assert.match(servicePrice, /font-family:\s*Inter, Arial, sans-serif/, 'service price must not use the display face')
assert.match(servicePrice, /font-size:\s*15px/, 'service price must accompany rather than dominate the name')
assert.match(servicePrice, /font-weight:\s*600/, 'card price must use semibold emphasis without becoming typographically heavy')

const durationBadge = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .service-meta small')
assert.match(durationBadge, /color:\s*var\(--booking-secondary-ink\)/, 'duration must use the contrast-safe semantic secondary ink')
assert.match(durationBadge, /background:\s*var\(--booking-bg\)/, 'duration must read as a neutral theme-aware badge')
assert.match(durationBadge, /font-size:\s*12px/, 'duration badge must stay compact but readable')
assert.match(durationBadge, /font-weight:\s*400/, 'duration badge must stay visually light')
const depositBadge = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-option .option-deposit')
assert.match(depositBadge, /color:\s*var\(--booking-deposit-ink\)/, 'deposit badge must use its own informational ink rather than the interaction accent')
assert.match(depositBadge, /background:\s*var\(--booking-deposit-bg\)/, 'deposit badge must use its own informational surface')
assert.doesNotMatch(depositBadge, /--booking-accent/, 'deposit metadata must not consume the interaction accent')
assert.match(depositBadge, /font-size:\s*12px/, 'deposit badge must stay compact but readable')
assert.match(depositBadge, /font-weight:\s*400/, 'deposit badge must not add another bold element')

const categoryChip = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-filter')
assert.match(categoryChip, /font-weight:\s*400/, 'all category chips, including the active chip, must use regular weight')
assert.match(categoryChip, /min-height:\s*30px/, 'category chips must stay compact')
assert.match(categoryChip, /font-size:\s*12px/, 'category chip type must remain subordinate')
assert.match(exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-filter.active'), /background:\s*var\(--booking-accent\)/, 'active category must be distinguished by its fill')
assert.match(bookingUi, /@media \(max-width: 820px\)[\s\S]*?body\[class\*="booking-theme-"\] \.fresha-heading\s*\{\s*font-size:\s*24px;/, 'booking title must retain its hierarchy on mobile')

const businessTagline = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-brand-name span')
assert.match(businessTagline, /color:\s*var\(--booking-secondary-ink\)/, 'business tagline must use contrast-safe secondary ink')
assert.match(businessTagline, /font-size:\s*12px/, 'business tagline must remain subordinate to the business name')
assert.match(businessTagline, /font-weight:\s*400/, 'business tagline must explicitly reset the inherited heavy weight')

const summaryTotal = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-total')
assert.match(summaryTotal, /color:\s*var\(--booking-summary-ink\)/, 'summary total must remain neutral')
assert.match(summaryTotal, /font-weight:\s*400/, 'the Total label must remain regular')
assert.doesNotMatch(summaryTotal, /--booking-accent/, 'summary total must not compete with interactive state')

const summaryName = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-name')
assert.match(summaryName, /font-family:\s*Inter, Arial, sans-serif/, 'summary business name must not inherit a display serif')
assert.match(summaryName, /font-size:\s*15px/, 'summary business name must fit the compact card hierarchy')
assert.match(summaryName, /font-weight:\s*600/, 'summary business name must use semibold')
assert.match(summaryName, /text-transform:\s*none/, 'summary business name must preserve the business casing')

const summaryDefaultValue = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-card-line strong')
assert.match(summaryDefaultValue, /font-weight:\s*400/, 'non-monetary summary values must remain regular')
const selectedServiceAmount = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .primary-line > b')
assert.match(selectedServiceAmount, /color:\s*var\(--booking-summary-ink\)/, 'selected service amount must remain neutral')
assert.match(selectedServiceAmount, /font-weight:\s*600/, 'selected service amount must use semibold')
const subtotalAmount = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-subtotal > strong')
assert.match(subtotalAmount, /color:\s*var\(--booking-summary-ink\)/, 'subtotal must remain neutral')
assert.match(subtotalAmount, /font-weight:\s*600/, 'subtotal amount must use semibold')
const depositAmount = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-deposit > strong')
assert.match(depositAmount, /color:\s*var\(--booking-deposit-ink\)/, 'deposit amount must keep its amber/earth informational semantics')
assert.match(depositAmount, /font-weight:\s*600/, 'deposit amount must use semibold')
assert.doesNotMatch(depositAmount, /--booking-accent/, 'deposit amount must not become an interactive accent')
const totalAmount = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .summary-total > strong')
assert.match(totalAmount, /color:\s*var\(--booking-summary-ink\)/, 'total amount must remain neutral')
assert.match(totalAmount, /font-weight:\s*600/, 'total amount must use semibold')

const serviceOption = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-option')
assert.match(serviceOption, /min-height:\s*68px/, 'service cards must be dense enough for long catalogs')
assert.match(serviceOption, /padding:\s*12px 14px/, 'service card inset must match the compact reference')
assert.match(serviceOption, /grid-template-columns:\s*20px minmax\(0, 1fr\) auto/, 'selection control must remain visible without dominating the card')
const serviceCheck = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .service-check')
assert.match(serviceCheck, /width:\s*18px/, 'selection check must remain accessible but visually quiet')
assert.match(serviceCheck, /height:\s*18px/, 'selection check must remain accessible but visually quiet')
const serviceGroups = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-groups')
assert.match(serviceGroups, /gap:\s*20px/, 'category groups must avoid oversized vertical gaps')
const serviceGroup = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-group')
assert.match(serviceGroup, /gap:\s*8px/, 'category heading and cards must stay visually connected')
const serviceOptions = exactCssRule(bookingUi, 'body[class*="booking-theme-"] .booking-service-options')
assert.match(serviceOptions, /gap:\s*8px/, 'service cards must use a compact vertical rhythm')

function parseThemeTokens(theme: string) {
  const block = bookingUi.match(new RegExp('\\.booking-theme-' + theme + '\\s*\\{([^}]*)\\}'))?.[1]
  assert.ok(block, `missing token block for ${theme}`)
  return Object.fromEntries(
    [...block.matchAll(/(--booking-[a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((match) => [match[1], match[2]])
  )
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16) / 255) || []
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) {
  const tokens = parseThemeTokens(theme)
  assert.match(tokens['--booking-secondary-ink'] || '', /^#[0-9A-Fa-f]{6}$/, `${theme} must define explicit secondary ink`)
  assert.match(tokens['--booking-deposit-ink'] || '', /^#[0-9A-Fa-f]{6}$/, `${theme} must define explicit deposit ink`)
  assert.match(tokens['--booking-deposit-bg'] || '', /^#[0-9A-Fa-f]{6}$/, `${theme} must define explicit deposit background`)
  const durationRatio = contrastRatio(tokens['--booking-secondary-ink'], tokens['--booking-bg'])
  assert.ok(durationRatio >= 4.5, `${theme} duration badge contrast must be >= 4.5:1, received ${durationRatio.toFixed(2)}:1`)
  for (const [state, backgroundToken] of [
    ['normal price', '--booking-surface'],
    ['hover price', '--booking-accent-soft'],
    ['selected price', '--booking-accent-soft']
  ] as const) {
    const ratio = contrastRatio(tokens['--booking-ink'], tokens[backgroundToken])
    assert.ok(ratio >= 4.5, `${theme} ${state} contrast must be >= 4.5:1, received ${ratio.toFixed(2)}:1`)
  }
  const taglineRatio = contrastRatio(tokens['--booking-secondary-ink'], tokens['--booking-bg'])
  assert.ok(taglineRatio >= 4.5, `${theme} business tagline contrast must be >= 4.5:1, received ${taglineRatio.toFixed(2)}:1`)
  const depositRatio = contrastRatio(tokens['--booking-deposit-ink'], tokens['--booking-deposit-bg'])
  assert.ok(depositRatio >= 4.5, `${theme} deposit badge contrast must be >= 4.5:1, received ${depositRatio.toFixed(2)}:1`)
  const summaryDepositRatio = contrastRatio(tokens['--booking-deposit-ink'], tokens['--booking-summary-bg'])
  assert.ok(summaryDepositRatio >= 4.5, `${theme} summary deposit contrast must be >= 4.5:1, received ${summaryDepositRatio.toFixed(2)}:1`)
}

assert.equal(parseThemeTokens('light')['--booking-bg'], '#F7F8FA', 'light theme must preserve its cool neutral background')
assert.equal(parseThemeTokens('blue')['--booking-bg'], '#F1F5F9', 'blue theme must preserve its cool background rather than drifting toward cream')

const landingSaveBlock = crmUi.match(/async function saveLandingSettings\(event\) \{([\s\S]*?)\n    async function saveBusinessSettings/)?.[1] || ''
assert.match(landingSaveBlock, /getJson\('\/businesses\/' \+ state\.businessId,[\s\S]*method:\s*'PATCH'/, 'landing settings must persist through the business PATCH endpoint')
assert.match(landingSaveBlock, /body:\s*JSON\.stringify\(\{[\s\S]*bookingTheme:\s*selectedBookingTheme/, 'the structured PATCH payload must persist the validated selected theme')

console.log('Booking theme UI contract: OK')
