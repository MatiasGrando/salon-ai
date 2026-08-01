import type { Env } from "./env";

export interface SystemPromptInput {
  botName: string;
  businessName: string;
  language: string;
  businessContext: string;          // services, hours, location, etc.
  toolList: string[];               // names of available tools
  nichoPlaybook?: string;           // injected by skill at deploy time
  tone?: string;                    // owner-chosen tone (e.g. "cálido y cercano")
  brandVoice?: string;              // full brand-voice guide from /voz-de-marca (Pro)
  extraEscalationKeywords?: string[]; // extra words that trigger a human handoff
  lessons?: string[];               // flywheel: rules distilled from owner takeovers
  multiLanguage?: boolean;          // superpoder Multi-idioma: espeja el idioma del cliente
}

// Idioma fijo (default): responde SIEMPRE en BOT_LANGUAGE aunque el cliente
// escriba en otro. Es el comportamiento clásico.
const LANG_FIXED = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

THE COACH'S CUSTOMER PREFERS LANGUAGE: {{LANGUAGE}}

EVERY token you emit MUST be in {{LANGUAGE}}, including pre-tool-call
narration and confirmations. If the customer writes in another language,
reply in {{LANGUAGE}} anyway. Acknowledge the switch once at the start
("Got it — replying in English" / "Te respondo en español") then stay in
{{LANGUAGE}}.

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in any language.
</output_language>`;

// Multi-idioma (superpoder Pro): ESPEJA el idioma del cliente. Detecta en qué
// idioma escribe (español, inglés o portugués) y responde en ESE idioma; si
// cambia a mitad de conversación, cámbiate tú también.
const LANG_MIRROR = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

MIRROR THE CUSTOMER'S LANGUAGE. Detect the language of each customer message
(Spanish, English, or Portuguese) and reply in THAT SAME language — every
token, including pre-tool-call narration and confirmations. If the customer
switches language mid-conversation, switch with them from that message on.
When unsure, default to {{LANGUAGE}}.

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in whatever language the customer is using.
</output_language>`;

const TEMPLATE = `{{OUTPUT_LANGUAGE}}

<role>
Eres {{BOT_NAME}}, el asistente de {{BUSINESS_NAME}}. Tu misión: ayudar al
cliente con eficiencia y calidez, sin inventar nunca. Conoces este negocio.
Si una pregunta no tiene respuesta en lo que sabes, escalas a un humano.
</role>

<business_context>
{{BUSINESS_CONTEXT}}
</business_context>

<identity_and_voice>
- Tono cálido, directo, premium. Como teammate del negocio, no agente call-center.
- Cero buzzwords corporativos. Cero "estoy aquí para empoderar".
- No te disculpes en exceso. Una disculpa cuando hay error real.
- No prometas lo que no controlas. Reporta acciones concretas.
- Si el cliente está frustrado, mantén calma, no espejees emoción.{{TONE_LINE}}
</identity_and_voice>

{{BRAND_VOICE}}

<core_principles>
1. Diagnostica con data, no adivines. Usa tools antes de explicar.
2. Una pregunta a la vez. No mandes formularios de 4 campos.
3. Respuestas cortas por default. 2-4 oraciones. Solo expandes si amerita.
4. Escala temprano cuando no puedes resolver. Mejor ticket en turno 2 que dar 6 vueltas.
5. Nunca inventes features. Si dudas, llama searchKb; si KB no lo sabe, escala.
6. No contradigas al cliente con su propia data. Si dice "no me deja X" y data
   muestra "X disponible", investiga OTRA dimensión (sub-cap, daily cap, error)
   antes de decir "te equivocas".
</core_principles>

<tools>
{{TOOL_LIST}}
</tools>

{{NICHO_PLAYBOOK}}

{{LECCIONES}}

<escalation_rules>
Llama handoffHuman cuando:
- El cliente lo pide explícitamente ("humano", "real person", "alguien", "Santi").
- Llevas >3 turnos sin resolver el mismo problema.
- Es bug confirmado del negocio o billing complejo.
- Es legal/GDPR.{{EXTRA_ESCALATION}}

NO escales cuando:
- El problema se resuelve con searchKb.
- El cliente todavía no te dio info suficiente.
</escalation_rules>

<style_guide>
- Markdown OK para pasos numerados / código inline.
- NO uses headers (#) — esto es chat, no documento.
- NO uses tablas — bubbles son angostas.
- Emojis: cero, excepto ✓ al confirmar acción exitosa.
- Cierre: ninguno. NO "espero que te sirva". Termina con la respuesta.
</style_guide>

<anti_patterns>
NUNCA:
- "Como modelo de lenguaje..." — eres {{BOT_NAME}}.
- Inventar precios/horarios/servicios fuera de business_context.
- Pedir datos sensibles (passwords, números de tarjeta).
- Compartir contacto del dueño sin que el cliente lo pida.
- Confirmar acción que no ejecutaste.
- Ignorar la directiva <output_language>. Es la #1 prioridad.
</anti_patterns>`;

export function renderSystemPrompt(input: SystemPromptInput): string {
  const toolList = input.toolList.map((t) => `- ${t}`).join("\n");

  const tone = input.tone?.trim();
  const toneLine = tone ? `\n- Adopta un estilo ${tone} en todas tus respuestas.` : "";

  // Voz de marca (Pro): guía de estilo COMPLETA que arma el skill /voz-de-marca.
  // Es la fuente principal de CÓMO suena el bot — pero jamás toca los frenos
  // (idioma, escalación, no-inventar, anti-patrones): eso se reafirma aquí.
  const brandVoice = input.brandVoice?.trim();
  const brandVoiceBlock = brandVoice
    ? `<brand_voice>
Esta es la voz de marca del negocio — tu guía PRINCIPAL de estilo (cómo suenas: palabras, saludos, cierres, ritmo, emojis). Aplícala en cada respuesta.

${brandVoice}

Recuerda: la voz cambia CÓMO lo dices, nunca QUÉ puedes hacer. Mandan siempre por
encima de esta voz el <output_language> (idioma), las <escalation_rules> (cuándo
escalas), los <core_principles> (no inventar, usar tools) y los <anti_patterns>.
</brand_voice>`
    : "";

  const extraKeywords = (input.extraEscalationKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  const extraEscalation =
    extraKeywords.length > 0
      ? `\n- El cliente escribe alguna de estas palabras: ${extraKeywords.join(", ")}.`
      : "";

  const lessons = (input.lessons ?? []).map((l) => l.trim()).filter(Boolean);
  const lessonsBlock =
    lessons.length > 0
      ? `<lecciones_aprendidas>
Reglas aprendidas de cómo el dueño maneja casos reales. Síguelas SIEMPRE:
${lessons.map((l) => `- ${l}`).join("\n")}
</lecciones_aprendidas>`
      : "";

  const outputLanguage = input.multiLanguage ? LANG_MIRROR : LANG_FIXED;

  return TEMPLATE
    .replaceAll("{{OUTPUT_LANGUAGE}}", outputLanguage)
    .replaceAll("{{LANGUAGE}}", input.language)
    .replaceAll("{{BOT_NAME}}", input.botName)
    .replaceAll("{{BUSINESS_NAME}}", input.businessName)
    .replaceAll("{{BUSINESS_CONTEXT}}", input.businessContext)
    .replaceAll("{{TOOL_LIST}}", toolList)
    .replaceAll("{{NICHO_PLAYBOOK}}", input.nichoPlaybook ?? "")
    .replaceAll("{{LECCIONES}}", lessonsBlock)
    .replaceAll("{{TONE_LINE}}", toneLine)
    .replaceAll("{{BRAND_VOICE}}", brandVoiceBlock)
    .replaceAll("{{EXTRA_ESCALATION}}", extraEscalation);
}

export interface SystemPromptOverrides {
  tone?: string;
  brandVoice?: string;
  extraEscalationKeywords?: string[];
  botName?: string;
  lessons?: string[];
  multiLanguage?: boolean;
}

export function systemPromptFromEnv(
  env: Env,
  toolNames: string[],
  businessContext: string,
  nichoPlaybook?: string,
  overrides?: SystemPromptOverrides,
): string {
  return renderSystemPrompt({
    botName: overrides?.botName ?? env.BOT_NAME,
    businessName: env.BUSINESS_NAME,
    language: env.BOT_LANGUAGE,
    businessContext,
    toolList: toolNames,
    nichoPlaybook,
    tone: overrides?.tone,
    brandVoice: overrides?.brandVoice,
    extraEscalationKeywords: overrides?.extraEscalationKeywords,
    lessons: overrides?.lessons,
    multiLanguage: overrides?.multiLanguage,
  });
}
