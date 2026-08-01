import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { systemPromptFromEnv } from "./system-prompt";
import { renderBusinessContext } from "./businessContext";
import { getBufferMs, isPro } from "./config";
import { getNiche } from "./niches";
import type { LlmOverrides } from "./llm/provider";

export type ModelOverride = "auto" | "haiku" | "sonnet";

export interface AgentConfig {
  systemPrompt: string;
  bufferMs: number;
  maxChunks: number;
  interChunkDelayMs: number;
  modelOverride: ModelOverride;
  botPaused: boolean;
  /** Tool names still enabled after applying the dashboard's disabled_tools. */
  enabledToolNames: string[];
  /** Sampling temperature (0-1). undefined = use the provider default. */
  temperature?: number;
  /** Monthly AI budget (USD). undefined = no cap. */
  monthlyBudgetUsd?: number;
  /** BYO-LLM del dashboard (proveedor / API key / modelo). */
  llm: LlmOverrides;
  /** Info oficial del negocio (settings o member/config.local) — la fuente de
   *  verdad que usa el Blindaje anti-invento además de los pasajes de KB. */
  businessContext: string;
  /** Blindaje anti-invento activo: Pro Y no apagado (blindaje_enabled≠"off"). */
  blindajeEnabled: boolean;
}

/** Extract the BYO-LLM overrides from a settings snapshot. */
export function llmOverridesFrom(settings: Record<string, string>): LlmOverrides {
  const pick = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  };
  return {
    provider: pick(SETTING_KEYS.llmProvider),
    apiKey: pick(SETTING_KEYS.llmApiKey),
    model: pick(SETTING_KEYS.llmModel),
  };
}

/** Load just the BYO-LLM overrides (para analyzer/flywheel/admin, fuera del agente).
 *  Nunca truena: si settings no está disponible, se usan los defaults del env. */
export async function loadLlmOverrides(env: Env): Promise<LlmOverrides> {
  try {
    const settings = await new SettingsRepo(new Db(env.DB)).all();
    return llmOverridesFrom(settings);
  } catch {
    return {};
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function normalizeModelOverride(value: string | undefined): ModelOverride {
  if (value === "haiku" || value === "sonnet" || value === "auto") return value;
  return "auto";
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the effective agent config by overlaying D1 `settings` on top of env
 * defaults. Anything empty/absent in settings falls back to the env/default.
 */
export async function resolveAgentConfig(
  env: Env,
  toolNames: string[],
  channel?: string,
): Promise<AgentConfig> {
  const repo = new SettingsRepo(new Db(env.DB));
  const settings = await repo.all();

  const get = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v : undefined;
  };

  // Niche pack activo (BOT_NICHE). Aporta el playbook del giro y un tono por
  // defecto; ambos se pueden sobreescribir desde el panel.
  const niche = getNiche(env);

  // Override por CANAL primero (key "system_prompt_override:<canal>", ej.
  // ":twilio" = WhatsApp) y si no existe, el override global. Así cada canal
  // puede tener su propia persona sin tocar la de los demás.
  const systemPromptOverride =
    (channel ? get(`${SETTING_KEYS.systemPromptOverride}:${channel}`) : undefined) ??
    get(SETTING_KEYS.systemPromptOverride);
  const businessContext = get(SETTING_KEYS.businessContext) ?? renderBusinessContext();
  const botName = get(SETTING_KEYS.botName) ?? env.BOT_NAME;
  // Tono elegido en el panel gana; si no hay, el tono por defecto del nicho.
  const tone = get(SETTING_KEYS.tone) ?? (niche.defaultTone || undefined);
  // Voz de marca (superpoder Pro /voz-de-marca): guía de estilo completa. Solo
  // aplica en Pro; se lee en vivo desde D1 (cambia sin redeploy).
  const brandVoice = isPro(env) ? get(SETTING_KEYS.brandVoice) : undefined;
  const escalationKeywords = parseCsvList(get(SETTING_KEYS.escalationKeywords));

  // Flywheel lessons (JSON array). Only injected into the GENERATED prompt —
  // a manual override replaces the whole prompt, lessons included.
  let lessons: string[] = [];
  try {
    const parsed = JSON.parse(get(SETTING_KEYS.learnedLessons) ?? "[]");
    if (Array.isArray(parsed)) lessons = parsed.filter((l) => typeof l === "string");
  } catch { /* malformed setting — ignore */ }

  // Dashboard tool toggles: the prompt only advertises the enabled tools, so
  // the model never tries to call something that was turned off. A tool
  // disabled GLOBALLY or just for THIS channel (key "disabled_tools:<canal>")
  // is disabled — union of both sets, deduped.
  const disabledToolsGlobal = parseCsvList(get(SETTING_KEYS.disabledTools));
  const disabledToolsChannel = channel
    ? parseCsvList(get(`${SETTING_KEYS.disabledTools}:${channel}`))
    : [];
  const disabledTools = [...new Set([...disabledToolsGlobal, ...disabledToolsChannel])];
  const enabledToolNames = toolNames.filter((n) => !disabledTools.includes(n));

  // Multi-idioma (superpoder Pro): solo si el plan es Pro Y el dueño lo activó.
  // En free se ignora — el bot mantiene su idioma fijo (BOT_LANGUAGE).
  const multiLanguage = isPro(env) && get(SETTING_KEYS.multiLanguage) === "1";

  // Blindaje anti-invento (Pro): ON por default; el dueño lo apaga con
  // blindaje_enabled="off" (D1/panel) si el verificador le bloquea respuestas
  // legítimas — sin necesidad de redeploy.
  const blindajeEnabled = isPro(env) && get(SETTING_KEYS.blindajeEnabled) !== "off";

  const systemPrompt =
    systemPromptOverride ??
    systemPromptFromEnv(env, enabledToolNames, businessContext, niche.playbook || undefined, {
      tone,
      brandVoice,
      extraEscalationKeywords: escalationKeywords,
      botName,
      lessons,
      multiLanguage,
    });

  const bufferSecondsRaw = get(SETTING_KEYS.bufferSeconds);
  const bufferMs =
    bufferSecondsRaw !== undefined
      ? Math.max(1000, parseIntOr(bufferSecondsRaw, 1) * 1000)
      : getBufferMs(env);

  const maxChunks = clamp(parseIntOr(get(SETTING_KEYS.maxChunks), 3), 1, 5);
  const interChunkDelayMs = clamp(parseIntOr(get(SETTING_KEYS.interChunkDelayMs), 1000), 0, 5000);
  const modelOverride = normalizeModelOverride(get(SETTING_KEYS.modelOverride));
  const botPaused = get(SETTING_KEYS.botPaused) === "1";

  const tempRaw = get(SETTING_KEYS.temperature);
  let temperature: number | undefined;
  if (tempRaw !== undefined) {
    const t = Number.parseFloat(tempRaw);
    if (!Number.isNaN(t)) temperature = clamp(t, 0, 1);
  }

  // Tope de gasto de IA mensual. Default $25 USD: protege la llave del miembro
  // no-técnico por default (un bot en loop no la quema sin freno). El dueño lo
  // sube desde la tab Costos, o lo apaga poniendo "0" (= sin tope, bajo su
  // responsabilidad). El corte duro (2× el tope) es la red de seguridad final.
  const DEFAULT_MONTHLY_BUDGET_USD = 25;
  const budgetRaw = get(SETTING_KEYS.monthlyBudget);
  let monthlyBudgetUsd: number | undefined = DEFAULT_MONTHLY_BUDGET_USD;
  if (budgetRaw !== undefined && budgetRaw.trim() !== "") {
    const b = Number.parseFloat(budgetRaw);
    if (!Number.isNaN(b)) monthlyBudgetUsd = b > 0 ? b : undefined; // "0" = sin tope explícito
  }

  return {
    systemPrompt,
    bufferMs,
    maxChunks,
    interChunkDelayMs,
    modelOverride,
    botPaused,
    blindajeEnabled,
    enabledToolNames,
    temperature,
    monthlyBudgetUsd,
    llm: llmOverridesFrom(settings),
    businessContext,
  };
}
