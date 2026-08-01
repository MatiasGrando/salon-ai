import type { D1Database, DurableObjectNamespace, R2Bucket, VectorizeIndex, Ai } from "@cloudflare/workers-types";
import type { SupportAgent } from "./agent";

export interface Env {
  // Bindings
  // Typed namespace so we can call the agent's methods via RPC (stub.ingest()).
  AGENT: DurableObjectNamespace<SupportAgent>;
  DB: D1Database;
  KB: VectorizeIndex;
  // R2 = OPCIONAL (solo lead magnets). Ausente en el bot default. Guía: docs/opcional-lead-magnets.md
  CATALOG?: R2Bucket;
  AI: Ai;

  // Vars (member-set)
  BOT_NAME: string;
  PEER_BOTS?: string; // JSON [{name,url}] — otras instancias para el selector de proyectos
  WA_DAILY_TEMPLATE_CAP?: string; // tope diario de plantillas HSM (default 250 — tier 1 de Meta)
  BUSINESS_NAME: string;
  BOT_LANGUAGE: string;
  BOT_TIER: "free" | "pro";
  // Nicho del bot (restaurante, inmobiliaria…). Selecciona el "niche pack" que
  // re-etiqueta el dashboard, aporta el playbook del giro y sus columnas.
  // Ausente/desconocido → pack genérico (comportamiento actual). Ver src/niches/.
  BOT_NICHE?: string;
  /** "on" enciende el chat web público de demo (/demo). APAGADO por defecto. */
  DEMO_MODE?: string;
  // LLM provider for the chat brain: "anthropic" (default) | "openai" | "xai" | "google".
  // If unset and only OPENAI_API_KEY is present, auto-selects "openai".
  // (Voice transcription + embeddings always run on Cloudflare Workers AI.)
  LLM_PROVIDER?: "anthropic" | "openai" | "xai" | "google";
  // Optional per-tier model id overrides (fast = cheap default, smart = upgrade).
  ANTHROPIC_MODEL_FAST?: string;
  ANTHROPIC_MODEL_SMART?: string;
  OPENAI_MODEL_FAST?: string;
  OPENAI_MODEL_SMART?: string;
  GOOGLE_MODEL_FAST?: string;
  GOOGLE_MODEL_SMART?: string;
  BUFFER_SECONDS: string;
  DASHBOARD_BASE_URL: string;

  // Secrets (member-set via wrangler secret put)
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;  // alternative LLM provider (see LLM_PROVIDER)
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  MANYCHAT_API_KEY?: string;
  MANYCHAT_CONTENT_TYPE?: "instagram" | "whatsapp" | "telegram" | "messenger"; // ManyChat channel for sendContent; defaults to "instagram"
  // Tool de soporte de Forja (solo la instancia de Horizontes; inerte sin ambos).
  FORJA_SUPPORT_URL?: string;    // ej. https://horizontes-license-server.….workers.dev
  FORJA_SUPPORT_TOKEN?: string;  // Bearer del lookup /v1/support/license
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WA_FROM?: string;
  TWILIO_HANDOFF_CONTENT_SID?: string;  // approved WhatsApp template for owner handoff DM
  // Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat).
  META_PAGE_ACCESS_TOKEN?: string;  // Messenger / IG ligado a Página (graph.facebook.com)
  INSTAGRAM_ACCESS_TOKEN?: string;  // Instagram API con Instagram Login, token IGAA… (graph.instagram.com)
  META_VERIFY_TOKEN?: string;       // string que tú eliges; valida el handshake GET del webhook
  META_APP_SECRET?: string;
  // "manychat" = los DMs de Instagram entran SOLO por ManyChat (el webhook
  // oficial de Meta los ignora para no procesarlos doble). Comentarios y
  // postbacks del embudo no se ven afectados.
  IG_DM_SOURCE?: string;
  // "off" = el agente-dueño de WhatsApp se pausa: los mensajes del número del
  // dueño entran al flujo normal de clientes (para probar el bot desde su cel).
  OWNER_AGENT?: string;
  /** "on" activa el modo auditoría (dinámica masterclass, instancia Horizontes). */
  AUDIT_MODE?: string;
  // "off" = canal oficial de IG apagado por completo (DMs + embudo de
  // comentarios + postbacks). El bot de IG vive solo en ManyChat.
  IG_OFFICIAL?: string;         // App Secret de Facebook; firma los webhooks de Messenger
  INSTAGRAM_APP_SECRET?: string;    // App Secret del producto Instagram (IG Login); firma los webhooks de IG
  // WhatsApp OFICIAL (Cloud API de Meta, sin BSP/Twilio). Mismo ecosistema Graph
  // que Meta; el número corre en la cuenta del miembro con SU token. El envío es
  // a graph.facebook.com/<phone_number_id>/messages; el media entrante se sirve
  // por el proxy firmado /webhooks/whatsapp/media/:id (Cloud API exige el token
  // para descargarlo, así queda del lado del server).
  WHATSAPP_PHONE_NUMBER_ID?: string;  // el Phone Number ID del número (no el número)
  WHATSAPP_ACCESS_TOKEN?: string;     // token del system user / WABA (Bearer)
  WHATSAPP_VERIFY_TOKEN?: string;     // handshake GET del webhook (si falta, usa META_VERIFY_TOKEN)
  WHATSAPP_APP_SECRET?: string;       // firma X-Hub-Signature-256 (si falta, usa META_APP_SECRET)
  // Embudos de comentarios dinámicos (feature personal): endpoint POST /funnels.
  FUNNEL_API_TOKEN?: string;        // guarda el endpoint /funnels (header X-Funnel-Token)
  SUPADATA_API_KEY?: string;        // transcripción de reels (Supadata) — para el agente-dueño (F3)
  XAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;          // Gemini (BYO-LLM) — ver LLM_PROVIDER="google"

  // ── Modo evento/masterclass (opt-in; enciende tools extra del bot) ────────
  EVENT_NAME?: string;              // "Crear y Dominar Agentes IA con Claude Code"
  EVENT_STARTS_AT?: string;         // ISO con offset, ej. "2026-07-26T13:00:00-06:00"
  EVENT_DURATION_MIN?: string;      // duración en minutos (default 120)
  EVENT_REGISTER_URL?: string;      // landing de registro (activa el modo evento)
  EVENT_SLUG?: string;              // slug del evento en la plataforma (para el registro conversacional)
  EVENT_GROUP_URL?: string;         // grupo de WhatsApp del evento
  EVENT_OFFER_URL?: string;         // página de la oferta/comunidad
  EVENT_RESOURCES_URL?: string;     // materiales del evento (keyword RECURSOS)
  EVENT_KEYWORDS?: string;          // palabras de registro de la campaña (coma-separadas). Vacío = set amplio por default. La keyword varía por historia — nunca se exige coincidencia exacta.
  EVENT_FASTACTION_NOTE?: string;   // línea del bono fast-action (se muestra en la fase EN VIVO)
  REGISTRATION_WEBHOOK_URL?: string;   // endpoint de la plataforma para registro conversacional
  REGISTRATION_WEBHOOK_SECRET?: string; // secret compartido con ese endpoint
  SHOW_TOKEN?: string;              // token del live wall /show (proyección en vivo)             // Grok (xAI) — cerebro del agente-dueño (F2)
  // ── Cal.com (agenda real para los nichos de cita) ────────────────────────
  // Con estas vars, el bot consulta disponibilidad real y reserva en Cal.com.
  // Sin ellas, agendarCita solo registra la cita para que el dueño la confirme.
  CALCOM_API_KEY?: string;                 // secret: API key de Cal.com (cal_...)
  CALCOM_EVENT_TYPE_ID?: string;           // event type por defecto (numérico, como string)
  CALCOM_EVENT_TYPES?: string;             // opcional: JSON {"corte":123,"barba":456} servicio→eventTypeId
  CALCOM_TIMEZONE?: string;                // zona horaria (default America/Mexico_City)
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;  // base64-encoded JSON
  // ── Cobros por WhatsApp (superpoder Pro) ─────────────────────────────────
  // Con la llave secreta de Stripe del miembro, la tool sendPaymentLink crea un
  // link de pago y el webhook /api/stripe/webhook confirma cuando pagan. Sin
  // ella, la tool avisa "cobros sin conectar" (no se inventa un cobro).
  STRIPE_SECRET_KEY?: string;      // secret: sk_live_… / sk_test_… del miembro
  STRIPE_WEBHOOK_SECRET?: string;  // secret: whsec_… para verificar la firma del webhook
  // ── Composio (superpoder Pro): integraciones genéricas por app ───────────
  // Con la API key del proyecto de Composio del miembro, el bot puede usar
  // CUALQUIER app que haya conectado ahí (Google Calendar, Gmail, Slack,
  // Notion, CRMs…) sin código por app — ver src/integrations/composio.ts.
  // Sin ella, la tool "composio" ni se registra (no-op).
  COMPOSIO_API_KEY?: string;    // secret: llave del proyecto de Composio (composio.dev)
  COMPOSIO_ENTITY_ID?: string;  // opcional: filtra las cuentas conectadas por user_id (Composio v3); sin ella se usan TODAS las del proyecto
  OWNER_EMAIL: string;  // for handoff notifications (email)
  OWNER_TELEGRAM_CHAT_ID?: string;  // for handoff notifications (default channel)
  OWNER_WA_NUMBER?: string;  // for Pro handoff WhatsApp DM (requires template)

  // HTTP Basic Auth password for the admin dashboard (secret).
  // Username is always "admin". Set via `wrangler secret put DASHBOARD_PASSWORD`.
  DASHBOARD_PASSWORD: string;

  // "1" = panel admin PÚBLICO (sin Basic Auth). Solo cuando el dueño lo decide
  // explícitamente (var en wrangler.toml); sin la var, el guard queda activo.
  DASHBOARD_PUBLIC?: string;

  // Token guarding POST /kb/reindex (header: X-Reindex-Token). Secret.
  // Set via `wrangler secret put KB_REINDEX_TOKEN`.
  KB_REINDEX_TOKEN: string;

  // Control plane (hosted): glue para que un plano de control externo lea este
  // bot self-hosted vía los endpoints /api/*. Ambos opcionales; sin el token,
  // /api/* queda cerrado (fail-closed).
  CONTROL_PLANE_TOKEN?: string;  // secret; Bearer que el control plane presenta para llamar /api/*
  CONTROL_PLANE_URL?: string;    // base URL del control plane (para reportes / license check futuros)
}
