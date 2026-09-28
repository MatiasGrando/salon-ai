/** JSON-like values keep snapshots, events, and effect descriptors as serializable data. */
export type ConversationData =
  | null
  | boolean
  | number
  | string
  | readonly ConversationData[]
  | { readonly [key: string]: ConversationData };

export interface ConversationIdentity {
  readonly businessId: string;
  readonly provider: string;
  readonly conversationId: string;
  readonly vertical: string;
}

/** Versioned, vertical-neutral state. Processed event IDs belong to durable ingress, not snapshots. */
export interface ConversationSnapshot<TState extends ConversationData = ConversationData>
  extends ConversationIdentity {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly state: TState;
}

/** One admitted conversation event with the revision on which its transition was based. */
export interface ConversationEvent<TPayload extends ConversationData = ConversationData>
  extends ConversationIdentity {
  readonly schemaVersion: 1;
  readonly expectedRevision: number;
  readonly type: string;
  readonly payload: TPayload;
}

/** Effects describe requested work as data; execution belongs to a later runtime boundary. */
export interface ConversationEffect {
  readonly type: string;
  readonly payload: ConversationData;
}

export interface ConversationTransitionProposal<
  TState extends ConversationData = ConversationData,
> {
  readonly nextState: TState;
  readonly effects: readonly ConversationEffect[];
}

export type ConversationTransitionResult<
  TState extends ConversationData = ConversationData,
> =
  | {
      readonly status: 'accepted';
      readonly snapshot: ConversationSnapshot<TState>;
      readonly event: ConversationEvent;
      readonly effects: readonly ConversationEffect[];
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'invalid-trusted-context'
        | 'invalid-snapshot'
        | 'invalid-event'
        | 'identity-mismatch'
        | 'revision-conflict'
        | 'revision-exhausted'
        | 'invalid-transition';
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonData(value: unknown, ancestors = new Set<object>()): value is ConversationData {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  let valid = false;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      ancestors.delete(value);
      return false;
    }
    const keys = Reflect.ownKeys(value);
    const length = value.length;
    valid = keys.length === length + 1;
    let hasLength = false;
    for (const key of keys) {
      if (key === 'length') {
        hasLength = true;
        continue;
      }
      if (typeof key !== 'string') {
        valid = false;
        break;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        valid = false;
        break;
      }
    }
    valid = valid && hasLength;
    if (valid) {
      for (let index = 0; index < length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (property === undefined || !('value' in property) || !isJsonData(property.value, ancestors)) {
          valid = false;
          break;
        }
      }
    }
  } else if (isPlainRecord(value)) {
    valid = Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property !== undefined && 'value' in property && isJsonData(property.value, ancestors);
    });
  }
  ancestors.delete(value);
  return valid;
}

function hasExactDataKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Reflect.ownKeys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property !== undefined && 'value' in property;
    }) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIdentity(value: unknown): value is ConversationIdentity {
  return (
    isPlainRecord(value) &&
    hasExactDataKeys(value, ['businessId', 'provider', 'conversationId', 'vertical']) &&
    isNonEmptyString(value.businessId) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.conversationId) &&
    isNonEmptyString(value.vertical)
  );
}

function sameIdentity(left: ConversationIdentity, right: ConversationIdentity): boolean {
  return (
    left.businessId === right.businessId &&
    left.provider === right.provider &&
    left.conversationId === right.conversationId &&
    left.vertical === right.vertical
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSnapshot(value: unknown): value is ConversationSnapshot {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, [
    'schemaVersion', 'businessId', 'provider', 'conversationId', 'vertical', 'revision', 'state',
  ])) return false;
  return (
    value.schemaVersion === 1 &&
    isIdentity({ businessId: value.businessId, provider: value.provider, conversationId: value.conversationId, vertical: value.vertical }) &&
    isRevision(value.revision) &&
    isJsonData(value.state)
  );
}

function isEvent(value: unknown): value is ConversationEvent {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, [
    'schemaVersion', 'businessId', 'provider', 'conversationId', 'vertical', 'expectedRevision', 'type', 'payload',
  ])) return false;
  return (
    value.schemaVersion === 1 &&
    isIdentity({ businessId: value.businessId, provider: value.provider, conversationId: value.conversationId, vertical: value.vertical }) &&
    isRevision(value.expectedRevision) &&
    isNonEmptyString(value.type) &&
    isJsonData(value.payload)
  );
}

function isEffect(value: unknown): value is ConversationEffect {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, ['type', 'payload'])) return false;
  return isNonEmptyString(value.type) && isJsonData(value.payload);
}

function isTransition(value: unknown): value is ConversationTransitionProposal {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, ['nextState', 'effects'])) return false;
  if (!isJsonData(value.nextState) || !Array.isArray(value.effects) || !isJsonData(value.effects)) {
    return false;
  }
  for (let index = 0; index < value.effects.length; index++) {
    const effect = Object.getOwnPropertyDescriptor(value.effects, String(index));
    if (effect === undefined || !('value' in effect) || !isEffect(effect.value)) return false;
  }
  return true;
}

function copyConversationData(value: ConversationData): ConversationData {
  if (Array.isArray(value)) {
    const copy = new Array<ConversationData>(value.length);
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (item === undefined || !('value' in item)) throw new TypeError('Invalid conversation array data');
      copy[index] = copyConversationData(item.value);
    }
    return copy;
  }
  if (value !== null && typeof value === 'object') {
    const copy = Object.create(Object.getPrototypeOf(value)) as Record<string, ConversationData>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError('Invalid conversation object key');
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (property === undefined || !('value' in property)) throw new TypeError('Invalid conversation object data');
      Object.defineProperty(copy, key, {
        ...property,
        value: copyConversationData(property.value),
      });
    }
    return copy;
  }
  return value;
}

/**
 * Applies a vertical-produced transition only when trusted identity and expected revision agree.
 * The function returns effect descriptors as data and never invokes them.
 */
export function transitionConversation<TState extends ConversationData>(
  trustedIdentity: ConversationIdentity,
  snapshot: ConversationSnapshot,
  event: ConversationEvent,
  transition: ConversationTransitionProposal<TState>,
): ConversationTransitionResult<TState> {
  if (!isIdentity(trustedIdentity)) {
    return { status: 'rejected', reason: 'invalid-trusted-context' };
  }
  if (!isSnapshot(snapshot)) {
    return { status: 'rejected', reason: 'invalid-snapshot' };
  }
  if (!isEvent(event)) {
    return { status: 'rejected', reason: 'invalid-event' };
  }
  if (
    !sameIdentity(trustedIdentity, snapshot) ||
    !sameIdentity(trustedIdentity, event)
  ) {
    return { status: 'rejected', reason: 'identity-mismatch' };
  }
  if (event.expectedRevision !== snapshot.revision) {
    return { status: 'rejected', reason: 'revision-conflict' };
  }
  if (snapshot.revision === Number.MAX_SAFE_INTEGER) {
    return { status: 'rejected', reason: 'revision-exhausted' };
  }
  if (!isTransition(transition)) {
    return { status: 'rejected', reason: 'invalid-transition' };
  }

  return {
    status: 'accepted',
    snapshot: {
      schemaVersion: 1,
      ...trustedIdentity,
      revision: snapshot.revision + 1,
      state: copyConversationData(transition.nextState) as TState,
    },
    event: copyConversationData(event as unknown as ConversationData) as unknown as ConversationEvent,
    effects: copyConversationData(transition.effects as unknown as ConversationData) as unknown as readonly ConversationEffect[],
  };
}