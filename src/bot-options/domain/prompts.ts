/**
 * F3.3/F3.5 - Contratos puros para prompts, estabilizacion y stale cutover.
 *
 * El llamador aporta `dbNow` desde PostgreSQL. Este modulo no consulta reloj,
 * persistencia, Meta ni servicios y ninguna clasificacion ejecuta transiciones.
 */

import type {
  BotOptionsActionPayload,
  BotOptionsEntityRef,
  ClientChoiceActionType
} from './actions.js'

export const PROMPT_IDLE_WINDOW_MS = 500
export const PROMPT_ABSOLUTE_WINDOW_MS = 1500

export const BOT_PROMPT_STATUSES = [
  'OPEN',
  'STABILIZING',
  'RESOLVED',
  'INVALIDATED',
  'EXPIRED'
] as const

export type BotPromptStatus = (typeof BOT_PROMPT_STATUSES)[number]
export type BotPromptMode = 'FUNCTIONAL' | 'NAVIGATION' | 'CONFLICT'

export type PromptExecutionContext = {
  businessId: string
  deploymentId: string
  deploymentGeneration: number
  sessionId: string
  stateRevision: bigint
}

export type PromptChoiceContract = {
  choiceToken: string
  actionType: ClientChoiceActionType
  entityRef: BotOptionsEntityRef | null
  payload: BotOptionsActionPayload | null
  labelSnapshot: string
  sortOrder: number
}

export type BotPromptContract = PromptExecutionContext & {
  promptId: string
  mode: BotPromptMode
  status: BotPromptStatus
  firstActionAt: number | null
  lastActionAt: number | null
  settleAt: number | null
  absoluteAt: number | null
  resolvedAt: number | null
  choices: readonly PromptChoiceContract[]
}

export type PromptChoiceAttempt = PromptExecutionContext & {
  promptId: string
  choiceToken: string
  providerEventId: string
  providerMessageId: string | null
  receivedAt: number
}

export type PromptAdmittedAction = {
  promptId: string
  providerEventId: string
  providerMessageId: string | null
  receivedAt: number
  admittedAt: number
  inboxId: string
  choice: PromptChoiceContract
}

export type StaleCutoverRecovery = {
  kind: 'RECONSTRUCT_CURRENT_GENERATION_MAIN_MENU'
  businessId: string
  deploymentId: string
  deploymentGeneration: number
  sessionId: string
  sourceProviderEventId: string
  targetFlow: 'MAIN_MENU'
  notice: 'BOT_UPDATED'
  semanticAction: null
}

export function createStaleCutoverRecovery(
  current: PromptExecutionContext,
  sourceProviderEventId: string
): StaleCutoverRecovery {
  return {
    kind: 'RECONSTRUCT_CURRENT_GENERATION_MAIN_MENU',
    businessId: current.businessId,
    deploymentId: current.deploymentId,
    deploymentGeneration: current.deploymentGeneration,
    sessionId: current.sessionId,
    sourceProviderEventId,
    targetFlow: 'MAIN_MENU',
    notice: 'BOT_UPDATED',
    semanticAction: null
  }
}

export type PromptAdmissionDecision =
  | {
      classification: 'ADMITTED'
      prompt: BotPromptContract
      action: PromptAdmittedAction
      wakeAt: number
    }
  | { classification: 'DUPLICATE_PROVIDER_EVENT'; prompt: BotPromptContract }
  | { classification: 'STALE_REVISION'; prompt: BotPromptContract }
  | { classification: 'STALE_CONTEXT'; prompt: BotPromptContract }
  | {
      classification: 'STALE_CUTOVER'
      prompt: BotPromptContract
      recovery: StaleCutoverRecovery
    }
  | { classification: 'EXPIRED'; prompt: BotPromptContract }
  | { classification: 'REJECTED_CHOICE'; prompt: BotPromptContract }
  | { classification: 'REJECTED_CONTEXT'; prompt: BotPromptContract }
  | { classification: 'REJECTED_CORRUPTION'; prompt: BotPromptContract }

export function isRecoverableStalePromptClassification(
  classification: PromptAdmissionDecision['classification']
): classification is 'STALE_REVISION' | 'STALE_CONTEXT' | 'STALE_CUTOVER' | 'EXPIRED' {
  return classification === 'STALE_REVISION'
    || classification === 'STALE_CONTEXT'
    || classification === 'STALE_CUTOVER'
    || classification === 'EXPIRED'
}

function sameOwnership(left: PromptExecutionContext, right: PromptExecutionContext): boolean {
  return left.businessId === right.businessId && left.sessionId === right.sessionId
}

function sameDeployment(left: PromptExecutionContext, right: PromptExecutionContext): boolean {
  return left.deploymentId === right.deploymentId &&
    left.deploymentGeneration === right.deploymentGeneration
}

function hasCoherentWindow(prompt: BotPromptContract): boolean {
  if (prompt.firstActionAt === null) {
    return prompt.lastActionAt === null && prompt.settleAt === null && prompt.absoluteAt === null
  }
  return prompt.lastActionAt !== null &&
    prompt.settleAt !== null &&
    prompt.absoluteAt !== null &&
    prompt.firstActionAt <= prompt.lastActionAt &&
    prompt.lastActionAt <= prompt.absoluteAt &&
    prompt.settleAt <= prompt.absoluteAt
}

/**
 * Decide admision bajo el supuesto de que prompt y provider event se bloquearon.
 * El resultado aceptado es un patch completo y persistible; los rechazos no mutan.
 */
export function admitPromptChoice(input: {
  dbNow: number
  current: PromptExecutionContext
  prompt: BotPromptContract
  attempt: PromptChoiceAttempt
  existingProviderEventIds: ReadonlySet<string>
  inboxId: string
}): PromptAdmissionDecision {
  const { current, prompt, attempt, dbNow } = input

  if (!Number.isFinite(dbNow) || !Number.isFinite(attempt.receivedAt)) {
    return { classification: 'REJECTED_CORRUPTION', prompt }
  }
  if (!sameOwnership(attempt, current)) {
    return { classification: 'REJECTED_CONTEXT', prompt }
  }
  if (attempt.deploymentGeneration < current.deploymentGeneration) {
    return {
      classification: 'STALE_CUTOVER',
      prompt,
      recovery: createStaleCutoverRecovery(current, attempt.providerEventId)
    }
  }
  if (attempt.deploymentGeneration > current.deploymentGeneration) {
    return { classification: 'REJECTED_CORRUPTION', prompt }
  }
  if (attempt.deploymentId !== current.deploymentId) {
    return { classification: 'REJECTED_CONTEXT', prompt }
  }
  if (attempt.stateRevision < current.stateRevision) {
    return { classification: 'STALE_REVISION', prompt }
  }
  if (attempt.stateRevision > current.stateRevision) {
    return { classification: 'REJECTED_CORRUPTION', prompt }
  }
  if (
    !sameOwnership(prompt, current) ||
    !sameDeployment(prompt, current) ||
    prompt.stateRevision !== current.stateRevision ||
    attempt.promptId !== prompt.promptId
  ) {
    return { classification: 'STALE_CONTEXT', prompt }
  }
  if (input.existingProviderEventIds.has(attempt.providerEventId)) {
    return { classification: 'DUPLICATE_PROVIDER_EVENT', prompt }
  }
  if (!hasCoherentWindow(prompt)) {
    return { classification: 'REJECTED_CORRUPTION', prompt }
  }
  if (prompt.status !== 'OPEN' && prompt.status !== 'STABILIZING') {
    return { classification: 'EXPIRED', prompt }
  }
  if (
    (prompt.status === 'OPEN' && prompt.firstActionAt !== null) ||
    (prompt.status === 'STABILIZING' && prompt.firstActionAt === null)
  ) {
    return { classification: 'REJECTED_CORRUPTION', prompt }
  }
  if (prompt.absoluteAt !== null && dbNow > prompt.absoluteAt) {
    return { classification: 'EXPIRED', prompt }
  }

  const choice = prompt.choices.find((candidate) => candidate.choiceToken === attempt.choiceToken)
  if (!choice) {
    return { classification: 'REJECTED_CHOICE', prompt }
  }

  const firstActionAt = prompt.firstActionAt ?? dbNow
  const absoluteAt = prompt.absoluteAt ?? dbNow + PROMPT_ABSOLUTE_WINDOW_MS
  const settleAt = Math.min(dbNow + PROMPT_IDLE_WINDOW_MS, absoluteAt)
  const nextPrompt: BotPromptContract = {
    ...prompt,
    status: 'STABILIZING',
    firstActionAt,
    lastActionAt: dbNow,
    settleAt,
    absoluteAt
  }
  return {
    classification: 'ADMITTED',
    prompt: nextPrompt,
    action: {
      promptId: prompt.promptId,
      providerEventId: attempt.providerEventId,
      providerMessageId: attempt.providerMessageId,
      receivedAt: attempt.receivedAt,
      admittedAt: dbNow,
      inboxId: input.inboxId,
      choice
    },
    wakeAt: settleAt
  }
}

export type PromptConflictChoice = PromptChoiceContract & {
  sourceChoiceToken: string
  confirmationPayload: BotOptionsActionPayload
  confirmationChoice: {
    actionType: ClientChoiceActionType
    label: string
    entityRef?: BotOptionsEntityRef | undefined
    payload: BotOptionsActionPayload
  }
}

type ClosedPrompt = BotPromptContract & {
  status: 'RESOLVED' | 'EXPIRED'
  resolvedAt: number
}

export type PromptReconciliationDecision =
  | { kind: 'NOT_READY'; prompt: BotPromptContract; wakeAt: number }
  | { kind: 'NO_ACTIONS'; prompt: ClosedPrompt; actionStatuses: Readonly<Record<string, never>> }
  | {
      kind: 'SELECT'
      prompt: ClosedPrompt
      selected: PromptAdmittedAction
      actionStatuses: Readonly<Record<string, 'SELECTED' | 'DUPLICATE'>>
    }
  | {
      kind: 'CONFLICT'
      prompt: ClosedPrompt
      choices: readonly PromptConflictChoice[]
      actionStatuses: Readonly<Record<string, 'CONFLICT'>>
    }
  | { kind: 'REJECTED_CORRUPTION'; prompt: BotPromptContract }

function compareActions(left: PromptAdmittedAction, right: PromptAdmittedAction): number {
  return left.receivedAt - right.receivedAt ||
    left.admittedAt - right.admittedAt ||
    left.inboxId.localeCompare(right.inboxId)
}

function sameChoice(left: PromptChoiceContract, right: PromptChoiceContract): boolean {
  return left.choiceToken === right.choiceToken &&
    left.actionType === right.actionType &&
    left.labelSnapshot === right.labelSnapshot &&
    left.sortOrder === right.sortOrder &&
    JSON.stringify(left.entityRef) === JSON.stringify(right.entityRef) &&
    JSON.stringify(left.payload) === JSON.stringify(right.payload)
}

/** Reconciliacion inclusiva: `dbNow === settleAt` ya esta lista para cerrar. */
export function reconcilePrompt(input: {
  dbNow: number
  prompt: BotPromptContract
  actions: readonly PromptAdmittedAction[]
}): PromptReconciliationDecision {
  const { prompt, dbNow } = input
  if (
    !Number.isFinite(dbNow) ||
    prompt.status !== 'STABILIZING' ||
    prompt.settleAt === null ||
    prompt.absoluteAt === null ||
    !hasCoherentWindow(prompt)
  ) {
    return { kind: 'REJECTED_CORRUPTION', prompt }
  }
  if (dbNow < prompt.settleAt) {
    return { kind: 'NOT_READY', prompt, wakeAt: prompt.settleAt }
  }

  const inboxIds = new Set<string>()
  const providerEventIds = new Set<string>()
  for (const action of input.actions) {
    const persistedChoice = prompt.choices.find((choice) => choice.choiceToken === action.choice.choiceToken)
    if (
      action.promptId !== prompt.promptId ||
      !persistedChoice ||
      !sameChoice(action.choice, persistedChoice) ||
      !Number.isFinite(action.receivedAt) ||
      !Number.isFinite(action.admittedAt) ||
      inboxIds.has(action.inboxId) ||
      providerEventIds.has(action.providerEventId)
    ) {
      return { kind: 'REJECTED_CORRUPTION', prompt }
    }
    inboxIds.add(action.inboxId)
    providerEventIds.add(action.providerEventId)
  }

  const sorted = [...input.actions].sort(compareActions)
  if (sorted.length === 0) {
    return {
      kind: 'NO_ACTIONS',
      prompt: { ...prompt, status: 'EXPIRED', resolvedAt: dbNow },
      actionStatuses: {}
    }
  }

  const distinct = new Map<string, PromptAdmittedAction>()
  for (const action of sorted) {
    if (!distinct.has(action.choice.choiceToken)) distinct.set(action.choice.choiceToken, action)
  }
  const closed: ClosedPrompt = { ...prompt, status: 'RESOLVED', resolvedAt: dbNow }

  if (distinct.size === 1) {
    const selected = sorted[0]!
    const actionStatuses: Record<string, 'SELECTED' | 'DUPLICATE'> = {}
    for (const action of sorted) {
      actionStatuses[action.inboxId] = action === selected ? 'SELECTED' : 'DUPLICATE'
    }
    return { kind: 'SELECT', prompt: closed, selected, actionStatuses }
  }

  const actionStatuses: Record<string, 'CONFLICT'> = {}
  for (const action of sorted) actionStatuses[action.inboxId] = 'CONFLICT'
  const choices = [...distinct.values()]
    .map(({ choice }): PromptConflictChoice => {
      const confirmationPayload: BotOptionsActionPayload = {
        ...(choice.payload ?? {}),
        conflictChoiceToken: choice.choiceToken
      }
      return {
        ...choice,
        sourceChoiceToken: choice.choiceToken,
        confirmationPayload,
        confirmationChoice: {
          actionType: choice.actionType,
          label: choice.labelSnapshot,
          ...(choice.entityRef ? { entityRef: choice.entityRef } : {}),
          payload: confirmationPayload
        }
      }
    })
    .sort((left, right) => left.sortOrder - right.sortOrder)
  return { kind: 'CONFLICT', prompt: closed, choices, actionStatuses }
}

export type PromptInvalidationDecision =
  | { kind: 'KEEP'; prompt: BotPromptContract }
  | { kind: 'INVALIDATE'; prompt: BotPromptContract & { status: 'INVALIDATED'; resolvedAt: number } }
  | { kind: 'REJECTED_CONTEXT'; prompt: BotPromptContract }

/** Una pantalla funcional nueva invalida prompts activos incompatibles del mismo contexto. */
export function invalidatePromptForScreen(input: {
  dbNow: number
  prompt: BotPromptContract
  screen: PromptExecutionContext & { promptId: string; mode: BotPromptMode }
}): PromptInvalidationDecision {
  const { prompt, screen } = input
  if (!sameOwnership(prompt, screen) || !sameDeployment(prompt, screen)) {
    return { kind: 'REJECTED_CONTEXT', prompt }
  }
  if (prompt.status !== 'OPEN' && prompt.status !== 'STABILIZING') {
    return { kind: 'KEEP', prompt }
  }
  if (screen.mode !== 'FUNCTIONAL') return { kind: 'KEEP', prompt }
  if (screen.promptId === prompt.promptId && screen.stateRevision === prompt.stateRevision) {
    return { kind: 'KEEP', prompt }
  }
  return {
    kind: 'INVALIDATE',
    prompt: { ...prompt, status: 'INVALIDATED', resolvedAt: input.dbNow }
  }
}
