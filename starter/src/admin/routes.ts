/**
 * Admin dashboard routes (Hono sub-app mounted at `/admin`).
 *
 * Auth is HTTP Basic Auth (owner override of the original magic-link plan):
 * every route is guarded by `adminAuth(env)`, which prompts the browser's
 * native Basic Auth dialog. Username is always "admin", password lives in the
 * `DASHBOARD_PASSWORD` secret. There are NO /login or /logout routes — Basic
 * Auth does not need them.
 *
 * Because the Basic Auth middleware needs the per-request `Env` (to read
 * `DASHBOARD_PASSWORD` from the binding), it is applied inside a wildcard
 * middleware that has access to `c.env` rather than at module-init time.
 */
import { parsePeerBots } from "./projects";
import { Hono } from "hono";
import { generateText } from "ai";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import type { Env } from "../env";
import { adminAuth } from "./auth";
import { layout, renderUpgrade } from "./views/layout";
import { isPro } from "../config";
import { renderOverview } from "./views/overview";
import { renderStats } from "./views/stats";
import { renderCosts } from "./views/costs";
import {
  renderInbox,
  renderInboxList,
  renderThreadLive,
  renderSuggestionBox,
} from "./views/conversations";
import { pickAdapter } from "../replies/sender";
import { channelLabel } from "../channels/labels";
import type { ChannelId } from "../channels/shared";
import { renderInsights } from "./views/insights";
import { analyzeConversations } from "../insights/analyzer";
import { renderAgentePage, renderAgenteCanvas, renderNodeModal, toggleTool, toastOob, currentGlobalSystemPrompt } from "./views/agente";
import { renderKbList, renderKbEditor } from "./views/kb";
import { KbDocsRepo, indexDoc, removeDocVectors, reindexAll, MAX_DOC_CHARS } from "../kb/docs";
import { renderMejoras } from "./views/mejoras";
import { runFlywheel, getLessons, saveLessons } from "../flywheel/detect";
import { applySuggestion, dismissSuggestion } from "../flywheel/apply";
import { renderLeads, exportLeadsCsv } from "./views/leads";
import { renderTickets } from "./views/tickets";
import { renderCobros } from "./views/cobros";
import { renderConfig } from "./views/config";
import { renderConexiones } from "./views/conexiones";
import { renderCampanas } from "./views/campanas";
import { renderPlantillas } from "./views/plantillas";
import { renderReviews } from "./views/reviews";
import { sendCampaign, createHandoffTemplate, contentApprovalStatus } from "../campaigns";
import { Db } from "../db/client";
import { LeadsRepo, type Lead } from "../db/leads";
import { TicketsRepo } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { SettingsRepo, SETTING_KEYS, type SettingKey } from "../db/settings";
import { CONTROLS, levelToValue } from "./control-levels";
import { systemPromptFromEnv } from "../system-prompt";
import { renderBusinessContext } from "../businessContext";

export const adminApp = new Hono<{ Bindings: Env }>();

// Guard every admin route with Basic Auth. The middleware factory needs the
// request-scoped Env to read DASHBOARD_PASSWORD, so build it per request here.
// DASHBOARD_PUBLIC="1" (wrangler.toml de esta instancia) apaga el guard —
// decisión explícita de Santi (2026-07-11): su panel es público a propósito.
// Para volver a protegerlo: quitar esa var y redeploy.
adminApp.use("*", (c, next) => {
  if (c.env.DASHBOARD_PUBLIC === "1") return next();
  return adminAuth(c.env)(c, next);
});

// Gate de tier: el panel free ve el nav Pro bloqueado; si aun así navega a una
// ruta Pro (URL directa, bookmark, click al item bloqueado), servimos la página
// de upgrade en vez de la vista real. Los datos Pro nunca se exponen en free.
const PRO_GATE: Array<[string, string]> = [
  ["/admin/cobros", "Cobros"],
  ["/admin/insights", "Insights"],
  ["/admin/stats", "Estadísticas"],
  ["/admin/costs", "Costos"],
  ["/admin/mejoras", "Mejoras"],
  ["/admin/campanas", "Campañas"],
  ["/admin/plantillas", "Plantillas"],
  ["/admin/reviews", "Reseñas"],
  ["/admin/report", "Reportes"],
];
adminApp.use("*", async (c, next) => {
  if (isPro(c.env)) return next();
  const path = c.req.path;
  const hit = PRO_GATE.find(([pre]) => path === pre || path.startsWith(pre + "/"));
  if (hit) return c.html(renderUpgrade(c.env, hit[1]));
  return next();
});

// Página de upgrade (item bloqueado del nav apunta aquí).
adminApp.get("/upgrade", (c) => c.html(renderUpgrade(c.env)));

// Reporte diseñado. Por default sirve el último generado por el cron; con
// ?preview=1 arma uno fresco al vuelo (para revisarlo sin esperar a las 3am —
// gasta una llamada de IA). Ver src/owner/report/.
adminApp.get("/report", async (c) => {
  const url = new URL(c.req.url);
  if (url.searchParams.get("preview") === "1") {
    const { buildReport } = await import("../owner/report/build");
    const report = await buildReport(c.env, Date.now());
    return c.html(report.html);
  }
  const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
  const { Db } = await import("../db/client");
  const html = await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.reportLastHtml);
  if (html) return c.html(html);
  return c.html(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:520px;margin:12vh auto;padding:0 20px;color:#33373d;text-align:center">
    <h1 style="font-weight:800">Aún no hay reporte</h1>
    <p style="line-height:1.6">Tu primer reporte diseñado se genera automático cada mañana (si activaste <b>Reportes</b> en tu panel).
    ¿Quieres verlo ya? <a href="?preview=1" style="color:#0f766e;font-weight:600">Genera una vista previa →</a></p></body>`,
  );
});

// Root → default tab.
adminApp.get("/", (c) => c.redirect("/admin/overview"));

// Selector de proyectos (header): instancia actual + hermanas de PEER_BOTS.
adminApp.get("/projects", (c) =>
  c.json({ current: c.env.BOT_NAME ?? "Mi bot", peers: parsePeerBots(c.env) }),
);

// --- Read-only tabs ---------------------------------------------------------

adminApp.get("/overview", async (c) => c.html(await renderOverview(c.env)));

adminApp.get("/stats", async (c) => c.html(await renderStats(c.env)));

adminApp.get("/costs", async (c) => c.html(await renderCosts(c.env, c.req.query("saved") === "1")));

// Monthly AI budget (Costos tab). Empty value clears the cap.
adminApp.post("/costs/budget", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("monthly_budget") ?? "").trim();
  const n = Number.parseFloat(raw);
  const value = raw !== "" && Number.isFinite(n) && n > 0 ? String(n) : "";
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.monthlyBudget, value);
  return c.redirect("/admin/costs?saved=1");
});

// --- Conocimiento (KB editable, F4) -------------------------------------------

adminApp.get("/kb", async (c) =>
  c.html(
    await renderKbList(c.env, {
      saved: c.req.query("saved") === "1",
      deleted: c.req.query("deleted") === "1",
      reindexed: c.req.query("reindexed") ?? undefined,
    }),
  ),
);

adminApp.get("/kb/new", (c) => c.html(renderKbEditor(null, c.env)));

adminApp.get("/kb/:id/edit", async (c) => {
  const doc = await new KbDocsRepo(new Db(c.env.DB)).getById(c.req.param("id"));
  if (!doc) return c.redirect("/admin/kb");
  return c.html(renderKbEditor(doc, c.env));
});

// Save = persist in D1 + index into Vectorize immediately (stale vectors for
// the doc are blanket-deleted first), so searchKb uses it on the next message.
adminApp.post("/kb/save", async (c) => {
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const content = String(form.get("content") ?? "").trim().slice(0, MAX_DOC_CHARS);
  if (!title || !content) return c.redirect("/admin/kb");

  const id = String(form.get("id") ?? "").trim() || crypto.randomUUID();
  const repo = new KbDocsRepo(new Db(c.env.DB));
  await repo.upsert({ id, title, content });
  const doc = (await repo.getById(id))!;
  await indexDoc(c.env, doc);
  return c.redirect("/admin/kb?saved=1");
});

adminApp.post("/kb/:id/delete", async (c) => {
  const id = c.req.param("id");
  await new KbDocsRepo(new Db(c.env.DB)).delete(id);
  await removeDocVectors(c.env, id);
  return c.redirect("/admin/kb?deleted=1");
});

// Global reindex: repo fixtures + every dashboard doc.
adminApp.post("/kb/reindex", async (c) => {
  const r = await reindexAll(c.env);
  return c.redirect(`/admin/kb?reindexed=${r.indexed}`);
});

// --- Handoff: plantilla HSM del aviso al dueño ---------------------------------

// Setup one-shot: crea la plantilla en la Content API de Twilio, la somete a
// aprobación de WhatsApp (UTILITY) y guarda el ContentSid en settings —
// notifyOwner la usa como fallback del secret, sin pasos manuales.
adminApp.post("/handoff/template/setup", async (c) => {
  const r = await createHandoffTemplate(c.env);
  if ("error" in r) return c.json(r, 502);
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.twilioHandoffContentSid, r.sid);
  return c.json(r);
});

// Estado de aprobación de la plantilla del handoff (approved | pending | …).
adminApp.get("/handoff/template/status", async (c) => {
  const sid =
    c.env.TWILIO_HANDOFF_CONTENT_SID ||
    (await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.twilioHandoffContentSid));
  if (!sid) return c.json({ error: "sin plantilla — corre el setup primero" }, 404);
  const r = await contentApprovalStatus(c.env, sid);
  return c.json({ sid, ...r });
});

// --- Mejoras (flywheel, F5) ----------------------------------------------------

adminApp.get("/mejoras", async (c) =>
  c.html(
    await renderMejoras(c.env, {
      found: c.req.query("found") ?? undefined,
      applied: c.req.query("applied") === "1",
      dismissed: c.req.query("dismissed") === "1",
    }),
  ),
);

// Run the detectors on demand (they also run nightly from scheduled()).
adminApp.post("/mejoras/run", async (c) => {
  const r = await runFlywheel(c.env);
  return c.redirect(`/admin/mejoras?found=${r.created}`);
});

adminApp.post("/mejoras/:id/apply", async (c) => {
  const ok = await applySuggestion(c.env, c.req.param("id"));
  return c.redirect(ok ? "/admin/mejoras?applied=1" : "/admin/mejoras");
});

adminApp.post("/mejoras/:id/dismiss", async (c) => {
  const ok = await dismissSuggestion(c.env, c.req.param("id"));
  return c.redirect(ok ? "/admin/mejoras?dismissed=1" : "/admin/mejoras");
});

// Autonomía del flywheel: manual (default) o copiloto (auto-aplica lo seguro
// en el cron nocturno — KB sin huecos y lecciones; lo delicado sigue en cola).
adminApp.post("/mejoras/autonomy", async (c) => {
  const form = await c.req.formData();
  const level = String(form.get("level") ?? "manual") === "copilot" ? "copilot" : "manual";
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.autonomyLevel, level);
  return c.redirect("/admin/mejoras");
});

// Remove one lesson from the prompt (the ✕ next to each active lesson).
adminApp.post("/mejoras/lessons/remove", async (c) => {
  const form = await c.req.formData();
  const lesson = String(form.get("lesson") ?? "");
  const lessons = (await getLessons(c.env)).filter((l) => l !== lesson);
  await saveLessons(c.env, lessons);
  return c.redirect("/admin/mejoras");
});

// Inbox (F1): two-pane view. ?c=<id> selects the thread; ?f/?q filter the list.
adminApp.get("/conversations", async (c) =>
  c.html(
    await renderInbox(c.env, {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

// HTMX fragments (polled): left list every 10s, thread every 5s. Registered
// before /conversations/:id so the static segments win the match.
adminApp.get("/conversations/list-fragment", async (c) =>
  c.html(
    await renderInboxList(c.env, {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

adminApp.get("/conversations/thread/:id", async (c) =>
  c.html(await renderThreadLive(c.env, c.req.param("id"))),
);

// Old detail URLs (linked from Insights, notifications, etc.) → inbox selection.
adminApp.get("/conversations/:id", (c) =>
  c.redirect(`/admin/conversations?c=${encodeURIComponent(c.req.param("id"))}`),
);

// Insights tab. Visiting it opportunistically grades a few pending
// conversations in the background (waitUntil) so the tab catches up on its own
// even without pressing "Analizar ahora". TODO: move the main run to
// scheduled() in index.ts once the channels/meta work in flight there lands.
adminApp.get("/insights", async (c) => {
  try {
    c.executionCtx.waitUntil(
      analyzeConversations(c.env, { limit: 3 }).catch((e) =>
        console.error("[insights] background analysis failed:", e),
      ),
    );
  } catch {
    // no executionCtx (tests) — render without background catch-up
  }
  return c.html(await renderInsights(c.env, c.req.query("analyzed") ?? undefined));
});

// "Analizar ahora": grade up to 10 pending conversations inline, then redirect
// back with the count for the confirmation banner.
adminApp.post("/insights/analyze", async (c) => {
  const result = await analyzeConversations(c.env, { limit: 10 });
  return c.redirect(`/admin/insights?analyzed=${result.analyzed}`);
});

// "Mi Agente": n8n-style canvas of how the bot works. The canvas fragment is
// polled by HTMX every 15s (live activity pulse); node panels load on click.
// ?channel=<id> redraws the WHOLE radiography for that channel (its prompt
// override + its disabled-tools union). Empty/absent = General (global). The
// value is validated downstream against configuredChannels.
adminApp.get("/agente", async (c) =>
  c.html(await renderAgentePage(c.env, c.req.query("channel") || undefined)),
);

adminApp.get("/agente/canvas", async (c) =>
  c.html(await renderAgenteCanvas(c.env, c.req.query("channel") || undefined)),
);

adminApp.get("/agente/node/:id", async (c) =>
  c.html(await renderNodeModal(c.env, c.req.param("id"), false, c.req.query("channel") || undefined)),
);

// Save a node's config from its modal. Writes the relevant settings (with
// clamps), re-renders the modal with a saved banner + toast, and fires the
// `canvas-refresh` event so the diagram updates immediately.
adminApp.post("/agente/node/:id/save", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const num = (key: string): number | null => {
    const raw = form.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  if (id === "buffer") {
    const s = num("buffer_seconds");
    if (s !== null) await repo.set(SETTING_KEYS.bufferSeconds, String(Math.round(clamp(s, 1, 60))));
  } else if (id === "reply") {
    const chunks = num("max_chunks");
    if (chunks !== null) await repo.set(SETTING_KEYS.maxChunks, String(Math.round(clamp(chunks, 1, 5))));
    const delayS = num("inter_chunk_delay_s");
    if (delayS !== null)
      await repo.set(SETTING_KEYS.interChunkDelayMs, String(Math.round(clamp(delayS, 0, 5) * 1000)));
  } else if (id === "model") {
    const m = String(form.get("model_override") ?? "");
    if (m === "auto" || m === "haiku" || m === "sonnet") await repo.set(SETTING_KEYS.modelOverride, m);
    const t = num("temperature");
    if (t !== null) await repo.set(SETTING_KEYS.temperature, String(clamp(t, 0, 1)));
  } else if (id === "brain") {
    // `channel` (empty/absent = General) scopes the prompt key to
    // system_prompt_override[:<canal>]. Four sub-actions share the brain
    // modal — reset, copy-general, pause toggle, and saving the prompt text —
    // checked in that priority order. bot_paused stays GLOBAL-only (no
    // per-channel pause).
    const channel = String(form.get("channel") ?? "").trim() || undefined;
    const promptKey = channel ? `${SETTING_KEYS.systemPromptOverride}:${channel}` : SETTING_KEYS.systemPromptOverride;
    const action = String(form.get("action") ?? "");

    if (action === "reset") {
      // "Delete" = empty string, same convention the General tab already used:
      // settings-loader treats an empty value as absent and falls back.
      await repo.set(promptKey, "");
    } else if (action === "copy-general") {
      await repo.set(promptKey, await currentGlobalSystemPrompt(c.env));
    } else if (form.get("bot_paused") !== null) {
      await repo.set(SETTING_KEYS.botPaused, String(form.get("bot_paused")) === "1" ? "1" : "0");
    } else if (form.get("system_prompt_override") !== null) {
      await repo.set(promptKey, String(form.get("system_prompt_override")).trim());
    }
  } else {
    return c.text("Nodo desconocido", 404);
  }

  c.header("HX-Trigger", "canvas-refresh");
  const activeChannel = id === "brain" ? String(form.get("channel") ?? "").trim() || undefined : undefined;
  return c.html((await renderNodeModal(c.env, id, true, activeChannel)) + toastOob("✓ Guardado"));
});

// Toggle a tool on/off from its node modal. The `channel` form field (empty =
// General) scopes the write to disabled_tools[:<canal>] and re-renders the tool
// modal FOR that channel so the diagram + modal stay on the viewed channel.
adminApp.post("/agente/tools/:name/toggle", async (c) => {
  const name = c.req.param("name");
  // Tolerate a body-less POST (global toggle) — formData() throws on no body.
  const form = await c.req.formData().catch(() => null);
  const channel = (form && String(form.get("channel") ?? "").trim()) || undefined;
  const ok = await toggleTool(c.env, name, channel);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, `tool:${name}`, true, channel)) + toastOob("✓ Guardado"));
});

// Same toggle, but invoked from the tools LIST inside the Agente modal. Since a
// channel view hides its off tools from the canvas, this is where a hidden tool
// gets turned back on. Re-renders the WHOLE Agente modal (not the tool modal) so
// the list stays open on the viewed channel; the canvas redraws via the event.
adminApp.post("/agente/node/brain/tools/:name/toggle", async (c) => {
  const name = c.req.param("name");
  const form = await c.req.formData().catch(() => null);
  const channel = (form && String(form.get("channel") ?? "").trim()) || undefined;
  const ok = await toggleTool(c.env, name, channel);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, "brain", true, channel)) + toastOob("✓ Guardado"));
});

adminApp.get("/leads", async (c) => c.html(await renderLeads(c.env)));

adminApp.get("/tickets", async (c) => c.html(await renderTickets(c.env)));

adminApp.get("/cobros", async (c) => c.html(await renderCobros(c.env)));

// Conexiones: mapa de canales con estado verde/gris (paso 4 del onboarding).
adminApp.get("/conexiones", async (c) => c.html(await renderConexiones(c.env, c.req.url)));

adminApp.get("/campanas", async (c) => {
  const q: Record<string, string | undefined> = {
    ok: c.req.query("ok"),
    err: c.req.query("err"),
    ff: c.req.query("ff"),
    tp: c.req.query("tp"),
    dup: c.req.query("dup"),
    quota: c.req.query("quota"),
    fail: c.req.query("fail"),
  };
  return c.html(await renderCampanas(c.env, q));
});

adminApp.post("/campanas/send", async (c) => {
  const form = await c.req.formData();
  const segmentId = String(form.get("segment") ?? "");
  const campaignKey = String(form.get("campaign_key") ?? "").trim();
  const freeformText = String(form.get("freeform_text") ?? "").trim();
  const templateSid = String(form.get("template_sid") ?? "").trim();
  const varsRaw = String(form.get("template_vars") ?? "").trim();
  if (!segmentId || !campaignKey || (!freeformText && !templateSid)) {
    return c.redirect("/admin/campanas?err=" + encodeURIComponent("Falta el segmento, el nombre de campaña, o un mensaje/plantilla."));
  }
  let variables: Record<string, string> | undefined;
  if (varsRaw) {
    try {
      variables = JSON.parse(varsRaw);
    } catch {
      return c.redirect("/admin/campanas?err=" + encodeURIComponent("Las variables no son JSON válido."));
    }
  }
  // El body de la plantilla viaja al historial de cada conversación — sin él,
  // el agente no sabría qué se le preguntó al cliente cuando responda.
  let templateBody: string | undefined;
  if (templateSid) {
    const { listContentTemplates } = await import("../campaigns");
    const tpl = (await listContentTemplates(c.env).catch(() => [])).find((t) => t.sid === templateSid);
    templateBody = tpl?.body || undefined;
  }
  const result = await sendCampaign(c.env, {
    segmentId,
    campaignKey,
    freeformText: freeformText || undefined,
    template: templateSid ? { sid: templateSid, variables, body: templateBody } : undefined,
  });
  const q = new URLSearchParams({
    ok: "1",
    ff: String(result.sentFreeform),
    tp: String(result.sentTemplate),
    dup: String(result.skippedDuplicate),
    quota: String(result.skippedQuota),
    fail: String(result.failed),
  });
  return c.redirect("/admin/campanas?" + q.toString());
});

// Plantillas: read-only de las plantillas HSM del número y a qué rol del bot
// (reenganche / handoff) está asignada cada una. El POST asigna el SID de
// reenganche con un click (atajo del campo manual en Configuración).
adminApp.get("/plantillas", async (c) =>
  c.html(await renderPlantillas(c.env, { saved: c.req.query("saved") })),
);

// Reseñas: respuestas de la encuesta de satisfacción (rating + opinión abierta).
adminApp.get("/reviews", async (c) => c.html(await renderReviews(c.env)));

adminApp.post("/plantillas/use", async (c) => {
  const form = await c.req.formData();
  const sid = String(form.get("sid") ?? "").trim();
  if (sid) await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.reengageTemplateSid, sid);
  return c.redirect("/admin/plantillas?saved=1");
});

// Cloud API oficial: guarda el nombre + idioma de la plantilla de Meta para reenganche.
adminApp.post("/plantillas/wa-template", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));
  await repo.set(SETTING_KEYS.reengageTemplateName, String(form.get("name") ?? "").trim());
  await repo.set(SETTING_KEYS.reengageTemplateLang, String(form.get("lang") ?? "").trim() || "es");
  return c.redirect("/admin/plantillas?saved=1");
});

adminApp.get("/config", async (c) => {
  const settings = await new SettingsRepo(new Db(c.env.DB)).all();
  const saved = c.req.query("saved") === "1";
  return c.html(renderConfig(c.env, settings, saved, c.req.query("llmtest")));
});

// Guarda proveedor/modelo/API key desde el form (allow-list de valores). El
// input de la key llega vacío cuando no la tocaron → solo se sobreescribe si
// escribieron algo; el checkbox la borra explícitamente.
async function saveLlmFields(repo: SettingsRepo, form: FormData): Promise<void> {
  const provRaw = form.get(SETTING_KEYS.llmProvider);
  if (provRaw !== null) {
    const v = String(provRaw).trim().toLowerCase();
    await repo.set(
      SETTING_KEYS.llmProvider,
      v === "anthropic" || v === "openai" || v === "xai" || v === "google" ? v : "",
    );
  }
  const modelRaw = form.get(SETTING_KEYS.llmModel);
  if (modelRaw !== null) {
    await repo.set(SETTING_KEYS.llmModel, String(modelRaw).trim().slice(0, 100));
  }
  if (form.get("llm_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.llmApiKey, "");
  } else {
    const keyRaw = form.get(SETTING_KEYS.llmApiKey);
    if (keyRaw !== null && String(keyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.llmApiKey, String(keyRaw).trim());
    }
  }
}

// Prueba de la config BYO-LLM: PRIMERO guarda lo que el dueño acaba de escribir
// (proveedor/modelo/key), LUEGO lo prueba con un generateText mínimo. Así "Probar"
// valida exactamente lo tecleado en un clic — antes era un link GET que descartaba
// el form y probaba el estado viejo de D1 (bug: "API key is invalid" con key buena).
adminApp.post("/config/llm-test", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));
  await saveLlmFields(repo, form);
  try {
    const ov = await loadLlmOverrides(c.env);
    const { model, modelId, provider } = createModel(c.env, "fast", ov);
    const r = await generateText({
      model,
      prompt: "Responde únicamente: ok",
      maxOutputTokens: 8,
    });
    const okText = r.text.trim().slice(0, 20) || "ok";
    return c.redirect(
      `/admin/config?llmtest=${encodeURIComponent(`ok:${provider}/${modelId} → "${okText}"`)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.redirect(`/admin/config?llmtest=${encodeURIComponent(`err:${msg.slice(0, 180)}`)}`);
  }
});

// Save the control panel. Card selections are mapped from the picked option
// (value or label) back to the value we persist via `levelToValue`; free-text
// fields are stored verbatim (trimmed). Empty/absent => default at load time.
adminApp.post("/config", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));

  // Card-based controls: tone, buffer_seconds, max_chunks, model_override, bot_paused.
  for (const key of Object.keys(CONTROLS)) {
    const picked = form.get(key);
    if (picked === null) continue; // control not submitted — leave as-is
    const value = levelToValue(key, String(picked));
    if (value !== null) await repo.set(key, value);
  }

  // Free-text controls (stored verbatim, trimmed).
  const textKeys: SettingKey[] = [
    SETTING_KEYS.botName,
    SETTING_KEYS.businessContext,
    SETTING_KEYS.systemPromptOverride,
    SETTING_KEYS.escalationKeywords,
  ];
  for (const key of textKeys) {
    const raw = form.get(key);
    if (raw === null) continue;
    await repo.set(key, String(raw).trim());
  }

  // BYO-LLM: proveedor, modelo y API key (helper compartido con /config/llm-test).
  await saveLlmFields(repo, form);

  // Superpoderes Forja+ (toggles) — la sección solo se renderiza en Pro, así
  // que solo procesamos sus checkboxes en Pro (un checkbox no marcado no llega
  // en el form → lo guardamos como "0"). Los text fields se guardan trimmed.
  if (isPro(c.env)) {
    const toggleKeys: SettingKey[] = [
      SETTING_KEYS.dailyReport,
      SETTING_KEYS.multiLanguage,
      SETTING_KEYS.satisfactionSurvey,
      SETTING_KEYS.reengageColdLeads,
      SETTING_KEYS.salesHunter,
      SETTING_KEYS.reviewRequests,
      SETTING_KEYS.paymentsEnabled,
    ];
    for (const key of toggleKeys) {
      await repo.set(key, form.get(key) === "1" ? "1" : "0");
    }
    for (const key of [SETTING_KEYS.reviewUrl, SETTING_KEYS.reengageTemplateSid] as SettingKey[]) {
      const raw = form.get(key);
      if (raw !== null) await repo.set(key, String(raw).trim());
    }
    // Selects con allow-list: formato del reporte + modo de la encuesta.
    const selects: Array<[SettingKey, string[]]> = [
      [SETTING_KEYS.reportFormat, ["html", "docx", "pdf"]],
      [SETTING_KEYS.surveyMode, ["numerico", "abierto", "ambos"]],
    ];
    for (const [key, allowed] of selects) {
      const raw = form.get(key);
      if (raw !== null && allowed.includes(String(raw))) await repo.set(key, String(raw));
    }
  }

  return c.redirect("/admin/config?saved=1");
});

// --- CSV export -------------------------------------------------------------

adminApp.get("/leads/export.csv", async (c) => {
  const csv = await exportLeadsCsv(c.env);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${Date.now()}.csv"`,
    },
  });
});

// --- Mutating actions (HTMX / plain form posts) -----------------------------

const LEAD_STATUSES: ReadonlyArray<Lead["status"]> = ["new", "contacted", "sold", "lost"];

// Mark a lead's status (nuevo / contactado / vendido / perdido).
adminApp.post("/leads/:id/status", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("status") ?? "new");
  const status: Lead["status"] = (LEAD_STATUSES as readonly string[]).includes(raw)
    ? (raw as Lead["status"])
    : "new";
  const leads = new LeadsRepo(new Db(c.env.DB));
  await leads.setStatus(c.req.param("id"), status);
  return c.redirect("/admin/leads");
});

// Resolve a support ticket.
adminApp.post("/tickets/:id/resolve", async (c) => {
  const form = await c.req.formData();
  const resolvedBy = String(form.get("resolved_by") ?? c.env.OWNER_EMAIL ?? "admin").trim() || "admin";
  const tickets = new TicketsRepo(new Db(c.env.DB));
  await tickets.resolve(c.req.param("id"), resolvedBy);
  return c.redirect("/admin/tickets");
});

// --- Inbox actions (F1) -------------------------------------------------------

/** Owner takes over for this long after replying/pausing from the dashboard.
 * Configurable desde el panel (control "Cuando tomas el control"). Vacío = 60 min;
 * "0" = hasta que el dueño reanude (pausa efectivamente indefinida ≈ 1 año). */
const DEFAULT_TAKEOVER_MIN = 60;
const MANUAL_RESUME_MS = 365 * 24 * 60 * 60 * 1000;
async function takeoverMs(env: Env): Promise<number> {
  const raw = ((await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.takeoverMinutes)) ?? "").trim();
  const min = raw === "" ? DEFAULT_TAKEOVER_MIN : parseInt(raw, 10);
  if (!Number.isFinite(min)) return DEFAULT_TAKEOVER_MIN * 60_000;
  return min <= 0 ? MANUAL_RESUME_MS : min * 60_000;
}

// Reply AS A HUMAN from the dashboard: sends through the conversation's channel
// adapter (Twilio/Telegram/Meta/ManyChat), persists the message as role=owner,
// and pauses the bot (owner takeover — same behavior as isOwnerMessage in the
// agent). Returns a status line for #send-status plus an out-of-band swap that
// refreshes #thread-live instantly. X-Sent: 1 tells the composer to reset.
adminApp.post("/conversations/:id/reply", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  if (!text) return c.html(`<span class="text-stone-400">Escribe un mensaje primero.</span>`);

  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(id);
  if (!conv) return c.html(`<span class="text-red-600">✗ Conversación no encontrada.</span>`);

  try {
    const adapter = pickAdapter(conv.channel as ChannelId);
    await adapter.sendReply(
      {
        channel: conv.channel as ChannelId,
        channelUserId: conv.channel_user_id,
        chunks: [text],
        interChunkDelayMs: 0,
      },
      c.env,
    );
  } catch (e) {
    // Nothing persisted on failure: the customer never got the message.
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(`<span class="text-red-600">✗ No se pudo enviar: ${escapeHtml(msg)}</span>`);
  }

  const msgs = new MessagesRepo(db);
  await msgs.append(id, "owner", text);
  await convs.touchLastMessage(id);
  await convs.setPausedUntil(id, Date.now() + (await takeoverMs(c.env)));

  c.header("X-Sent", "1");
  return c.html(
    `<span class="text-emerald-600">✓ Enviado por ${escapeHtml(channelLabel(conv.channel))}</span>` +
      `<div id="thread-live" hx-swap-oob="innerHTML">${await renderThreadLive(c.env, id)}</div>`,
  );
});

// Pause the bot in this conversation without sending anything (owner wants the
// customer for themselves). Returns the refreshed thread fragment.
adminApp.post("/conversations/:id/pause", async (c) => {
  const id = c.req.param("id");
  const convs = new ConversationsRepo(new Db(c.env.DB));
  await convs.setPausedUntil(id, Date.now() + (await takeoverMs(c.env)));
  return c.html(await renderThreadLive(c.env, id));
});

// Return a paused conversation back to the bot. Clears paused_until AND appends
// an owner-authored summary of the human handoff to the message history, so the
// bot resumes with context about what the owner already resolved.
adminApp.post("/conversations/:id/resume", async (c) => {
  const id = c.req.param("id");
  const convs = new ConversationsRepo(new Db(c.env.DB));
  await convs.setPausedUntil(id, null);
  // Insert a system-style owner note summarizing the human handoff so the bot
  // has context when it picks the conversation back up. The summary field is
  // optional, so tolerate a request with no form body (formData() throws on an
  // empty/no-content-type body).
  const form = await c.req.formData().catch(() => null);
  const summary =
    String(form?.get("summary") ?? "").trim() ||
    "(El dueño habló con el cliente y resolvió la consulta.)";
  const msgs = new MessagesRepo(new Db(c.env.DB));
  await msgs.append(id, "owner", summary);
  return c.redirect(`/admin/conversations?c=${encodeURIComponent(id)}`);
});

// --- Co-pilot (HTMX-driven suggestion) --------------------------------------

/** Escape untrusted text (LLM output) before interpolating into an HTML fragment. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// "Suggest Reply": call Anthropic with the recent conversation history + the
// business context and return ONE short message the owner can copy/paste (or
// send manually via WhatsApp). It does NOT send anything to the customer — it
// only returns an HTML fragment for HTMX to swap into the suggestion area.
//
// Auth: already enforced by the wildcard Basic Auth middleware above, so there
// is no per-route auth check here (no magic-link `requireAuth`).
adminApp.post("/conversations/:id/suggest", async (c) => {
  const msgs = new MessagesRepo(new Db(c.env.DB));
  const history = await msgs.lastN(c.req.param("id"), 20);
  const { model } = createModel(c.env, "fast", await loadLlmOverrides(c.env));
  const aiMessages = history.map((m) => ({
    role: (m.role === "tool" ? "user" : m.role === "owner" ? "assistant" : m.role) as
      | "user"
      | "assistant",
    content: m.content,
  }));
  aiMessages.push({
    role: "user",
    content:
      "Eres asistente del dueño. Sugiere UN solo mensaje corto en español que el dueño podría enviar al cliente para resolver la última consulta. NO incluyas preámbulo, solo la frase a copy/paste.",
  });
  const sys = systemPromptFromEnv(c.env, [], renderBusinessContext());
  const result = await generateText({
    model,
    system: sys,
    messages: aiMessages,
  });
  // HTMX swaps this into #suggestion-box; the "Usar" button fills the composer.
  return c.html(renderSuggestionBox(result.text));
});

// --- Fallback ---------------------------------------------------------------

adminApp.notFound((c) =>
  c.html(
    layout({
      title: "No encontrado",
      activeTab: "overview",
      body: "<p class='text-stone-500'>Página no encontrada.</p>",
    }),
    404,
  ),
);
