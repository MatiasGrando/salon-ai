import assert from 'node:assert/strict'
import {
  PROMPT_ABSOLUTE_WINDOW_MS,
  PROMPT_IDLE_WINDOW_MS,
  admitPromptChoice,
  invalidatePromptForScreen,
  isRecoverableStalePromptClassification,
  reconcilePrompt,
  type BotPromptContract,
  type PromptAdmittedAction,
  type PromptChoiceAttempt,
  type PromptExecutionContext
} from '../src/bot-options/domain/prompts.js'

for (const classification of ['STALE_REVISION', 'STALE_CONTEXT', 'EXPIRED', 'STALE_CUTOVER'] as const) {
  assert.equal(isRecoverableStalePromptClassification(classification), true, `${classification} must refresh the current view`)
}
for (const classification of ['DUPLICATE_PROVIDER_EVENT', 'REJECTED_CHOICE', 'REJECTED_CONTEXT', 'REJECTED_CORRUPTION'] as const) {
  assert.equal(isRecoverableStalePromptClassification(classification), false, `${classification} must remain silent`)
}

const current: PromptExecutionContext = {
  businessId: 'biz_1',
  deploymentId: 'dep_current',
  deploymentGeneration: 7,
  sessionId: 'ses_1',
  stateRevision: 11n
}

const choices = [
  {
    choiceToken: 'choice_a',
    actionType: 'menu.start_booking' as const,
    entityRef: null,
    payload: null,
    labelSnapshot: 'Sacar un turno',
    sortOrder: 0
  },
  {
    choiceToken: 'choice_b',
    actionType: 'menu.business_hours' as const,
    entityRef: null,
    payload: null,
    labelSnapshot: 'Consultar horarios',
    sortOrder: 1
  }
]

function openPrompt(overrides: Partial<BotPromptContract> = {}): BotPromptContract {
  return {
    ...current,
    promptId: 'prompt_1',
    mode: 'FUNCTIONAL',
    status: 'OPEN',
    firstActionAt: null,
    lastActionAt: null,
    settleAt: null,
    absoluteAt: null,
    resolvedAt: null,
    choices,
    ...overrides
  }
}

function attempt(overrides: Partial<PromptChoiceAttempt> = {}): PromptChoiceAttempt {
  return {
    ...current,
    promptId: 'prompt_1',
    choiceToken: 'choice_a',
    providerEventId: 'evt_1',
    providerMessageId: 'wamid.1',
    receivedAt: 1000,
    ...overrides
  }
}

function admit(input: {
  dbNow: number
  prompt?: BotPromptContract
  attempt?: PromptChoiceAttempt
  seen?: readonly string[]
  inboxId?: string
}) {
  return admitPromptChoice({
    dbNow: input.dbNow,
    current,
    prompt: input.prompt ?? openPrompt(),
    attempt: input.attempt ?? attempt(),
    existingProviderEventIds: new Set(input.seen ?? []),
    inboxId: input.inboxId ?? 'inbox_1'
  })
}

// Primera pulsación: bordes exactos de 500 ms idle y 1500 ms absolutos.
const first = admit({ dbNow: 1000 })
assert.equal(first.classification, 'ADMITTED')
if (first.classification !== 'ADMITTED') throw new Error('primera pulsación no admitida')
assert.equal(first.prompt.status, 'STABILIZING')
assert.equal(first.prompt.firstActionAt, 1000)
assert.equal(first.prompt.lastActionAt, 1000)
assert.equal(first.prompt.settleAt, 1000 + PROMPT_IDLE_WINDOW_MS)
assert.equal(first.prompt.absoluteAt, 1000 + PROMPT_ABSOLUTE_WINDOW_MS)

const beforeIdle = reconcilePrompt({ dbNow: 1499, prompt: first.prompt, actions: [first.action] })
assert.equal(beforeIdle.kind, 'NOT_READY')
const atIdle = reconcilePrompt({ dbNow: 1500, prompt: first.prompt, actions: [first.action] })
assert.equal(atIdle.kind, 'SELECT', '500 ms exactos cierran')

// Un click durante STABILIZING, incluso justo en settleAt, se admite si no cerró conciliación.
const second = admit({
  dbNow: 1500,
  prompt: first.prompt,
  attempt: attempt({ providerEventId: 'evt_2', receivedAt: 1500 }),
  inboxId: 'inbox_2'
})
assert.equal(second.classification, 'ADMITTED')
if (second.classification !== 'ADMITTED') throw new Error('segunda pulsación no admitida')
assert.equal(second.prompt.firstActionAt, 1000)
assert.equal(second.prompt.lastActionAt, 1500)
assert.equal(second.prompt.settleAt, 2000)
assert.equal(second.prompt.absoluteAt, 2500)

const atAbsolute = admit({
  dbNow: 2500,
  prompt: second.prompt,
  attempt: attempt({ providerEventId: 'evt_3', receivedAt: 2500 }),
  inboxId: 'inbox_3'
})
assert.equal(atAbsolute.classification, 'ADMITTED', 'absoluteAt es inclusivo')
if (atAbsolute.classification !== 'ADMITTED') throw new Error('borde absoluto no admitido')
assert.equal(atAbsolute.prompt.settleAt, 2500)
assert.equal(reconcilePrompt({
  dbNow: 2499,
  prompt: atAbsolute.prompt,
  actions: [first.action, second.action, atAbsolute.action]
}).kind, 'NOT_READY')
assert.equal(reconcilePrompt({
  dbNow: 2500,
  prompt: atAbsolute.prompt,
  actions: [first.action, second.action, atAbsolute.action]
}).kind, 'SELECT', '1500 ms exactos cierran el máximo absoluto')
assert.equal(
  admit({
    dbNow: 2501,
    prompt: atAbsolute.prompt,
    attempt: attempt({ providerEventId: 'evt_4', receivedAt: 2501 })
  }).classification,
  'EXPIRED'
)

// Retry del mismo evento no crea otra acción.
assert.equal(admit({ dbNow: 1200, prompt: first.prompt, seen: ['evt_1'] }).classification, 'DUPLICATE_PROVIDER_EVENT')

// Dos eventos con la misma choice producen una selección y un duplicado lógico.
const sameChoiceSecond: PromptAdmittedAction = {
  ...first.action,
  providerEventId: 'evt_same_2',
  inboxId: 'inbox_same_2',
  receivedAt: 1001,
  admittedAt: 1001
}
const identical = reconcilePrompt({ dbNow: 1500, prompt: first.prompt, actions: [sameChoiceSecond, first.action] })
assert.equal(identical.kind, 'SELECT')
if (identical.kind === 'SELECT') {
  assert.equal(identical.selected.inboxId, 'inbox_1')
  assert.deepEqual(identical.actionStatuses, { inbox_1: 'SELECTED', inbox_same_2: 'DUPLICATE' })
}

// Dos choices distintas no aplican ninguna y generan confirmaciones explícitas.
const differentChoice: PromptAdmittedAction = {
  ...first.action,
  providerEventId: 'evt_b',
  inboxId: 'inbox_b',
  receivedAt: 1002,
  admittedAt: 1002,
  choice: choices[1]!
}
const conflict = reconcilePrompt({ dbNow: 1500, prompt: first.prompt, actions: [differentChoice, first.action] })
assert.equal(conflict.kind, 'CONFLICT')
if (conflict.kind === 'CONFLICT') {
  assert.deepEqual(conflict.actionStatuses, { inbox_1: 'CONFLICT', inbox_b: 'CONFLICT' })
  assert.deepEqual(conflict.choices.map((choice) => choice.sourceChoiceToken), ['choice_a', 'choice_b'])
  assert.equal(conflict.choices[0]?.confirmationPayload.conflictChoiceToken, 'choice_a')
  assert.equal(conflict.choices[1]?.confirmationPayload.conflictChoiceToken, 'choice_b')
  assert.deepEqual(conflict.choices[0]?.confirmationChoice, {
    actionType: 'menu.start_booking',
    label: 'Sacar un turno',
    payload: { conflictChoiceToken: 'choice_a' }
  })
}

const noActions = reconcilePrompt({ dbNow: 1500, prompt: first.prompt, actions: [] })
assert.equal(noActions.kind, 'NO_ACTIONS')
if (noActions.kind === 'NO_ACTIONS') assert.equal(noActions.prompt.status, 'EXPIRED')

assert.equal(
  admit({ dbNow: 1000, prompt: openPrompt({ status: 'STABILIZING' }) }).classification,
  'REJECTED_CORRUPTION',
  'STABILIZING sin ventanas nunca se autocorrige'
)
assert.equal(
  admit({ dbNow: 1200, prompt: { ...first.prompt, status: 'OPEN' } }).classification,
  'REJECTED_CORRUPTION',
  'OPEN con una ventana iniciada es inconsistente'
)
assert.equal(
  reconcilePrompt({ dbNow: 1500, prompt: first.prompt, actions: [{ ...first.action, promptId: 'prompt_other' }] }).kind,
  'REJECTED_CORRUPTION',
  'conciliación no mezcla acciones de otro prompt'
)

// Revisión y contexto nunca se adaptan al estado vigente.
assert.equal(admit({ dbNow: 1000, attempt: attempt({ stateRevision: 10n }) }).classification, 'STALE_REVISION')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ stateRevision: 12n }) }).classification, 'REJECTED_CORRUPTION')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ businessId: 'biz_other' }) }).classification, 'REJECTED_CONTEXT')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ sessionId: 'ses_other' }) }).classification, 'REJECTED_CONTEXT')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ deploymentId: 'dep_other' }) }).classification, 'REJECTED_CONTEXT')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ promptId: 'prompt_other' }) }).classification, 'STALE_CONTEXT')
assert.equal(admit({ dbNow: 1000, attempt: attempt({ choiceToken: 'missing' }) }).classification, 'REJECTED_CHOICE')

// Generation vieja se clasifica antes de transición y sólo reconstruye MAIN_MENU vigente.
const staleCutover = admit({
  dbNow: 1000,
  attempt: attempt({ deploymentId: 'dep_old', deploymentGeneration: 6, providerEventId: 'evt_old' })
})
assert.equal(staleCutover.classification, 'STALE_CUTOVER')
if (staleCutover.classification === 'STALE_CUTOVER') {
  assert.equal(staleCutover.recovery.deploymentId, 'dep_current')
  assert.equal(staleCutover.recovery.deploymentGeneration, 7)
  assert.equal(staleCutover.recovery.targetFlow, 'MAIN_MENU')
  assert.equal(staleCutover.recovery.semanticAction, null, 'no revive payload ni acción vieja')
  assert.equal('choiceToken' in staleCutover.recovery, false)
}
assert.equal(
  admit({ dbNow: 1000, attempt: attempt({ deploymentGeneration: 8 }) }).classification,
  'REJECTED_CORRUPTION',
  'generation futura indica corrupción, no stale'
)

// Una pantalla funcional nueva invalida; navegación compatible no lo hace.
const keepSame = invalidatePromptForScreen({
  dbNow: 2000,
  prompt: first.prompt,
  screen: { ...current, promptId: 'prompt_1', mode: 'FUNCTIONAL' }
})
assert.equal(keepSame.kind, 'KEEP')
const keepNavigation = invalidatePromptForScreen({
  dbNow: 2000,
  prompt: first.prompt,
  screen: { ...current, promptId: 'nav_1', stateRevision: 12n, mode: 'NAVIGATION' }
})
assert.equal(keepNavigation.kind, 'KEEP')
const invalidated = invalidatePromptForScreen({
  dbNow: 2000,
  prompt: first.prompt,
  screen: { ...current, promptId: 'prompt_2', stateRevision: 12n, mode: 'FUNCTIONAL' }
})
assert.equal(invalidated.kind, 'INVALIDATE')
if (invalidated.kind === 'INVALIDATE') {
  assert.equal(invalidated.prompt.status, 'INVALIDATED')
  assert.equal(invalidated.prompt.resolvedAt, 2000)
  assert.equal(admit({
    dbNow: 2000,
    prompt: invalidated.prompt,
    attempt: attempt({ providerEventId: 'evt_after_invalidation', receivedAt: 2000 })
  }).classification, 'EXPIRED')
}

console.log('OK bot-options prompts: admisión, 500/1500, conflicto, invalidación y stale cutover cumplen el contrato.')
