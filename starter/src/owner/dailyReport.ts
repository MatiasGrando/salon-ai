/**
 * Reportes automáticos (superpoder Pro) — resumen diario del negocio al dueño.
 * Ya no es texto plano: arma un reporte DISEÑADO con insights escritos por la
 * misma IA del bot (ver ./report/). Entrega:
 *  • Email (Resend): teaser email-safe + botón al reporte completo (+ archivo
 *    adjunto si el dueño activó DOCX/PDF vía /reportes).
 *  • Telegram: resumen + link al reporte hosteado (/admin/report).
 * El HTML rico se guarda (report_last_html) para servirlo en el panel y como PDF.
 *
 * Corre en el cron diario (0 3 * * *). Guardas: solo Pro + toggle daily_report;
 * idempotente (throttle 20 h); best-effort (una falla no tira los otros crons).
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { isPro } from "../config";
import { Resend } from "resend";
import { buildReport, type BuiltReport } from "./report/build";
import { renderReportFile } from "./report/file";
import { collectDailyStats } from "./report/collect";

export { collectDailyStats };
export type { ReportStats as DailyReportStats } from "./report/collect";

/** No re-enviar si ya se mandó hace < esto (protege del doble tick del cron). */
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

export interface DailyReportResult {
  sent: boolean;
  reason?: "not_pro" | "disabled" | "throttled" | "no_channel_or_empty";
  stats?: Awaited<ReturnType<typeof collectDailyStats>>;
}

type ReportFormat = "html" | "docx" | "pdf";

function toBase64(data: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin);
}

async function deliver(env: Env, report: BuiltReport, format: ReportFormat): Promise<void> {
  // Archivo (DOCX/PDF) — solo si el dueño lo activó vía /reportes; si no, null → HTML.
  let file = null;
  if (format !== "html") {
    try {
      file = await renderReportFile(env, format, { html: report.html, model: report.model });
    } catch (e) {
      console.error(`[dailyReport] generador ${format} falló, uso HTML:`, e instanceof Error ? e.message : e);
    }
    if (!file) console.warn(`[dailyReport] formato ${format} no activado — corre /reportes. Enviando HTML.`);
  }

  // Email: teaser email-safe (+ adjunto si hay archivo).
  if (env.RESEND_API_KEY && env.OWNER_EMAIL) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: `${env.BUSINESS_NAME} <onboarding@resend.dev>`,
        to: env.OWNER_EMAIL,
        subject: report.subject,
        html: report.emailHtml,
        text: report.text,
        attachments: file ? [{ filename: file.filename, content: toBase64(file.content) }] : undefined,
      });
    } catch (e) {
      console.error("[dailyReport] resend failed:", e instanceof Error ? e.message : e);
    }
  }

  // Telegram: resumen + link al reporte completo.
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.OWNER_TELEGRAM_CHAT_ID,
          text: `${report.subject}\n\n${report.text}`,
        }),
      });
    } catch (e) {
      console.error("[dailyReport] telegram failed:", e instanceof Error ? e.message : e);
    }
  }
}

export async function sendDailyReport(env: Env, opts: { now?: number } = {}): Promise<DailyReportResult> {
  const now = opts.now ?? Date.now();
  if (!isPro(env)) return { sent: false, reason: "not_pro" };

  const settings = new SettingsRepo(new Db(env.DB));
  if ((await settings.get(SETTING_KEYS.dailyReport)) !== "1") return { sent: false, reason: "disabled" };

  const last = Number.parseInt((await settings.get(SETTING_KEYS.dailyReportLastAt)) ?? "0", 10) || 0;
  if (now - last < MIN_GAP_MS) return { sent: false, reason: "throttled" };

  const report = await buildReport(env, now);
  const stats = report.model.ctx.stats;

  // Día sin actividad, o sin canal de aviso: marca el envío (respeta el throttle)
  // pero no molesta / no puede entregar.
  const hasChannel =
    (env.RESEND_API_KEY && env.OWNER_EMAIL) || (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID);
  if (report.empty || !hasChannel) {
    if (!hasChannel)
      console.error("[dailyReport] sin canal (Telegram o Resend+OWNER_EMAIL) — el dueño no lo verá");
    await settings.set(SETTING_KEYS.dailyReportLastAt, String(now));
    return { sent: false, reason: "no_channel_or_empty", stats };
  }

  await settings.set(SETTING_KEYS.dailyReportLastAt, String(now));
  await settings.set(SETTING_KEYS.reportLastHtml, report.html); // para servir en /admin/report

  const format = (((await settings.get(SETTING_KEYS.reportFormat)) as ReportFormat) || "html") as ReportFormat;
  await deliver(env, report, format);
  return { sent: true, stats };
}
