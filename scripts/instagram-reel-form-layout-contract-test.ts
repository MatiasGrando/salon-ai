import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')

assert.match(ui, /(?:\.dialog)?\.instagram-reel-dialog\s*\{[^}]*resize:\s*none/s)
assert.match(ui, /\.instagram-reel-form\s*\{[^}]*overflow:\s*(?:auto|hidden)/s)
assert.match(ui, /\.instagram-reel-section\s*\{[^}]*padding:/s)
assert.match(ui, /\.instagram-reel-form-grid\s*\{[^}]*display:\s*grid/s)
assert.match(ui, /\.instagram-reel-actions\s*\{[^}]*position:\s*sticky/s)
assert.match(ui, /\.instagram-reel-(?:field|form)[^{]*:(?:focus-within|focus)[^{]*\{/s)
assert.match(ui, /\.instagram-reel-feedback\.error/)
assert.match(ui, /@media\s*\(max-width:\s*720px\)[\s\S]*\.instagram-reel-dialog/s)
assert.match(ui, /@media\s*\(max-width:\s*720px\)[\s\S]*\.instagram-reel-form-grid\s*\{[^}]*grid-template-columns:\s*1fr/s)
assert.match(ui, /\.instagram-reels-table-wrap\s*\{[^}]*overflow-x:\s*auto/s)
assert.match(ui, /\.instagram-reels-table\s*\{[^}]*min-width:/s)
assert.doesNotMatch(ui, /(?:\.dialog)?\.instagram-reel-dialog\s*\{[^}]*resize:\s*(?:both|horizontal|vertical)/s)

const stepNames = ['content', 'automation', 'destination', 'review']
assert.deepEqual([...ui.matchAll(/data-reel-step-indicator="([^"]+)"/g)].map(([, step]) => step), stepNames)
assert.deepEqual([...ui.matchAll(/<section class="instagram-reel-section" data-reel-section="(\w+)"( hidden)?>/g)].map(([, step, hidden]) => [step, !!hidden]), stepNames.map((step, index) => [step, index > 0]))
assert.match(ui, /\.instagram-reel-section\[hidden\]\s*\{\s*display:\s*none/)
assert.match(ui, /id="instagram-reel-message-preview"/)
assert.match(ui, /id="instagram-reel-draft" type="button"/)
assert.match(ui, /id="instagram-reel-back" type="button"/)
assert.match(ui, /<footer class="instagram-reel-actions">[\s\S]*?id="instagram-reel-submit"/)

console.log('Instagram Reel form layout contract: OK')
