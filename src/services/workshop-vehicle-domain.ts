export type WorkshopVehicleUsage = 'PARTICULAR' | 'FREQUENT' | 'PROFESSIONAL'

export class WorkshopVehicleValidationError extends Error {}

export const WORKSHOP_DEFAULT_BRAND_NAMES: readonly string[] = [
  'Agrale',
  'Alfa Romeo',
  'Audi',
  'BAIC',
  'BMW',
  'BYD',
  'Changan',
  'Chery',
  'Chevrolet',
  'Chrysler',
  'Citroën',
  'Dacia',
  'Daihatsu',
  'Dodge',
  'DS Automobiles',
  'Fiat',
  'Ford',
  'Geely',
  'Great Wall',
  'Haval',
  'Honda',
  'Hyundai',
  'Isuzu',
  'Iveco',
  'JAC',
  'Jeep',
  'Kia',
  'Land Rover',
  'Lexus',
  'Lifan',
  'Mazda',
  'Mercedes-Benz',
  'Mini',
  'Mitsubishi',
  'Nissan',
  'Peugeot',
  'Porsche',
  'RAM',
  'Renault',
  'Rover',
  'Scania',
  'Seat',
  'Smart',
  'Subaru',
  'Suzuki',
  'Toyota',
  'Volkswagen',
  'Volvo'
]

export function normalizeWorkshopPlate(value: unknown) {
  const plate = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/.test(plate)) {
    throw new WorkshopVehicleValidationError('Ingresa una patente argentina valida')
  }
  return plate
}

export function normalizeWorkshopBrand(value: unknown) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (!name || name.length > 80) throw new WorkshopVehicleValidationError('Ingresa una marca valida')
  return {
    name,
    normalizedName: name.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }
}

export function normalizeWorkshopPlatePrefix(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
}

export function normalizeWorkshopContactPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!/^(?:11|15)\d{8}$/.test(digits)) {
    throw new WorkshopVehicleValidationError('Ingresa el telefono como 11-XXXX-XXXX o 15-XXXX-XXXX')
  }
  const localNumber = digits.slice(2)
  return {
    normalizedPhone: `54911${localNumber}`,
    storedPhone: `11-${localNumber.slice(0, 4)}-${localNumber.slice(4)}`
  }
}

export function parseWorkshopVehicleInput(input: Record<string, unknown>) {
  const currentYear = new Date().getFullYear() + 2
  const year = input.year === '' || input.year == null ? null : parseInteger(input.year)
  const currentMileage = input.currentMileage === '' || input.currentMileage == null
    ? null
    : parseInteger(input.currentMileage)
  const brandId = String(input.brandId || '').trim()
  const model = requiredText(input.model, 'Ingresa el modelo', 100)
  const engine = requiredText(input.engine, 'Ingresa la motorizacion', 100)
  const contactName = requiredText(input.contactName, 'Ingresa el nombre del contacto', 120)
  const contactPhone = requiredText(input.contactPhone, 'Ingresa el telefono del contacto', 40)
  const contactEmail = String(input.contactEmail || '').trim().toLowerCase() || null
  const usage = String(input.usage || '') as WorkshopVehicleUsage

  if (!brandId) throw new WorkshopVehicleValidationError('Selecciona una marca')
  if (year != null && (year < 1886 || year > currentYear)) throw new WorkshopVehicleValidationError('Ingresa un ano valido')
  if (currentMileage != null && currentMileage < 0) throw new WorkshopVehicleValidationError('El kilometraje no puede ser negativo')
  if (!['PARTICULAR', 'FREQUENT', 'PROFESSIONAL'].includes(usage)) {
    throw new WorkshopVehicleValidationError('Selecciona un tipo de uso valido')
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new WorkshopVehicleValidationError('Ingresa un correo electronico valido')
  }

  return {
    plate: normalizeWorkshopPlate(input.plate),
    brandId,
    model,
    year,
    engine,
    currentMileage,
    usage,
    contactName,
    contactPhone,
    contactEmail
  }
}

function requiredText(value: unknown, message: string, maxLength: number) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (!text || text.length > maxLength) throw new WorkshopVehicleValidationError(message)
  return text
}

function parseInteger(value: unknown) {
  const normalized = typeof value === 'string' ? value.replace(/[.,\s]/g, '') : value
  const number = Number(normalized)
  return Number.isSafeInteger(number) ? number : null
}
