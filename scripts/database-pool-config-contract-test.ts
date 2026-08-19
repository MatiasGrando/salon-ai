import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const prismaConfig = await readFile('src/config/prisma.ts', 'utf8')

assert.match(prismaConfig, /DATABASE_POOL_MAX \?\? '3'/)
assert.match(prismaConfig, /max: poolMax/)
assert.match(prismaConfig, /idleTimeoutMillis: 10_000/)
assert.match(prismaConfig, /connectionTimeoutMillis: 10_000/)

console.log('Database pool configuration contract: OK')
