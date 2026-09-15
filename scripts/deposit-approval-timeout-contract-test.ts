import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { approveCurrentDepositProof } from '../src/services/deposit-review-operation.js'

let transactionOptions: unknown
const client = {
  $transaction: async (_callback: unknown, options: unknown) => {
    transactionOptions = options
    throw new Error('transaction intercepted')
  }
} as unknown as Parameters<typeof approveCurrentDepositProof>[0]

await assert.rejects(
  approveCurrentDepositProof(client, {
    businessId: 'business', depositId: 'deposit', actorUserId: 'reviewer',
    operationKey: 'approval', method: 'POST', path: '/crm/deposits/deposit/approve'
  }),
  /transaction intercepted/
)
assert.deepEqual(transactionOptions, { timeout: 20_000 })

const routes = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const directApproval = routes.slice(routes.indexOf("app.post('/crm/deposits/:id/approve'"), routes.indexOf("app.post('/crm/deposits/:id/reject'"))
const conversationApproval = routes.slice(routes.indexOf("app.post('/crm/conversations/:id/deposit/approve'"), routes.indexOf("app.post('/crm/conversations/:id/deposit/reject'"))
assert.match(directApproval, /\}, DEPOSIT_APPROVAL_TRANSACTION_OPTIONS\)\.catch/)
assert.match(conversationApproval, /\}, DEPOSIT_APPROVAL_TRANSACTION_OPTIONS\)\.catch/)

console.log('OK deposit approval timeout: current and legacy approval use a scoped 20-second transaction budget.')
