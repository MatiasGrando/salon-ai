import assert from 'node:assert/strict';
import { admitIntentProposal } from '../src/new-bot/domain/admission.js';
import type { TrustedTenantContext, ValidatedOperationDescriptor } from '../src/new-bot/domain/admission.js';
import type { VerticalContract } from '../src/new-bot/domain/contracts.js';
import { salonVerticalContract } from '../src/new-bot/domain/verticals/salon.js';
import { workshopVerticalContract } from '../src/new-bot/domain/verticals/workshop.js';
import {
  dispatchVerticalOperation,
  type HandlerRouteDescriptor,
} from '../src/new-bot/runtime/dispatch.js';

const contracts: readonly VerticalContract[] = [salonVerticalContract, workshopVerticalContract];
const handlerRoutes: readonly HandlerRouteDescriptor[] = [
  {
    vertical: 'salon',
    intent: 'reserve-service',
    capability: 'scheduling',
    route: 'salon.reserve-service',
  },
  {
    vertical: 'workshop',
    intent: 'diagnose-vehicle',
    capability: 'vehicle-diagnosis',
    route: 'workshop.diagnose-vehicle',
  },
  {
    vertical: 'workshop',
    intent: 'prepare-quote',
    capability: 'quote-preparation',
    route: 'workshop.prepare-quote',
  },
];

let effects = 0;

function admit(
  businessId: string,
  intent: string,
  entities: Readonly<Record<string, unknown>>,
  contract: VerticalContract,
): ValidatedOperationDescriptor {
  const descriptor = admitIntentProposal({ businessId }, { intent, entities }, contract);
  assert.ok(descriptor, `expected ${contract.vertical}/${intent} to be admitted`);
  return descriptor;
}

function dispatch(
  operation: ValidatedOperationDescriptor,
  trustedBusinessId: string,
  handlers: readonly HandlerRouteDescriptor[] = handlerRoutes,
  registeredContracts: readonly VerticalContract[] = contracts,
) {
  const trustedTenant: TrustedTenantContext = { businessId: trustedBusinessId };
  return dispatchVerticalOperation(operation, trustedTenant, registeredContracts, handlers);
}

const salonOperation = admit(
  'salon-tenant-17',
  'reserve-service',
  { service: 'haircut', date: '2026-10-03' },
  salonVerticalContract,
);
assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17'),
  { status: 'matched', businessId: 'salon-tenant-17', route: 'salon.reserve-service' },
);

const diagnosisOperation = admit(
  'workshop-tenant-42',
  'diagnose-vehicle',
  { vehicleDescription: 'sedan', reportedSymptoms: 'engine noise' },
  workshopVerticalContract,
);
assert.deepEqual(
  dispatch(diagnosisOperation, 'workshop-tenant-42'),
  { status: 'matched', businessId: 'workshop-tenant-42', route: 'workshop.diagnose-vehicle' },
);

const quoteOperation = admit(
  'workshop-tenant-73',
  'prepare-quote',
  { diagnosisId: 'diagnosis-9', requestedWork: 'replace brake pads' },
  workshopVerticalContract,
);
assert.deepEqual(
  dispatch(quoteOperation, 'workshop-tenant-73'),
  { status: 'matched', businessId: 'workshop-tenant-73', route: 'workshop.prepare-quote' },
  'workshop quote preparation must resolve its own capability without scheduling',
);
assert.equal(effects, 0, 'dispatch resolves routes without executing handler effects');

const accessorRoute = {
  vertical: 'salon',
  intent: 'reserve-service',
  capability: 'scheduling',
  get route() {
    effects++;
    return 'salon.accessor-route';
  },
};
assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17', [accessorRoute]),
  { status: 'rejected', reason: 'invalid-handler-registry' },
  'accessor-backed routes must be rejected without evaluating them',
);
assert.equal(effects, 0, 'dispatch must not evaluate effectful route accessors');

assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17', [
    { vertical: 'salon', intent: 'reserve-service', capability: 'vehicle-diagnosis', route: 'wrong.capability' },
  ]),
  { status: 'rejected', reason: 'handler-not-found' },
  'a registered handler with a mismatched capability must not be selected',
);
assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17', []),
  { status: 'rejected', reason: 'handler-not-found' },
  'a missing handler must be rejected',
);
assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17', [handlerRoutes[0]!, { ...handlerRoutes[0]! }]),
  { status: 'rejected', reason: 'ambiguous-handler' },
  'duplicate matching handler registrations must be rejected',
);
assert.deepEqual(
  dispatch(salonOperation, 'salon-tenant-17', handlerRoutes, [...contracts, salonVerticalContract]),
  { status: 'rejected', reason: 'ambiguous-vertical-contract' },
  'duplicate matching vertical contracts must be rejected',
);
assert.deepEqual(
  dispatch(
    salonOperation,
    'salon-tenant-17',
    handlerRoutes,
    [{
      ...salonVerticalContract,
      operations: [...salonVerticalContract.operations, salonVerticalContract.operations[0]!],
    }, workshopVerticalContract],
  ),
  { status: 'rejected', reason: 'ambiguous-contract-operation' },
  'duplicate intent declarations must be rejected as ambiguous',
);
assert.deepEqual(
  dispatch(
    { intent: 'reserve-service', entities: { service: 'haircut' } } as unknown as ValidatedOperationDescriptor,
    'salon-tenant-17',
  ),
  { status: 'rejected', reason: 'invalid-operation-descriptor' },
  'an untrusted proposal shape cannot enter the dispatch boundary',
);
assert.deepEqual(
  dispatch({ ...salonOperation, capability: 'vehicle-diagnosis' }, 'salon-tenant-17'),
  { status: 'rejected', reason: 'operation-not-declared' },
  'a capability mismatch must not dispatch',
);
assert.deepEqual(
  dispatch({ ...salonOperation, businessId: ' ' }, 'salon-tenant-17'),
  { status: 'rejected', reason: 'invalid-operation-descriptor' },
  'malformed descriptors must not be trusted at runtime',
);
assert.deepEqual(
  dispatch(
    { ...salonOperation, entities: { ...salonOperation.entities, businessId: 'attacker-tenant' } },
    'salon-tenant-17',
  ),
  { status: 'rejected', reason: 'invalid-operation-descriptor' },
  'tenant identity must not be smuggled through entities',
);
assert.deepEqual(
  dispatch({ ...salonOperation, businessId: 'forged-tenant' }, 'salon-tenant-17'),
  { status: 'rejected', reason: 'tenant-mismatch' },
  'a structurally valid descriptor cannot change trusted tenant provenance',
);
assert.deepEqual(
  dispatchVerticalOperation(salonOperation, { businessId: ' ' }, contracts, handlerRoutes),
  { status: 'rejected', reason: 'invalid-trusted-tenant-context' },
  'missing trusted tenant identity must be rejected',
);
assert.equal(effects, 0, 'rejected dispatches must also have no effects');

console.log('New bot runtime dispatch passed.');