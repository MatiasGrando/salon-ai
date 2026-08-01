/**
 * Recupera no-shows / leads fríos (superpoder Pro) — SEGUNDO toque a los leads
 * calientes que se enfriaron por DÍAS. El follow-up (followup/run.ts) da el
 * primer toque dentro de las 24h; este reengancha a los que aun así no
 * volvieron, entre 2 y 7 días después, una sola vez.
 *
 * Entrega honesta por canal (2-7 días cae FUERA de la ventana de 24h):
 *  • Telegram: free-form siempre (no hay ventana) → reengancha out-of-window.
 *  • WhatsApp/Twilio/ManyChat/Messenger: free-form solo si el cliente sigue en
 *    ventana (raro a 2-7 días). Fuera de ventana, solo si el dueño configuró una
 *    plantilla HSM aprobada (reengage_template_sid) — si no, se salta (no se
 *    inventa un envío que WhatsApp rechazaría).
 *
 * Claim-before-send en reengage_sends (PRIMARY KEY = candado). Best-effort.
 */
import { generateText } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { resolveAgentConfig, loadLlmOverrides } from "../settings-loader";
import { createModel } from "../llm/provider";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { isPro } from "../config";
import { sendOutbound } from "./send";
import { sendTwilioTemplate } from "../campaigns";
import { sendWhatsappTemplate } from "../channels/whatsapp";
import type { ChannelId } from "../channels/shared";

const MIN_COLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 días
const MAX_COLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Canales con ventana de 24h para mensajes iniciados por el negocio. */
const WINDOWED: ReadonlySet<string> = new Set(["twilio", "whatsapp", "manychat", "messenger"]);

interface CandidateRow {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  sale_opportunity: number | null;
  kw_hits: number;
  last_user_at: number;
}

export interface ReengageResult {
  sent: number;
  skipped: number;
  errors: number;
}

export async function runReengage(
  env: Env,
  opts: { now?: number; limit?: number; dailyCap?: number } = {},
): Promise<ReengageResult> {
  const empty: ReengageResult = { sent: 0, skipped: 0, errors: 0 };
  if (!isPro(env)) return empty;

  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 5;
  const dailyCap = opts.dailyCap ?? 20;
  const db = new Db(env.DB);

  const settings = new SettingsRepo(db);
  if ((await settings.get(SETTING_KEYS.reengageColdLeads)) !== "1") return empty;
  // Plantilla fuera de ventana por método: Twilio (Content SID) o Cloud API
  // oficial (nombre + idioma de la plantilla de Meta).
  const templateSid = ((await settings.get(SETTING_KEYS.reengageTemplateSid)) ?? "").trim();
  const templateName = ((await settings.get(SETTING_KEYS.reengageTemplateName)) ?? "").trim();
  const templateLang = ((await settings.get(SETTING_KEYS.reengageTemplateLang)) ?? "").trim() || "es";

  const cfg = await resolveAgentConfig(env, []);
  if (cfg.botPaused) return empty;

  const sentToday =
    (
      await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM reengage_sends WHERE sent_at > ?",
        [now - 24 * 60 * 60 * 1000],
      )
    )?.n ?? 0;
  if (sentToday >= dailyCap) return empty;

  const rows = await db.all<CandidateRow>(
    `SELECT c.id, c.channel, c.channel_user_id, c.display_name,
       i.sale_opportunity,
       (SELECT COUNT(*) FROM keyword_hits k WHERE k.conversation_id = c.id) AS kw_hits,
       (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_at
     FROM conversations c
     LEFT JOIN conversation_insights i ON i.conversation_id = c.id
     LEFT JOIN reengage_sends re ON re.conversation_id = c.id
     WHERE re.conversation_id IS NULL
       AND c.open_ticket_id IS NULL
       AND c.channel != 'instagram'
       AND (c.paused_until IS NULL OR c.paused_until < ?)
     GROUP BY c.id
     HAVING last_user_at IS NOT NULL
       AND last_user_at <= ? AND last_user_at >= ?
       AND (COALESCE(i.sale_opportunity, 0) = 1 OR kw_hits > 0)
     ORDER BY COALESCE(i.sale_opportunity, 0) DESC
     LIMIT ?`,
    [now, now - MIN_COLD_MS, now - MAX_COLD_MS, Math.min(limit, dailyCap - sentToday)],
  );
  if (rows.length === 0) return empty;

  const msgs = new MessagesRepo(db);
  const { model, modelId } = createModel(env, "fast", await loadLlmOverrides(env));
  const out = { ...empty };

  for (const cand of rows) {
    const inWindow = now - cand.last_user_at < WA_WINDOW_MS;
    const needsTemplate = WINDOWED.has(cand.channel) && !inWindow;
    // El canal decide qué plantilla aplica: el WhatsApp oficial (Cloud API) usa
    // nombre+idioma de Meta; el resto (Twilio/manychat/messenger) el Content SID.
    const isCloudWa = cand.channel === "whatsapp";
    const templateReady = isCloudWa ? templateName !== "" : templateSid !== "";
    // Fuera de ventana sin plantilla configurada: no se puede entregar free-form.
    // No quemamos el claim — puede reengancharse cuando el dueño la conecte.
    if (needsTemplate && !templateReady) {
      out.skipped++;
      continue;
    }

    // Claim antes de enviar.
    const claim = await db.run(
      "INSERT OR IGNORE INTO reengage_sends (conversation_id, reason, sent_at) VALUES (?, ?, ?)",
      [cand.id, (cand.sale_opportunity ?? 0) === 1 ? "hot" : "keyword", now],
    );
    if ((claim.meta.changes ?? 0) === 0) {
      out.skipped++;
      continue;
    }

    try {
      if (needsTemplate) {
        if (isCloudWa) {
          await sendWhatsappTemplate(env, cand.channel_user_id, templateName, templateLang, [
            cand.display_name || "cliente",
          ]);
        } else {
          await sendTwilioTemplate(env, cand.channel_user_id, templateSid, {
            "1": cand.display_name || "",
          });
        }
        await msgs.append(cand.id, "assistant", `[reenganche vía plantilla]`, { modelUsed: modelId });
        out.sent++;
        continue;
      }

      // Free-form: mensaje breve en la voz del bot que retoma con naturalidad.
      const history = await msgs.lastN(cand.id, 6);
      const transcript = history
        .map((m) => `${m.role === "user" ? "Cliente" : "Tú"}: ${m.content.slice(0, 250)}`)
        .join("\n");
      const result = await generateText({
        model,
        prompt: `Eres ${env.BOT_NAME}, de ${env.BUSINESS_NAME}. Este cliente mostró interés hace unos días y ya no volvió. Escribe UN mensaje muy breve (máx 2 líneas), cálido y natural, sin presión, retomando lo último que hablaron para reactivarlo. ${cand.display_name ? `Se llama ${cand.display_name}.` : ""} Responde SOLO con el mensaje.

Últimos mensajes:
${transcript}`,
      });
      const text = result.text.trim();
      if (!text) throw new Error("empty reengage text");
      await sendOutbound(
        env,
        { conversationId: cand.id, channel: cand.channel as ChannelId, channelUserId: cand.channel_user_id, text },
        now,
      );
      out.sent++;
    } catch (e) {
      out.errors++;
      console.error(`[reengage] failed for ${cand.id}:`, e);
    }
  }

  if (out.sent) console.log(`[reengage] sent=${out.sent} skipped=${out.skipped} errors=${out.errors}`);
  return out;
}
