declare const customerText: unique symbol
/** Original customer message, query or quote; never an identifier or public catalog label. */
export type CustomerText = string & { readonly [customerText]: true }

/** Validates original length and formatting without rewriting any customer bytes. */
export function isCustomerText(value: unknown, maximum: number): value is CustomerText {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
}
