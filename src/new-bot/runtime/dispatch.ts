import type { TrustedTenantContext, ValidatedOperationDescriptor } from '../domain/admission.js';
import type { DomainOperation, VerticalContract } from '../domain/contracts.js';

export interface HandlerRouteDescriptor {
  readonly vertical: string;
  readonly intent: string;
  readonly capability: string;
  readonly route: string;
}

export type VerticalDispatchResult =
  | {
      readonly status: 'matched';
      readonly businessId: string;
      readonly route: string;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'invalid-operation-descriptor'
        | 'invalid-trusted-tenant-context'
        | 'tenant-mismatch'
        | 'invalid-vertical-contract'
        | 'vertical-contract-not-found'
        | 'ambiguous-vertical-contract'
        | 'operation-not-declared'
        | 'ambiguous-contract-operation'
        | 'invalid-handler-registry'
        | 'handler-not-found'
        | 'ambiguous-handler';
    };

const operationKeys = ['businessId', 'vertical', 'intent', 'capability', 'entities'];
const contractKeys = ['vertical', 'capabilities', 'operations'];
const operationDeclarationKeys = ['intent', 'capability', 'requiredEntities'];
const handlerRouteKeys = ['vertical', 'intent', 'capability', 'route'];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyDataProperties(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property !== undefined && 'value' in property && property.get === undefined && property.set === undefined;
  });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Reflect.ownKeys(value);
  return hasOnlyDataProperties(value) && actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPresentEntity(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isOperationDeclaration(value: unknown): value is DomainOperation {
  if (!isPlainRecord(value) || !hasExactKeys(value, operationDeclarationKeys)) return false;
  return (
    isNonEmptyString(value.intent) &&
    isNonEmptyString(value.capability) &&
    Array.isArray(value.requiredEntities) &&
    value.requiredEntities.every(isNonEmptyString)
  );
}

function isVerticalContract(value: unknown): value is VerticalContract {
  if (!isPlainRecord(value) || !hasExactKeys(value, contractKeys)) return false;
  return (
    isNonEmptyString(value.vertical) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isNonEmptyString) &&
    Array.isArray(value.operations) &&
    value.operations.every(isOperationDeclaration)
  );
}

function isHandlerRoute(value: unknown): value is HandlerRouteDescriptor {
  if (!isPlainRecord(value) || !hasExactKeys(value, handlerRouteKeys)) return false;
  return (
    isNonEmptyString(value.vertical) &&
    isNonEmptyString(value.intent) &&
    isNonEmptyString(value.capability) &&
    isNonEmptyString(value.route)
  );
}

function isTrustedTenantContext(value: unknown): value is TrustedTenantContext {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ['businessId']) &&
    isNonEmptyString(value.businessId)
  );
}

function isValidatedDescriptor(value: unknown): value is ValidatedOperationDescriptor {
  if (!isPlainRecord(value) || !hasExactKeys(value, operationKeys)) return false;
  if (
    !isNonEmptyString(value.businessId) ||
    !isNonEmptyString(value.vertical) ||
    !isNonEmptyString(value.intent) ||
    !isNonEmptyString(value.capability) ||
    !isPlainRecord(value.entities) ||
    !hasOnlyDataProperties(value.entities) ||
    Object.hasOwn(value.entities, 'businessId')
  ) {
    return false;
  }
  return Object.values(value.entities).every(isPresentEntity);
}

function hasExactEntityKeys(
  entities: Readonly<Record<string, unknown>>,
  requiredEntities: readonly string[],
): boolean {
  const actualKeys = Object.keys(entities);
  return (
    actualKeys.length === requiredEntities.length &&
    requiredEntities.every((entity) => Object.hasOwn(entities, entity))
  );
}

/**
 * Resolves one pure route for a tenant-bound admitted operation. It never invokes a handler.
 */
export function dispatchVerticalOperation(
  operation: ValidatedOperationDescriptor,
  trustedTenant: TrustedTenantContext,
  contracts: readonly VerticalContract[],
  handlers: readonly HandlerRouteDescriptor[],
): VerticalDispatchResult {
  if (!isValidatedDescriptor(operation)) {
    return { status: 'rejected', reason: 'invalid-operation-descriptor' };
  }
  if (!isTrustedTenantContext(trustedTenant)) {
    return { status: 'rejected', reason: 'invalid-trusted-tenant-context' };
  }
  if (operation.businessId !== trustedTenant.businessId) {
    return { status: 'rejected', reason: 'tenant-mismatch' };
  }
  if (!Array.isArray(contracts)) {
    return { status: 'rejected', reason: 'invalid-vertical-contract' };
  }

  const matchingContracts = contracts.filter(
    (contract) =>
      isPlainRecord(contract) &&
      hasOnlyDataProperties(contract) &&
      contract.vertical === operation.vertical,
  );
  if (matchingContracts.length === 0) {
    return { status: 'rejected', reason: 'vertical-contract-not-found' };
  }
  if (matchingContracts.length > 1) {
    return { status: 'rejected', reason: 'ambiguous-vertical-contract' };
  }

  const contractValue = matchingContracts[0];
  if (!isVerticalContract(contractValue)) {
    return { status: 'rejected', reason: 'invalid-vertical-contract' };
  }
  const declaredOperations = contractValue.operations.filter(
    (candidate) => candidate.intent === operation.intent,
  );
  if (declaredOperations.length === 0) {
    return { status: 'rejected', reason: 'operation-not-declared' };
  }
  if (declaredOperations.length > 1) {
    return { status: 'rejected', reason: 'ambiguous-contract-operation' };
  }

  const declaration = declaredOperations[0]!;
  if (
    declaration.capability !== operation.capability ||
    !contractValue.capabilities.includes(declaration.capability) ||
    declaration.requiredEntities.includes('businessId') ||
    !hasExactEntityKeys(operation.entities, declaration.requiredEntities)
  ) {
    return { status: 'rejected', reason: 'operation-not-declared' };
  }

  if (!Array.isArray(handlers) || !handlers.every(isHandlerRoute)) {
    return { status: 'rejected', reason: 'invalid-handler-registry' };
  }
  const matchingHandlers = handlers.filter(
    (handler) =>
      handler.vertical === operation.vertical &&
      handler.intent === operation.intent &&
      handler.capability === operation.capability,
  );
  if (matchingHandlers.length === 0) {
    return { status: 'rejected', reason: 'handler-not-found' };
  }
  if (matchingHandlers.length > 1) {
    return { status: 'rejected', reason: 'ambiguous-handler' };
  }

  return {
    status: 'matched',
    businessId: trustedTenant.businessId,
    route: matchingHandlers[0]!.route,
  };
}