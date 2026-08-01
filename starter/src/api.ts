// Control-plane API — glue so the hosted control plane (app.forjabots.com)
// can poll this self-hosted bot and push its tier. Mounted at /api from
// index.ts. Every route is guarded (fail-closed Bearer via requireControlPlane).
import { Hono } from "hono";
import type { Env } from "./env";
import { channelStatuses } from "./admin/views/conexiones";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { requireControlPlane } from "./http-auth";
import { bustTierCache, effectiveTier } from "./tier";
import { BOT_VERSION } from "./version";
import { composioEnabled, listConnectedTools, getComposioContext } from "./integrations/composio";

export const apiApp = new Hono<{ Bindings: Env }>();

// Fail-closed Bearer guard on the whole sub-app (same pattern as /admin, /funnels).
apiApp.use("*", async (c, next) => {
  if (!requireControlPlane(c.req.raw, c.env)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

// GET /api/health → liveness + identity. Reporta el tier EFECTIVO (override
// del control plane incluido), no el var estático — es la verdad del bot.
apiApp.get("/health", async (c) =>
  c.json({ ok: true, version: BOT_VERSION, tier: await effectiveTier(c.env) }, 200),
);

// GET /api/config → resumen de configuración para el panel de la nube (Fase 1
// del contrato): negocio, nicho, idioma, canales conectados (estado, JAMÁS
// secrets) y pausa. Con esto app.forjabots.com muestra la interfaz completa
// del bot apenas el onboarding termina.
apiApp.get("/config", async (c) => {
  const settings = new SettingsRepo(new Db(c.env.DB));
  const [botNameOverride, paused] = await Promise.all([
    settings.get(SETTING_KEYS.botName),
    settings.get(SETTING_KEYS.botPaused),
  ]);
  const channels = channelStatuses(c.env).map((ch) => ({
    id: ch.id,
    name: ch.name,
    connected: ch.ok,
  }));

  // Composio: solo estado/config para el panel de la nube — NUNCA la API key
  // del miembro ni ningún otro secret (ver src/integrations/composio.ts).
  const composioIsEnabled = composioEnabled(c.env);
  const [composioTools, composioContext] = composioIsEnabled
    ? await Promise.all([listConnectedTools(c.env), getComposioContext(c.env)])
    : [[], {}];
  const composio = {
    enabled: composioIsEnabled,
    toolkits: [...new Set(composioTools.map((t) => t.toolkitSlug))],
    context: composioContext,
  };

  return c.json(
    {
      ok: true,
      business: c.env.BUSINESS_NAME ?? "",
      bot_name: botNameOverride || c.env.BOT_NAME || "",
      niche: c.env.BOT_NICHE || "generico",
      language: c.env.BOT_LANGUAGE || "es",
      channels,
      channels_connected: channels.filter((ch) => ch.connected).length,
      channels_total: channels.length,
      paused: paused === "1",
      version: BOT_VERSION,
      tier: await effectiveTier(c.env),
      composio,
    },
    200,
  );
});

// GET /api/leads?limit=20 → leads recientes para la Bandeja de clientes del
// control plane (Forja+). PRINCIPIO DE PRIVACIDAD: la nube LEE en vivo, no
// almacena. Devolvemos lo justo para la bandeja (nombre, canal, intención,
// estado, cuándo, nota corta) — el contenido completo de la conversación NUNCA
// sale del bot; para eso está el panel /admin del propio bot.
apiApp.get("/leads", async (c) => {
  const raw = Number.parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 20;
  const rows = await new Db(c.env.DB).all<{
    id: string; name: string | null; contact: string | null; channel_user_id: string | null;
    intent: string; notes: string | null; status: string | null; created_at: number;
  }>(
    "SELECT id, name, contact, channel_user_id, intent, notes, status, created_at FROM leads ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  const leads = rows.map((r) => ({
    id: r.id,
    name: r.name || "Cliente",
    // contacto enmascarado: suficiente para reconocerlo, sin volcar el dato entero.
    contact_hint: maskContact(r.contact),
    intent: r.intent,
    status: r.status || "new",
    notes: (r.notes || "").slice(0, 140),
    created_at: r.created_at,
  }));
  return c.json({ ok: true, leads, count: leads.length }, 200);
});

function maskContact(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [u, dom] = s.split("@");
    return `${u.slice(0, 2)}***@${dom}`;
  }
  return s.length > 4 ? `***${s.slice(-4)}` : s;
}

// POST /api/tier {tier:"pro"|"free"} → el control plane sube/baja el tier en
// caliente (al activar Forja+, o al expirar). Persiste en settings y aplica al
// siguiente request (cache 30s por isolate; este isolate aplica al instante).
apiApp.post("/tier", async (c) => {
  let body: { tier?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const tier = body.tier;
  if (tier !== "pro" && tier !== "free") {
    return c.json({ ok: false, error: "invalid_tier" }, 400);
  }
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.tierOverride, tier);
  bustTierCache(tier);
  c.env.BOT_TIER = tier;
  return c.json({ ok: true, tier }, 200);
});

export type MetricsRange = "7d" | "30d" | "all";

/** Window start (ms epoch) for a range. "all" = 0 (no lower bound). */
export function sinceForRange(range: MetricsRange, now: number): number {
  if (range === "all") return 0;
  const days = range === "30d" ? 30 : 7; // default / fallback = 7d
  return now - days * 24 * 60 * 60 * 1000;
}

/** Normalize the ?range query param to a supported value (default 7d). */
export function parseRange(raw: string | undefined): MetricsRange {
  return raw === "30d" || raw === "all" ? raw : "7d";
}

export interface MetricsResponse {
  range: MetricsRange;
  leads: number;
  messages: number;
  conversations: number;
  health_score: number;
}

/**
 * Aggregate the bot's activity over the requested window from the real D1
 * tables (schema.sql):
 *   leads          = COUNT(leads)          created_at >= since
 *   messages       = COUNT(messages)       created_at >= since
 *   conversations  = COUNT(conversations)  last_message_at >= since (active in window)
 *
 * health_score (0–100): the share of in-window conversations that did NOT get
 * escalated to a human — i.e. never opened a handoff ticket (the tickets table
 * is written only on handoffHuman). 100 = nobody had to be escalated; lower =
 * more conversations needed a human. escalated is clamped to [0, conversations]
 * so the ratio stays in range, and with zero conversations we report 100
 * (no traffic ≠ unhealthy).
 */
export async function computeMetrics(
  db: Db,
  range: MetricsRange,
  now = Date.now(),
): Promise<MetricsResponse> {
  const since = sinceForRange(range, now);

  const leads =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?", [since]))
      ?.n ?? 0;
  const messages =
    (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?", [since]))
      ?.n ?? 0;
  const conversations =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversations WHERE last_message_at >= ?",
      [since],
    ))?.n ?? 0;

  // Distinct conversations that opened a handoff ticket in the window.
  const escalatedRaw =
    (await db.first<{ n: number }>(
      "SELECT COUNT(DISTINCT conversation_id) AS n FROM tickets WHERE conversation_id IS NOT NULL AND created_at >= ?",
      [since],
    ))?.n ?? 0;

  const escalated = Math.min(escalatedRaw, conversations);
  const healthScore =
    conversations === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(((conversations - escalated) / conversations) * 100)));

  return { range, leads, messages, conversations, health_score: healthScore };
}

// GET /api/metrics?range=7d|30d|all → aggregates for the control-plane dashboard.
apiApp.get("/metrics", async (c) => {
  const range = parseRange(c.req.query("range"));
  const metrics = await computeMetrics(new Db(c.env.DB), range);
  return c.json(metrics, 200);
});
