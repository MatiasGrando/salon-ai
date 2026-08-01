/**
 * Arma el reporte completo: junta datos → IA escribe insights → llena la
 * plantilla (la custom del dueño si existe, si no la default). Devuelve el HTML
 * rico (página/PDF), el email-safe y el texto. No manda nada (eso lo hace dailyReport).
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { selfOrigin } from "../../lib/self-origin";
import { collectReportContext } from "./collect";
import { generateReportInsights } from "./insights";
import {
  DEFAULT_ACCENT,
  DEFAULT_REPORT_TEMPLATE,
  renderReportEmail,
  renderReportHtml,
  renderReportText,
  type ReportModel,
} from "./template";

export interface BuiltReport {
  subject: string;
  html: string; // reporte completo (página/PDF)
  emailHtml: string; // email-safe (teaser + botón)
  text: string;
  model: ReportModel;
  empty: boolean;
}

function dateLabel(now: number): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(now),
    );
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export async function buildReport(env: Env, now: number): Promise<BuiltReport> {
  const ctx = await collectReportContext(env, now);
  const empty = ctx.stats.customerMessages === 0 && ctx.stats.newLeads === 0;

  const settings = new SettingsRepo(new Db(env.DB));
  const [customTemplate, accent, logo] = await Promise.all([
    settings.get(SETTING_KEYS.reportTemplate),
    settings.get(SETTING_KEYS.reportAccent),
    settings.get(SETTING_KEYS.reportLogo),
  ]);

  const insights = empty
    ? { summary: "Día tranquilo — hoy no hubo mensajes de clientes.", insights: [], actions: [] }
    : await generateReportInsights(env, ctx);

  const model: ReportModel = {
    businessName: env.BUSINESS_NAME,
    dateLabel: dateLabel(now),
    accent: (accent && accent.trim()) || DEFAULT_ACCENT,
    logoUrl: (logo && logo.trim()) || null,
    panelUrl: `${await selfOrigin(env)}/admin/report`,
    ctx,
    insights,
  };

  return {
    subject: `📊 Tu resumen de hoy — ${env.BUSINESS_NAME}`,
    html: renderReportHtml(model, (customTemplate && customTemplate.trim()) || DEFAULT_REPORT_TEMPLATE),
    emailHtml: renderReportEmail(model),
    text: renderReportText(model),
    model,
    empty,
  };
}
