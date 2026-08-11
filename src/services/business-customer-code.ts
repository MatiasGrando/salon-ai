import { randomInt } from 'node:crypto'

const CUSTOMER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CUSTOMER_CODE_LENGTH = 6

export function generateBusinessCustomerCode() {
  let suffix = ''
  for (let index = 0; index < CUSTOMER_CODE_LENGTH; index += 1) {
    suffix += CUSTOMER_CODE_ALPHABET[randomInt(CUSTOMER_CODE_ALPHABET.length)]
  }
  return `WX-${suffix}`
}

export function normalizeBusinessCustomerCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

export function isBusinessCustomerCode(value: string) {
  return /^WX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(normalizeBusinessCustomerCode(value))
}
