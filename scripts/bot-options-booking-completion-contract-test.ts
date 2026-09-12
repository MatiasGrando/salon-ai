import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const effectExecutorSource = readFileSync(
  new URL('../src/bot-options/infrastructure/prisma-bot-options-effect-executor.ts', import.meta.url),
  'utf8'
)
const pgContractSource = readFileSync(
  new URL('./bot-options-f7-booking-pg-contract-test.ts', import.meta.url),
  'utf8'
)

assert.match(
  effectExecutorSource,
  /confirmBookingWithoutDeposit[\s\S]*?result\.kind === 'CONFIRMED'[\s\S]*?currentStep"='COMPLETED'/,
  'a confirmed deterministic booking must project COMPLETED to Conversation in the same transaction'
)
assert.match(
  effectExecutorSource,
  /result\.kind === 'CONFIRMED'[\s\S]*?pendingConversationUpdates\?\.push/,
  'the completed conversation projection must notify the CRM after commit'
)
assert.match(
  pgContractSource,
  /"currentStep"::text[\s\S]*?conversationStep: 'COMPLETED'/,
  'the PostgreSQL vertical contract must verify the visible CRM state'
)

console.log('bot-options-booking-completion-contract-test: OK')
