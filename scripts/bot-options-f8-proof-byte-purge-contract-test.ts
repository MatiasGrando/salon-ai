import assert from 'node:assert/strict'
import { DepositProofBytePurgeError, validateDepositProofBytePurgeInput } from '../src/services/deposit-proof-byte-purge.js'

assert.deepEqual(validateDepositProofBytePurgeInput({ mode: 'DRY_RUN', batchSize: 1, businessId: ' tenant ' }), {
  mode: 'DRY_RUN', batchSize: 1, businessId: 'tenant', operationKey: undefined
})
assert.throws(() => validateDepositProofBytePurgeInput({ mode: 'EXECUTE', batchSize: 1 }), DepositProofBytePurgeError)
assert.throws(() => validateDepositProofBytePurgeInput({ mode: 'DRY_RUN', batchSize: 0 }), /batchSize/i)
assert.throws(() => validateDepositProofBytePurgeInput({ mode: 'DRY_RUN', batchSize: 1001 }), /batchSize/i)
assert.throws(() => validateDepositProofBytePurgeInput({ mode: 'INVALID' as 'DRY_RUN', batchSize: 1 }), /mode/i)
console.log('OK F8 purge pure: bounded input, explicit execute idempotency key and tenant normalization.')
