import type { VerticalContract } from '../contracts.js';

export const salonVerticalContract = {
  vertical: 'salon',
  capabilities: ['service-catalog', 'scheduling'],
  operations: [
    {
      intent: 'reserve-service',
      capability: 'scheduling',
      requiredEntities: ['service', 'date'],
    },
  ],
} as const satisfies VerticalContract;