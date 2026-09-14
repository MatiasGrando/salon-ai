import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const authGuard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')

assert.match(server, /import \{ instagramPublicationRoutes \} from '\.\/routes\/instagram-publications\.js'/)
assert.match(server, /register\(instagramPublicationRoutes(?:,|\))/)
assert.match(authGuard, /instagram-publications/, 'ACCOUNT_ADMIN debe poder usar publicaciones dentro de un comercio autorizado')

console.log('Instagram publication wiring contract: OK')
