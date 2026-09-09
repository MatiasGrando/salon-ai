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
function quantity(value: unknown) {
  const result = Number(value ?? 1)
  if (!Number.isInteger(result) || result < 1 || result > 999) throw new WorkshopJobError('Cantidad invalida')
  return result
}
function money(value: unknown) {
  if (value == null || value === '') return null
  const raw = String(value).trim().replace(',', '.')
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) throw new WorkshopJobError('Importe invalido: usa numeros y hasta dos decimales')
  return Math.round(Number(raw) * 100)
}
export function parseWorkshopShortcut(body: any) {
  return { name: text(body?.name, 'nombre del boton', 60), description: text(body?.description, 'descripcion', 300), quantity: quantity(body?.quantity) }
}
export function parseWorkshopJob(body: any) {
  const date = String(body?.date || '')
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new WorkshopJobError('Fecha invalida')
  const mileage = Number(body?.mileage)
  if (body?.mileage === '' || body?.mileage == null || !Number.isInteger(mileage) || mileage < 0 || mileage > 10000000) throw new WorkshopJobError('Kilometraje invalido')
  if (!Array.isArray(body?.lines) || !body.lines.length || body.lines.length > 100) throw new WorkshopJobError('Agrega al menos una tarea (maximo 100)')
  const lines = body.lines.map((line: any) => ({ description: text(line?.description, 'descripcion de tarea', 300), quantity: quantity(line?.quantity), partsCents: money(line?.parts), laborCents: money(line?.labor) }))
  const totalCents = lines.reduce((total: number, line: any) => total + line.quantity * ((line.partsCents ?? 0) + (line.laborCents ?? 0)), 0)
  if (!Number.isSafeInteger(totalCents) || totalCents > 2000000000) throw new WorkshopJobError('El total supera el limite permitido')
  const notes = String(body?.notes || '').trim()
  if (notes.length > 4000) throw new WorkshopJobError('Observaciones demasiado extensas')
  return {vehicleId:text(body?.vehicleId,'vehiculo'),date,mileage,performerId:text(body?.performerId,'responsable',100),notes,lines,totalCents}
}
