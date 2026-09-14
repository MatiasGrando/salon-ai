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

console.log('Instagram Reel form layout contract: OK')
