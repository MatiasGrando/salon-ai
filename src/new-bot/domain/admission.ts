import type { IntentProposal, VerticalContract } from './contracts.js';

export interface TrustedTenantContext {
  readonly businessId: string;
}

export interface ValidatedOperationDescriptor {
  readonly businessId: string;
  readonly vertical: string;
  readonly intent: string;
  readonly capability: string;
  readonly entities: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresentEntityValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Admits an untrusted proposal into a tenant-bound operation descriptor.
 * This function has no side effects and never executes the described operation.
 */
export function admitIntentProposal(
  tenant: TrustedTenantContext,
  proposal: IntentProposal,
  contract: VerticalContract,
): ValidatedOperationDescriptor | null {
  if (!tenant || typeof tenant.businessId !== 'string' || tenant.businessId.trim().length === 0) {
    return null;
  }
  if (!proposal || typeof proposal.intent !== 'string' || proposal.intent.trim().length === 0) {
    return null;
  }
  if (!contract || typeof contract.vertical !== 'string' || !isRecord(proposal.entities)) {
    return null;
  }

  const operation = contract.operations.find((candidate) => candidate.intent === proposal.intent);
  if (!operation || !contract.capabilities.includes(operation.capability)) {
    return null;
  }
  if (operation.requiredEntities.includes('businessId')) {
    return null;
  }
  if (
    operation.requiredEntities.some(
      (entity) => !isPresentEntityValue(proposal.entities[entity]),
    )
  ) {
    return null;
  }

  const entities = Object.fromEntries(
    operation.requiredEntities.map((entity) => [entity, proposal.entities[entity]]),
  );
  return {
    businessId: tenant.businessId,
    vertical: contract.vertical,
    intent: operation.intent,
    capability: operation.capability,
    entities,
  };
}