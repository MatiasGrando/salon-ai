import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canStaffAccessRoute, type StaffAuthorizationUser } from '../src/services/staff-permission-service.js'

const staff = (canManageDeposits: boolean): StaffAuthorizationUser => ({
  role: 'STAFF',
  agendaScope: 'ALL',
  canCreateAppointments: false,
  canEditAppointments: false,
  canCancelAppointments: false,
  canManageScheduleBlocks: false,
  canForceAppointments: false,
  canViewCustomers: true,
  canCreateCustomers: false,
  canEditCustomers: false,
  canManageCustomerNotes: false,
  canManageCustomerMarketing: false,
  canViewConversations: true,
  canReplyConversations: true,
  canManageDeposits,
  canViewOperationalReports: false,
  canViewFinancialAmounts: false
})

for (const path of [
  '/crm/deposits',
  '/crm/deposits/deposit-1/proof',
  '/crm/deposits/deposit-1/approve',
  '/crm/deposits/deposit-1/reject',
  '/crm/conversations/conversation-1/deposit/approve',
  '/crm/conversations/conversation-1/deposit/reject'
]) {
  const method = path.endsWith('/approve') || path.endsWith('/reject') ? 'POST' : 'GET'
  assert.equal(canStaffAccessRoute(staff(false), method, path), false, `${method} ${path} requires canManageDeposits`)
  assert.equal(canStaffAccessRoute(staff(true), method, path), true, `${method} ${path} permits designated reviewer`)
}

const depositService = readFileSync(new URL('../src/services/booking-deposit-service.ts', import.meta.url), 'utf8')
assert.equal(depositService.includes("'application/pdf'"), false, 'legacy web proof parsing must not admit PDFs')

const runbook = readFileSync(new URL('../docs/nuevo-bot/runbook-seguridad-privacidad.md', import.meta.url), 'utf8')
// Repository evidence is not approval of infrastructure this test cannot inspect.
assert.match(runbook, /Aprobación operativa pendiente/i)
assert.match(runbook, /no hay cron de purga activado por este trabajo/i)
assert.match(runbook, /canManageDeposits/i)
assert.match(runbook, /12 meses/i)
assert.match(runbook, /retención efectiva[^\n]*no (?:está )?certificada/i)
assert.match(runbook, /legacy[^\n]*visitId[^\n]*null/i)
assert.match(runbook, /PDF rechazado en el parser WEB legacy/i)
assert.match(runbook, /PDF clásico/i)
assert.match(runbook, /ObjStm\/XRef/i)
assert.match(runbook, /legal hold[^\n]*pendiente/i)
assert.match(runbook, /restore[^\n]*pendiente/i)
assert.doesNotMatch(runbook, /F8\.1 aprobada:/i, 'documentation must not manufacture operational approval')

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const validator = source('src/services/deposit-proof-image-validation.ts')
assert.match(validator, /DEPOSIT_PROOF_MAX_BYTES = 3 \* 1024 \* 1024/)
assert.match(validator, /image\.rotate\(\)\.webp\(/, 'F8 re-encodes images before review')
assert.equal(validator.includes("'application/pdf'"), false, 'F8 image validation must not admit PDFs')
const proofJob = source('src/bot-options/application/process-deposit-proof-job.ts')
assert.match(proofJob, /if \(!input\.capabilityEnabled\)/, 'proof ingestion retains the capability gate')
assert.match(proofJob, /downloadMetaDepositProof\(/)
assert.match(proofJob, /validateDepositProof\(/)
assert.match(proofJob, /\['image', 'document'\]\.includes\(String\(payload\.messageType\)\)/, 'proof job admits only image/document transports before technical validation')
const documentValidator = source('src/services/deposit-proof-pdf-validation.ts')
assert.match(documentValidator, /maxOutputLength: MAX_STREAM_BYTES/)
assert.match(documentValidator, /UNSUPPORTED_NAMES = new Set\(\['ObjStm', 'XRef'\]\)/)
assert.match(documentValidator, /assertPassiveNames\(raw\)/)
assert.match(documentValidator, /throwOnInvalidObject: true/)
assert.match(documentValidator, /ignoreEncryption: false/)
const proofWriter = source('src/services/deposit-proof-writer.ts')
assert.match(proofWriter, /INSERT INTO "BookingDepositProof"/, 'F8 retains separate evidence attempts')
assert.match(proofWriter, /interval '12 months'/, 'eligibility is separate from byte deletion')
const purge = source('src/services/deposit-proof-byte-purge.ts')
assert.match(purge, /normalized\.mode === 'DRY_RUN'/)
assert.match(purge, /retentionEligibleAt" <= clock_timestamp\(\)/)
assert.match(purge, /SET "sourceData" = NULL, "derivedData" = NULL/, 'purge keeps the evidence row')
assert.match(purge, /INSERT INTO "BookingDepositProofPurgeAudit"/)
const purgeCli = source('scripts/purge-booking-deposit-proof-bytes.ts')
assert.match(purgeCli, /Refusing non-local database/, 'local maintenance is not implicit production access')
assert.match(purgeCli, /PURGE_PROOF_BYTES/)
assert.match(purgeCli, /Execute requires --operation-key/)
const crm = source('src/routes/crm.ts')
assert.match(crm, /DOWNLOAD_DEPOSIT_PROOF/)
assert.match(crm, /private, no-store/)
assert.match(source('src/services/deposit-review-operation.ts'), /INSERT INTO "BookingDepositReviewAudit"/)
assert.match(source('src/bot-options/application/expire-deposit-hold.ts'), /assertClaimedBotJobTx\(/)

console.log('OK: deposit security repository controls and pending operational gates (no deployment approval)')
