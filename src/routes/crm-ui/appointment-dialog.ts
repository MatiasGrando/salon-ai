/**
 * Appointment presentation only. Data, permission checks and financial commands
 * belong to the existing Agenda and Caja controllers.
 */
export const appointmentDialogStyles = `
  #appointment-dialog, #appointment-checkout {
    --ap-blue: #2563eb;
    --ap-ink: #152033;
    --ap-muted: #64748b;
    --ap-line: #dbe2eb;
    --ap-soft: #f8fafc;
    --ap-chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='m4 6 4 4 4-4' stroke='%2364748b' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    position: fixed; inset: 0; display: grid; place-items: center;
    padding: 18px; background: #14243c66; color: var(--ap-ink);
    font: 14px/1.45 Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    z-index: 1000;
  }
  #appointment-checkout { z-index: 1010; padding: 14px; }
  :is(#appointment-dialog, #appointment-checkout) *, :is(#appointment-dialog, #appointment-checkout) *::before, :is(#appointment-dialog, #appointment-checkout) *::after { box-sizing: border-box; }
  :is(#appointment-dialog, #appointment-checkout)[hidden], :is(#appointment-dialog, #appointment-checkout) [hidden] { display: none !important; }
  :is(#appointment-dialog, #appointment-checkout) :is(button, input, select, textarea) { font: inherit; letter-spacing: normal; }
  :is(#appointment-dialog, #appointment-checkout) button { cursor: pointer; }
  :is(#appointment-dialog, #appointment-checkout) button:disabled { opacity: .45; cursor: not-allowed; }
  :is(#appointment-dialog, #appointment-checkout) :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--ap-blue); outline-offset: 2px; }
  #appointment-dialog .appointment-dialog-card {
    width: min(980px, 100%); max-width: none; height: auto; max-height: calc(100dvh - 36px);
    display: flex; flex-direction: column; margin: 0; padding: 0; resize: none;
    border: 1px solid var(--ap-line); border-radius: 14px; overflow: hidden;
    background: white; box-shadow: 0 12px 36px #172b4d0c; color: var(--ap-ink);
  }
  #appointment-dialog[data-mode="new"] .appointment-dialog-card { width: min(600px, 100%); }
  :is(#appointment-dialog, #appointment-checkout) .ap-head,
  #appointment-dialog .ap-foot { padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: 0 0 auto; }
  :is(#appointment-dialog, #appointment-checkout) .ap-head { border-bottom: 1px solid var(--ap-line); }
  #appointment-dialog .ap-head :is(h2, h3), #appointment-checkout .ap-head h2 { font-size: 19px; line-height: 1.45; margin: 0; font-weight: 700; }
  #appointment-dialog .ap-head p { margin: 4px 0 0; }
  :is(#appointment-dialog, #appointment-checkout) :is(small, .ap-muted) { color: var(--ap-muted); }
  #appointment-dialog .appointment-form { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0; padding: 0; gap: 0; }
  #appointment-dialog .appointment-modal-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 22px; }
  #appointment-dialog .appointment-modal-body::-webkit-scrollbar, #appointment-checkout .ap-body::-webkit-scrollbar { width: 7px; }
  #appointment-dialog .appointment-modal-body::-webkit-scrollbar-thumb, #appointment-checkout .ap-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
  #appointment-dialog .ap-columns { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 24px; }
  #appointment-dialog .ap-stack { display: grid; align-content: start; gap: 8px; min-width: 0; }
  #appointment-dialog .ap-finance-stack { gap: 12px; }
  #appointment-dialog .ap-summary, #appointment-dialog .appointment-create-summary { display: grid; gap: 9px; margin: 0; }
  #appointment-dialog .ap-summary > div, #appointment-dialog .appointment-create-summary > div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  #appointment-dialog .ap-summary span, #appointment-dialog .appointment-create-summary span { color: var(--ap-muted); }
  #appointment-dialog .ap-quick { display: grid; gap: 8px; }
  #appointment-dialog .ap-rightlinks { display: flex; align-items: center; justify-content: center; gap: 9px; flex-wrap: wrap; }
  #appointment-dialog .ap-rightlinks .ap-btn { font-size: 12px; }
  #appointment-dialog .ap-section-title, #appointment-checkout .ap-section-title { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
  #appointment-dialog .ap-caps { font-size: 11px; letter-spacing: .08em; color: var(--ap-muted); text-transform: uppercase; }
  #appointment-dialog .ap-grid2, #appointment-checkout .ap-grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  :is(#appointment-dialog, #appointment-checkout) .ap-field,
  #appointment-dialog :is(.appointment-finance-row, .appointment-total-adjust-grid, .appointment-product-add-row, .appointment-correction-panel) label {
    display: grid; gap: 5px; margin: 0 0 13px; color: var(--ap-ink); font-size: 12px; font-weight: 600; min-width: 0;
  }
  :is(#appointment-dialog, #appointment-checkout) .ap-field :is(input, select, textarea),
  #appointment-dialog :is(.appointment-create-payment-content, .appointment-finance-content, .appointment-product-content, .appointment-correction-panel) :is(input:not([type="checkbox"]), select, textarea) {
    width: 100%; min-width: 0; min-height: 0; height: auto; border: 1px solid #cbd5e1; border-radius: 8px;
    padding: 10px; background-color: white; color: var(--ap-ink); font-size: 14px; font-weight: 400; line-height: 1.45; box-shadow: none;
  }
  :is(#appointment-dialog, #appointment-checkout) input::placeholder { color: #8591a3; }
  :is(#appointment-dialog, #appointment-checkout) select { appearance: none; -webkit-appearance: none; background-image: var(--ap-chevron); background-repeat: no-repeat; background-size: 16px 16px; background-position: right 10px center; padding-right: 32px !important; }
  :is(#appointment-dialog, #appointment-checkout) textarea { resize: vertical; }
  :is(#appointment-dialog, #appointment-checkout) .ap-btn,
  #appointment-dialog :is(.appointment-create-payment-content, .appointment-finance-content, .appointment-product-content, .appointment-correction-panel) button {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: auto; min-height: 0; margin: 0;
    background: white; color: var(--ap-ink); border: 1px solid var(--ap-line); padding: 10px 14px;
    border-radius: 8px; font-size: 14px; font-weight: 600; line-height: 1.45; white-space: nowrap; box-shadow: none; text-decoration: none;
  }
  :is(#appointment-dialog, #appointment-checkout) .ap-btn.ap-primary,
  #appointment-dialog :is(.appointment-create-payment-content, .appointment-finance-content, .appointment-product-content, .appointment-correction-panel) button.primary { background: var(--ap-blue); color: white; border-color: var(--ap-blue); }
  :is(#appointment-dialog, #appointment-checkout) .ap-btn.ap-link { border: 0; background: none; color: var(--ap-blue); padding: 5px 0; }
  #appointment-dialog .ap-btn.ap-danger { color: #b91c1c; }
  :is(#appointment-dialog, #appointment-checkout) .ap-full { width: 100%; }
  #appointment-dialog .ap-row { display: flex; align-items: center; gap: 9px; min-width: 0; }
  #appointment-dialog .ap-between { justify-content: space-between; }
  #appointment-dialog .ap-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  #appointment-dialog .ap-divider, #appointment-checkout .ap-divider { border: 0; border-top: 1px solid var(--ap-line); margin: 17px 0; }
  #appointment-dialog .ap-panel { border: 1px solid var(--ap-line); border-radius: 10px; padding: 14px; margin: 0; background: white; box-shadow: none; }
  #appointment-dialog .ap-panel h4 { font-size: 14px; margin: 0; color: var(--ap-ink); }
  #appointment-dialog .ap-panel p { margin: 6px 0 0; }
  #appointment-dialog details > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; list-style: none; color: var(--ap-ink); }
  #appointment-dialog details > summary::-webkit-details-marker { display: none; }
  #appointment-dialog details > summary::after { content: ''; display: block; width: 16px; height: 16px; flex: 0 0 16px; background: var(--ap-chevron) center/16px no-repeat; border: 0; transform: none; transition: transform .15s; }
  #appointment-dialog details[open] > summary::after { transform: rotate(180deg); }
  #appointment-dialog details[open] > summary { margin-bottom: 12px; }
  #appointment-dialog .ap-compact { padding: 12px 14px; }
  #appointment-dialog .ap-compact[open] > summary { margin-bottom: 7px; }
  #appointment-dialog .ap-compact .ap-field { margin-bottom: 0; gap: 4px; }
  #appointment-dialog .ap-compact textarea { min-height: 48px; padding: 8px 10px; }
  #appointment-dialog .ap-statusbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  #appointment-dialog .ap-statusbar select { border: 1px solid var(--ap-line); border-radius: 7px; padding: 6px; color: var(--ap-ink); background-color: white; }
  #appointment-dialog .ap-pill { font-size: 11px; font-weight: 650; border-radius: 20px; padding: 4px 9px; background: #f1f5f9; color: #475569; display: inline-block; }
  #appointment-dialog .ap-pill.pending { background: #fff4d9; color: #92630c; }
  #appointment-dialog .ap-pill.done { background: #e5f6eb; color: #18713e; }
  #appointment-dialog .ap-pill.absent { background: #feecec; color: #a52b2b; }
  #appointment-dialog .appointment-origin-summary { display: inline-flex; gap: 4px; align-items: center; margin: 0; color: var(--ap-muted); font-size: 12px; }
  #appointment-dialog .ap-avatar { height: 34px; width: 34px; flex: 0 0 34px; border-radius: 50%; background: #eef2f7; display: grid; place-items: center; font-weight: 700; color: var(--ap-muted); }
  #appointment-dialog .ap-customer-summary { margin-top: 10px; }
  #appointment-dialog .ap-customer-details { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  #appointment-dialog .ap-customer-fields { margin-top: 12px; }
  #appointment-dialog .appointment-customer-combobox { position: relative; }
  #appointment-dialog .appointment-customer-results { position: absolute; left: 0; right: 0; top: calc(100% + 4px); max-height: 220px; overflow-y: auto; z-index: 4; background: white; border: 1px solid var(--ap-line); border-radius: 8px; box-shadow: 0 8px 20px #14243c14; }
  #appointment-dialog .appointment-customer-results button { width: 100%; text-align: left; white-space: normal; }
  #appointment-dialog .appointment-visit-services { margin-top: 0; }
  #appointment-dialog .appointment-visit-services-header { display: block; margin: 0 0 10px; }
  #appointment-dialog .appointment-visit-services-list { margin: 10px 0 0; }
  #appointment-dialog #appointment-service-edit-slot { margin-top: 10px; }
  #appointment-dialog #appointment-service-edit-slot > summary { font-size: 12px; color: var(--ap-muted); }
  #appointment-dialog #appointment-service-edit-slot .ap-field { margin-bottom: 0; }
  #appointment-dialog .appointment-visit-service { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  #appointment-dialog .appointment-visit-service + .appointment-visit-service { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ap-line); }
  #appointment-dialog .appointment-visit-service small { display: block; }
  #appointment-dialog .appointment-add-service-panel { margin-top: 8px; padding: 10px; background: var(--ap-soft); border: 1px solid var(--ap-line); border-radius: 8px; }
  #appointment-dialog .appointment-add-service-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8px; }
  #appointment-dialog .appointment-add-service-grid .full { grid-column: 1 / -1; }
  #appointment-dialog .appointment-add-service-actions { display: flex; justify-content: flex-end; gap: 8px; }
  #appointment-dialog .appointment-add-service-actions button { padding: 7px 11px; font-size: 12px; }
  #appointment-dialog .appointment-technical-profile-header { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
  #appointment-dialog .appointment-technical-profile-action { font-size: 12px; }
  #appointment-dialog .appointment-technical-profile-display { font-size: 12px; color: var(--ap-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
  #appointment-dialog .appointment-technical-profile-editor { margin-top: 6px; }
  #appointment-dialog .appointment-technical-profile-editor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  :is(#appointment-dialog, #appointment-checkout) .ap-feedback { font-size: 12px; color: #b91c1c; margin: 10px 0 0; overflow-wrap: anywhere; }
  :is(#appointment-dialog, #appointment-checkout) .ap-feedback:empty { display: none; }
  #appointment-dialog .appointment-deposit-option label { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-weight: 600; }
  #appointment-dialog .appointment-deposit-option input[type="checkbox"] { width: auto; accent-color: var(--ap-blue); }
  #appointment-dialog .appointment-deposit-amount { margin-top: 10px; }
  #appointment-dialog .ap-foot { border-top: 1px solid var(--ap-line); flex-wrap: wrap; }
  #appointment-dialog .ap-save-actions { margin-left: auto; }
  #appointment-dialog .ap-more-actions { position: relative; }
  #appointment-dialog .ap-more-actions[open] > summary { margin: 0; }
  #appointment-dialog .ap-more-menu { display: grid; gap: 6px; position: absolute; bottom: calc(100% + 12px); left: 0; min-width: 190px; padding: 8px; border: 1px solid var(--ap-line); border-radius: 8px; background: white; box-shadow: 0 8px 20px #14243c14; z-index: 5; }
  #appointment-dialog .ap-tabs, #appointment-dialog .ap-mobilebar { display: none; }
  #appointment-dialog .ap-tabs { gap: 0; border-bottom: 1px solid var(--ap-line); margin-bottom: 16px; }
  #appointment-dialog .ap-tabs button { flex: 1; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: white; padding: 11px 4px; color: var(--ap-muted); font-weight: 600; }
  #appointment-dialog .ap-tabs button[aria-selected="true"] { color: var(--ap-blue); border-bottom-color: var(--ap-blue); }
  :is(#appointment-dialog, #appointment-checkout) .ap-money { font-size: 29px; font-weight: 750; letter-spacing: -.035em; margin: 5px 0 12px; font-variant-numeric: tabular-nums; color: var(--ap-ink); }
  #appointment-dialog .ap-money-small { font-size: 20px; margin: 0; }
  #appointment-dialog .ap-mobilebar { padding: 12px 14px; border-top: 1px solid var(--ap-line); align-items: center; justify-content: space-between; gap: 8px; background: white; flex: 0 0 auto; }
  #appointment-dialog[data-mode="new"] :is(.ap-edit-only, .ap-statusbar, .ap-more-actions, .ap-tabs, .ap-mobilebar, .ap-finance-stack, .appointment-visit-services) { display: none !important; }
  #appointment-dialog[data-mode="edit"] .ap-new-only { display: none !important; }
  #appointment-dialog[data-mode="new"] .ap-columns { display: block; }
  #appointment-dialog[data-mode="new"] .ap-datetime-field { grid-column: 1 / -1; }
  #appointment-dialog[data-mode="new"] .ap-datetime-field { margin-bottom: 0; }
  #appointment-dialog[data-mode="new"] #appointment-customer-card { padding: 0; border: 0; border-radius: 0; }
  #appointment-dialog[data-mode="new"] .ap-customer-fields { margin-top: 0; }
  #appointment-dialog[data-mode="new"] .ap-customer-title { font-size: 11px; letter-spacing: .08em; color: var(--ap-muted); text-transform: uppercase; margin: 0 0 12px; }
  #appointment-dialog[data-mode="new"] .ap-new-client-divider { margin: 9px 0 17px; }
  #appointment-dialog[data-mode="new"] .ap-stack { gap: 12px; }
  #appointment-dialog[data-mode="new"] .ap-additional-slot { margin-top: 0; }
  #appointment-dialog .ap-initial-finance-slot { margin-top: 4px; }
  #appointment-checkout .ap-checkout-card { width: min(410px, 100%); max-height: 94dvh; display: flex; flex-direction: column; overflow: hidden; background: white; border-radius: 14px; box-shadow: 0 24px 80px #14243c33; }
  #appointment-checkout .ap-body { min-height: 0; overflow-y: auto; padding: 12px 22px 22px; overscroll-behavior: contain; }
  #appointment-checkout .ap-center { text-align: center; }
  #appointment-checkout .ap-close { background: none; border: 0; color: var(--ap-muted); font-size: 20px; font-weight: 400; line-height: 1; padding: 5px; }
  #appointment-dialog .ap-close { min-width: 24px; }
  #appointment-checkout .ap-radio { display: flex; align-items: center; gap: 9px; border: 1px solid var(--ap-line); padding: 10px; border-radius: 8px; margin: 0 0 7px; font-weight: 400; }
  #appointment-checkout .ap-radio:has(input:checked) { border-color: var(--ap-blue); background: #f5f8ff; }
  #appointment-checkout :is(.ap-radio, .ap-check) input { accent-color: var(--ap-blue); width: auto; flex: 0 0 auto; margin: 3px 0 0; }
  #appointment-checkout .ap-check { display: flex; gap: 8px; align-items: flex-start; font-weight: 600; }
  #appointment-checkout .ap-note { font-size: 12px; color: var(--ap-muted); margin: 12px 0; }
  #appointment-checkout .ap-info { background: var(--ap-soft); border-radius: 8px; padding: 11px; font-size: 12px; color: var(--ap-muted); margin-bottom: 12px; }
  #appointment-checkout .ap-info:empty { display: none; }
  :is(#appointment-dialog, #appointment-checkout) .ap-mix-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
  :is(#appointment-dialog, #appointment-checkout) .ap-mix-grid .ap-field { margin-bottom: 4px; }
  #appointment-checkout .ap-mix-note { display: block; margin-bottom: 8px; font-size: 12px; }
  #appointment-checkout .ap-mix-note.invalid { color: #b91c1c; }
  #appointment-checkout .ap-mix-note.valid { color: #18713e; }
  #appointment-checkout [aria-busy="true"] { cursor: progress; }
  @media (max-width: 700px) {
    #appointment-dialog { padding: 10px; }
    #appointment-dialog .appointment-dialog-card { max-height: calc(100dvh - 20px); border-radius: 10px; }
    #appointment-dialog .ap-columns { display: block; }
    #appointment-dialog[data-mode="edit"] :is(.ap-tabs, .ap-mobilebar) { display: flex; }
    #appointment-dialog .appointment-modal-body { padding: 14px; }
    #appointment-dialog[data-mode="new"] .appointment-modal-body { padding: 15px; }
    :is(#appointment-dialog, #appointment-checkout) .ap-head, #appointment-dialog .ap-foot { padding: 14px; }
    #appointment-dialog .ap-save-actions { width: 100%; justify-content: flex-end; }
    #appointment-dialog .ap-grid2, #appointment-checkout .ap-grid2 { gap: 8px; }
    #appointment-dialog .ap-statusbar { justify-content: flex-start; }
    #appointment-dialog .ap-statusbar .appointment-origin-summary { display: none; }
    #appointment-dialog .ap-finance-stack { margin: 0; }
    #appointment-dialog .ap-head .ap-actions { gap: 6px; }
    #appointment-dialog .ap-head .ap-btn { padding: 8px; }
    #appointment-checkout .ap-body { padding-left: 22px; padding-right: 22px; }
  }
  @media (max-width: 380px) {
    :is(#appointment-dialog, #appointment-checkout) .ap-mix-grid { grid-template-columns: 1fr; }
    #appointment-dialog .ap-save-actions { gap: 6px; }
    #appointment-dialog .ap-save-actions .ap-btn { padding-left: 10px; padding-right: 10px; }
    #appointment-dialog .ap-save-actions #appointment-dirty-note { width: 100%; text-align: right; }
  }
  @media (prefers-reduced-motion: reduce) {
    #appointment-dialog details > summary::after { transition: none; }
  }
`

export type AppointmentDialogMarkupOptions = {
  cashRegisterEnabled: boolean
  financeCreateMarkup?: string
  financeEditMarkup?: string
  productsMarkup?: string
  correctionMarkup?: string
}

/** Slots accept trusted application markup, never user text. */
export function renderAppointmentDialogMarkup(options: AppointmentDialogMarkupOptions): string {
  const { cashRegisterEnabled, financeCreateMarkup = '', financeEditMarkup = '', productsMarkup = '', correctionMarkup = '' } = options
  return `
    <div class="dialog-backdrop ap-shell" id="appointment-dialog" data-mode="new" hidden>
      <section class="dialog appointment-dialog-card" role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title" tabindex="-1">
        <header class="dialog-header ap-head">
          <div><h3 id="appointment-dialog-title">Nuevo turno</h3><p class="ap-muted ap-edit-only" id="appointment-header-date"></p></div>
          <div class="appointment-dialog-header-actions ap-actions">
            <a class="whatsapp ap-btn" id="appointment-whatsapp" href="#" title="Abrir WhatsApp Desktop" aria-label="Abrir WhatsApp Desktop" data-icon="whatsapp" hidden></a>
            <button class="ap-btn" id="appointment-open-chat" type="button" title="Abrir chat del cliente" aria-label="Abrir chat del cliente" data-icon="mail" hidden></button>
            <div class="appointment-attention-picker" id="appointment-attention-picker" hidden>
              <input id="appointment-attention-color" type="hidden" value="NONE">
              <button class="appointment-attention-toggle ap-btn" id="appointment-attention-toggle" type="button" title="Marcar turno para atenci&oacute;n" aria-label="Marcar turno para atenci&oacute;n" aria-haspopup="menu" aria-expanded="false"><span class="appointment-attention-dot" aria-hidden="true"></span></button>
              <div class="appointment-attention-menu" id="appointment-attention-menu" role="menu" hidden>
                <button type="button" role="menuitemradio" data-appointment-attention="NONE"><span class="appointment-attention-option-dot"></span>Sin color</button>
                <button type="button" role="menuitemradio" data-appointment-attention="YELLOW"><span class="appointment-attention-option-dot attention-yellow"></span>Amarillo</button>
                <button type="button" role="menuitemradio" data-appointment-attention="ORANGE"><span class="appointment-attention-option-dot attention-orange"></span>Naranja</button>
              </div>
            </div>
            <button class="ap-btn ap-close" id="appointment-close" type="button" title="Cerrar" aria-label="Cerrar turno">&times;</button>
          </div>
        </header>
        <form class="appointment-form" id="appointment-form" novalidate>
          <div class="appointment-modal-body">
            <div class="ap-statusbar" id="appointment-statusbar">
              <div class="ap-row"><span class="ap-pill pending" id="appointment-state-label">Pendiente</span><span class="ap-pill" id="appointment-financial-state">Sin pago</span><div class="appointment-origin-summary" id="appointment-origin-row" hidden><span id="appointment-origin-badge" aria-hidden="true"></span><span>Origen: <strong id="appointment-origin-label"></strong></span></div></div>
              <select aria-label="Cambiar estado del turno" id="appointment-status-select"><option value="CONFIRMED">Pendiente</option><option value="COMPLETED">Realizado</option><option value="NO_SHOW">Ausente</option></select>
            </div>
            <div class="ap-tabs" role="tablist" aria-label="Secciones del turno">
              <button type="button" role="tab" id="appointment-tab-turno" data-appointment-tab="turno" aria-controls="appointment-panel-turno" aria-selected="true">Turno</button>
              <button type="button" role="tab" id="appointment-tab-cliente" data-appointment-tab="cliente" aria-controls="appointment-panel-cliente" aria-selected="false" tabindex="-1">Cliente</button>
              ${cashRegisterEnabled ? '<button type="button" role="tab" id="appointment-tab-pago" data-appointment-tab="pago" aria-controls="appointment-panel-pago" aria-selected="false" tabindex="-1">Pago</button>' : ''}
            </div>
            <div class="ap-columns">
              <div class="ap-stack">
                <section id="appointment-panel-turno" data-appointment-tabpanel="turno" aria-labelledby="appointment-tab-turno">
                  <h4 class="ap-section-title" id="appointment-data-title">Datos del turno</h4>
                  <div class="ap-grid2" id="appointment-primary-fields">
                    <label class="ap-field ap-datetime-field" for="appointment-start">Fecha y hora<input class="field" id="appointment-start" type="datetime-local" required></label>
                    <label class="ap-field" for="appointment-professional">Profesional<select id="appointment-professional" required></select></label>
                    <label class="ap-field" id="appointment-service-field" for="appointment-service">Servicio<select id="appointment-service" required></select></label>
                  </div>
                  <section class="appointment-visit-services ap-panel" id="appointment-visit-services" hidden>
                    <div class="appointment-visit-services-header"><h4>Servicios de la visita</h4></div>
                    <details id="appointment-service-edit-slot"><summary>Cambiar servicio de este turno</summary></details>
                    <div class="appointment-visit-services-list" id="appointment-visit-services-list"></div>
                    <button class="ap-btn ap-link" id="appointment-add-service-open" type="button" aria-expanded="false" aria-controls="appointment-add-service-panel">+ Agregar servicio</button>
                    <div class="appointment-add-service-panel" id="appointment-add-service-panel" hidden>
                      <div class="appointment-add-service-grid">
                        <label class="ap-field" for="appointment-add-service-service">Servicio<select id="appointment-add-service-service"></select></label>
                        <label class="ap-field" for="appointment-add-service-professional">Profesional<select id="appointment-add-service-professional"></select></label>
                        <label class="ap-field full" for="appointment-add-service-start">Comienza<input class="field" id="appointment-add-service-start" type="datetime-local"></label>
                      </div>
                      <p class="appointment-add-service-feedback ap-feedback" id="appointment-add-service-feedback" role="status"></p>
                      <div class="appointment-add-service-actions"><button class="ap-btn" id="appointment-add-service-cancel" type="button">Cancelar</button><button class="ap-btn ap-primary" id="appointment-add-service-submit" type="button">Agregar a la visita</button></div>
                    </div>
                  </section>
                  ${cashRegisterEnabled ? correctionMarkup : ''}
                </section>
                <hr class="ap-divider ap-new-only ap-new-client-divider">
                <section class="ap-stack" id="appointment-panel-cliente" data-appointment-tabpanel="cliente" aria-labelledby="appointment-tab-cliente">
                  <section class="ap-panel" id="appointment-customer-card">
                    <h4 class="ap-customer-title">Cliente</h4>
                    <div class="ap-row ap-customer-summary ap-edit-only"><span class="ap-avatar" id="appointment-customer-avatar" aria-hidden="true"></span><div class="ap-customer-details"><strong id="appointment-customer-name-display"></strong><br><small id="appointment-customer-phone-display"></small></div><button class="ap-btn ap-link" id="appointment-customer-edit" type="button" aria-expanded="false" aria-controls="appointment-customer-fields">Editar</button></div>
                    <div class="ap-customer-fields" id="appointment-customer-fields">
                      <label class="ap-field" for="appointment-customer-search"><span class="ap-edit-only">Buscar cliente existente</span><div class="appointment-customer-combobox"><input id="appointment-customer" type="hidden"><input class="field" id="appointment-customer-search" autocomplete="off" placeholder="Buscar por nombre o tel&eacute;fono" aria-label="Buscar cliente" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="appointment-customer-results"><div class="appointment-customer-results" id="appointment-customer-results" role="listbox" hidden></div></div></label>
                      <div class="ap-grid2"><label class="ap-field" for="appointment-customer-name">Nombre<input class="field" id="appointment-customer-name"></label><label class="ap-field" for="appointment-customer-phone">Tel&eacute;fono<input class="field" id="appointment-customer-phone" type="tel"></label></div>
                    </div>
                  </section>
                  <details class="appointment-customer-technical-profile ap-panel ap-compact" id="appointment-customer-technical-profile" aria-labelledby="appointment-customer-technical-profile-title" hidden>
                    <summary id="appointment-customer-technical-profile-title">Ficha t&eacute;cnica del cliente</summary>
                    <div class="appointment-technical-profile-header"><button class="appointment-technical-profile-action ap-btn ap-link" id="appointment-customer-technical-profile-edit" type="button" hidden>Editar</button><button class="appointment-technical-profile-action ap-btn ap-link" id="appointment-customer-technical-profile-add" type="button" hidden>+ Agregar dato importante</button></div>
                    <div class="appointment-technical-profile-display" id="appointment-customer-technical-profile-display"></div>
                    <div class="appointment-technical-profile-editor" id="appointment-customer-technical-profile-editor" hidden><label class="ap-field" for="appointment-customer-technical-profile-input">Dato t&eacute;cnico permanente<textarea class="field" id="appointment-customer-technical-profile-input" maxlength="1000" rows="2"></textarea></label><div class="appointment-technical-profile-editor-actions"><button class="ap-btn" id="appointment-customer-technical-profile-cancel" type="button">Cancelar</button><button class="ap-btn ap-primary" id="appointment-customer-technical-profile-save" type="button">Guardar ficha</button></div></div>
                    <p class="appointment-technical-profile-feedback ap-feedback" id="appointment-customer-technical-profile-feedback" role="status"></p>
                  </details>
                  <details class="appointment-additional ap-panel ap-compact ap-additional-slot" id="appointment-additional">
                    <summary>Informaci&oacute;n adicional</summary>
                    <div class="appointment-additional-content"><label class="ap-field" for="appointment-notes">Observaci&oacute;n<textarea class="field" id="appointment-notes" maxlength="2000" rows="2"></textarea></label><div class="appointment-deposit-option" ${cashRegisterEnabled ? 'hidden' : ''}><label><input id="appointment-deposit-paid" type="checkbox">Dej&oacute; se&ntilde;a</label><label class="ap-field appointment-deposit-amount" id="appointment-deposit-amount-row" for="appointment-deposit-amount" hidden>Monto de la se&ntilde;a<input class="field" id="appointment-deposit-amount" type="number" min="1" step="1" inputmode="numeric"></label></div></div>
                  </details>
                  ${cashRegisterEnabled ? '<div class="ap-initial-finance-slot ap-new-only">' + financeCreateMarkup + '</div>' : ''}
                </section>
              </div>
              ${cashRegisterEnabled ? '<aside class="ap-stack ap-finance-stack" id="appointment-panel-pago" data-appointment-tabpanel="pago" aria-labelledby="appointment-tab-pago"><h4 class="ap-section-title" style="margin:0">Resumen financiero</h4>' + financeEditMarkup + productsMarkup + '</aside>' : ''}
            </div>
            <p class="hint ap-feedback" id="appointment-feedback" role="status" aria-live="polite"></p>
          </div>
          ${cashRegisterEnabled ? '<div class="ap-mobilebar"><div><small>Saldo pendiente</small><div class="ap-money ap-money-small" id="appointment-mobile-balance">--</div></div><button class="ap-btn ap-primary" id="appointment-mobile-charge" type="button">Cobrar</button></div>' : ''}
          <footer class="dialog-actions ap-foot">
            <details class="ap-more-actions" id="appointment-more-actions"><summary>M&aacute;s acciones</summary><div class="ap-more-menu"><button class="ap-btn" id="appointment-complete" type="button" hidden>Marcar realizado</button><button class="ap-btn ap-danger" id="appointment-no-show" type="button" hidden>Marcar ausente</button><button class="ap-btn ap-danger" id="appointment-delete" type="button" hidden>Eliminar</button></div></details>
            <div class="ap-actions ap-save-actions"><small id="appointment-dirty-note" hidden>Cambios sin guardar</small><button class="ap-btn" id="appointment-cancel" type="button">Cancelar</button><button class="ap-btn ap-primary" id="appointment-submit" type="submit">Crear turno</button></div>
          </footer>
        </form>
      </section>
    </div>`
}

export const appointmentCheckoutMarkup = `
  <div id="appointment-checkout" class="ap-shell" hidden>
    <section class="ap-checkout-card" role="dialog" aria-modal="true" aria-labelledby="appointment-checkout-title" aria-describedby="appointment-checkout-subtitle" tabindex="-1">
      <header class="ap-head"><div><h2 id="appointment-checkout-title">Registrar cobro</h2><small id="appointment-checkout-subtitle"></small></div><button class="ap-close" id="appointment-checkout-close" type="button" aria-label="Cerrar cobro">&times;</button></header>
      <div class="ap-body">
        <div class="ap-center"><small id="appointment-checkout-caption">Importe a cobrar</small><div class="ap-money" id="appointment-checkout-display">--</div></div>
        <label class="ap-field" id="appointment-checkout-amount-row" hidden>Importe de la se&ntilde;a<input id="appointment-checkout-amount" type="number" min="1" step="1" inputmode="numeric"></label>
        <h3 class="ap-section-title">Medio de pago</h3>
        <div id="appointment-checkout-methods" role="radiogroup" aria-label="Medio de pago"></div>
        <div id="appointment-checkout-mixed" hidden><div class="ap-mix-grid" id="appointment-checkout-mixed-fields"></div><small class="ap-mix-note" id="appointment-checkout-mixed-note" role="status" aria-live="polite"></small></div>
        <hr class="ap-divider">
        <div id="appointment-checkout-complete-row" hidden><label class="ap-check"><input id="appointment-checkout-complete" type="checkbox">Marcar este turno como realizado</label><p class="ap-note" id="appointment-checkout-complete-note"></p></div>
        <p class="ap-info" id="appointment-checkout-context"></p>
        <p class="ap-feedback" id="appointment-checkout-error" role="status" aria-live="polite"></p>
        <button class="ap-btn ap-primary ap-full" id="appointment-checkout-submit" type="button">Confirmar cobro</button>
        <button class="ap-btn ap-link ap-full" id="appointment-checkout-cancel" type="button">Cancelar</button>
      </div>
    </section>
  </div>`

/** Only responsive presentation. The controllers decide whether an action is allowed. */
export const appointmentDialogLayoutScript = `
    let appointmentDialogActiveTab = 'turno';
    function setAppointmentDialogTab(tab) {
      const root = document.getElementById('appointment-dialog');
      if (!root) return;
      const available = Array.from(root.querySelectorAll('[data-appointment-tab]'));
      appointmentDialogActiveTab = available.some((button) => button.dataset.appointmentTab === tab) ? tab : 'turno';
      const mobile = window.matchMedia('(max-width: 700px)').matches && root.dataset.mode === 'edit';
      available.forEach((button) => {
        const selected = button.dataset.appointmentTab === appointmentDialogActiveTab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      root.querySelectorAll('[data-appointment-tabpanel]').forEach((panel) => {
        panel.hidden = mobile && panel.dataset.appointmentTabpanel !== appointmentDialogActiveTab;
      });
    }
    function setAppointmentDialogMode(mode) {
      const root = document.getElementById('appointment-dialog');
      if (!root) return;
      const editing = mode === 'edit';
      root.dataset.mode = editing ? 'edit' : 'new';
      const serviceField = document.getElementById('appointment-service-field');
      const serviceSlot = document.getElementById(editing ? 'appointment-service-edit-slot' : 'appointment-primary-fields');
      if (serviceField && serviceSlot) serviceSlot.appendChild(serviceField);
      const customerFields = document.getElementById('appointment-customer-fields');
      const editCustomer = document.getElementById('appointment-customer-edit');
      if (customerFields) customerFields.hidden = editing;
      if (editCustomer) editCustomer.setAttribute('aria-expanded', 'false');
      const dataTitle = document.getElementById('appointment-data-title');
      if (dataTitle) dataTitle.classList.toggle('ap-caps', !editing);
      setAppointmentDialogTab('turno');
    }
    document.querySelectorAll('[data-appointment-tab]').forEach((button) => {
      button.addEventListener('click', () => setAppointmentDialogTab(button.dataset.appointmentTab));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(button.parentElement.querySelectorAll('[data-appointment-tab]'));
        const index = tabs.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        setAppointmentDialogTab(tabs[next].dataset.appointmentTab);
        tabs[next].focus();
      });
    });
    document.getElementById('appointment-customer-edit')?.addEventListener('click', () => {
      const fields = document.getElementById('appointment-customer-fields');
      const button = document.getElementById('appointment-customer-edit');
      if (!fields || !button) return;
      fields.hidden = !fields.hidden;
      button.setAttribute('aria-expanded', String(!fields.hidden));
      if (!fields.hidden) fields.querySelector('input:not([type="hidden"])')?.focus();
    });
    window.addEventListener('resize', () => setAppointmentDialogTab(appointmentDialogActiveTab));
    let appointmentCheckoutPresentationState = null;
    function showAppointmentCheckout() {
      const checkout = document.getElementById('appointment-checkout');
      if (!checkout || !checkout.hidden) return;
      const editor = document.getElementById('appointment-dialog');
      appointmentCheckoutPresentationState = {
        focus: document.activeElement,
        overflow: document.body.style.overflow,
        editorInert: editor?.inert,
        editorAriaHidden: editor?.getAttribute('aria-hidden'),
      };
      checkout.hidden = false;
      document.body.style.overflow = 'hidden';
      if (editor) { editor.inert = true; editor.setAttribute('aria-hidden', 'true'); }
      const initialFocus = Array.from(checkout.querySelectorAll('input:not([disabled]):not([type="hidden"]), button:not([disabled])')).find((node) => node.getClientRects().length && !node.closest('[hidden]'));
      initialFocus?.focus();
    }
    function hideAppointmentCheckout() {
      const checkout = document.getElementById('appointment-checkout');
      if (!checkout || checkout.hidden) return;
      checkout.hidden = true;
      const previous = appointmentCheckoutPresentationState;
      appointmentCheckoutPresentationState = null;
      if (!previous) return;
      document.body.style.overflow = previous.overflow;
      const editor = document.getElementById('appointment-dialog');
      if (editor) {
        editor.inert = Boolean(previous.editorInert);
        if (previous.editorAriaHidden === null) editor.removeAttribute('aria-hidden');
        else editor.setAttribute('aria-hidden', previous.editorAriaHidden);
      }
      if (previous.focus?.isConnected) previous.focus.focus();
    }
    function requestAppointmentCheckoutDismiss(reason) {
      const checkout = document.getElementById('appointment-checkout');
      if (!checkout || checkout.hidden) return;
      checkout.dispatchEvent(new CustomEvent('appointment-checkout-dismiss-request', { bubbles: true, cancelable: true, detail: { reason } }));
    }
    ['appointment-checkout-close', 'appointment-checkout-cancel'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => requestAppointmentCheckoutDismiss(id.endsWith('cancel') ? 'cancel' : 'close'));
    });
    document.getElementById('appointment-checkout')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) requestAppointmentCheckoutDismiss('backdrop');
    });
    document.addEventListener('keydown', (event) => {
      const checkout = document.getElementById('appointment-checkout');
      if (!checkout || checkout.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        requestAppointmentCheckoutDismiss('escape');
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(checkout.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter((node) => node.getClientRects().length && !node.closest('[hidden]'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); checkout.querySelector('[role="dialog"]')?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !checkout.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !checkout.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }, true);
`
