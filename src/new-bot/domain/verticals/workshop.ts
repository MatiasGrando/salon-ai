import type { VerticalContract } from '../contracts.js';

export const workshopVerticalContract = {
  vertical: 'workshop',
  capabilities: ['vehicle-diagnosis', 'quote-preparation'],
  operations: [
    {
      intent: 'diagnose-vehicle',
      capability: 'vehicle-diagnosis',
      requiredEntities: ['vehicleDescription', 'reportedSymptoms'],
    },
    {
      intent: 'prepare-quote',
      capability: 'quote-preparation',
      requiredEntities: ['diagnosisId', 'requestedWork'],
    },
  ],
} as const satisfies VerticalContract;