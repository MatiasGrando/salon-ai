import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')

assert.match(ui, /data-marketing-view="instagram-reels"/)
assert.match(ui, /data-marketing-nav="instagram-reels"/)
assert.match(ui, /id="instagram-reels-manager"/)
assert.match(ui, /<table class="instagram-reels-table"/)
assert.match(ui, /id="instagram-reels-table-body"/)
assert.match(ui, /id="instagram-reel-new"/)

assert.match(ui, /class="dialog instagram-reel-dialog"/)
assert.match(ui, /id="instagram-reel-dialog"/)
assert.match(ui, /data-reel-section="content"/)
assert.match(ui, /data-reel-section="automation"/)
assert.match(ui, /data-reel-section="review"/)
assert.match(ui, /accept="video\/mp4,video\/quicktime,\.mp4,\.mov"/)
assert.match(ui, /id="instagram-reel-video-preview"/)
assert.match(ui, /id="instagram-reel-caption"/)
assert.match(ui, /id="instagram-reel-share-to-feed"/)
assert.match(ui, /id="instagram-reel-automation-enabled"/)
assert.match(ui, /id="instagram-reel-keyword-input"/)
assert.match(ui, /id="instagram-reel-keyword-chips"/)
assert.match(ui, /id="instagram-reel-private-reply"/)
assert.match(ui, /id="instagram-reel-review"/)
assert.match(ui, /id="instagram-reel-progress"/)
assert.match(ui, /id="instagram-reel-feedback"[^>]*role="status"[^>]*aria-live="polite"/)

assert.match(ui, /const basePath = '\/businesses\/' \+ encodeURIComponent\(state\.businessId\) \+ '\/instagram-publications'/)
for (const endpoint of ["basePath + '/uploads'", "basePath + '/uploads/verify'", "getJson(basePath,", "basePath + '/' + publication.id + '/publish'"]) {
  assert.ok(ui.includes(endpoint), `missing endpoint flow: ${endpoint}`)
}

assert.match(ui, /fetch\(upload\.uploadUrl,\s*\{/)
assert.match(ui, /headers:\s*upload\.uploadHeaders/)
assert.doesNotMatch(ui, /fetch\(upload\.uploadUrl[\s\S]{0,400}(?:credentials|Authorization|SUPABASE_SERVICE_ROLE_KEY)/)
assert.match(ui, /Publicaci&oacute;n en cola|Publicacion en cola/)
assert.doesNotMatch(ui, /Reel publicado con [ée]xito/)

assert.doesNotMatch(ui, /\b(?:alert|confirm|prompt)\s*\(/)
assert.match(ui, /function renderInstagramReels\(/)
assert.match(ui, /function openInstagramReelDialog\(/)
assert.match(ui, /function closeInstagramReelDialog\(/)
assert.match(ui, /function submitInstagramReel\(/)

console.log('Instagram Reel UI contract: OK')
