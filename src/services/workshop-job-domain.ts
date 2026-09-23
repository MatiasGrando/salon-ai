export class WorkshopJobError extends Error {}

export function parseWorkshopPerformerName(value: unknown) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!name) throw new WorkshopJobError('El nombre del trabajador es obligatorio')
  if (name.length > 100) throw new WorkshopJobError('El nombre del trabajador es demasiado largo')
  return { name, normalizedName: name.toLocaleLowerCase('es') }
}
function text(value: unknown, label: string, max = 180) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!result || result.length > max) throw new WorkshopJobError('Revisa ' + label)
  return result
}
function optionalText(value: unknown, max: number) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (result.length > max) throw new WorkshopJobError('Texto demasiado largo')
  return result
}
function optionalPositiveInteger(value: unknown, label: string, max: number) {
  if (value == null || value === '') return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1 || result > max) throw new WorkshopJobError(label + ' invalido')
  return result
}
function quantity(value: unknown) {
  const result = Number(value ?? 1)
  if (!Number.isInteger(result) || result < 1 || result > 999) throw new WorkshopJobError('Cantidad invalida')
  return result
}
function optionalDate(value: unknown) {
  if (value == null || value === '') return undefined
  const date = String(value)
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new WorkshopJobError('Fecha de próximo control inválida')
  return date
}
function money(value: unknown) {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  if (!/^\d{1,8}$/.test(raw)) throw new WorkshopJobError('Importe inválido: usá pesos enteros, sin centavos')
  return Number(raw) * 100
}
export function parseWorkshopShortcut(body: any) {
  const recurrenceEnabled = body?.recurrenceEnabled === true
  const returnMonths = optionalPositiveInteger(body?.returnMonths, 'Intervalo de meses', 240)
  const returnKilometers = optionalPositiveInteger(body?.returnKilometers, 'Intervalo de kilometros', 1_000_000)
  if (recurrenceEnabled && returnMonths === null && returnKilometers === null) throw new WorkshopJobError('Indicá meses y/o kilómetros para activar el seguimiento')
  return {
    name: text(body?.name, 'nombre del servicio', 60),
    description: text(body?.description, 'descripcion', 300),
    quantity: quantity(body?.quantity),
    recurrenceEnabled,
    returnMonths,
    returnKilometers,
    customerInstructions: optionalText(body?.customerInstructions, 1000)
  }
}
export function parseWorkshopJob(body: any) {
  const date = String(body?.date || '')
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new WorkshopJobError('Fecha invalida')
  const mileage = Number(body?.mileage)
  if (body?.mileage === '' || body?.mileage == null || !Number.isInteger(mileage) || mileage < 0 || mileage > 10000000) throw new WorkshopJobError('Kilometraje invalido')
  if (!Array.isArray(body?.lines) || !body.lines.length || body.lines.length > 100) throw new WorkshopJobError('Agrega al menos una tarea (maximo 100)')
  const lines = body.lines.map((line: any) => ({
    ...(line?.serviceId ? {
      serviceId: text(line.serviceId, 'servicio', 100),
      ...(optionalDate(line.nextDueDate) ? { nextDueDate: optionalDate(line.nextDueDate) } : {}),
      ...(line.nextDueMileage == null || line.nextDueMileage === '' ? {} : { nextDueMileage: optionalPositiveInteger(line.nextDueMileage, 'Kilometraje de próximo control', 20_000_000) }),
      ...('returnMonths' in line ? { returnMonths: optionalPositiveInteger(line.returnMonths, 'Intervalo de meses', 240) } : {}),
      ...('returnKilometers' in line ? { returnKilometers: optionalPositiveInteger(line.returnKilometers, 'Intervalo de kilometros', 1_000_000) } : {})
    } : {}),
    description: text(line?.description, 'descripcion de tarea', 300),
    quantity: quantity(line?.quantity),
    partsCents: money(line?.parts),
    laborCents: money(line?.labor)
  }))
  const linkedServiceIds = lines.flatMap((line: any) => line.serviceId ? [line.serviceId] : [])
  if (new Set(linkedServiceIds).size !== linkedServiceIds.length) throw new WorkshopJobError('Cada servicio puede agregarse una sola vez por trabajo')
  const totalCents = lines.reduce((total: number, line: any) => total + line.quantity * ((line.partsCents ?? 0) + (line.laborCents ?? 0)), 0)
  if (!Number.isSafeInteger(totalCents) || totalCents > 2000000000) throw new WorkshopJobError('El total supera el limite permitido')
  const notes = String(body?.notes || '').trim()
  if (notes.length > 4000) throw new WorkshopJobError('Observaciones demasiado extensas')
  return {vehicleId:text(body?.vehicleId,'vehiculo'),date,mileage,performerId:text(body?.performerId,'responsable',100),notes,lines,totalCents}
}
