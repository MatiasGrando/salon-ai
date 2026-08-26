import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ingressConfig = await readFile('src/config/prisma-ingress.ts', 'utf8')
const generalConfig = await readFile('src/config/prisma.ts', 'utf8')

assert.match(ingressConfig, /DATABASE_INGRESS_POOL_MAX \?\? '2'/)
assert.match(ingressConfig, /max: poolMax/)
assert.match(ingressConfig, /DATABASE_URL/)
assert.doesNotMatch(ingressConfig, /from ['"]\.\/prisma\.js['"]/)
assert.match(generalConfig, /DATABASE_POOL_MAX \?\? '3'/)
assert.match(generalConfig, /max: poolMax/)

console.log('OK Prisma ingress config: independent pool defaults to 2 without instantiating the general pool.')
