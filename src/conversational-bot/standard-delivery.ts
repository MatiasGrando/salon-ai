/** Delivery consumes verified server facts; it never invents prices, schedules or consent. */
export type StandardServiceLine = { name: string; price: string | null; duration: string | null }
export type StandardField = { label: string; value: string; link?: boolean }
export type StandardDelivery =
  | { kind: 'services'; services: readonly StandardServiceLine[]; purpose?: 'booking' | 'price' | 'details' }
  | { kind: 'address'; address: string | null; areaOnly?: boolean; mapsUrl: string | null; businessName?: string | null }
  | { kind: 'hours'; hours: string | null; businessName?: string | null }
  | { kind: 'fields'; fields: readonly StandardField[] }
  | { kind: 'missing'; businessName?: string | null; subject?: string }
  | { kind: 'service_details'; name: string; lines: readonly string[] }
  | { kind: 'professionals'; businessName?: string | null; names: readonly string[]; details?: readonly string[]; complete: boolean; overview?: boolean }
const blocks = (...parts: readonly (string | null | undefined)[]) => parts.filter(part => part?.trim()).join('\n\n')
export function safePublicLink(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && value.length <= 2048 ? url.toString() : null } catch { return null }
}
export function standardDelivery(input: StandardDelivery): string {
  switch (input.kind) {
    case 'services': {
      if (!input.services.length) return 'Todavía no tengo servicios publicados. Puedo ayudarte con otra consulta sobre el local.'
      const list = input.services.map(service => '• ' + service.name + ' — ' + (service.price?.replace(/\$\s+/g, '$') ?? 'Precio a consultar') + (service.duration ? ' · ' + service.duration : '')).join('\n')
      const lead = input.purpose === 'booking' ? 'Dale, por supuesto. ¿Cuál de estos servicios querés?'
        : input.purpose === 'price' ? 'Claro. ¿De cuál de estos servicios querés saber el precio?'
          : input.purpose === 'details' ? 'Claro. ¿De cuál de estos servicios querés información?' : null
      return blocks(lead, list)
    }
    case 'address': return input.address ? blocks((input.areaOnly ? 'Estamos en la zona de ' : 'Estamos en ') + input.address + '.', input.mapsUrl ? 'Te dejo la ubicación para que llegues fácil:\nMaps: ' + input.mapsUrl : null) : standardDelivery({ kind: 'missing', businessName: 'businessName' in input && typeof input.businessName === 'string' ? input.businessName : null })
    case 'hours': {
      if (!input.hours || input.hours === 'No tengo horarios publicados.') return standardDelivery({ kind: 'missing', businessName: 'businessName' in input && typeof input.businessName === 'string' ? input.businessName : null })
      // Reshape only canonical weekday markers; preserve every actual interval and exception.
      const rows = input.hours.split('\n').map(line => line.replace(/^\*?(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)\*?:/, '• $1:'))
        .filter(line => line.trim() && !['Los horarios pueden variar por feriados o eventos especiales.', 'Los horarios pueden variar en fechas especiales. Para conocer la disponibilidad exacta, podés buscar un turno.'].includes(line) && line !== 'Los horarios pueden cambiar en fechas especiales.').join('\n')
      return blocks('Estos son nuestros horarios de atención 😊', rows, 'Los horarios pueden cambiar en fechas especiales.', 'Si querés saber qué turnos hay disponibles para un día en particular, decime qué día te interesa y lo revisamos.')
    }
    case 'fields': {
      const fields = input.fields.flatMap(field => { const value = field.link ? safePublicLink(field.value) : field.value.trim(); return value ? [field.label + ': ' + value] : [] })
      return fields.length ? blocks('Claro 😊', fields.join('\n')) : standardDelivery({ kind: 'missing', businessName: 'businessName' in input && typeof input.businessName === 'string' ? input.businessName : null })
    }
    case 'missing': return blocks('Todavía no tengo esa información cargada 😊', input.subject ? 'No tengo cargado ese dato sobre ' + input.subject + '.' : null, 'Si querés, puedo ayudarte con otra consulta sobre ' + (input.businessName?.trim() || 'el local') + '.')
    case 'service_details': return blocks('Claro 😊', input.name + ':\n' + input.lines.join('\n'))
    case 'professionals': return blocks(input.businessName ? 'En ' + input.businessName + ' trabajan estos profesionales 😊' : 'Estos son los profesionales del local 😊', input.names.map(name => '• ' + name).join('\n'), input.details?.join('\n\n'), !input.complete ? 'Todavía no tengo la jornada completa cargada para responder esa consulta.' : input.overview ? 'Si querés, también te puedo decir qué días y horarios trabaja cada uno.' : null)
  }
}
export function standardDateTimeQuestion(date: string | null, hasTemporalRequest: boolean, dateLabel?: string, serviceName?: string): string | null {
  if (!date && !hasTemporalRequest) return 'Perfecto 😊 ¿Para qué día y horario querés reservar' + (serviceName ? ' tu ' + serviceName : '') + '?'
  if (!date) return 'Perfecto 😊 ¿Para qué día querés reservar' + (serviceName ? ' tu ' + serviceName : '') + '?'
  return hasTemporalRequest ? null : 'Perfecto 😊 ¿Qué horario preferís para el ' + (dateLabel ?? date) + '?'
}
export function standardProfessionalChoices(labels: readonly string[]): string { return blocks('Perfecto 😊 ¿Con qué profesional te gustaría reservar?', 'Podés elegir:\n' + labels.map((label, index) => `${index + 1}. ${label}`).join('\n')) }
export function standardSlotOffer(input: { date: string; professional: string | null; band: string | null; labels: readonly string[]; nearest?: string | null; preference?: string | null }): string {
  const professional = input.professional ? ' con ' + input.professional : ''
  const lead = input.nearest ? 'A las ' + input.nearest + ' ya no tengo disponibilidad 😕, pero tengo estos horarios cercanos:'
    : input.preference ? 'Perfecto 😊 ' + input.preference + ' tengo estos horarios para el ' + input.date + professional + ':'
      : 'Para el ' + input.date + ' tengo algunos horarios disponibles' + (input.band ? ' ' + input.band : '') + professional + ' 😊'
  return blocks(lead, input.labels.map((label, index) => `${index + 1}. ${label}`).join('\n'), '¿Cuál te queda mejor?')
}
export function standardManySlots(date: string, labels: readonly string[]): string { return blocks('Tengo bastante disponibilidad para el ' + date + ' 😊', '¿Más o menos en qué horario te gustaría venir?', 'Podés indicar una hora o una preferencia: ' + labels.join(' · ') + '.') }

/** The renderer owns these acknowledgements, not a synonym classifier or a booking decision. */
export function ownsStandardOpening(text: string): boolean {
  return ['Claro 😊', 'Claro. ¿De cuál de estos servicios', 'Dale, por supuesto.', 'Perfecto 😊', 'Estos son nuestros horarios de atención 😊', 'Todavía no tengo esa información cargada 😊'].some(opening => text.startsWith(opening))
}
export function standardWorkSchedule(schedule: string): string {
  return schedule.split('\n').map(line => line.replace(/^\*?(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)\*?:/, '• $1:')).join('\n')
}
/** A verified local calendar date has the same weekday independently of the UTC offset. */
export function formatDeliveryDate(date: string): string {
  const weekday = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long' }).format(new Date(date + 'T12:00:00Z'))
  return weekday + ' ' + date.slice(8, 10) + '/' + date.slice(5, 7)
}