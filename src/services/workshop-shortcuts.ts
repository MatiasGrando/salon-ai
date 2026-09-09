import { createHash } from 'node:crypto'

const names = ['Cambio de aceite', 'Filtro de aceite', 'Filtro de aire', 'Filtro de habitáculo', 'Filtro de combustible', 'Engrase', 'Correa de distribución']
export function workshopDefaultShortcuts(businessId: string) {
  return names.map((name, position) => ({
    id: 'wjd_' + createHash('sha256').update(businessId + ':' + position).digest('hex'),
    businessId, name, description: name, quantity: 1, position, active: true
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
