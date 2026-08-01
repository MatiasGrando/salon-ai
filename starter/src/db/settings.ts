import { Db } from "./client";

// Canonical setting keys. Every value is stored as TEXT; the loader parses.
// Empty/absent => default (see settings-loader.ts).
export const SETTING_KEYS = {
  systemPromptOverride: "system_prompt_override",
  businessContext: "business_context",
  botName: "bot_name",
  tone: "tone", // línea corta de estilo (las 3 tarjetas del panel: cálido/formal/divertido)
  brandVoice: "brand_voice", // guía de voz COMPLETA que arma el skill /voz-de-marca (Pro): retrato, muletillas, así-sí/así-no, situaciones. Se inyecta como bloque <brand_voice>.
  bufferSeconds: "buffer_seconds",
  maxChunks: "max_chunks",
  interChunkDelayMs: "inter_chunk_delay_ms",
  escalationKeywords: "escalation_keywords",
  modelOverride: "model_override", // auto | haiku | sonnet
  botPaused: "bot_paused", // 0 | 1
  takeoverMinutes: "takeover_minutes", // human-in-the-loop: minutos que el bot se queda callado tras tu intervención (0 = hasta que reanudes). Vacío = 60.
  disabledTools: "disabled_tools", // comma-separated tool names turned off from the dashboard
  temperature: "temperature", // LLM sampling temperature 0-1; empty = provider default
  monthlyBudget: "monthly_budget", // USD cap for monthly AI spend; empty = no cap
  learnedLessons: "learned_lessons", // JSON array of rules distilled from owner takeovers
  twilioHandoffContentSid: "twilio_handoff_content_sid", // HSM del aviso de handoff (fallback del secret)
  autonomyLevel: "autonomy_level", // flywheel: manual (default) | copilot (auto-aplica lo seguro de noche)
  // BYO-LLM (dashboard "Modelo de IA"): the owner plugs their own provider,
  // API key and/or concrete model. Empty = the instance's env defaults.
  llmProvider: "llm_provider", // "" (auto) | anthropic | openai
  llmApiKey: "llm_api_key", // owner's API key; empty = use the env key
  llmModel: "llm_model", // concrete model id; empty = auto tiers (fast⇄smart)
  // Blindaje anti-invento (verificador pre-envío, Pro): contadores para el panel.
  blindajeChecks: "blindaje_checks", // respuestas verificadas contra la KB
  blindajeBlocked: "blindaje_blocked", // respuestas reemplazadas por "déjame confirmarlo"
  blindajeEnabled: "blindaje_enabled", // "off" apaga el Blindaje en este bot (default: on si Pro). Sin redeploy.
  // Tier efectivo empujado por el control plane (POST /api/tier al activar
  // Forja+): "pro" | "free". Vacío = manda el BOT_TIER del wrangler.toml.
  tierOverride: "tier_override",
  // Auto-cura del origin: base URL real del worker aprendida de las requests
  // entrantes cuando DASHBOARD_BASE_URL viene vacío del install. Le da un origin
  // al código de cron (que no tiene request). Ver src/lib/self-origin.ts.
  selfOrigin: "self_origin",
  // ── Superpoderes Forja+ (runtime real, gated a Pro) ──────────────────────
  // Multi-idioma: 1 = el bot espeja el idioma del cliente (ES/EN/PT) en vez de
  // forzar BOT_LANGUAGE. Vacío/0 = comportamiento clásico (idioma fijo).
  multiLanguage: "multi_language",
  // Reportes automáticos: 1 = resumen diario al dueño por su canal. Guarda el
  // último envío para no duplicar si el cron de 3am corre dos veces.
  dailyReport: "daily_report",
  dailyReportLastAt: "daily_report_last_at",
  // Reporte diseñado (superpoder Reportes): el skill /reportes los llena a la
  // medida del negocio. format = html (default) | docx | pdf; template = HTML con
  // placeholders {{X}} (custom de Claude); accent = color de marca; logo = URL.
  reportFormat: "report_format",
  reportTemplate: "report_template",
  reportAccent: "report_accent",
  reportLogo: "report_logo",
  reportLastHtml: "report_last_html", // último reporte rico, para servir /admin/report
  // Encuestas de satisfacción: 1 = tras una conversación resuelta, pide rating
  // 1-5 y alerta al dueño si es bajo.
  satisfactionSurvey: "satisfaction_survey",
  // Modo de la encuesta: numerico (default, rating 1-5) | abierto (opinión de
  // texto libre) | ambos (rating + comentario). Lo elige el dueño al activarla.
  surveyMode: "survey_mode",
  // Recupera no-shows / leads fríos: 1 = re-engancha leads calientes que se
  // enfriaron por días (segundo toque, ventana 2-7 días).
  reengageColdLeads: "reengage_cold_leads",
  // Cazador de ventas: default ON (ausente/"1"). "0" apaga el follow-up
  // automático (3-20h) sin bajar de tier. Ver src/followup/run.ts.
  salesHunter: "sales_hunter",
  // Plantilla HSM aprobada para reenganchar FUERA de la ventana de 24h. Dos vías
  // según el método de WhatsApp del miembro (la plantilla debe tener {{1}} =
  // nombre del cliente):
  //  • Twilio (BSP): el Content SID (HX…).
  //  • Cloud API oficial (Meta): nombre + idioma de la plantilla de Meta.
  // Vacío = fuera de ventana no reengancha (dentro de ventana y en Telegram sí).
  reengageTemplateSid: "reengage_template_sid",
  reengageTemplateName: "reengage_template_name", // Cloud API: nombre de la plantilla de Meta
  reengageTemplateLang: "reengage_template_lang", // Cloud API: idioma (es, es_MX, en_US…); default es
  // Pide reseñas: 1 = tras resolución positiva invita a dejar reseña. Requiere
  // review_url (el link de Google del negocio) para activarse de verdad.
  reviewRequests: "review_requests",
  reviewUrl: "review_url",
  // Cobros por WhatsApp: 1 = habilita la tool de cobro. Requiere el secret
  // STRIPE_SECRET_KEY para funcionar (sin él, la tool avisa "sin conectar").
  paymentsEnabled: "payments_enabled",
  // Config por-tool de Composio (JSON string, toolkit slug -> objeto de config)
  // que el dueño dejó vía el skill /conexiones-composio — ej. a qué base de
  // Airtable, qué calendario de Google Calendar, qué event_type de Cal.com
  // apunta cada app. El adaptador (src/integrations/composio.ts) lo lee y lo
  // inyecta al LLM en el system prompt para que use el recurso correcto sin
  // adivinar.
  composioContext: "composio_context",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.first<SettingRow>(
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.all<SettingRow>(
      "SELECT key, value FROM settings",
    );
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }
}
