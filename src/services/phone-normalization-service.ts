const DEFAULT_ARGENTINA_AREA_CODE = cleanAreaCode(process.env.DEFAULT_ARGENTINA_AREA_CODE) || '11'

type NormalizePhoneOptions = {
  defaultAreaCode?: string | null | undefined
}

export type NormalizedPhoneResult =
  | {
      ok: true
      phone: string
      display: string
      local: string
    }
  | {
      ok: false
      message: string
    }

export function normalizePhone(value?: string | null, options: NormalizePhoneOptions = {}) {
  const normalized = normalizeArgentineMobilePhone(value, options)
  return normalized.ok ? normalized.phone : String(value || '').replace(/\D/g, '')
}

export function normalizeArgentineMobilePhone(value?: string | null, options: NormalizePhoneOptions = {}): NormalizedPhoneResult {
  const rawDigits = String(value || '').replace(/\D/g, '')
  if (!rawDigits) return { ok: false, message: 'Ingresa tu numero de telefono' }

  let digits = rawDigits

  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('54')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.startsWith('9')) digits = digits.slice(1)

  const withoutDomesticMobilePrefix = stripDomesticMobilePrefix(digits)
  const defaultAreaCode = cleanAreaCode(options.defaultAreaCode) || DEFAULT_ARGENTINA_AREA_CODE
  const national = withoutDomesticMobilePrefix.length >= 6 && withoutDomesticMobilePrefix.length <= 8
    ? `${defaultAreaCode}${withoutDomesticMobilePrefix}`
    : withoutDomesticMobilePrefix

  if (national.length !== 10) {
    return {
      ok: false,
      message: 'Ingresa un telefono argentino valido'
    }
  }

  const canonical = `549${national}`
  return {
    ok: true,
    phone: canonical,
    display: formatArgentineMobilePhone(canonical),
    local: formatArgentineMobileLocal(national)
  }
}

export function phoneSearchVariants(value?: string | null, options: NormalizePhoneOptions = {}) {
  const normalized = normalizeArgentineMobilePhone(value, options)
  const digits = String(value || '').replace(/\D/g, '')
  const variants = new Set<string>()
  if (digits) variants.add(digits)
  if (normalized.ok) {
    const national = normalized.phone.slice(3)
    const areaAndDomesticMobile = `${national.slice(0, -8)}15${normalized.phone.slice(-8)}`
    variants.add(normalized.phone)
    variants.add(`54${national}`)
    variants.add(national)
    variants.add(`15${normalized.phone.slice(-8)}`)
    variants.add(areaAndDomesticMobile)
    variants.add(`0${areaAndDomesticMobile}`)
    variants.add(`0${national}`)
  }
  return [...variants].filter(Boolean)
}

export function formatArgentineMobileInput(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  const limited = digits.slice(0, 11)
  if (!limited) return ''

  const areaAndNumber = limited.startsWith('9') ? limited.slice(1) : limited
  const areaLength = inferAreaCodeLength(areaAndNumber)
  const area = areaAndNumber.slice(0, areaLength)
  const local = areaAndNumber.slice(areaLength)
  const firstLength = local.length >= 8 ? 4 : local.length >= 7 ? 3 : 2
  const first = local.slice(0, firstLength)
  const second = local.slice(first.length, first.length + 4)

  return [
    limited.startsWith('9') ? '9 ' : '',
    area,
    first ? `${area ? '-' : ''}${first}` : '',
    second ? `-${second}` : ''
  ].join('')
}

export function formatArgentineMobilePhone(value: string) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits.startsWith('549') ? `+54 ${formatArgentineMobileInput(digits.slice(2))}` : value
}

function formatArgentineMobileLocal(national: string) {
  return formatArgentineMobileInput(`9${national}`)
}

function stripDomesticMobilePrefix(digits: string) {
  if (digits.length === 12 && digits.startsWith('9')) return digits.slice(1)
  for (const areaLength of [2, 3, 4]) {
    const candidate = `${digits.slice(0, areaLength)}${digits.slice(areaLength + 2)}`
    if (digits.slice(areaLength, areaLength + 2) === '15' && candidate.length === 10) return candidate
  }
  if (digits.startsWith('15') && digits.length >= 8 && digits.length <= 10) return digits.slice(2)
  if (digits.length === 11 && digits.slice(2, 4) === '15') return `${digits.slice(0, 2)}${digits.slice(4)}`
  return digits
}

export function inferDefaultAreaCodeFromPhone(value?: string | null) {
  const normalized = normalizeArgentineMobilePhone(value)
  if (!normalized.ok) return DEFAULT_ARGENTINA_AREA_CODE
  const national = normalized.phone.slice(3)
  return national.slice(0, inferAreaCodeLength(national))
}

function inferAreaCodeLength(nationalDigits: string) {
  if (nationalDigits.startsWith('11')) return 2
  const firstFour = nationalDigits.slice(0, 4)
  if (COMMON_FOUR_DIGIT_AREA_CODES.has(firstFour)) return 4
  return 3
}

function cleanAreaCode(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 2 && digits.length <= 4 ? digits : ''
}

const COMMON_FOUR_DIGIT_AREA_CODES = new Set([
  '2202', '2221', '2223', '2224', '2225', '2226', '2227', '2229',
  '2241', '2242', '2243', '2244', '2245', '2246', '2252', '2254',
  '2255', '2257', '2261', '2262', '2264', '2265', '2266', '2267',
  '2268', '2271', '2272', '2273', '2274', '2281', '2283', '2284',
  '2285', '2286', '2291', '2292', '2296', '2297', '2302', '2314',
  '2316', '2317', '2320', '2323', '2324', '2325', '2326', '2331',
  '2333', '2334', '2335', '2336', '2337', '2338', '2342', '2343',
  '2344', '2345', '2346', '2352', '2353', '2354', '2355', '2356',
  '2357', '2358', '2362', '2377', '2392', '2393', '2394', '2395',
  '2396', '2473', '2474', '2475', '2477', '2478', '2622', '2624',
  '2625', '2626', '2646', '2647', '2648', '2651', '2655', '2656',
  '2657', '2658', '2901', '2902', '2903', '2920', '2921', '2922',
  '2923', '2924', '2925', '2926', '2927', '2928', '2929', '2931',
  '2932', '2933', '2934', '2935', '2936', '2940', '2942', '2945',
  '2946', '2948', '2952', '2953', '2954', '2962', '2963', '2964',
  '2966', '2972', '2982', '2983', '3327', '3329', '3382', '3385',
  '3387', '3388', '3400', '3401', '3402', '3404', '3405', '3406',
  '3407', '3408', '3409', '3460', '3462', '3463', '3464', '3465',
  '3466', '3467', '3468', '3469', '3471', '3472', '3476', '3482',
  '3483', '3487', '3489', '3491', '3492', '3493', '3496', '3497',
  '3498', '3521', '3522', '3524', '3525', '3532', '3533', '3537',
  '3541', '3542', '3543', '3544', '3546', '3547', '3548', '3549',
  '3562', '3563', '3564', '3571', '3572', '3573', '3574', '3575',
  '3576', '3582', '3583', '3584', '3585', '3711', '3715', '3716',
  '3718', '3721', '3725', '3731', '3734', '3735', '3741', '3743',
  '3751', '3754', '3755', '3756', '3757', '3758', '3772', '3773',
  '3774', '3775', '3777', '3781', '3782', '3786', '3821', '3825',
  '3826', '3827', '3832', '3835', '3837', '3838', '3841', '3843',
  '3844', '3845', '3846', '3854', '3855', '3856', '3857', '3858',
  '3861', '3862', '3863', '3865', '3867', '3868', '3869', '3885',
  '3886', '3887', '3888', '3891', '3892', '3894'
])
