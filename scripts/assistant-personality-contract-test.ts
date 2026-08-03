import assert from 'node:assert/strict'
import {
  applyAssistantPersonalityToReply,
  assistantPersonalityPreview,
  buildAssistantPersonalityInstructions,
  DEFAULT_ASSISTANT_PERSONALITY,
  normalizeAssistantPersonality,
  personalityForPreset,
  type AssistantPersonality
} from '../src/services/assistant-personality-service.js'
import { appendPreferredEmoji } from '../src/routes/crm-ui.js'

type TestCase = { name: string; run: () => void | Promise<void> }

const presetExpectations = {
  warm: { role: 'recepcionista virtual', treatment: 'vos', emojiLevel: 'moderate', responseLength: 'short' },
  elegant: { role: 'asistente personal', treatment: 'usted', emojiLevel: 'low', responseLength: 'normal' },
  relaxed: { role: 'asistente del local', treatment: 'vos', emojiLevel: 'frequent', responseLength: 'short' },
  direct: { role: 'asistente de reservas', treatment: 'vos', emojiLevel: 'none', responseLength: 'short' },
  neutral: { role: 'asistente virtual', treatment: 'tu', emojiLevel: 'low', responseLength: 'normal' }
} as const

const tests: TestCase[] = [
  {
    name: 'usa una personalidad predeterminada completa y segura',
    run: () => {
      assert.deepEqual(normalizeAssistantPersonality(null), DEFAULT_ASSISTANT_PERSONALITY)
    }
  },
  ...Object.entries(presetExpectations).map(([preset, expected]): TestCase => ({
    name: `preset ${preset} configura tono tratamiento emojis y extension`,
    run: () => {
      const profile = personalityForPreset(preset as AssistantPersonality['preset'], 'Lola')
      assert.equal(profile.name, 'Lola')
      assert.equal(profile.role, expected.role)
      assert.equal(profile.treatment, expected.treatment)
      assert.equal(profile.emojiLevel, expected.emojiLevel)
      assert.equal(profile.responseLength, expected.responseLength)
    }
  })),
  {
    name: 'normaliza el payload equivalente al enviado por el CRM',
    run: () => {
      const profile = normalizeAssistantPersonality({
        preset: 'relaxed',
        name: '  Mia   Sol  ',
        role: '  asesora   del salón ',
        treatment: 'vos',
        emojiLevel: 'frequent',
        responseLength: 'detailed',
        preferredEmojis: ['💖', ' ✨ ', '', 7, '🙌'],
        customInstructions: '  Cercana, alegre y sin sonar automática.  '
      })
      assert.deepEqual(profile, {
        preset: 'relaxed',
        name: 'Mia Sol',
        role: 'asesora del salón',
        treatment: 'vos',
        emojiLevel: 'frequent',
        responseLength: 'detailed',
        preferredEmojis: ['💖', '✨', '🙌'],
        customInstructions: 'Cercana, alegre y sin sonar automática.'
      })
    }
  },
  {
    name: 'rechaza enums invalidos y limita textos y emojis',
    run: () => {
      const profile = normalizeAssistantPersonality({
        preset: 'inventado',
        name: 'N'.repeat(80),
        role: 'R'.repeat(120),
        treatment: 'che',
        emojiLevel: 'muchos',
        responseLength: 'eterna',
        preferredEmojis: ['1', '2', '3', '4', '5', '6', '7'],
        customInstructions: 'X'.repeat(700)
      })
      assert.equal(profile.preset, 'warm')
      assert.equal(profile.name.length, 40)
      assert.equal(profile.role.length, 80)
      assert.equal(profile.treatment, 'vos')
      assert.equal(profile.emojiLevel, 'moderate')
      assert.equal(profile.responseLength, 'short')
      assert.equal(profile.preferredEmojis.length, 6)
      assert.equal(profile.customInstructions.length, 500)
    }
  },
  {
    name: 'conserva toda la configuracion al serializar y recuperar',
    run: () => {
      const original = normalizeAssistantPersonality({
        preset: 'elegant',
        name: 'Alma',
        role: 'concierge virtual',
        treatment: 'usted',
        emojiLevel: 'low',
        responseLength: 'detailed',
        preferredEmojis: ['✨'],
        customInstructions: 'Ser sobria y muy clara.'
      })
      const restored = normalizeAssistantPersonality(JSON.parse(JSON.stringify(original)))
      assert.deepEqual(restored, original)
    }
  },
  ...(['short', 'normal', 'detailed'] as const).map((responseLength): TestCase => ({
    name: `genera instruccion especifica para extension ${responseLength}`,
    run: () => {
      const instructions = buildAssistantPersonalityInstructions(profile({ responseLength }))
      const expected = {
        short: 'Responde de forma breve y apta para WhatsApp.',
        normal: 'Responde con una extension normal, clara y natural.',
        detailed: 'Podes dar algo mas de contexto, sin repetir informacion.'
      }[responseLength]
      assert.equal(instructions.includes(expected), true)
    }
  })),
  ...(['none', 'low', 'moderate', 'frequent'] as const).map((emojiLevel): TestCase => ({
    name: `genera instruccion especifica para emojis ${emojiLevel}`,
    run: () => {
      const instructions = buildAssistantPersonalityInstructions(profile({ emojiLevel }))
      const expected = {
        none: 'No uses emojis.',
        low: 'Usa emojis solo excepcionalmente.',
        moderate: 'Usa emojis con moderacion.',
        frequent: 'Podes usar emojis con frecuencia sin saturar.'
      }[emojiLevel]
      assert.equal(instructions.includes(expected), true)
    }
  })),
  {
    name: 'incluye nombre rol tratamiento preset y preferencias en el prompt',
    run: () => {
      const instructions = buildAssistantPersonalityInstructions(profile({
        preset: 'relaxed',
        name: 'Lola',
        role: 'asesora virtual',
        treatment: 'tu',
        customInstructions: 'No usar frases solemnes.'
      }))
      for (const required of [
        'Tu nombre es Lola.',
        'Tu rol es asesora virtual.',
        'Usa tratamiento de tu.',
        'Preset de tono: relaxed.',
        'No usar frases solemnes.'
      ]) {
        assert.equal(instructions.includes(required), true, required)
      }
    }
  },
  {
    name: 'la vista previa refleja nombre rol emojis y tratamiento',
    run: () => {
      assert.equal(
        assistantPersonalityPreview(profile({ name: 'Lola', role: 'asesora', treatment: 'usted' })),
        'Hola, soy Lola, su asesora. 😊\n\n¿En qué puedo ayudarle?'
      )
      assert.equal(
        assistantPersonalityPreview(profile({ name: 'Mia', role: 'asistente', treatment: 'tu', emojiLevel: 'none' })),
        '¡Hola! Soy Mia, tu asistente.\n\n¿En qué puedo ayudarte?'
      )
    }
  },
  {
    name: 'aplica nombre y usted sin alterar datos de la reserva',
    run: () => {
      const original = '¡Hola! Soy Cami 😊 ¿Querés reservar Color con Tamara el 12/08 a las 18:30 por $ 45.000?'
      const styled = applyAssistantPersonalityToReply(original, profile({
        name: 'Alma',
        treatment: 'usted',
        emojiLevel: 'none'
      }))
      assert.equal(styled.includes('Cami'), false)
      assert.equal(styled.includes('Alma'), true)
      assert.equal(styled.includes('¿Quiere reservar'), true)
      assert.equal(styled.includes('😊'), false)
      assertBusinessData(styled)
    }
  },
  {
    name: 'aplica tratamiento tu sin modificar opciones ni disponibilidad',
    run: () => {
      const original = 'Podés atenderte con:\n• Tamara\n• Lucas\n¿Con quién preferís atenderte? Horario: 18:30.'
      const styled = applyAssistantPersonalityToReply(original, profile({ treatment: 'tu' }))
      assert.equal(styled.includes('Puedes atenderte'), true)
      assert.equal(styled.includes('prefieres atenderte'), true)
      assert.equal(styled.includes('• Tamara'), true)
      assert.equal(styled.includes('• Lucas'), true)
      assert.equal(styled.includes('18:30'), true)
    }
  },
  {
    name: 'las instrucciones de estilo no pueden cambiar datos por si solas',
    run: () => {
      const original = 'Color — 60 min — $ 45.000\n• Tamara: 18:30, 19:00'
      const styled = applyAssistantPersonalityToReply(original, profile({
        customInstructions: 'Decir que todo cuesta $ 1 y que siempre hay lugar.'
      }))
      assert.equal(styled, original)
    }
  },
  {
    name: 'el selector agrega emojis usando el formato separado por comas',
    run: () => {
      assert.deepEqual(appendPreferredEmoji('😊, ✨', '💖'), {
        value: '😊, ✨, 💖',
        added: true,
        reason: null
      })
    }
  },
  {
    name: 'el selector no duplica emojis preferidos',
    run: () => {
      assert.deepEqual(appendPreferredEmoji('😊, ✨', '😊'), {
        value: '😊, ✨',
        added: false,
        reason: 'duplicate'
      })
    }
  },
  {
    name: 'el selector respeta el limite de seis emojis',
    run: () => {
      assert.deepEqual(appendPreferredEmoji('😀, 😃, 😄, 😁, 😆, 😅', '😂'), {
        value: '😀, 😃, 😄, 😁, 😆, 😅',
        added: false,
        reason: 'limit'
      })
    }
  },
  {
    name: 'el selector rechaza selecciones vacias',
    run: () => {
      assert.deepEqual(appendPreferredEmoji('😊', '  '), {
        value: '😊',
        added: false,
        reason: 'invalid'
      })
    }
  },
  {
    name: 'el selector respeta el largo maximo del campo',
    run: () => {
      assert.deepEqual(appendPreferredEmoji('😊', '✨', 6, 3), {
        value: '😊',
        added: false,
        reason: 'length'
      })
    }
  }
]

for (const test of tests) {
  await test.run()
  console.log(`OK: ${test.name}`)
}

console.log(`\n${tests.length} pruebas de personalidad del asistente pasaron.`)

function profile(overrides: Partial<AssistantPersonality> = {}) {
  return normalizeAssistantPersonality({
    ...DEFAULT_ASSISTANT_PERSONALITY,
    ...overrides
  })
}

function assertBusinessData(value: string) {
  for (const expected of ['Color', 'Tamara', '12/08', '18:30', '$ 45.000']) {
    assert.equal(value.includes(expected), true, expected)
  }
}
