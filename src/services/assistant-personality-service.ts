import { prisma } from '../config/prisma.js'

export const ASSISTANT_PERSONALITY_PRESETS = [
  'warm',
  'elegant',
  'relaxed',
  'direct',
  'neutral'
] as const

export const ASSISTANT_TREATMENTS = ['vos', 'tu', 'usted'] as const
export const ASSISTANT_EMOJI_LEVELS = ['none', 'low', 'moderate', 'frequent'] as const
export const ASSISTANT_RESPONSE_LENGTHS = ['short', 'normal', 'detailed'] as const

export type AssistantPersonality = {
  preset: (typeof ASSISTANT_PERSONALITY_PRESETS)[number]
  name: string
  role: string
  treatment: (typeof ASSISTANT_TREATMENTS)[number]
  emojiLevel: (typeof ASSISTANT_EMOJI_LEVELS)[number]
  responseLength: (typeof ASSISTANT_RESPONSE_LENGTHS)[number]
  preferredEmojis: string[]
  customInstructions: string
}

export const DEFAULT_ASSISTANT_PERSONALITY: AssistantPersonality = {
  preset: 'warm',
  name: 'Cami',
  role: 'recepcionista virtual',
  treatment: 'vos',
  emojiLevel: 'moderate',
  responseLength: 'short',
  preferredEmojis: ['😊', '✨'],
  customInstructions: ''
}

const PRESET_DEFAULTS: Record<
  AssistantPersonality['preset'],
  Pick<AssistantPersonality, 'role' | 'treatment' | 'emojiLevel' | 'responseLength' | 'preferredEmojis'>
> = {
  warm: {
    role: 'recepcionista virtual',
    treatment: 'vos',
    emojiLevel: 'moderate',
    responseLength: 'short',
    preferredEmojis: ['😊', '✨']
  },
  elegant: {
    role: 'asistente personal',
    treatment: 'usted',
    emojiLevel: 'low',
    responseLength: 'normal',
    preferredEmojis: ['✨']
  },
  relaxed: {
    role: 'asistente del local',
    treatment: 'vos',
    emojiLevel: 'frequent',
    responseLength: 'short',
    preferredEmojis: ['😊', '🙌', '✨']
  },
  direct: {
    role: 'asistente de reservas',
    treatment: 'vos',
    emojiLevel: 'none',
    responseLength: 'short',
    preferredEmojis: []
  },
  neutral: {
    role: 'asistente virtual',
    treatment: 'tu',
    emojiLevel: 'low',
    responseLength: 'normal',
    preferredEmojis: ['😊']
  }
}

export async function getBusinessAssistantPersonality(businessId: string) {
  const settings = await prisma.businessFeatureSettings.findUnique({
    where: { businessId },
    select: { assistantPersonality: true }
  })
  return normalizeAssistantPersonality(settings?.assistantPersonality)
}

export function normalizeAssistantPersonality(value: unknown): AssistantPersonality {
  const source = isRecord(value) ? value : {}
  const preset = readEnum(
    source.preset,
    ASSISTANT_PERSONALITY_PRESETS,
    DEFAULT_ASSISTANT_PERSONALITY.preset
  )
  const defaults = PRESET_DEFAULTS[preset]

  return {
    preset,
    name: cleanText(source.name, DEFAULT_ASSISTANT_PERSONALITY.name, 40),
    role: cleanText(source.role, defaults.role, 80),
    treatment: readEnum(source.treatment, ASSISTANT_TREATMENTS, defaults.treatment),
    emojiLevel: readEnum(source.emojiLevel, ASSISTANT_EMOJI_LEVELS, defaults.emojiLevel),
    responseLength: readEnum(
      source.responseLength,
      ASSISTANT_RESPONSE_LENGTHS,
      defaults.responseLength
    ),
    preferredEmojis: readEmojis(source.preferredEmojis, defaults.preferredEmojis),
    customInstructions: cleanText(source.customInstructions, '', 500)
  }
}

export function personalityForPreset(
  preset: AssistantPersonality['preset'],
  currentName = DEFAULT_ASSISTANT_PERSONALITY.name
): AssistantPersonality {
  return normalizeAssistantPersonality({
    preset,
    name: currentName,
    ...PRESET_DEFAULTS[preset]
  })
}

export function buildAssistantPersonalityInstructions(profile: AssistantPersonality) {
  const emojiInstruction = {
    none: 'No uses emojis.',
    low: 'Usa emojis solo excepcionalmente.',
    moderate: `Usa emojis con moderacion. Preferidos: ${profile.preferredEmojis.join(' ') || 'ninguno'}.`,
    frequent: `Podes usar emojis con frecuencia sin saturar. Preferidos: ${profile.preferredEmojis.join(' ') || 'ninguno'}.`
  }[profile.emojiLevel]

  const lengthInstruction = {
    short: 'Responde de forma breve y apta para WhatsApp.',
    normal: 'Responde con una extension normal, clara y natural.',
    detailed: 'Podes dar algo mas de contexto, sin repetir informacion.'
  }[profile.responseLength]

  return [
    `Tu nombre es ${profile.name}.`,
    `Tu rol es ${profile.role}.`,
    `Usa tratamiento de ${profile.treatment}.`,
    `Preset de tono: ${profile.preset}.`,
    emojiInstruction,
    lengthInstruction,
    profile.customInstructions
      ? `Preferencias adicionales de estilo: ${profile.customInstructions}`
      : ''
  ].filter(Boolean).join('\n')
}

export function assistantPersonalityPreview(profile: AssistantPersonality) {
  const emoji = profile.emojiLevel === 'none'
    ? ''
    : ` ${profile.preferredEmojis[0] ?? '😊'}`
  const greeting = profile.treatment === 'usted'
    ? `Hola, soy ${profile.name}, su ${profile.role}.${emoji}`
    : `¡Hola! Soy ${profile.name}, tu ${profile.role}.${emoji}`
  const followUp = profile.treatment === 'usted'
    ? '¿En qué puedo ayudarle?'
    : profile.treatment === 'tu'
      ? '¿En qué puedo ayudarte?'
      : '¿En qué te puedo ayudar?'
  return `${greeting}\n\n${followUp}`
}

export function applyAssistantPersonalityToReply(
  reply: string,
  profile: AssistantPersonality
) {
  let styled = reply.replace(/\bCami\b/g, profile.name)

  if (profile.treatment === 'tu') {
    styled = replaceTerms(styled, [
      ['querés', 'quieres'],
      ['podés', 'puedes'],
      ['preferís', 'prefieres'],
      ['confirmás', 'confirmas'],
      ['decís', 'dices'],
      ['tenés', 'tienes']
    ])
  }

  if (profile.treatment === 'usted') {
    styled = replaceTerms(styled, [
      ['¿Querés', '¿Quiere'],
      ['querés', 'quiere'],
      ['Podés', 'Puede'],
      ['podés', 'puede'],
      ['preferís', 'prefiere'],
      ['¿Confirmás', '¿Confirma'],
      ['confirmás', 'confirma'],
      ['¿Me decís', '¿Me dice'],
      ['te gustaría', 'le gustaría'],
      ['te queda', 'le queda'],
      ['atenderte', 'atenderse'],
      ['te puedo ayudar', 'puedo ayudarle'],
      ['puedo ayudarte', 'puedo ayudarle']
    ])
  }

  if (profile.emojiLevel === 'none') {
    styled = styled
      .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/ {2,}/g, ' ')
      .trim()
  }

  return styled
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') return fallback
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned ? cleaned.slice(0, maxLength) : fallback
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  return typeof value === 'string' && allowed.includes(value)
    ? value as T[number]
    : fallback
}

function readEmojis(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback]
  const emojis = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 12))
    .filter(Boolean)
    .slice(0, 6)
  return emojis.length ? emojis : [...fallback]
}

function replaceTerms(value: string, replacements: Array<[string, string]>) {
  return replacements.reduce(
    (result, [source, replacement]) => result.replaceAll(source, replacement),
    value
  )
}
