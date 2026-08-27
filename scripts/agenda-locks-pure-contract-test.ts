import assert from 'node:assert/strict'
import {
  AGENDA_LOCK_NAMESPACE,
  AgendaLockScopeError,
  acquireAgendaHierarchy,
  canonicalProfessionalIds
} from '../src/services/agenda-locks.js'

assert.equal(AGENDA_LOCK_NAMESPACE, 'salon-ai:agenda:v1')
assert.deepEqual(canonicalProfessionalIds(['p-z', 'p-a', 'p-z', '', ' p-b ']), ['p-a', 'p-b', 'p-z'])

const calls: string[] = []
const tx = {
  professional: {
    findMany: async (input: any) => {
      calls.push(`validate:${input.where.id.in.join(',')}`)
      return input.where.id.in.map((id: string) => ({ id }))
    }
  },
  $queryRaw: async (query: any) => {
    calls.push(`lock:${query.values.find((value: unknown) => typeof value === 'string')}`)
    return [{ pg_advisory_xact_lock: null }]
  }
} as any

await acquireAgendaHierarchy(tx, {
  businessId: 'business-a',
  professionalIds: ['professional-z', 'professional-a', 'professional-z']
})
assert.deepEqual(calls, [
  'lock:salon-ai:agenda:v1:business:business-a',
  'validate:professional-a,professional-z',
  'lock:salon-ai:agenda:v1:professional:professional-a',
  'lock:salon-ai:agenda:v1:professional:professional-z'
])

const rejectedTx = {
  professional: { findMany: async () => [{ id: 'professional-a' }] },
  $queryRaw: async () => []
} as any
await assert.rejects(
  acquireAgendaHierarchy(rejectedTx, {
    businessId: 'business-a',
    professionalIds: ['professional-a', 'professional-foreign']
  }),
  AgendaLockScopeError
)

console.log('OK F7 locks pure: namespace, business-first order, sorted/deduplicated professionals and tenant rejection.')
