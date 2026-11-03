import { initialDialogueState, type DialogueResponse, type DialogueState } from './engine.js'

const BARBER_TEST_BUSINESS_ID = 'cmpvr0oqo0000o0vcnhgyv054'
/** Exact whole-message control; ordinary prose or a different tenant is not reset authority. */
export const isTestResetCommand = (value: unknown): boolean => typeof value === 'string' && value.trim() === '/reset'
export const isBarberTestReset = (value: unknown, businessId: string): boolean =>
  businessId === BARBER_TEST_BUSINESS_ID && isTestResetCommand(value)

/** Caller supplies validated state and scope. This only discards conversation memory, never effects. */
export function resetTestDialogue(state: DialogueState): DialogueResponse {
  if (state.appointmentManagement && !state.appointmentManagement.outcome) {
    const next=structuredClone(state)
    delete next.appointmentManagement; delete next.ownAppointmentInquiry
    return {state:next,proposal:null,replyPrepared:true,
      reply:'Cerré la gestión pendiente de cancelación o reprogramación. Conservé tus turnos, señas y los datos del pedido. ¿En qué te puedo ayudar?'}
  }
  return { state: initialDialogueState(state.businessId), proposal: null, replyPrepared: true,
    reply: 'Listo, reinicié esta conversación de prueba. No cancelé turnos confirmados ni borré el historial. ¿En qué te puedo ayudar?' }
}
