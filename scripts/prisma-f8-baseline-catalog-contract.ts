import assert from 'node:assert/strict'
import pg from 'pg'

const f9IndexNames = new Set([
  'AppointmentChangeHistory_pkey',
  'AppointmentChangeHistory_operationKey_key',
  'AppointmentChangeHistory_appointmentId_createdAt_idx',
  'BookingDeposit_appointmentId_id_key'
])
const f9ForeignKeyNames = new Set([
  'AppointmentChangeHistory_appointmentId_fkey',
  'AppointmentChangeHistory_appointmentId_bookingDepositId_fkey'
])

// Keep this in migration order and spelling. pg_get_functiondef preserves this
// boolean form modulo whitespace, which is all normalize intentionally erases.
const F9_CANCELLATION_BRANCH = normalize(`OR ((OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus" OR OLD."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus")
  AND NEW."status" = 'REJECTED'::"BookingDepositStatus"
  AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt"
  AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason"
  AND NEW."reviewedByUserId" IS NOT DISTINCT FROM OLD."reviewedByUserId"
  AND NEW."reviewedAt" IS NOT NULL AND NEW."rejectionReason" = 'CANCELLED_BY_CUSTOMER')`)

const leftUrl = requireAllowedUrl('F8_BASELINE_LEFT_DATABASE_URL')
const rightUrl = requireAllowedUrl('F8_BASELINE_RIGHT_DATABASE_URL')

const [left, right] = await Promise.all([catalog(leftUrl), catalog(rightUrl)])

const leftF8Terms = requiredFunction(left.functions, 'reject_f8_booking_deposit_terms_update')
const rightF8Terms = requiredFunction(right.functions, 'reject_f8_booking_deposit_terms_update')
const leftTermsDefinition = normalize(leftF8Terms.definition)
const rightTermsDefinition = normalize(rightF8Terms.definition)
if (leftTermsDefinition !== rightTermsDefinition) {
  // F9 may add exactly one sealed customer-cancellation disjunct. Strip that
  // one normalized migration form and compare the whole remaining function;
  // never exclude the function from catalog parity.
  const leftIsF9 = leftTermsDefinition.includes(F9_CANCELLATION_BRANCH)
  const rightIsF9 = rightTermsDefinition.includes(F9_CANCELLATION_BRANCH)
  assert.notEqual(leftIsF9, rightIsF9, 'the F8 terms function may differ only by one F9 cancellation branch')
  const f9Definition = leftIsF9 ? leftTermsDefinition : rightTermsDefinition
  const f8Definition = leftIsF9 ? rightTermsDefinition : leftTermsDefinition
  assertF9CancellationReplacement(f9Definition)
  assert.equal(removeExactlyOneF9CancellationBranch(f9Definition), f8Definition,
    'F9 may not alter any F8 terms-function text beyond its exact cancellation branch')
}
assert.deepEqual(left.functions.filter((row) => row.name !== 'reject_f8_booking_deposit_terms_update'), right.functions.filter((row) => row.name !== 'reject_f8_booking_deposit_terms_update'), 'function catalog must match outside the exact F9 terms delta')
assert.deepEqual(left.triggers, right.triggers, 'trigger catalog must match')
assert.deepEqual(left.deferredConstraints, right.deferredConstraints, 'deferred constraints must match')
assert.deepEqual(left.foreignKeys, right.foreignKeys, 'foreign keys must match')

for (const name of [
  'BookingDeposit_assert_f8_aggregate',
  'BookingDeposit_reject_sealed_terms_update',
  'BookingDeposit_require_proof_evidence',
  'BookingDepositLine_assert_total',
  'BookingDepositProof_assert_sequence',
  'BookingDepositProof_reject_update',
  'BookingDepositProofPurgeAudit_reject_mutation',
  'BookingDepositExpiryAudit_reject_update'
]) {
  assert.ok(left.triggers.some((row) => row.name === name), `missing critical trigger ${name}`)
}

function assertF9CancellationReplacement(definition: string) {
  const normalized = normalize(definition)
  assert.equal(countOccurrences(normalized, F9_CANCELLATION_BRANCH), 1, 'F9 cancellation branch must occur exactly once')
  for (const branch of [
    "OLD.\"status\" = 'PENDING_PROOF'::\"BookingDepositStatus\" AND NEW.\"status\" = 'PROOF_RECEIVED'::\"BookingDepositStatus\"",
    "OLD.\"status\" = 'PENDING_RESUBMISSION'::\"BookingDepositStatus\" AND NEW.\"status\" = 'PROOF_RECEIVED'::\"BookingDepositStatus\"",
    "NEW.\"status\" = 'EXPIRED'::\"BookingDepositStatus\"",
    "OLD.\"status\" = 'PROOF_RECEIVED'::\"BookingDepositStatus\" AND NEW.\"status\" IN ('APPROVED'::\"BookingDepositStatus\", 'REJECTED'::\"BookingDepositStatus\")",
    "OLD.\"status\" = 'PROOF_RECEIVED'::\"BookingDepositStatus\" AND NEW.\"status\" = 'PENDING_RESUBMISSION'::\"BookingDepositStatus\"",
    "(OLD.\"status\" = 'PENDING_PROOF'::\"BookingDepositStatus\" OR OLD.\"status\" = 'PENDING_RESUBMISSION'::\"BookingDepositStatus\")",
    "NEW.\"status\" = 'REJECTED'::\"BookingDepositStatus\"",
    "NEW.\"rejectionReason\" = 'CANCELLED_BY_CUSTOMER'",
    'NEW."reviewedAt" IS NOT NULL',
    'NEW."reviewedByUserId" IS NOT DISTINCT FROM OLD."reviewedByUserId"',
    'NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt"',
    'NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt"',
    'NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason"'
  ]) assert.ok(normalized.includes(branch), `F9 cancellation replacement must retain/add exact branch fragment: ${branch}`)
}

function removeExactlyOneF9CancellationBranch(definition: string) {
  assert.equal(countOccurrences(definition, F9_CANCELLATION_BRANCH), 1, 'F9 cancellation branch must occur exactly once before removal')
  return normalize(definition.replace(F9_CANCELLATION_BRANCH, ''))
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1
}

function requiredFunction(rows: Array<{ name: string; definition: string }>, name: string) {
  const matches = rows.filter((row) => row.name === name)
  assert.equal(matches.length, 1, `expected exactly one ${name} function`)
  return matches[0]!
}

for (const name of [
  'BookingDeposit_visitId_fkey',
  'BookingDepositLine_businessId_depositId_fkey',
  'BookingDepositLine_businessId_serviceId_fkey',
  'BookingDepositProof_businessId_depositId_fkey',
  'BookingDepositExpiryAudit_businessId_depositId_fkey'
]) {
  assert.ok(left.foreignKeys.some((row) => row.name === name), `missing tenant-scoped FK ${name}`)
}

for (const name of [
  'BookingDeposit_businessId_visitId_key',
  'BookingDepositProof_businessId_depositId_sequence_key',
  'BookingDepositProof_businessId_depositId_sourceSha256_key',
  'BookingDepositProof_businessId_retentionEligibleAt_idx'
]) {
  assert.ok(left.indexes.some((row) => row.name === name), `missing critical index ${name}`)
}

const expectedPartialIndexes = [
  { table: 'BotSession', name: 'BotSession_active_deployment_conversation_key', columns: '"deploymentId", "conversationId"', predicate: '"status" = \'ACTIVE\' AND "conversationId" IS NOT NULL' },
  { table: 'BotPrompt', name: 'BotPrompt_open_functional_per_session_key', columns: '"sessionId"', predicate: '"status" IN (\'OPEN\', \'STABILIZING\') AND "mode" = \'FUNCTIONAL\'' },
  { table: 'BotActionInbox', name: 'BotActionInbox_promptId_providerMessageId_key', columns: '"promptId", "providerMessageId"', predicate: '"promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL' },
  { table: 'BotOutbox', name: 'BotOutbox_providerMessageId_key', columns: '"providerMessageId"', predicate: '"providerMessageId" IS NOT NULL' },
  { table: 'BotDispatchClaim', name: 'BotDispatchClaim_active_resource_key', columns: 'kind, "engineKey", "resourceId"', predicate: '"resourceId" IS NOT NULL AND "status" IN (\'CLAIMED\', \'SENDING\', \'UNKNOWN\')' }
] as const

assert.equal(left.indexes.length, 297, 'corrected empty baseline must contain 297 indexes')
assertPartialIndexes(left.indexes, 'corrected baseline')

const snapshotUrl = new URL(rightUrl).pathname === '/salon_ai_f7_snapshot'
if (snapshotUrl) {
  assert.equal(right.indexes.length, 292, 'authorized snapshot is known to have exactly 292 indexes')
  for (const expected of expectedPartialIndexes) {
    assert.ok(!right.indexes.some((row) => row.name === expected.name), `snapshot must expose known missing index ${expected.name}`)
  }
  const partialNames = new Set(expectedPartialIndexes.map((index) => index.name))
  assert.deepEqual(left.indexes.filter((row) => !partialNames.has(row.name)), right.indexes, 'only the five intended partial indexes may differ from the unreconciled snapshot')
} else {
  assert.equal(right.indexes.length, 297, 'reconciled scratch must contain 297 indexes')
  assertPartialIndexes(right.indexes, 'reconciled scratch')
  assert.deepEqual(left.indexes, right.indexes, 'reconciled scratch catalog must equal corrected empty baseline')
}

console.log(`F8 baseline catalog parity passed: ${left.functions.length} functions, ${left.triggers.length} triggers, ${left.deferredConstraints.length} deferred constraints, ${left.indexes.length} indexes, ${left.foreignKeys.length} foreign keys`)

function requireAllowedUrl(name: string): string {
  const value = process.env[name]
  assert.ok(value, `${name} is required`)
  const parsed = new URL(value)
  const allowedDatabase = parsed.pathname === '/salon_ai_f7_snapshot'
    || /^\/salon_ai_f8_baseline_[a-z0-9_]+$/.test(parsed.pathname)
  assert.equal(parsed.protocol, 'postgresql:', `${name} must use PostgreSQL`)
  assert.equal(parsed.username, 'postgres', `${name} must use the local postgres role`)
  assert.equal(parsed.password, 'postgres', `${name} must use the local postgres credential`)
  assert.equal(parsed.hostname, '127.0.0.1', `${name} must use loopback`)
  assert.equal(parsed.port, '54322', `${name} must use the local PostgreSQL port`)
  assert.ok(allowedDatabase, `${name} must target the read-only snapshot or an f8 baseline scratch database`)
  assert.equal(parsed.search, '', `${name} must not contain query parameters`)
  assert.equal(parsed.hash, '', `${name} must not contain a fragment`)
  return value
}

function assertPartialIndexes(indexes: Array<{ table: string; name: string; definition: string }>, target: string) {
  for (const expected of expectedPartialIndexes) {
    const actual = indexes.find((row) => row.name === expected.name)
    assert.ok(actual, `${target} is missing partial unique index ${expected.name}`)
    assert.equal(actual.table, expected.table, `${expected.name} table must match`)
    const definition = normalize(actual.definition)
    assert.ok(definition.startsWith(`CREATE UNIQUE INDEX "${expected.name}" ON public."${expected.table}" USING btree (${expected.columns}) WHERE `), `${expected.name} must be a unique btree index over the exact columns`)
    assert.equal(normalizePredicate(definition.slice(definition.indexOf(' WHERE ') + 7)), normalizePredicate(expected.predicate), `${expected.name} predicate must match exactly`)
  }
}

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizePredicate(value: string) {
  return normalize(value)
    .replace(/::[A-Za-z0-9_".]+/g, '')
    .replace(/"([a-z_][a-z0-9_]*)"/g, '$1')
    .replace(/= ANY \(ARRAY\[/g, 'IN (')
    .replace(/\]\)/g, ')')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function catalog(connectionString: string) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const functions = await client.query(`SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY p.proname`)
    const triggers = await client.query(`SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`)
    const deferredConstraints = await client.query(`SELECT c.conname AS name, rel.relname AS "table", pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_class rel ON rel.oid = c.conrelid WHERE n.nspname = 'public' AND c.condeferrable ORDER BY rel.relname, c.conname`)
    const indexes = await client.query(`SELECT tablename AS "table", indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename, indexname`)
    const foreignKeys = await client.query(`SELECT c.conname AS name, rel.relname AS "table", pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_class rel ON rel.oid = c.conrelid WHERE n.nspname = 'public' AND c.contype = 'f' ORDER BY rel.relname, c.conname`)
    // F9 is the sole accepted additive delta. Preserve strict F8 parity by
    // filtering only its known audit objects; other future drift still fails.
    return {
      functions: functions.rows.filter((row) => row.name !== 'reject_appointment_change_history_mutation'),
      triggers: triggers.rows.filter((row) => !(row.table === 'AppointmentChangeHistory' && row.name === 'AppointmentChangeHistory_reject_mutation')),
      deferredConstraints: deferredConstraints.rows,
      indexes: indexes.rows.filter((row) => !f9IndexNames.has(row.name)),
      foreignKeys: foreignKeys.rows.filter((row) => !f9ForeignKeyNames.has(row.name))
    }
  } finally {
    await client.end()
  }
}
