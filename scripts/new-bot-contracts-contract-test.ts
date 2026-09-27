import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { salonVerticalContract } from '../src/new-bot/domain/verticals/salon.js';
import { workshopVerticalContract } from '../src/new-bot/domain/verticals/workshop.js';
import type { IntentProposal, VerticalContract } from '../src/new-bot/domain/contracts.js';
import { admitIntentProposal } from '../src/new-bot/domain/admission.js';

const coreSource = readFileSync(
  resolve(process.cwd(), 'src/new-bot/domain/contracts.ts'),
  'utf8',
);

assert.doesNotMatch(
  coreSource,
  /appointment|booking|schedule|turno|cita/i,
  'the shared contract must not assume appointment-only concepts',
);

assert.equal(salonVerticalContract.vertical, 'salon');
assert.ok(salonVerticalContract.capabilities.includes('service-catalog'));
assert.ok(salonVerticalContract.capabilities.includes('scheduling'));
assert.ok(salonVerticalContract.operations.some((operation) => operation.intent === 'reserve-service'));

assert.equal(workshopVerticalContract.vertical, 'workshop');
assert.ok(workshopVerticalContract.capabilities.includes('vehicle-diagnosis'));
assert.ok(workshopVerticalContract.capabilities.includes('quote-preparation'));
assert.ok(!(workshopVerticalContract.capabilities as readonly string[]).includes('scheduling'));
assert.ok(workshopVerticalContract.operations.some((operation) => operation.intent === 'diagnose-vehicle'));
assert.ok(workshopVerticalContract.operations.some((operation) => operation.intent === 'prepare-quote'));

for (const contract of [salonVerticalContract, workshopVerticalContract]) {
  for (const operation of contract.operations) {
    assert.ok(
      (contract.capabilities as readonly string[]).includes(operation.capability),
      `${contract.vertical} operation ${operation.intent} requires a declared capability`,
    );
  }
}

const tenantKeyRequiredContract: VerticalContract = {
  ...salonVerticalContract,
  operations: salonVerticalContract.operations.map((operation) => ({
    ...operation,
    requiredEntities: [...operation.requiredEntities, 'businessId'],
  })),
};
const tenantKeyProposal: IntentProposal = {
  intent: 'reserve-service',
  entities: { service: 'haircut', date: '2026-10-03', businessId: 'attacker-tenant' },
};
assert.equal(
  admitIntentProposal(
    { businessId: 'trusted-salon-tenant' },
    tenantKeyProposal,
    tenantKeyRequiredContract,
  ),
  null,
  'vertical contracts must not request tenant identity from an untrusted proposal',
);

console.log('New bot vertical contracts passed.');
const salonProposal: IntentProposal = {
  intent: 'reserve-service',
  entities: { service: 'haircut', date: '2026-10-03', businessId: 'attacker-tenant' },
};
const originalSalonEntities = { ...salonProposal.entities };
const admittedSalon = admitIntentProposal(
  { businessId: 'trusted-salon-tenant' },
  salonProposal,
  salonVerticalContract,
);
assert.deepEqual(admittedSalon, {
  businessId: 'trusted-salon-tenant',
  vertical: 'salon',
  intent: 'reserve-service',
  capability: 'scheduling',
  entities: { service: 'haircut', date: '2026-10-03' },
});
assert.deepEqual(salonProposal.entities, originalSalonEntities, 'admission must not mutate the proposal');

assert.equal(
  admitIntentProposal(
    { businessId: 'trusted-salon-tenant' },
    { intent: 'delete-business', entities: {} },
    salonVerticalContract,
  ),
  null,
  'undeclared intents must be rejected',
);
assert.equal(
  admitIntentProposal(
    { businessId: 'trusted-salon-tenant' },
    { intent: 'reserve-service', entities: { service: 'haircut' } },
    salonVerticalContract,
  ),
  null,
  'missing required entities must be rejected',
);

const undeclaredCapabilityContract: VerticalContract = {
  ...salonVerticalContract,
  operations: salonVerticalContract.operations.map((operation) => ({
    ...operation,
    capability: 'unlisted-capability',
  })),
};
assert.equal(
  admitIntentProposal(
    { businessId: 'trusted-salon-tenant' },
    { intent: 'reserve-service', entities: { service: 'haircut', date: '2026-10-03' } },
    undeclaredCapabilityContract,
  ),
  null,
  'operations requiring undeclared capabilities must be rejected',
);
assert.equal(
  admitIntentProposal(
    { businessId: ' ' },
    salonProposal,
    salonVerticalContract,
  ),
  null,
  'missing trusted tenant identity must be rejected',
);

const admittedDiagnosis = admitIntentProposal(
  { businessId: 'trusted-workshop-tenant' },
  { intent: 'diagnose-vehicle', entities: { vehicleDescription: 'sedan', reportedSymptoms: 'noise' } },
  workshopVerticalContract,
);
assert.equal(admittedDiagnosis?.capability, 'vehicle-diagnosis');
assert.equal(admittedDiagnosis?.businessId, 'trusted-workshop-tenant');

const admittedQuote = admitIntentProposal(
  { businessId: 'trusted-workshop-tenant' },
  { intent: 'prepare-quote', entities: { diagnosisId: 'diag-1', requestedWork: 'brake repair' } },
  workshopVerticalContract,
);
assert.equal(admittedQuote?.capability, 'quote-preparation');
assert.equal(admittedQuote?.businessId, 'trusted-workshop-tenant');
assert.equal(
  admitIntentProposal(
    { businessId: 'trusted-workshop-tenant' },
    { intent: 'diagnose-vehicle', entities: { vehicleDescription: 'sedan' } },
    workshopVerticalContract,
  ),
  null,
  'workshop diagnosis must reject missing symptom details',
);
