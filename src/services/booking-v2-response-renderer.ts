import type { BookingV2DomainCatalog } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption } from './booking-v2-domain.js'
import type { BookingV2MessagePlan } from './booking-v2-dialogue.js'
import type { BookingDraft, BookingField } from './booking-v2-state.js'

export type BookingV2RenderInput = {
  plan: BookingV2MessagePlan
  draft: BookingDraft
  catalog?: BookingV2DomainCatalog | null
  availabilityOptions?: BookingV2AvailabilityOption[]
}

export function renderBookingV2Response(input: BookingV2RenderInput): string {
  if (input.plan.type === 'handoff') {
    return 'Te derivo con una persona para que pueda ayudarte mejor.'
  }

  if (input.plan.type === 'ask_field') {
    if (input.plan.field === 'time' && input.availabilityOptions?.length) {
      return `Tengo ${formatAvailabilityOptions(input.availabilityOptions)}. ¿Qué horario preferís?`
    }
    const question = questionForField(input.plan.field)
    if (input.plan.reason === 'not_understood') {
      return `Disculpame, no te entendí bien. ${question}`
    }
    if (input.plan.field === 'name' && !input.draft.name) {
      return `Hola, soy la asistente virtual. ${question}`
    }
    return question
  }

  if (input.plan.type === 'confirm_field') {
    return confirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  if (input.plan.type === 'confirm_correction') {
    return correctionConfirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  return bookingConfirmation(input.draft, input.catalog)
}

function questionForField(field: BookingField) {
  if (field === 'name') return '¿Me decís tu nombre?'
  if (field === 'service') return '¿Qué servicio querés reservar?'
  if (field === 'professional') return '¿Con qué profesional querés atenderte?'
  if (field === 'date') return '¿Qué día querés venir?'
  return '¿Qué horario preferís?'
}

function confirmationForField(
  field: BookingField,
  value: string,
  catalog?: BookingV2DomainCatalog | null
) {
  if (field === 'service') return `¿Querés reservar ${labelForService(value, catalog)}?`
  if (field === 'professional') return `¿Querés atenderte con ${labelForProfessional(value, catalog)}?`
  if (field === 'date') return `¿Querés venir el ${formatDate(value)}?`
  if (field === 'time') return `¿Querés reservar a las ${value}?`
  return `¿Tu nombre es ${value}?`
}

function correctionConfirmationForField(
  field: BookingField,
  value: string | null,
  catalog?: BookingV2DomainCatalog | null
) {
  if (value) return confirmationForField(field, value, catalog)
  if (field === 'service') return '¿Querés modificar el servicio?'
  if (field === 'professional') return '¿Querés cambiar de profesional?'
  if (field === 'date') return '¿Querés modificar el día?'
  if (field === 'time') return '¿Querés modificar el horario?'
  return '¿Querés modificar tu nombre?'
}

function bookingConfirmation(draft: BookingDraft, catalog?: BookingV2DomainCatalog | null) {
  return [
    'Perfecto.',
    `¿Confirmás la reserva para ${labelForService(draft.service, catalog)}`,
    `con ${labelForProfessional(draft.professional, catalog)}`,
    `el ${formatDate(draft.date)}`,
    `a las ${draft.time}?`
  ].join(' ')
}

function labelForService(serviceId: string | null, catalog?: BookingV2DomainCatalog | null) {
  return catalog?.services.find((service) => service.id === serviceId)?.name ?? 'el servicio elegido'
}

function labelForProfessional(professionalId: string | null, catalog?: BookingV2DomainCatalog | null) {
  return catalog?.professionals.find((professional) => professional.id === professionalId)?.name ?? 'el profesional elegido'
}

function formatDate(value: string | null) {
  if (!value) return 'el día elegido'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

function formatAvailabilityOptions(options: BookingV2AvailabilityOption[]) {
  const uniqueTimes = Array.from(new Set(options.map((option) => option.time))).slice(0, 6)
  if (uniqueTimes.length === 1) return `disponible a las ${uniqueTimes[0]}`
  if (uniqueTimes.length === 2) return `disponible a las ${uniqueTimes[0]} y ${uniqueTimes[1]}`

  const last = uniqueTimes[uniqueTimes.length - 1]
  return `disponible a las ${uniqueTimes.slice(0, -1).join(', ')} y ${last}`
}
