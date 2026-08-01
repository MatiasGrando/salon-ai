// Pro dashboard "Config" tab — a VISUAL CONTROL PANEL for a non-technical owner
// (e.g. a barbershop owner). No raw numbers, no "pick 1-10": every technical
// setting is a group of 2-3 selectable cards (radio + inline SVG icon + short
// label + one-line plain-Spanish description). Text settings are plain inputs /
// textareas with clear labels (no jargon). The form POSTs to /admin/config.
import type { Env } from "../../env";
import { SETTING_KEYS } from "../../db/settings";
import { isPro } from "../../config";
import { stripeConfigured } from "../../integrations/stripe";
import { handoffNotifyStatus } from "../../tools/handoffHuman";
import { renderBusinessContext } from "../../businessContext";
import { CURATED_MODELS } from "../../llm/provider";
import {
  CONTROL_LIST,
  valueToLevel,
  type ControlDef,
} from "../control-levels";
import { layout } from "./layout";

/** Escape untrusted text before interpolating it into an HTML attribute/body. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// Brand accent = orange (Horizontes retro-terminal theme). The selected card
// lights up accent; the hidden radio drives the highlight via Tailwind's `peer`
// utilities so the whole card is clickable (it's a <label>).
const CARD_BASE =
  "peer-checked:border-accent peer-checked:bg-accent-soft " +
  "peer-checked:[&_.card-icon]:text-accent peer-checked:[&_.card-label]:text-accent " +
  "cfgcard flex flex-col gap-1 h-full border border-line bg-panel2 p-4 cursor-pointer";

/** Render one card group (radio cards) for a level-based control. */
function renderCardGroup(control: ControlDef, settings: Record<string, string>): string {
  const currentLevel = valueToLevel(control.key, settings[control.key]);
  const cards = control.options
    .map((opt) => {
      const id = `${control.key}__${opt.value}`;
      const checked = opt.label === currentLevel ? "checked" : "";
      return `
        <div class="relative">
          <input type="radio" id="${esc(id)}" name="${esc(control.key)}" value="${esc(opt.value)}"
                 class="peer sr-only absolute" ${checked}>
          <label for="${esc(id)}" class="${CARD_BASE}">
            <span class="card-icon text-dim">${opt.svg}</span>
            <span class="card-label font-display font-semibold text-[12.5px] text-cream">${esc(opt.label)}</span>
            <span class="text-dim text-[11px] leading-snug">${esc(opt.desc)}</span>
          </label>
        </div>`;
    })
    .join("");
  return `
    <fieldset style="display:flex;flex-direction:column;gap:8px">
      <legend class="font-display font-semibold text-[13.5px] text-cream">${esc(control.title)}</legend>
      <p class="text-muted text-[12px]">${esc(control.help)}</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${cards}</div>
    </fieldset>`;
}

const INPUT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Render a labeled single-line text field. */
function renderTextField(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <input type="text" id="${esc(opts.name)}" name="${esc(opts.name)}"
             value="${esc(opts.value)}" placeholder="${esc(opts.placeholder ?? "")}"
             style="${INPUT_STYLE}">
    </div>`;
}

/** Render a labeled multi-line textarea. */
function renderTextArea(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
  rows?: number;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <textarea id="${esc(opts.name)}" name="${esc(opts.name)}" rows="${opts.rows ?? 4}"
                placeholder="${esc(opts.placeholder ?? "")}"
                style="${INPUT_STYLE};resize:vertical">${esc(opts.value)}</textarea>
    </div>`;
}

const SELECT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Sección "Modelo de IA": proveedor + API key propia + modelo concreto. */
function renderLlmSection(settings: Record<string, string>, llmTest?: string): string {
  const provider = settings[SETTING_KEYS.llmProvider] ?? "";
  const model = settings[SETTING_KEYS.llmModel] ?? "";
  const hasKey = (settings[SETTING_KEYS.llmApiKey] ?? "").trim() !== "";
  const keyTail = hasKey ? (settings[SETTING_KEYS.llmApiKey] ?? "").trim().slice(-4) : "";

  const providerOpts = [
    { v: "", l: "Automático (recomendado)" },
    { v: "anthropic", l: "Claude (Anthropic)" },
    { v: "openai", l: "ChatGPT (OpenAI)" },
    { v: "xai", l: "Grok (xAI)" },
    { v: "google", l: "Gemini (Google)" },
  ]
    .map((o) => `<option value="${o.v}" ${provider === o.v ? "selected" : ""}>${o.l}</option>`)
    .join("");

  const anthropicOpts = CURATED_MODELS.filter((m) => m.provider === "anthropic")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const openaiOpts = CURATED_MODELS.filter((m) => m.provider === "openai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const xaiOpts = CURATED_MODELS.filter((m) => m.provider === "xai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const googleOpts = CURATED_MODELS.filter((m) => m.provider === "google")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");

  let testBanner = "";
  if (llmTest?.startsWith("ok:")) {
    testBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 13px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px">✓ Conexión exitosa — respondió ${esc(llmTest.slice(3))}</div>`;
  } else if (llmTest?.startsWith("err:")) {
    testBanner = `<div style="border:1px solid var(--danger,#e0654d);background:rgba(224,101,77,.1);color:var(--danger,#e0654d);padding:10px 13px;font-size:12px;font-weight:600;display:flex;flex-direction:column;gap:4px"><span>✕ Falló la prueba: ${esc(llmTest.slice(4, 200))}</span><span style="font-weight:400;opacity:.85">Revisa que la key sea del proveedor elegido y esté activa. Si dejaste el Proveedor en "Automático", puedes elegir el proveedor de tu key para forzarlo.</span></div>`;
  }

  // Estado activo actual — para que de un vistazo sepas qué IA está corriendo.
  const provLabel: Record<string, string> = {
    "": "Automático",
    anthropic: "Claude (Anthropic)",
    openai: "ChatGPT (OpenAI)",
    xai: "Grok (xAI)",
    google: "Gemini (Google)",
  };
  const curProv = provLabel[provider] ?? "Automático";
  const curModel = model ? (CURATED_MODELS.find((m) => m.id === model)?.label ?? model) : "Automático";
  const curKeySrc = hasKey ? `tu API key ····${esc(keyTail)}` : "key del sistema (incluida)";

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:3px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">🧠 Modelo de IA</h3>
        <p class="text-dim text-[12px]">Elige qué inteligencia usa tu bot. Déjalo en <b class="text-cream">Automático</b> y usa la configuración incluida, o pega <b class="text-cream">tu propia API key</b> para pagar tú el consumo directo con el proveedor.</p>
      </div>

      <!-- Para qué se usa esta IA -->
      <div style="border:1px solid var(--line);background:var(--panel2);padding:11px 13px;display:flex;flex-direction:column;gap:6px">
        <span class="text-cream text-[11.5px]" style="font-weight:600">Esta IA es el cerebro de tu bot. La misma que elijas aquí impulsa:</span>
        <ul class="text-dim text-[11px]" style="display:flex;flex-direction:column;gap:3px;margin:0;padding-left:16px;list-style:disc">
          <li><b class="text-cream">Responder mensajes</b> en WhatsApp/Instagram <span style="opacity:.7">— siempre activo, es el bot</span></li>
          <li><b class="text-cream">Insights</b> y <b class="text-cream">Mejoras</b> <span style="opacity:.7">— solo consumen cuando abres su panel</span></li>
          <li><b class="text-cream">Reportes de valor</b>, el <b class="text-cream">Cazador de ventas</b>, el <b class="text-cream">Blindaje anti-spam</b> y las <b class="text-cream">encuestas</b></li>
        </ul>
        <span class="text-dim text-[10.5px] leading-snug">Las funciones opcionales las prendes o apagas en <b class="text-cream">Superpoderes</b>, más abajo en esta misma página — así controlas cuánto consume tu IA.</span>
      </div>

      <!-- Estado activo -->
      <div style="display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--panel2);padding:9px 12px;font-size:11.5px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none"></span>
        <span class="text-dim">Ahora:</span>
        <span class="text-cream" style="font-weight:600">${esc(curProv)}</span>
        <span class="text-dim">·</span>
        <span class="text-cream">${esc(curModel)}</span>
        <span class="text-dim">·</span>
        <span class="text-cream">${curKeySrc}</span>
      </div>

      ${testBanner}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Proveedor</label>
          <select name="${SETTING_KEYS.llmProvider}" style="${SELECT_STYLE}">${providerOpts}</select>
          <p class="text-dim text-[10.5px] leading-snug">Con tu propia key, elige aquí <b class="text-cream">el proveedor de esa key</b> (Claude, ChatGPT, Grok o Gemini).</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Modelo</label>
          <select name="${SETTING_KEYS.llmModel}" style="${SELECT_STYLE}">
            <option value="" ${model === "" ? "selected" : ""}>Automático (rápido ⇄ inteligente)</option>
            <optgroup label="Claude (Anthropic)">${anthropicOpts}</optgroup>
            <optgroup label="ChatGPT (OpenAI)">${openaiOpts}</optgroup>
            <optgroup label="Grok (xAI)">${xaiOpts}</optgroup>
            <optgroup label="Gemini (Google)">${googleOpts}</optgroup>
          </select>
          <p class="text-dim text-[10.5px] leading-snug">Automático alterna barato/rápido ⇄ inteligente según la tarea.</p>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Tu API key <span class="text-dim" style="font-weight:400">(opcional)</span></label>
        <p class="text-dim text-[11px]">${hasKey ? `Hay una key guardada (termina en …${esc(keyTail)}). Escribe una nueva para reemplazarla, o marca la casilla para quitarla.` : "Pégala para que el consumo se cobre a tu cuenta. Vacío = usar la key incluida del sistema."}</p>
        <input type="password" name="${SETTING_KEYS.llmApiKey}" value="" autocomplete="off"
               placeholder="${hasKey ? "••••••••••••" : "sk-ant-…  ·  sk-…  ·  xai-…  ·  AIza…"}" style="${INPUT_STYLE}">
        ${hasKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="llm_api_key_clear" value="1"> Quitar mi API key y volver a la del sistema</label>` : ""}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px">
        <button type="submit" formmethod="post" formaction="/admin/config/llm-test" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:fit-content">
          ⚡ Probar y guardar mi IA
        </button>
        <p class="text-dim text-[11px]">Guarda tu proveedor, modelo y key, y los prueba con un mensaje real. Si tu key es válida, verás <span class="text-ok" style="font-weight:600">✓</span>.</p>
      </div>
    </div>`;
}

/** Un toggle (checkbox) de superpoder con etiqueta + descripción. */
function renderToggle(opts: {
  name: string;
  label: string;
  desc: string;
  checked: boolean;
  note?: string;
}): string {
  return `
    <label style="display:flex;gap:11px;align-items:flex-start;cursor:pointer;border:1px solid var(--line);background:var(--panel2);padding:13px 14px">
      <input type="checkbox" name="${esc(opts.name)}" value="1" ${opts.checked ? "checked" : ""}
             style="margin-top:3px;width:16px;height:16px;flex:none;accent-color:var(--accent)">
      <span style="display:flex;flex-direction:column;gap:2px">
        <span class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</span>
        <span class="text-dim text-[11px] leading-snug">${esc(opts.desc)}</span>
        ${opts.note ? `<span class="text-accent2 text-[10.5px]" style="margin-top:2px">${esc(opts.note)}</span>` : ""}
      </span>
    </label>`;
}

/** Sección "Superpoderes Forja+": los interruptores de los superpoderes de
 *  seguimiento. Solo Pro. Cobros/Reseñas muestran su requisito de conexión.
 *  El Cazador es default-ON (se apaga con "0"); el resto es opt-in ("1"). */
function renderSuperpoderesSection(env: Env, settings: Record<string, string>): string {
  const on = (k: string) => settings[k] === "1";
  const stripeOk = stripeConfigured(env);
  // Estado REAL (para que ningún toggle mienta): un superpoder puede estar
  // encendido pero no funcionar por falta de un prerequisito.
  const notify = handoffNotifyStatus(env); // canal para avisarte (Telegram/WhatsApp/correo)
  const reportOk =
    Boolean(env.RESEND_API_KEY && env.OWNER_EMAIL) ||
    Boolean(env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID);
  const reviewOk = (settings[SETTING_KEYS.reviewUrl] ?? "").trim() !== "";
  const waTemplateOk =
    (settings[SETTING_KEYS.reengageTemplateSid] ?? "").trim() !== "" ||
    (settings[SETTING_KEYS.reengageTemplateName] ?? "").trim() !== "";
  const blindajeOn = (settings[SETTING_KEYS.blindajeEnabled] ?? "") !== "off";
  const voiceCustom =
    (settings[SETTING_KEYS.brandVoice] ?? "").trim() !== "" ||
    (settings[SETTING_KEYS.tone] ?? "").trim() !== "";

  // Fila read-only de un superpoder automático (sin switch): punto verde/gris + estado.
  const statusRow = (label: string, ok: boolean, detail: string): string => `
    <div style="display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);background:var(--bg);padding:11px 13px">
      <span style="width:8px;height:8px;flex:none;margin-top:5px;border-radius:50%;background:${ok ? "var(--ok)" : "var(--dim)"}"></span>
      <span style="min-width:0">
        <span class="text-cream" style="font-size:12.5px;display:block">${label}</span>
        <span class="${ok ? "text-muted" : "text-dim"}" style="font-size:11px;line-height:1.4">${detail}</span>
      </span>
    </div>`;

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">⚡ Superpoderes</h3>
        <p class="text-dim text-[12px]">Enciende lo que quieras que tu bot haga solo. Todos corren en tu infraestructura, sin que muevas un dedo.</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        ${renderToggle({
          name: SETTING_KEYS.dailyReport,
          label: "📊 Reportes automáticos",
          desc: "Cada noche te llega un resumen del día por Telegram/correo.",
          checked: on(SETTING_KEYS.dailyReport),
          note: reportOk ? "Te llega por tu canal ✓" : "⚠ Falta canal de aviso (Telegram o correo) — no te llegará",
        })}
        ${renderToggle({
          name: SETTING_KEYS.multiLanguage,
          label: "🌎 Multi-idioma",
          desc: "Responde en el idioma del cliente (español, inglés o portugués).",
          checked: on(SETTING_KEYS.multiLanguage),
        })}
        ${renderToggle({
          name: SETTING_KEYS.satisfactionSurvey,
          label: "⭐ Encuestas de satisfacción",
          desc: "Pide calificación 1-5 tras atender y te avisa si es baja.",
          checked: on(SETTING_KEYS.satisfactionSurvey),
        })}
        ${renderToggle({
          name: SETTING_KEYS.reengageColdLeads,
          label: "🔄 Recupera no-shows",
          desc: "Reengancha leads calientes que se enfriaron por días.",
          checked: on(SETTING_KEYS.reengageColdLeads),
          note: waTemplateOk
            ? "Plantilla de WhatsApp lista ✓"
            : "En Telegram siempre; en WhatsApp fuera de 24h necesita plantilla ↓",
        })}
        ${renderToggle({
          name: SETTING_KEYS.salesHunter,
          label: "🎯 Cazador de ventas",
          desc: "Le escribe al cliente que preguntó y se enfrió (3–20h), en tu tono, y te avisa si era venta caliente.",
          checked: settings[SETTING_KEYS.salesHunter] !== "0",
        })}
        ${renderToggle({
          name: SETTING_KEYS.reviewRequests,
          label: "🌟 Pide reseñas",
          desc: "Invita a dejar reseña en Google a quien quedó contento.",
          checked: on(SETTING_KEYS.reviewRequests),
          note: reviewOk ? "Link de Google configurado ✓" : "⚠ Falta tu link de Google ↓ — no se activa",
        })}
        ${renderToggle({
          name: SETTING_KEYS.paymentsEnabled,
          label: "💰 Cobros por WhatsApp",
          desc: "El bot manda link de pago de Stripe y te avisa cuando pagan.",
          checked: on(SETTING_KEYS.paymentsEnabled),
          note: stripeOk ? "Stripe conectado ✓" : "Requiere conectar tu Stripe (secret STRIPE_SECRET_KEY)",
        })}
      </div>
      ${renderTextField({
        name: SETTING_KEYS.reviewUrl,
        label: "Tu link de reseñas de Google",
        help: "El link donde tus clientes dejan reseña (Google Business). Sin él, Pide reseñas no se activa.",
        value: settings[SETTING_KEYS.reviewUrl] ?? "",
        placeholder: "https://g.page/r/tu-negocio/review",
      })}
      ${renderTextField({
        name: SETTING_KEYS.reengageTemplateSid,
        label: "Plantilla de reenganche en WhatsApp (opcional)",
        help: "SID de tu plantilla HSM aprobada para reenganchar en WhatsApp fuera de 24h. En Telegram no se necesita.",
        value: settings[SETTING_KEYS.reengageTemplateSid] ?? "",
        placeholder: "HX…",
      })}
      ${renderSurveyMode(settings)}
      ${renderReportFormat(settings)}

      <div style="border-top:1px solid var(--line);padding-top:15px">
        <p class="text-dim" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 4px">También activos · automáticos (sin switch)</p>
        <p class="text-dim text-[11.5px]" style="margin:0 0 12px;line-height:1.5">Estos corren solos en Pro; aquí ves su estado real.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          ${statusRow("🛡️ Blindaje anti-invento", blindajeOn, blindajeOn ? "Verifica cada respuesta antes de enviarla" : "Apagado (blindaje_enabled = off)")}
          ${statusRow("🚨 Vigilante", notify.ok, notify.ok ? `Te avisa por ${notify.channels.join(" / ")}` : "Falta canal de aviso (Telegram/WhatsApp/correo)")}
          ${statusRow("📞 Handoff que atina", notify.ok, notify.ok ? `Pasa a humano por ${notify.channels.join(" / ")}` : "Falta canal de aviso (Telegram/WhatsApp/correo)")}
          ${statusRow("👂 Oído y vista", true, "Entiende notas de voz y lee imágenes")}
          ${statusRow("🎙️ Voz de marca", voiceCustom, voiceCustom ? "Voz personalizada activa" : "Usando el tono por defecto del giro")}
        </div>
      </div>
    </div>`;
}

/** Cómo pide la encuesta de satisfacción: número, opinión abierta o ambas. */
function renderSurveyMode(settings: Record<string, string>): string {
  const cur = settings[SETTING_KEYS.surveyMode] || "numerico";
  const opt = (v: string, label: string): string =>
    `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="text-cream text-[13px] font-medium">⭐ Cómo pide la encuesta</label>
      <select name="${SETTING_KEYS.surveyMode}" style="${SELECT_STYLE}">
        ${opt("numerico", "Calificación 1-5 (número)")}
        ${opt("abierto", "Opinión abierta (en sus palabras)")}
        ${opt("ambos", "Ambas — número + comentario")}
      </select>
      <p class="text-dim text-[11.5px]" style="line-height:1.5">
        Aplica cuando <b>Encuestas de satisfacción</b> está encendido. Las respuestas se ven en la tab <b>Reseñas</b>.
      </p>
    </div>`;
}

/** Selector de formato del reporte diario, con los requisitos de cada opción. */
function renderReportFormat(settings: Record<string, string>): string {
  const cur = settings[SETTING_KEYS.reportFormat] || "html";
  const opt = (v: string, label: string): string =>
    `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="text-cream text-[13px] font-medium">📊 Formato del reporte diario</label>
      <select name="${SETTING_KEYS.reportFormat}" style="${SELECT_STYLE}">
        ${opt("html", "Email + página web (recomendado · listo)")}
        ${opt("docx", "Word .docx adjunto (activar con /reportes)")}
        ${opt("pdf", "PDF adjunto (requiere Browser Rendering · /reportes)")}
      </select>
      <p class="text-dim text-[11.5px]" style="line-height:1.5">
        El <b>email + página</b> funciona ya y es el más vistoso. <b>Word</b> y <b>PDF</b> se entregan como archivo —
        córrelas con el skill <b>/reportes</b>, que además diseña el reporte con tu marca (colores, logo) y activa lo técnico.
        El PDF necesita <b>Cloudflare Browser Rendering</b> (plan pagado).
      </p>
    </div>`;
}

/**
 * Render the Config tab. Receives the current settings overlay (Record from
 * SettingsRepo.all()). `saved` shows the "Guardado ✓" confirmation banner after
 * a redirect from POST /admin/config?saved=1.
 */
export function renderConfig(
  env: Env,
  settings: Record<string, string>,
  saved = false,
  llmTest?: string,
): string {
  const cardGroups = CONTROL_LIST.map((c) => renderCardGroup(c, settings)).join("");

  const savedBanner = saved
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 14px;font-size:12.5px;font-weight:600">Guardado ✓</div>`
    : "";

  const body = `
    <form method="POST" action="/admin/config" style="display:flex;flex-direction:column;gap:28px">
      ${savedBanner}

      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">Panel de control de ${esc(env.BUSINESS_NAME)}</h2>
        <p class="text-muted text-[12.5px]">Ajuste cómo se comporta su bot. Los cambios se guardan al presionar el botón de abajo.</p>
      </div>

      <!-- Card-based controls (tono, velocidad, estilo, cerebro, estado) -->
      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:22px">
        ${cardGroups}
      </div>

      <!-- Superpoderes Forja+ (toggles) — solo Pro -->
      ${isPro(env) ? renderSuperpoderesSection(env, settings) : ""}

      <!-- Modelo de IA (BYO provider/key/model) -->
      ${renderLlmSection(settings, llmTest)}

      <!-- Free-text settings -->
      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
        ${renderTextField({
          name: SETTING_KEYS.botName,
          label: "Nombre del bot",
          help: "Cómo se presenta su asistente con los clientes.",
          value: settings[SETTING_KEYS.botName] ?? "",
          placeholder: env.BOT_NAME ?? "Mi asistente",
        })}

        ${renderTextArea({
          name: SETTING_KEYS.businessContext,
          label: "Información del negocio",
          help: "Horarios, servicios, precios, ubicación. El bot responde con esto. Editable en vivo — se aplica al guardar, sin re-desplegar.",
          // Pre-llenado: si el panel aún no tiene override, muestra lo que el
          // onboarding cargó en member/config.local (renderBusinessContext) para
          // que el miembro VEA y edite sus horarios aquí desde el día 1.
          value: settings[SETTING_KEYS.businessContext] || renderBusinessContext(),
          placeholder: "Ej. Abrimos lunes a sábado de 9 a 7. Corte $150, barba $100. Estamos en Av. Reforma 123.",
          rows: 6,
        })}

        ${renderTextArea({
          name: SETTING_KEYS.systemPromptOverride,
          label: "Instrucciones personalizadas",
          help: "Personalidad o reglas especiales. Déjalo vacío para usar la configuración automática.",
          value: settings[SETTING_KEYS.systemPromptOverride] ?? "",
          placeholder: "Ej. Siempre ofrece agendar una cita al final.",
          rows: 4,
        })}

        ${renderTextField({
          name: SETTING_KEYS.escalationKeywords,
          label: "Palabras que piden un humano",
          help: "Si el cliente escribe alguna, el bot avisa a una persona. Sepárelas con comas.",
          value: settings[SETTING_KEYS.escalationKeywords] ?? "",
          placeholder: "queja, reembolso, hablar con alguien",
        })}
      </div>

      <button type="submit" class="bigbtn font-display font-bold text-[13px] cursor-pointer"
              style="width:fit-content;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:4px 4px 0 var(--linelit);padding:13px 24px;display:flex;align-items:center;gap:9px">
        <i data-lucide="check" width="16" height="16"></i> Guardar cambios
      </button>
    </form>`;

  return layout({ title: "Config", activeTab: "config", body, env });
}
