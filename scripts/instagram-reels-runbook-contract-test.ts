import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runbook = readFileSync('docs/instagram-reels-runbook.md', 'utf8')

for (const required of [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'comments',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_REELS_ENABLED',
  'SUPABASE_INSTAGRAM_REELS_BUCKET',
  '20260913030000_add_instagram_reels_automation',
  'UNKNOWN',
  'X-Hub-Signature-256',
  'npm run test:instagram-reels'
]) {
  assert.ok(runbook.includes(required), `El runbook debe documentar ${required}`)
}

assert.match(runbook, /una sola respuesta privada por comentario/i)
assert.match(runbook, /no reintentar.*UNKNOWN/i)
assert.match(runbook, /bucket privado/i)
assert.match(runbook, /activar.*despu[eé]s/i)
assert.doesNotMatch(runbook, /META_APP_SECRET\s*=\s*[^<\s]/)
assert.doesNotMatch(runbook, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^<\s]/)

console.log('Instagram Reels runbook contract: OK')
