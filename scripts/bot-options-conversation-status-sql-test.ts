import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { projectBotOptionsConversationStepTx } from '../src/bot-options/infrastructure/prisma-conversation-status.js'

// Disposable PostgreSQL/WASM: no network or application database.
const db = new PGlite()
try {
  await db.exec(`
    CREATE TYPE "ConversationStep" AS ENUM ('START','BOOKING_IN_PROGRESS','AWAITING_DEPOSIT','COMPLETED');
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text, "currentStep" "ConversationStep", "updatedAt" timestamptz);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY, "businessId" text, "conversationId" text);
    INSERT INTO "Conversation" VALUES ('c','b','COMPLETED',now()),('other','other','COMPLETED',now());
    INSERT INTO "BotSession" VALUES ('s','b','c'),('other','other','other');
  `)
  const tx = { async $queryRaw(q: Prisma.Sql) { return (await db.query(q.text, q.values)).rows } }
  const project = (step: 'BOOKING_IN_PROGRESS' | 'AWAITING_DEPOSIT' | 'COMPLETED', businessId = 'b') =>
    projectBotOptionsConversationStepTx(tx as never, { businessId, sessionId: 's', step })
  assert.equal(await project('BOOKING_IN_PROGRESS', 'other'), null, 'tenant mismatch does not write')
  assert.equal((await project('BOOKING_IN_PROGRESS'))?.conversationId, 'c')
  assert.equal(await project('BOOKING_IN_PROGRESS'), null, 'same macro step does not emit duplicate update')
  assert.equal((await project('AWAITING_DEPOSIT'))?.conversationId, 'c')
  assert.equal((await project('COMPLETED'))?.conversationId, 'c')
  const rows = (await db.query<{ currentStep: string }>('SELECT "currentStep" FROM "Conversation" ORDER BY "id"')).rows
  assert.deepEqual(rows.map(r => r.currentStep), ['COMPLETED', 'COMPLETED'])
  console.log('bot-options-conversation-status-sql-test: OK')
} finally { await db.close() }
