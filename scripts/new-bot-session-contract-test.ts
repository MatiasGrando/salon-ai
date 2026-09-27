import assert from 'node:assert/strict';
import {
  transitionConversation,
  type ConversationEffect,
  type ConversationEvent,
  type ConversationSnapshot,
} from '../src/new-bot/domain/session.js';

const salonScope = { businessId: 'salon-17', conversationId: 'wa-100', vertical: 'salon' } as const;
const salonSnapshot: ConversationSnapshot = {
  schemaVersion: 1,
  ...salonScope,
  revision: 4,
  state: { step: 'service' },
};
const salonEvent: ConversationEvent = {
  schemaVersion: 1,
  ...salonScope,
  expectedRevision: 4,
  type: 'service-selected',
  payload: { service: 'haircut' },
};
const salonEffects: readonly ConversationEffect[] = [
  { type: 'ask-customer', payload: { field: 'date' } },
];
const salonResult = transitionConversation(salonScope, salonSnapshot, salonEvent, {
  nextState: { step: 'date', service: 'haircut' },
  effects: salonEffects,
});
assert.deepEqual(salonResult, {
  status: 'accepted',
  snapshot: {
    schemaVersion: 1,
    ...salonScope,
    revision: 5,
    state: { step: 'date', service: 'haircut' },
  },
  event: salonEvent,
  effects: salonEffects,
});
assert.equal(Object.hasOwn(salonResult.snapshot, 'processedEventIds'), false,
  'snapshots must not accumulate an unbounded processed-event history');

const workshopScope = { businessId: 'workshop-42', conversationId: 'chat-8', vertical: 'workshop' } as const;
const workshopSnapshot: ConversationSnapshot = {
  schemaVersion: 1,
  ...workshopScope,
  revision: 11,
  state: { stage: 'diagnosis', vehicleId: 'vehicle-5' },
};
const workshopEvent: ConversationEvent = {
  schemaVersion: 1,
  ...workshopScope,
  expectedRevision: 11,
  type: 'symptoms-received',
  payload: { symptoms: ['engine-noise'] },
};
const workshopResult = transitionConversation(workshopScope, workshopSnapshot, workshopEvent, {
  nextState: { stage: 'quote', diagnosisId: 'diagnosis-3' },
  effects: [{ type: 'request-inspection-details', payload: { diagnosisId: 'diagnosis-3' } }],
});
assert.equal(workshopResult.status, 'accepted');
if (workshopResult.status === 'accepted') {
  assert.equal(workshopResult.snapshot.vertical, 'workshop');
  assert.equal(workshopResult.snapshot.revision, 12);
  assert.deepEqual(workshopResult.snapshot.state, { stage: 'quote', diagnosisId: 'diagnosis-3' });
  assert.deepEqual(workshopResult.effects, [
    { type: 'request-inspection-details', payload: { diagnosisId: 'diagnosis-3' } },
  ]);
}

for (const mismatch of [
  { ...salonScope, businessId: 'other-business' },
  { ...salonScope, conversationId: 'other-conversation' },
  { ...salonScope, vertical: 'workshop' },
]) {
  assert.deepEqual(
    transitionConversation(salonScope, salonSnapshot, { ...salonEvent, ...mismatch }, {
      nextState: { step: 'must-not-apply' }, effects: [],
    }),
    { status: 'rejected', reason: 'identity-mismatch' },
    'events must match the trusted business, conversation, and vertical',
  );
}
assert.deepEqual(
  transitionConversation(salonScope, { ...salonSnapshot, conversationId: 'other-conversation' }, salonEvent, {
    nextState: { step: 'must-not-apply' }, effects: [],
  }),
  { status: 'rejected', reason: 'identity-mismatch' },
  'the stored snapshot must belong to the trusted conversation',
);
assert.deepEqual(
  transitionConversation(salonScope, salonSnapshot, { ...salonEvent, expectedRevision: 3 }, {
    nextState: { step: 'stale-write' }, effects: [],
  }),
  { status: 'rejected', reason: 'revision-conflict' },
  'stale expected revisions must not overwrite newer conversation state',
);

let invoked = 0;
const effectWithExecutableAccessor = {
  type: 'ask-customer',
  payload: {},
  get execute() {
    invoked++;
    return () => invoked++;
  },
} as unknown as ConversationEffect;
const unsafeEffectResult = transitionConversation(salonScope, salonSnapshot, salonEvent, {
  nextState: { step: 'date' },
  effects: [effectWithExecutableAccessor],
});
assert.deepEqual(unsafeEffectResult, { status: 'rejected', reason: 'invalid-transition' });
assert.equal(invoked, 0, 'effect descriptors are data and must never be evaluated');
let payloadAccessorInvoked = 0;
const accessorArray: unknown[] = [];
Object.defineProperty(accessorArray, '0', {
  configurable: true,
  get() {
    payloadAccessorInvoked++;
    return 'customer-data';
  },
});
accessorArray.length = 1;
const accessorPayloadEvent = {
  ...salonEvent,
  payload: { values: accessorArray },
} as unknown as ConversationEvent;
assert.deepEqual(
  transitionConversation(salonScope, salonSnapshot, accessorPayloadEvent, {
    nextState: { step: 'must-not-apply' }, effects: [],
  }),
  { status: 'rejected', reason: 'invalid-event' },
  'array accessors are not serializable event data',
);
assert.equal(payloadAccessorInvoked, 0, 'event data validation must not evaluate accessors');
let effectListAccessorInvoked = 0;
const accessorEffects: unknown[] = [];
Object.defineProperty(accessorEffects, '0', {
  configurable: true,
  get() {
    effectListAccessorInvoked++;
    return { type: 'ask-customer', payload: {} };
  },
});
accessorEffects.length = 1;
assert.deepEqual(
  transitionConversation(salonScope, salonSnapshot, salonEvent, {
    nextState: { step: 'date' },
    effects: accessorEffects as readonly ConversationEffect[],
  }),
  { status: 'rejected', reason: 'invalid-transition' },
  'effect collections must be data arrays, not executable accessors',
);
assert.equal(effectListAccessorInvoked, 0, 'effect collection validation must not evaluate accessors');
const maximumSnapshot: ConversationSnapshot = {
  ...salonScope,
  schemaVersion: 1,
  revision: Number.MAX_SAFE_INTEGER,
  state: { step: 'terminal' },
};
const maximumRevisionEvent: ConversationEvent = {
  ...salonEvent,
  expectedRevision: Number.MAX_SAFE_INTEGER,
};
assert.deepEqual(
  transitionConversation(salonScope, maximumSnapshot, maximumRevisionEvent, {
    nextState: { step: 'overflow' }, effects: [],
  }),
  { status: 'rejected', reason: 'revision-exhausted' },
  'a valid current revision must still be rejected when its increment would be unsafe',
);

let inheritedEveryInvoked = 0;
const effectArrayWithCustomPrototype: unknown[] = [];
effectArrayWithCustomPrototype.push({ type: 'ask-customer', payload: {} });
const customEffectArrayPrototype = Object.create(Array.prototype, {
  every: {
    value() {
      inheritedEveryInvoked++;
      throw new Error('inherited every must not run');
    },
  },
});
Object.setPrototypeOf(effectArrayWithCustomPrototype, customEffectArrayPrototype);
assert.deepEqual(
  transitionConversation(salonScope, salonSnapshot, salonEvent, {
    nextState: { step: 'date' },
    effects: effectArrayWithCustomPrototype as readonly ConversationEffect[],
  }),
  { status: 'rejected', reason: 'invalid-transition' },
  'effect arrays must use the standard array prototype',
);
assert.equal(inheritedEveryInvoked, 0, 'custom inherited array methods must not execute');

const nullPrototypeState = Object.assign(Object.create(null), { stage: 'before' });
const mutableNextState = { profile: nullPrototypeState, selections: ['before'] };
const mutablePayload = { details: { value: 'before' } };
const mutableEventInput = { ...salonEvent, payload: mutablePayload } as unknown as ConversationEvent;
const mutableEffectPayload = Object.assign(Object.create(null), { labels: ['before'] });
const mutableEffects = [{ type: 'notify', payload: mutableEffectPayload }];
const mutableTransition = {
  nextState: mutableNextState,
  effects: mutableEffects,
} as unknown as Parameters<typeof transitionConversation>[3];
const isolatedResult = transitionConversation(salonScope, salonSnapshot, mutableEventInput, mutableTransition);
assert.equal(isolatedResult.status, 'accepted');
if (isolatedResult.status === 'accepted') {
  nullPrototypeState.stage = 'after';
  mutableNextState.selections.push('after');
  mutablePayload.details.value = 'after';
  mutableEffectPayload.labels.push('after');
  mutableEffects.push({ type: 'late', payload: {} });

  assert.deepEqual(isolatedResult.snapshot.state, {
    profile: Object.assign(Object.create(null), { stage: 'before' }),
    selections: ['before'],
  }, 'snapshot state must not retain mutable proposal references');
  assert.equal(Object.getPrototypeOf(isolatedResult.snapshot.state.profile), null,
    'defensive copies must preserve null-prototype objects');
  assert.deepEqual(isolatedResult.event.payload, { details: { value: 'before' } },
    'accepted events must not retain mutable ingress references');
  assert.deepEqual(isolatedResult.effects, [
    { type: 'notify', payload: Object.assign(Object.create(null), { labels: ['before'] }) },
  ], 'accepted effects must not retain mutable proposal references');
  assert.equal(Object.getPrototypeOf(isolatedResult.effects[0]!.payload), null,
    'effect payload copies must preserve null-prototype objects');
}

console.log('New bot session contract passed.');