import { createHash } from 'node:crypto'

const defaults = [
  { name: 'Cambio de aceite', recurrenceEnabled: true, returnMonths: 6, returnKilometers: 10_000, customerInstructions: 'Intervalo orientativo: verificar el manual y las condiciones de uso del vehículo.' },
  { name: 'Filtro de aceite', recurrenceEnabled: true, returnMonths: 6, returnKilometers: 10_000, customerInstructions: 'Intervalo orientativo: verificar el manual y las condiciones de uso del vehículo.' },
  { name: 'Filtro de aire' },
  { name: 'Filtro de habitáculo' },
  { name: 'Filtro de combustible' },
  { name: 'Engrase' },
  { name: 'Correa de distribución' },
  { name: 'Líquido refrigerante' }
]
export function workshopDefaultShortcuts(businessId: string) {
  return defaults.map((item, position) => ({
    id: 'wjd_' + createHash('sha256').update(businessId + ':' + position).digest('hex'),
    businessId,
    name: item.name,
    description: item.name,
    quantity: 1,
    position,
    active: true,
    recurrenceEnabled: item.recurrenceEnabled ?? false,
    returnMonths: item.returnMonths ?? null,
    returnKilometers: item.returnKilometers ?? null,
    customerInstructions: item.customerInstructions ?? ''
  }))
}
export function isWorkshopDefaultShortcut(businessId: string, id: string) {
  return workshopDefaultShortcuts(businessId).some(x => x.id === id)
}
export function mergeWorkshopShortcuts(businessId: string, saved: any[]) {
  const entries = new Map(workshopDefaultShortcuts(businessId).map(x => [x.id, x]))
  for (const entry of saved) entries.set(entry.id, entry)
  return [...entries.values()].sort((a,b) => a.position-b.position || a.name.localeCompare(b.name))
}
