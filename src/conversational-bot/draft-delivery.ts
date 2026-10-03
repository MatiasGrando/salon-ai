import { basketServiceIds } from './service-basket.js'
import type { DialogueService, DialogueState, DialogueTurnOutcome } from './engine.js'
/** Narrate only explicitly applied, independently verified draft changes, never dependent invalidations. */
export function appliedChangeAcknowledgment(before: DialogueState, after: DialogueState,
  services: readonly DialogueService[], outcome?: DialogueTurnOutcome): string {
  if (!outcome || before.businessId !== after.businessId || after.sandboxReservation?.receipt) return ''
  const statements: string[] = []
  for (const field of outcome.appliedFields) {
    if (field === 'service') {
      const old = basketServiceIds(before), ids = basketServiceIds(after)
      const names = ids.map(id => services.find(service => service.id === id)?.name)
      if (JSON.stringify(before.basket ?? old) !== JSON.stringify(after.basket ?? ids) && old.length && ids.length && names.every(Boolean)) {
        statements.push('seguimos ' + (ids.length === 1 ? 'sólo ' : '') + 'con ' + names.join(' y '))
      }
    } else if (field === 'date' && before.date && before.date !== after.date && after.date) {
      statements.push('cambié la fecha al ' + after.date.slice(8) + '/' + after.date.slice(5, 7) + '/' + after.date.slice(0, 4))
    } else if (field === 'name' && before.customerName && before.customerName !== after.customerName && after.customerName) {
      statements.push('actualicé el nombre a ' + after.customerName)
    } else if (field === 'professional' && (before.professional || before.professionalNameHint) && JSON.stringify(before.professional) !== JSON.stringify(after.professional) && after.professional) {
      statements.push(after.professional.kind === 'any' ? 'seguimos con cualquier profesional compatible' : 'actualicé tu preferencia de profesional')
    } else if (field === 'time' && (before.requestedTime || before.timePreference) && (before.requestedTime !== after.requestedTime || JSON.stringify(before.timePreference) !== JSON.stringify(after.timePreference))) {
      statements.push(after.requestedTime ? 'actualicé la hora solicitada a ' + after.requestedTime : 'actualicé tu preferencia de horario')
    } else if (field === 'estimate' && before.serviceEstimates && Object.keys(before.serviceEstimates).length > 0 && JSON.stringify(before.serviceEstimates) !== JSON.stringify(after.serviceEstimates)) {
      statements.push('actualicé la opción elegida para el presupuesto')
    }
  }
  return statements.length ? 'Perfecto, ' + statements.join('; ') + '.' : ''
}

/** When the server combines acknowledgment with another prepared response, use
 * the verified acknowledgment's content without adding a second transition. */
export function acknowledgmentContent(acknowledgment: string): string {
  const lead = 'Perfecto, '
  if (!acknowledgment.startsWith(lead)) return acknowledgment
  const content = acknowledgment.slice(lead.length)
  return content.charAt(0).toUpperCase() + content.slice(1)
}