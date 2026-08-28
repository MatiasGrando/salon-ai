/**
 * F3.4 — Efectos declarativos del motor determinístico por opciones.
 *
 * La transición NUNCA toca la base ni Meta: devuelve efectos tipados que el
 * executor valida bajo lock (diseno-tecnico.md §7). Si un efecto falla su
 * guarda contextual, el executor produce un evento de recuperación para el
 * core; jamás adapta una acción vieja al estado nuevo.
 */

import type { BotOptionsEntityRef, SlotBand } from './actions.js'
import type { BotOptionsState } from './state.js'

/** Snapshot inmutable del carrito al confirmar: precios/duraciones reales viajan en el contexto. */
export type VisitServiceSnapshot = {
  serviceId: string
  name: string
  durationMinutes: number
  priceMinor: number | null
  /** 'FIXED' precio cerrado; 'STARTING_AT' estimado "desde"; null sin precio público. */
  priceMode: 'FIXED' | 'STARTING_AT' | null
}

export type AssignedProfessional = {
  professionalId: string
  name: string
  /** true cuando la persona fue elegida por la política balanceada de "cualquiera". */
  assignedByBalancer: boolean
}

export type BotOptionsEffect =
  | { kind: 'PERSIST_CUSTOMER_NAME'; name: string }
  | {
      kind: 'CONFIRM_VISIT'
      services: VisitServiceSnapshot[]
      professional: AssignedProfessional
      date: string
      slotStartAt: string
      totalDurationMinutes: number
      totalPriceMinor: number | null
    }
  | {
      kind: 'HOLD_VISIT_WITH_DEPOSIT'
      services: VisitServiceSnapshot[]
      professional: AssignedProfessional
      date: string
      slotStartAt: string
      totalDurationMinutes: number
      depositAmountMinor: number
      holdExpiresAtIso: string
    }
  | { kind: 'RELEASE_HOLD' }
  | { kind: 'APPROVE_DEPOSIT' }
  | { kind: 'REJECT_DEPOSIT_FOR_RESUBMISSION'; reason: string; resubmissionExpiresAtIso: string }
  | { kind: 'REJECT_DEPOSIT_FINAL'; reason: string }
  | { kind: 'CANCEL_BOOKING'; appointmentId: string; reason: string }
  | {
      kind: 'SWAP_APPOINTMENT_SLOT'
      appointmentId: string
      newSlotStartAt: string
      keepApprovedDeposit: boolean
    }
  | {
      kind: 'REQUEST_HUMAN_HANDOFF'
      reason: string
      detail: string | null
      /** Contexto mínimo y estable para auditar qué entidad originó la cola. */
      context: { serviceId: string } | { professionalId: string } | null
    }
  /** Customer intent only: the executor resolves the active handoff under lock. */
  | { kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' }
  | { kind: 'TAKE_HUMAN_HANDOFF' }
  | { kind: 'RESOLVE_HANDOFF'; mode: 'HOME' | 'RESUME' }
  | { kind: 'EMIT_OPERATIONAL_ALERT'; alertKind: string; detail: string | null }

export type BotOptionsEffectWithView =
  | { kind: 'SEND_VIEW'; viewPriority: 'normal' }

export function effectsRequireHandoff(effects: readonly BotOptionsEffect[]): boolean {
  return effects.some((effect) => effect.kind === 'REQUEST_HUMAN_HANDOFF')
}

export function describeEffectTarget(effect: BotOptionsEffect): string {
  switch (effect.kind) {
    case 'PERSIST_CUSTOMER_NAME':
      return 'cliente'
    case 'CONFIRM_VISIT':
    case 'HOLD_VISIT_WITH_DEPOSIT':
    case 'CANCEL_BOOKING':
    case 'SWAP_APPOINTMENT_SLOT':
      return 'reserva'
    case 'RELEASE_HOLD':
      return 'retencion'
    case 'APPROVE_DEPOSIT':
    case 'REJECT_DEPOSIT_FOR_RESUBMISSION':
    case 'REJECT_DEPOSIT_FINAL':
      return 'seña'
    case 'REQUEST_HUMAN_HANDOFF':
    case 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER':
    case 'TAKE_HUMAN_HANDOFF':
    case 'RESOLVE_HANDOFF':
      return 'handoff'
    case 'EMIT_OPERATIONAL_ALERT':
      return 'alerta'
    default:
      return 'desconocido'
  }
}

export type TransitionEffectBundle = {
  effects: BotOptionsEffect[]
  /** Estado que el executor debe persistir junto a los efectos, ya validado. */
  nextState: BotOptionsState
}

export type EffectGuardFailure = {
  effectKind: BotOptionsEffect['kind']
  reason: string
  entityRef?: BotOptionsEntityRef
  band?: SlotBand
}
