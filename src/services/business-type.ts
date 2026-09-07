export type BusinessType = 'SALON' | 'WORKSHOP'

// Omitted values preserve the existing salon behavior for older clients.
export function parseBusinessType(value: unknown): BusinessType | null {
  if (value === undefined) return 'SALON'
  return value === 'SALON' || value === 'WORKSHOP' ? value : null
}
