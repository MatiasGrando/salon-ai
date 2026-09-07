export const cashRegisterStyles = `
    .cash-register-view { display: none; min-width: 0; overflow: auto; background: var(--bg); }
    .app[data-section="cash"] { grid-template-columns: 80px minmax(0, 1fr); }
    .app[data-section="cash"] > :not(.workspace-nav):not(.cash-register-view):not(.crm-toast):not(.dialog-backdrop):not(.cash-dialog-backdrop) { display: none; }
    .app[data-section="cash"] .cash-register-view { display: block; grid-column: 2; }
    .cash-shell { width: min(1260px, 100%); margin: 0 auto; padding: 28px; }
    .cash-header, .cash-toolbar, .cash-session-strip, .cash-filter-row, .cash-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .cash-header { margin-bottom: 20px; }
    .cash-header h2, .cash-empty-state h3, .cash-dialog h3 { margin: 0; }
    .cash-header p, .cash-empty-state p { color: var(--muted); margin: 5px 0 0; }
    .cash-status { border-radius: 999px; padding: 7px 12px; font-weight: 800; background: var(--danger-soft); color: var(--danger); }
    .cash-status.open { background: #ecfdf5; color: #047857; }
    .cash-empty-state, .cash-panel, .cash-summary-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); }
    .cash-empty-state { min-height: 360px; display: grid; place-items: center; padding: 36px; text-align: center; }
    .cash-empty-state > div { max-width: 520px; }
    .cash-empty-state button { margin-top: 18px; }
    .cash-dashboard { display: grid; gap: 18px; }
    .cash-session-strip, .cash-toolbar, .cash-filter-row { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
    .cash-session-copy { display: grid; gap: 3px; }
    .cash-session-copy span { color: var(--muted); font-size: 13px; }
    .cash-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .cash-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .cash-summary-card { padding: 16px; display: grid; gap: 7px; }
    .cash-summary-card span { color: var(--muted); font-size: 13px; }
    .cash-summary-card strong { font-size: 24px; }
    .cash-summary-card small { color: var(--muted); }
    .cash-reconciliation { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 17px; border: 1px solid #fecaca; border-radius: 14px; background: #fef2f2; color: #991b1b; }
    .cash-reconciliation[hidden] { display: none; }
    .cash-reconciliation-copy { display: grid; gap: 4px; }
    .cash-reconciliation-copy span { color: #7f1d1d; }
    .cash-reconciliation > strong { font-size: 22px; white-space: nowrap; }
    .cash-session-history { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); overflow: hidden; }
    .cash-session-history > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 50px; padding: 0 16px; cursor: pointer; font-weight: 800; list-style: none; }
    .cash-session-history > summary::-webkit-details-marker { display: none; }
    .cash-session-history > summary span { color: var(--muted); font-weight: 600; }
    .cash-session-list { display: grid; border-top: 1px solid var(--line); }
    .cash-session-row { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(110px, auto)); gap: 14px; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
    .cash-session-row:last-child { border-bottom: 0; }
    .cash-session-row > div { display: grid; gap: 3px; }
    .cash-session-row span, .cash-session-row small { color: var(--muted); }
    .cash-session-difference.positive { color: #047857; }
    .cash-session-difference.negative { color: var(--danger); }
    .cash-panel { overflow: hidden; }
    .cash-filter-row { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; }
    .cash-filter-controls { display: flex; gap: 8px; flex: 1; flex-wrap: wrap; }
    .cash-filter-controls :is(select,input) { min-height: 40px; border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; background: white; }
    .cash-filter-controls input { min-width: min(320px, 100%); flex: 1; }
    .cash-entry-list { display: grid; }
    .cash-entry { display: grid; grid-template-columns: minmax(180px, 1.2fr) 120px 120px 140px auto; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .cash-entry:last-child { border-bottom: 0; }
    .cash-entry-main { display: grid; gap: 4px; }
    .cash-entry-main span, .cash-entry small { color: var(--muted); }
    .cash-entry-amount { font-weight: 900; text-align: right; }
    .cash-entry-amount.outflow { color: var(--danger); }
    .cash-entry-amount.inflow { color: #047857; }
    .cash-load-more { width: 100%; border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 14px; background: var(--surface-soft); }
    .cash-inline-state { padding: 34px; text-align: center; color: var(--muted); }
    .cash-dialog-backdrop { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 18px; background: rgba(17,19,24,.52); }
    .cash-dialog-backdrop[hidden] { display: none; }
    .cash-dialog { width: min(620px, 100%); max-height: calc(100vh - 36px); overflow: auto; background: var(--surface); border-radius: 18px; padding: 22px; box-shadow: 0 24px 64px rgba(0,0,0,.24); }
    .cash-dialog-form { display: grid; gap: 14px; margin-top: 18px; }
    .cash-dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .cash-dialog-form label { display: grid; gap: 6px; font-weight: 750; }
    .cash-dialog-form :is(input:not([type="checkbox"]),select,textarea) { width: 100%; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--text); box-sizing: border-box; }
    .cash-dialog-form :is(input:not([type="checkbox"]),select) { height: 42px; min-height: 42px; }
    .cash-dialog-form input:not([type="checkbox"]) { padding: 0 12px; }
    .cash-dialog-form select { height: 42px; padding: 0 36px 0 12px; line-height: normal; }
    .cash-dialog-form textarea { min-height: 88px; padding: 10px 12px; resize: vertical; }
    .cash-session-help { margin: 0; padding: 10px 12px; border-radius: 9px; background: var(--surface-soft); color: var(--muted); line-height: 1.45; }
    .cash-session-reconciliation { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
    .cash-session-reconciliation[hidden] { display: none; }
    .cash-session-reconciliation div { display: grid; gap: 4px; }
    .cash-session-reconciliation span { color: var(--muted); font-size: 12px; }
    .cash-difference-confirm { display: flex !important; grid-column: 1 / -1; grid-template-columns: 18px 1fr !important; align-items: start; gap: 9px !important; padding-top: 8px; border-top: 1px solid var(--line); font-weight: 650 !important; }
    .cash-difference-confirm[hidden] { display: none !important; }
    .cash-difference-confirm input { width: 18px; height: 18px; margin: 1px 0 0; }
    .cash-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .cash-feedback, .appointment-finance-feedback { min-height: 20px; margin: 0; color: var(--muted); white-space: pre-line; }
    .cash-feedback.error, .appointment-finance-feedback.error { color: var(--danger); }
    .cash-feedback.success, .appointment-finance-feedback.success { color: #047857; }
    .appointment-finance { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .appointment-finance > summary { min-height: 52px; cursor: pointer; padding: 0 13px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; font-weight: 850; background: var(--surface-soft); list-style: none; }
    .appointment-finance > summary::-webkit-details-marker { display: none; }
    .appointment-finance > summary::after { content: "⌄"; color: #64748b; font-size: 18px; line-height: 1; transition: transform 160ms ease; }
    .appointment-finance[open] > summary { border-bottom: 1px solid var(--line); }
    .appointment-finance[open] > summary::after { transform: rotate(180deg); }
    .appointment-finance-content { padding: 14px; display: grid; gap: 14px; }
    .appointment-finance-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .appointment-finance-summary div { background: var(--surface-soft); border-radius: 9px; padding: 10px; display: grid; gap: 4px; }
    .appointment-finance-summary span { color: var(--muted); font-size: 12px; }
    .appointment-finance-form { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
    .appointment-finance-form > small { color: var(--muted); }
    .appointment-finance-fixed-note { margin: 0; padding: 11px 12px; display: grid; gap: 4px; border: 1px solid var(--line); border-radius: 9px; color: var(--muted); background: var(--surface-soft); }
    .appointment-finance-fixed-note strong { color: var(--text); }
    .appointment-finance-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; }
    .appointment-finance-history { display: grid; gap: 7px; }
    .appointment-finance-history article { display: flex; justify-content: space-between; gap: 8px; padding: 9px; border-radius: 8px; background: var(--surface-soft); }
    .appointment-finance label { display: grid; gap: 6px; }
    .appointment-finance :is(input:not([type="checkbox"]), select) { width: 100%; min-height: 40px; border: 1px solid #b8c4d4; border-radius: 9px; padding: 8px 10px; background: var(--surface); }
    .appointment-finance :is(input:not([type="checkbox"]), select):focus { border-color: #2563eb; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
    .appointment-create-payment-content { padding: 12px; display: grid; gap: 12px; }
    .appointment-create-payment-fields { display: grid; gap: 12px; }
    .appointment-create-actions { display: flex; gap: 8px; }
    .appointment-create-actions button { flex: 1; min-height: 40px; padding: 8px 10px; }
    .appointment-create-actions button.active { border-color: #2563eb; color: #1d4ed8; background: #eff6ff; box-shadow: 0 0 0 1px #2563eb inset; }
    .appointment-create-panel { display: grid; gap: 9px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    .appointment-create-panel[hidden], .appointment-create-observation[hidden] { display: none; }
    .appointment-create-panel-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .appointment-create-panel-title small { color: var(--muted); }
    .appointment-create-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .appointment-create-summary div { min-width: 0; padding: 9px 10px; border-radius: 9px; background: var(--surface-soft); display: grid; gap: 3px; }
    .appointment-create-summary span { color: var(--muted); font-size: 11px; }
    .appointment-create-summary strong { font-size: 14px; }
    .appointment-create-summary .appointment-create-summary-emphasis { background: #eff6ff; }
    .appointment-create-summary .appointment-create-summary-emphasis strong { color: #1d4ed8; }
    .appointment-edit-estimated-total { display: grid; gap: 8px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); }
    .appointment-edit-estimated-total[hidden] { display: none; }
    .appointment-edit-history { display: grid; gap: 9px; padding-top: 12px; border-top: 1px solid var(--line); }
    .appointment-edit-history > strong { font-size: 13px; }
    .appointment-finance textarea { width: 100%; min-height: 72px; border: 1px solid #b8c4d4; border-radius: 9px; padding: 10px; background: var(--surface); resize: vertical; }
    .appointment-finance textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
    @media (max-width: 900px) {
      .app[data-section="cash"] { display: block; }
      .app[data-section="cash"] .cash-register-view { min-height: 100vh; padding-top: 70px; }
      .cash-shell { padding: 16px; }
      .cash-summary-grid { grid-template-columns: 1fr 1fr; }
      .cash-entry { grid-template-columns: 1fr auto; }
      .cash-session-row { grid-template-columns: 1fr 1fr; }
      .cash-entry > :not(.cash-entry-main):not(.cash-entry-amount) { display: none; }
    }
    @media (max-width: 560px) {
      .cash-header, .cash-toolbar, .cash-session-strip, .cash-filter-row { align-items: stretch; flex-direction: column; }
      .cash-summary-grid, .cash-dialog-grid, .appointment-finance-summary, .appointment-finance-row { grid-template-columns: 1fr; }
      .cash-session-reconciliation, .cash-session-row { grid-template-columns: 1fr; }
      .appointment-create-actions { flex-direction: column; }
      .appointment-create-summary { grid-template-columns: 1fr 1fr; }
      .cash-actions > button { flex: 1; }
    }
`

export const cashRegisterMarkup = `
    <section class="cash-register-view" id="cash-register-view" data-section="cash">
      <div class="cash-shell">
        <header class="cash-header">
          <div><h2>Caja</h2><p>Jornadas, cobros y movimientos del negocio</p></div>
          <span class="cash-status" id="cash-status">Caja cerrada</span>
        </header>
        <section class="cash-empty-state" id="cash-empty-state">
          <div>
            <h3>La caja est&aacute; cerrada</h3>
            <p id="cash-empty-copy">Abr&iacute; una jornada para registrar cobros y operaciones manuales.</p>
            <button class="primary" id="cash-open-empty" type="button">Abrir caja</button>
          </div>
        </section>
        <div class="cash-dashboard" id="cash-dashboard" hidden>
          <section class="cash-session-strip" id="cash-session-strip">
            <div class="cash-session-copy"><strong id="cash-responsible">Sin responsable</strong><span id="cash-session-time">Sesi&oacute;n activa</span></div>
            <div class="cash-actions">
              <button class="primary" id="cash-operation-open" type="button">Registrar operaci&oacute;n</button>
              <button class="secondary" id="cash-new-session" type="button">Nueva sesi&oacute;n</button>
              <button class="danger" id="cash-close-day" type="button">Cerrar caja</button>
            </div>
          </section>
          <section class="cash-toolbar">
            <label>Jornada <select id="cash-day-select"></select></label>
            <div class="cash-actions"><button class="primary" id="cash-open-toolbar" type="button" hidden>Abrir caja</button><button class="secondary" id="cash-refresh" type="button">Actualizar</button></div>
          </section>
          <section class="cash-summary-grid" aria-label="Resumen de Caja">
            <article class="cash-summary-card"><span>Cobrado bruto</span><strong id="cash-gross">$0</strong><small id="cash-methods">Efectivo $0</small></article>
            <article class="cash-summary-card"><span>Neto</span><strong id="cash-net">$0</strong><small id="cash-refunds">Devoluciones $0</small></article>
            <article class="cash-summary-card"><span>Gastos y retiros</span><strong id="cash-outgoing">$0</strong><small id="cash-incoming">Ingresos $0</small></article>
            <article class="cash-summary-card"><span id="cash-balance-label">Efectivo esperado</span><strong id="cash-expected">$0</strong><small id="cash-opening">Inicial $0</small></article>
          </section>
          <section class="cash-reconciliation" id="cash-reconciliation" hidden>
            <div class="cash-reconciliation-copy"><strong>Diferencia de cierre</strong><span id="cash-reconciliation-copy">El efectivo contado no coincide con el esperado.</span></div>
            <strong id="cash-reconciliation-amount">$0</strong>
          </section>
          <details class="cash-session-history" id="cash-session-history">
            <summary><span>Historial de sesiones</span><span id="cash-session-count">0 sesiones</span></summary>
            <div class="cash-session-list" id="cash-session-list"></div>
          </details>
          <section class="cash-panel">
            <div class="cash-filter-row">
              <div class="cash-filter-controls">
                <select id="cash-type-filter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="PAYMENT">Cobro</option><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option><option value="CASH_IN">Ingreso</option><option value="ADJUSTMENT">Ajuste</option><option value="REFUND">Devoluci&oacute;n</option><option value="REVERSAL">Contrapartida</option></select>
                <select id="cash-method-filter" aria-label="Filtrar por medio"><option value="">Todos los medios</option><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option><option value="UNSPECIFIED">Sin especificar</option></select>
                <input id="cash-search" type="search" placeholder="Buscar cliente o descripci&oacute;n" autocomplete="off">
              </div>
            </div>
            <div class="cash-entry-list" id="cash-entry-list"><div class="cash-inline-state">Cargando movimientos...</div></div>
            <button class="cash-load-more" id="cash-next-page" type="button" hidden>Cargar m&aacute;s movimientos</button>
          </section>
        </div>
      </div>
    </section>
    <div class="cash-dialog-backdrop" id="cash-session-dialog" hidden>
      <section class="cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-session-title">
        <div class="cash-dialog-head"><h3 id="cash-session-title">Abrir caja</h3><button class="icon-button" id="cash-session-x" type="button" aria-label="Cerrar">X</button></div>
        <form class="cash-dialog-form" id="cash-session-form">
          <p class="cash-session-help" id="cash-session-help"></p>
          <label id="cash-responsible-field">Responsable<select id="cash-session-responsible"></select></label>
          <label id="cash-opening-field"><span id="cash-opening-label">Efectivo inicial</span><input id="cash-opening-cash" type="number" min="0" step="1" inputmode="numeric"></label>
          <label id="cash-counted-field" hidden><span id="cash-counted-label">Efectivo contado</span><input id="cash-counted-cash" type="number" min="0" step="1" inputmode="numeric"></label>
          <section class="cash-session-reconciliation" id="cash-session-reconciliation" hidden>
            <div><span>Esperado</span><strong id="cash-session-expected">$0</strong></div>
            <div><span>Contado</span><strong id="cash-session-counted">--</strong></div>
            <div><span>Diferencia</span><strong id="cash-session-difference">--</strong></div>
            <label class="cash-difference-confirm" id="cash-difference-confirm-field" hidden><input id="cash-difference-confirm" type="checkbox"><span id="cash-difference-confirm-copy">Confirmo que registr&eacute; la diferencia de caja.</span></label>
          </section>
          <p class="cash-feedback" id="cash-session-feedback" role="status"></p>
          <div class="cash-dialog-actions"><button class="secondary" id="cash-session-cancel" type="button">Cancelar</button><button class="primary" id="cash-session-submit" type="submit">Confirmar</button></div>
        </form>
      </section>
    </div>
    <div class="cash-dialog-backdrop" id="cash-operation-dialog" hidden>
      <section class="cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-operation-title">
        <div class="cash-dialog-head"><h3 id="cash-operation-title">Registrar operaci&oacute;n</h3><button class="icon-button" id="cash-operation-x" type="button" aria-label="Cerrar">X</button></div>
        <form class="cash-dialog-form" id="cash-operation-form">
          <div class="cash-dialog-grid"><label>Tipo<select id="cash-operation-type"><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option><option value="CASH_IN">Ingreso</option><option value="ADJUSTMENT">Ajuste</option><option value="REFUND">Devoluci&oacute;n</option></select></label><label id="cash-operation-method-field">Medio<select id="cash-operation-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label></div>
          <label id="cash-operation-amount-field">Importe<input id="cash-operation-amount" type="number" min="1" step="1" inputmode="numeric"></label>
          <label id="cash-operation-delta-field" hidden>Diferencia con signo<input id="cash-operation-delta" type="number" step="1" inputmode="numeric" placeholder="Ej: -500 o 500"></label>
          <label id="cash-operation-description-field">Descripci&oacute;n<input id="cash-operation-description" maxlength="180"></label>
          <label id="cash-operation-counterparty-field" hidden>Persona que retira<input id="cash-operation-counterparty" maxlength="180"></label>
          <label>Observaci&oacute;n<textarea id="cash-operation-observation" maxlength="500" rows="3"></textarea></label>
          <p class="cash-feedback" id="cash-operation-feedback" role="status"></p>
          <div class="cash-dialog-actions"><button class="secondary" id="cash-operation-cancel" type="button">Cancelar</button><button class="primary" id="cash-operation-submit" type="submit">Registrar</button></div>
        </form>
      </section>
    </div>
`

export const appointmentFinanceMarkup = `
          <details class="appointment-finance" id="appointment-create-payment" hidden>
            <summary><span>Pago</span><span id="appointment-create-payment-status">Sin pago</span></summary>
            <div class="appointment-create-payment-content">
              <div class="appointment-create-payment-fields" id="appointment-create-payment-fields">
                <label id="appointment-create-estimated-total-row" hidden>Total acordado<input id="appointment-create-estimated-total" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el total final"></label>
                <div class="appointment-create-actions">
                  <button class="secondary" id="appointment-create-collect-total" type="button" aria-pressed="false">Cobrar total</button>
                  <button class="secondary" id="appointment-create-deposit" type="button" aria-pressed="false">Registrar se&ntilde;a</button>
                  <button class="secondary" id="appointment-create-discount-toggle" type="button" aria-pressed="false">Aplicar descuento</button>
                </div>
                <section class="appointment-create-panel" id="appointment-create-discount-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Descuento</strong><small>Se aplica antes de cobrar</small></div>
                  <div class="appointment-finance-row"><label>Tipo<select id="appointment-create-discount-type"><option value="AMOUNT">Monto</option><option value="PERCENTAGE">Porcentaje</option></select></label><label><span id="appointment-create-discount-value-label">Monto</span><input id="appointment-create-discount-value" type="number" min="1" step="1" inputmode="decimal"></label><span></span></div>
                </section>
                <section class="appointment-create-panel" id="appointment-create-deposit-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Se&ntilde;a</strong><small>Pago parcial</small></div>
                  <div class="appointment-finance-row"><label>Importe<input id="appointment-create-deposit-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el importe"></label><label>Medio<select id="appointment-create-deposit-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                </section>
                <section class="appointment-create-panel" id="appointment-create-payment-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Pago del saldo</strong><small>Calculado autom&aacute;ticamente</small></div>
                  <div class="appointment-finance-row"><label>Importe<input id="appointment-create-payment-amount" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Medio<select id="appointment-create-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="secondary" id="appointment-create-add-payment-line" type="button">Pago mixto</button></div>
                  <div class="appointment-finance-row" id="appointment-create-payment-line-two" hidden><label>Segundo importe<input id="appointment-create-payment-amount-two" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Segundo medio<select id="appointment-create-payment-method-two"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                </section>
                <div class="appointment-create-summary">
                  <div><span>Precio</span><strong id="appointment-create-summary-price">--</strong></div>
                  <div><span>Descuento</span><strong id="appointment-create-summary-discount">$ 0</strong></div>
                  <div><span>Total</span><strong id="appointment-create-summary-total">--</strong></div>
                  <div><span>Pagado</span><strong id="appointment-create-summary-paid">$ 0</strong></div>
                  <div class="appointment-create-summary-emphasis"><span>Pendiente</span><strong id="appointment-create-summary-due">--</strong></div>
                </div>
                <label class="appointment-create-observation" id="appointment-create-observation-row" hidden>Observaci&oacute;n<textarea id="appointment-create-payment-observation" maxlength="500" rows="2"></textarea></label>
                <div id="appointment-create-cash-required" hidden><p>Para cobrar necesit&aacute;s una sesi&oacute;n de Caja activa.</p><button class="primary" id="appointment-create-open-cash" type="button">Abrir caja</button></div>
              </div>
              <p class="appointment-finance-feedback" id="appointment-create-payment-feedback" role="status"></p>
            </div>
          </details>
          <details class="appointment-finance" id="appointment-finance" hidden>
            <summary><span>Pago</span><span id="appointment-finance-balance">Cargando...</span></summary>
            <div class="appointment-finance-content">
              <section class="appointment-edit-estimated-total" id="appointment-total-form" hidden>
                <div class="appointment-create-panel-title"><strong>Total acordado</strong><small>Servicio con precio estimativo</small></div>
                <div class="appointment-finance-row"><label>Importe<input id="appointment-estimated-total" type="number" min="0" step="1" inputmode="numeric"></label><span></span><button class="secondary" id="appointment-total-submit" type="button">Guardar total</button></div>
              </section>
              <div class="appointment-create-actions appointment-edit-actions">
                <button class="secondary" id="appointment-edit-collect-total" type="button" aria-pressed="false">Cobrar total</button>
                <button class="secondary" id="appointment-edit-deposit" type="button" aria-pressed="false">Registrar se&ntilde;a</button>
                <button class="secondary" id="appointment-edit-discount-toggle" type="button" aria-pressed="false">Aplicar descuento</button>
              </div>
              <section class="appointment-create-panel" id="appointment-discount-form" hidden>
                <div class="appointment-create-panel-title"><strong>Descuento</strong><small>Se aplica sobre el precio</small></div>
                <div class="appointment-finance-row"><label>Tipo<select id="appointment-discount-type"><option value="AMOUNT">Monto</option><option value="PERCENTAGE">Porcentaje</option></select></label><label><span id="appointment-discount-value-label">Monto</span><input id="appointment-discount-value" type="number" min="0" step="1" inputmode="decimal"></label><button class="secondary" id="appointment-discount-submit" type="button">Aplicar</button></div>
                <small id="appointment-discount-help">Se guarda como un monto nominal sobre el total del turno.</small>
              </section>
              <section class="appointment-create-panel" id="appointment-edit-deposit-panel" hidden>
                <div class="appointment-create-panel-title"><strong>Se&ntilde;a</strong><small>Pago parcial</small></div>
                <div class="appointment-finance-row"><label>Importe<input id="appointment-edit-deposit-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el importe"></label><label>Medio<select id="appointment-edit-deposit-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="primary" id="appointment-edit-deposit-submit" type="button">Registrar se&ntilde;a</button></div>
              </section>
              <section class="appointment-create-panel" id="appointment-edit-payment-panel" hidden>
                <div class="appointment-create-panel-title"><strong>Pago del saldo</strong><small>Calculado autom&aacute;ticamente</small></div>
                <div class="appointment-finance-row"><label>Importe<input id="appointment-payment-amount" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Medio<select id="appointment-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="secondary" id="appointment-add-payment-line" type="button">Pago mixto</button></div>
                <div class="appointment-finance-row" id="appointment-payment-line-two" hidden><label>Segundo importe<input id="appointment-payment-amount-two" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Segundo medio<select id="appointment-payment-method-two"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                <button class="primary" id="appointment-payment-submit" type="button">Registrar pago</button>
              </section>
              <label class="appointment-create-observation" id="appointment-edit-observation-row" hidden>Observaci&oacute;n<textarea id="appointment-payment-observation" maxlength="500" rows="2"></textarea></label>
              <div class="appointment-create-summary">
                <div><span>Precio</span><strong id="appointment-finance-price">--</strong></div>
                <div><span>Descuento</span><strong id="appointment-finance-discount">--</strong></div>
                <div><span>Total</span><strong id="appointment-finance-total">--</strong></div>
                <div><span>Pagado</span><strong id="appointment-finance-paid">--</strong></div>
                <div class="appointment-create-summary-emphasis"><span>Pendiente</span><strong id="appointment-finance-due">--</strong></div>
              </div>
              <div id="appointment-cash-required" hidden><p>Para cobrar necesit&aacute;s una sesi&oacute;n de Caja activa.</p><button class="primary" id="appointment-open-cash" type="button">Abrir caja</button></div>
              <div class="appointment-edit-history"><strong>Historial</strong><div class="appointment-finance-history" id="appointment-finance-history"></div></div>
              <p class="appointment-finance-feedback" id="appointment-finance-feedback" role="status"></p>
            </div>
          </details>
`

export const cashRegisterScript = `
    const cashUi = {
      view: document.getElementById('cash-register-view'), status: document.getElementById('cash-status'), empty: document.getElementById('cash-empty-state'), emptyCopy: document.getElementById('cash-empty-copy'), dashboard: document.getElementById('cash-dashboard'),
      openEmpty: document.getElementById('cash-open-empty'), openToolbar: document.getElementById('cash-open-toolbar'), sessionStrip: document.getElementById('cash-session-strip'), responsible: document.getElementById('cash-responsible'), sessionTime: document.getElementById('cash-session-time'), operationOpen: document.getElementById('cash-operation-open'), newSession: document.getElementById('cash-new-session'), closeDay: document.getElementById('cash-close-day'), daySelect: document.getElementById('cash-day-select'), refresh: document.getElementById('cash-refresh'),
      gross: document.getElementById('cash-gross'), methods: document.getElementById('cash-methods'), net: document.getElementById('cash-net'), refunds: document.getElementById('cash-refunds'), outgoing: document.getElementById('cash-outgoing'), incoming: document.getElementById('cash-incoming'), balanceLabel: document.getElementById('cash-balance-label'), expected: document.getElementById('cash-expected'), opening: document.getElementById('cash-opening'), reconciliation: document.getElementById('cash-reconciliation'), reconciliationCopy: document.getElementById('cash-reconciliation-copy'), reconciliationAmount: document.getElementById('cash-reconciliation-amount'), sessionHistory: document.getElementById('cash-session-history'), sessionCount: document.getElementById('cash-session-count'), sessionList: document.getElementById('cash-session-list'),
      typeFilter: document.getElementById('cash-type-filter'), methodFilter: document.getElementById('cash-method-filter'), search: document.getElementById('cash-search'), entryList: document.getElementById('cash-entry-list'), nextPage: document.getElementById('cash-next-page'),
      sessionDialog: document.getElementById('cash-session-dialog'), sessionTitle: document.getElementById('cash-session-title'), sessionForm: document.getElementById('cash-session-form'), sessionX: document.getElementById('cash-session-x'), sessionCancel: document.getElementById('cash-session-cancel'), sessionSubmit: document.getElementById('cash-session-submit'), sessionResponsible: document.getElementById('cash-session-responsible'), sessionHelp: document.getElementById('cash-session-help'), responsibleField: document.getElementById('cash-responsible-field'), openingField: document.getElementById('cash-opening-field'), openingLabel: document.getElementById('cash-opening-label'), countedField: document.getElementById('cash-counted-field'), countedLabel: document.getElementById('cash-counted-label'), openingCash: document.getElementById('cash-opening-cash'), countedCash: document.getElementById('cash-counted-cash'), sessionReconciliation: document.getElementById('cash-session-reconciliation'), sessionExpected: document.getElementById('cash-session-expected'), sessionCounted: document.getElementById('cash-session-counted'), sessionDifference: document.getElementById('cash-session-difference'), differenceConfirmField: document.getElementById('cash-difference-confirm-field'), differenceConfirm: document.getElementById('cash-difference-confirm'), differenceConfirmCopy: document.getElementById('cash-difference-confirm-copy'), sessionFeedback: document.getElementById('cash-session-feedback'),
      operationDialog: document.getElementById('cash-operation-dialog'), operationForm: document.getElementById('cash-operation-form'), operationX: document.getElementById('cash-operation-x'), operationCancel: document.getElementById('cash-operation-cancel'), operationType: document.getElementById('cash-operation-type'), operationMethod: document.getElementById('cash-operation-method'), operationMethodField: document.getElementById('cash-operation-method-field'), operationAmount: document.getElementById('cash-operation-amount'), operationAmountField: document.getElementById('cash-operation-amount-field'), operationDelta: document.getElementById('cash-operation-delta'), operationDeltaField: document.getElementById('cash-operation-delta-field'), operationDescription: document.getElementById('cash-operation-description'), operationDescriptionField: document.getElementById('cash-operation-description-field'), operationCounterparty: document.getElementById('cash-operation-counterparty'), operationCounterpartyField: document.getElementById('cash-operation-counterparty-field'), operationObservation: document.getElementById('cash-operation-observation'), operationFeedback: document.getElementById('cash-operation-feedback'), operationSubmit: document.getElementById('cash-operation-submit'),
      createPayment: document.getElementById('appointment-create-payment'), createPaymentStatus: document.getElementById('appointment-create-payment-status'), createPaymentFields: document.getElementById('appointment-create-payment-fields'), createEstimatedTotalRow: document.getElementById('appointment-create-estimated-total-row'), createEstimatedTotal: document.getElementById('appointment-create-estimated-total'),
      createCollectTotal: document.getElementById('appointment-create-collect-total'), createDeposit: document.getElementById('appointment-create-deposit'), createDiscountToggle: document.getElementById('appointment-create-discount-toggle'), createDiscountPanel: document.getElementById('appointment-create-discount-panel'), createDiscountType: document.getElementById('appointment-create-discount-type'), createDiscountValue: document.getElementById('appointment-create-discount-value'), createDiscountValueLabel: document.getElementById('appointment-create-discount-value-label'), createDepositPanel: document.getElementById('appointment-create-deposit-panel'), createDepositAmount: document.getElementById('appointment-create-deposit-amount'), createDepositMethod: document.getElementById('appointment-create-deposit-method'),
      createPaymentPanel: document.getElementById('appointment-create-payment-panel'), createPaymentAmount: document.getElementById('appointment-create-payment-amount'), createPaymentMethod: document.getElementById('appointment-create-payment-method'), createPaymentLineTwo: document.getElementById('appointment-create-payment-line-two'), createPaymentAmountTwo: document.getElementById('appointment-create-payment-amount-two'), createPaymentMethodTwo: document.getElementById('appointment-create-payment-method-two'), createAddPaymentLine: document.getElementById('appointment-create-add-payment-line'), createPaymentObservation: document.getElementById('appointment-create-payment-observation'), createObservationRow: document.getElementById('appointment-create-observation-row'),
      createSummaryPrice: document.getElementById('appointment-create-summary-price'), createSummaryDiscount: document.getElementById('appointment-create-summary-discount'), createSummaryTotal: document.getElementById('appointment-create-summary-total'), createSummaryPaid: document.getElementById('appointment-create-summary-paid'), createSummaryDue: document.getElementById('appointment-create-summary-due'), createCashRequired: document.getElementById('appointment-create-cash-required'), createOpenCash: document.getElementById('appointment-create-open-cash'), createPaymentFeedback: document.getElementById('appointment-create-payment-feedback'),
      finance: document.getElementById('appointment-finance'), financeBalance: document.getElementById('appointment-finance-balance'), financePrice: document.getElementById('appointment-finance-price'), financeDiscount: document.getElementById('appointment-finance-discount'), financeTotal: document.getElementById('appointment-finance-total'), financePaid: document.getElementById('appointment-finance-paid'), financeDue: document.getElementById('appointment-finance-due'), financeHistory: document.getElementById('appointment-finance-history'), financeFeedback: document.getElementById('appointment-finance-feedback'), totalForm: document.getElementById('appointment-total-form'), totalSubmit: document.getElementById('appointment-total-submit'), estimatedTotal: document.getElementById('appointment-estimated-total'), editCollectTotal: document.getElementById('appointment-edit-collect-total'), editDeposit: document.getElementById('appointment-edit-deposit'), editDiscountToggle: document.getElementById('appointment-edit-discount-toggle'), discountForm: document.getElementById('appointment-discount-form'), discountSubmit: document.getElementById('appointment-discount-submit'), discountType: document.getElementById('appointment-discount-type'), discountValue: document.getElementById('appointment-discount-value'), discountValueLabel: document.getElementById('appointment-discount-value-label'), discountHelp: document.getElementById('appointment-discount-help'), editDepositPanel: document.getElementById('appointment-edit-deposit-panel'), editDepositAmount: document.getElementById('appointment-edit-deposit-amount'), editDepositMethod: document.getElementById('appointment-edit-deposit-method'), editDepositSubmit: document.getElementById('appointment-edit-deposit-submit'), paymentForm: document.getElementById('appointment-edit-payment-panel'), paymentSubmit: document.getElementById('appointment-payment-submit'), paymentAmount: document.getElementById('appointment-payment-amount'), paymentMethod: document.getElementById('appointment-payment-method'), paymentLineTwo: document.getElementById('appointment-payment-line-two'), paymentAmountTwo: document.getElementById('appointment-payment-amount-two'), paymentMethodTwo: document.getElementById('appointment-payment-method-two'), addPaymentLine: document.getElementById('appointment-add-payment-line'), editObservationRow: document.getElementById('appointment-edit-observation-row'), paymentObservation: document.getElementById('appointment-payment-observation'), cashRequired: document.getElementById('appointment-cash-required'), appointmentOpenCash: document.getElementById('appointment-open-cash')
    }
    state.cashRegister = { current: null, days: [], selectedDayId: null, entries: [], nextCursor: null, permissions: {}, responsibleUsers: [], sessionMode: 'open', returnToAppointment: false, searchTimer: null, eventSource: null, loaded: false, appointmentFinance: null, appointmentFinanceRequestId: 0, appointmentFinanceSummaryCache: {}, appointmentFinanceCache: {}, appointmentFinanceInFlight: {}, financeSummaryRefreshTimer: null, createFinance: { collectTotal: false, deposit: false, discount: false }, editFinance: { collectTotal: false, deposit: false, discount: false } }

    function canUseCashPermission(permission) {
      if (['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(state.currentUser?.role)) return true
      if (state.currentUser?.role !== 'STAFF') return false
      return state.currentUser?.[permission] === true
    }

    function isCashBusinessScopedRole() {
      return ['ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(state.currentUser?.role)
    }

    function cashMoney(value) {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0))
    }

    function cashSignedMoney(value) {
      const amount = Number(value || 0)
      if (amount === 0) return cashMoney(0)
      return (amount > 0 ? '+' : '−') + cashMoney(Math.abs(amount))
    }

    function cashDate(value) {
      return value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: state.business?.timezone }) : '--'
    }

    function cashScoped(path) {
      if (!isCashBusinessScopedRole() || !state.businessId) return path
      return path + (path.includes('?') ? '&' : '?') + 'businessId=' + encodeURIComponent(state.businessId)
    }

    function stopCashRealtimeEvents() {
      state.cashRegister.eventSource?.close()
      state.cashRegister.eventSource = null
    }

    function startCashRealtimeEvents() {
      stopCashRealtimeEvents()
      if (!window.EventSource || !state.businessId || !(canUseCashPermission('canViewCashRegister') || canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      const source = new EventSource(cashScoped('/crm/cash-events'))
      state.cashRegister.eventSource = source
      source.addEventListener('cash_changed', (event) => {
        let payload
        try { payload = JSON.parse(event.data) } catch { return }
        if (payload.businessId !== state.businessId || !payload.entityId) return
        if (document.body.dataset.currentSection === 'cash') loadCashRegister({ preserve: true }).catch((error) => showCrmToast(error.message, 'error'))
        refreshVisibleAppointmentFinanceSummaries()
        if (state.editingAppointmentId && cashUi.finance.open && !cashUi.finance.hidden) loadAppointmentFinance({ force: true, preserve: true })
      })
    }

    function appointmentFinanceCacheKey(appointmentId) {
      return String(state.businessId || '') + ':' + String(appointmentId || '')
    }

    function cacheAppointmentFinanceSummary(appointmentId, summary) {
      const key = appointmentFinanceCacheKey(appointmentId)
      if (summary) state.cashRegister.appointmentFinanceSummaryCache[key] = summary
      else delete state.cashRegister.appointmentFinanceSummaryCache[key]
      const appointment = state.agendaAppointments.find((item) => item.id === appointmentId)
      if (appointment) appointment.financeSummary = summary || null
    }

    function cacheAgendaAppointmentFinanceSummaries(appointments) {
      for (const appointment of appointments || []) {
        if (Object.prototype.hasOwnProperty.call(appointment, 'financeSummary')) {
          cacheAppointmentFinanceSummary(appointment.id, appointment.financeSummary)
        }
      }
    }

    function refreshVisibleAppointmentFinanceSummaries() {
      clearTimeout(state.cashRegister.financeSummaryRefreshTimer)
      if (!state.businessId || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      state.cashRegister.financeSummaryRefreshTimer = setTimeout(async () => {
        const businessId = state.businessId
        const rangeStart = startOfDay(state.agendaSelectedDate || new Date())
        const viewDays = [1, 3, 7].includes(Number(state.agendaViewDays)) ? Number(state.agendaViewDays) : 1
        const params = new URLSearchParams({
          businessId,
          from: rangeStart.toISOString(),
          to: addDays(rangeStart, viewDays).toISOString()
        })
        if (els.agendaProfessional.value) params.set('professionalId', els.agendaProfessional.value)
        try {
          const rows = await getJson('/appointments/finance-summaries?' + params.toString())
          if (state.businessId !== businessId) return
          for (const row of rows) {
            cacheAppointmentFinanceSummary(row.appointmentId, row.financeSummary)
            delete state.cashRegister.appointmentFinanceCache[appointmentFinanceCacheKey(row.appointmentId)]
          }
          if (state.editingAppointmentId && !cashUi.finance.open) {
            const summary = state.cashRegister.appointmentFinanceSummaryCache[appointmentFinanceCacheKey(state.editingAppointmentId)]
            if (summary) renderAppointmentFinanceSummary(summary)
          }
        } catch {
          // El evento es una mejora oportunista: la próxima carga normal vuelve a sincronizar el resumen.
        }
      }, 140)
    }

    function renderCashResponsibleOptions() {
      const users = state.cashRegister.responsibleUsers.length
        ? state.cashRegister.responsibleUsers
        : [{ id: state.currentUser?.id, name: state.currentUser?.name || 'Administrador' }]
      const unique = new Map(users.filter((user) => user.id && user.isActive !== false).map((user) => [user.id, user]))
      cashUi.sessionResponsible.innerHTML = Array.from(unique.values()).map((user) => '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + '</option>').join('')
    }

    async function loadCashResponsibleOptions() {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.responsibleUsers = await getJson(cashScoped('/cash-register/responsibles'))
      renderCashResponsibleOptions()
    }

    function renderCashCurrent() {
      const current = state.cashRegister.current
      const isOpen = Boolean(current?.day && current?.session)
      const hasHistory = Boolean(state.cashRegister.selectedDayId)
      cashUi.status.textContent = isOpen ? 'Caja abierta' : 'Caja cerrada'
      cashUi.status.classList.toggle('open', isOpen)
      cashUi.empty.hidden = isOpen || hasHistory
      cashUi.dashboard.hidden = !isOpen && !hasHistory
      cashUi.sessionStrip.hidden = !isOpen
      cashUi.openToolbar.hidden = isOpen || !canUseCashPermission('canManageCashSessions')
      cashUi.openEmpty.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.emptyCopy.textContent = canUseCashPermission('canManageCashSessions') ? 'Abrí una jornada para registrar cobros y operaciones manuales.' : 'Necesitás un responsable autorizado para abrir la Caja.'
      cashUi.daySelect.innerHTML = state.cashRegister.days.map((day) => {
        const difference = day.closedAt && day.closingDifference !== null && Number(day.closingDifference) !== 0
          ? ' · Dif. ' + cashSignedMoney(day.closingDifference)
          : ''
        return '<option value="' + escapeHtml(day.id) + '"' + (day.id === state.cashRegister.selectedDayId ? ' selected' : '') + '>' + escapeHtml(cashDate(day.openedAt)) + (day.closedAt ? ' · Cerrada' : ' · Abierta') + escapeHtml(difference) + '</option>'
      }).join('')
      if (!isOpen) return
      cashUi.responsible.textContent = current.session.responsibleName || 'Responsable'
      cashUi.sessionTime.textContent = 'Desde ' + cashDate(current.session.openedAt)
      cashUi.operationOpen.hidden = !(canUseCashPermission('canManageCashOperations') || canUseCashPermission('canAdjustCash'))
      cashUi.newSession.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.closeDay.hidden = !canUseCashPermission('canManageCashSessions')
    }

    function renderCashSessions(sessions, currentSessionExpectedCash) {
      const rows = Array.isArray(sessions) ? sessions : []
      cashUi.sessionCount.textContent = rows.length + (rows.length === 1 ? ' sesión' : ' sesiones')
      if (!rows.length) {
        cashUi.sessionList.innerHTML = '<div class="cash-inline-state">No hay sesiones registradas.</div>'
        return
      }
      cashUi.sessionList.innerHTML = rows.map((session) => {
        const expected = session.expectedCash ?? (session.closedAt ? null : currentSessionExpectedCash)
        const counted = session.countedCash
        const difference = session.cashDifference
        const differenceClass = Number(difference) > 0 ? ' positive' : Number(difference) < 0 ? ' negative' : ''
        const period = cashDate(session.openedAt) + (session.closedAt ? ' — ' + cashDate(session.closedAt) : ' — Activa')
        return '<article class="cash-session-row"><div><strong>' + escapeHtml(session.responsibleName || 'Responsable') + '</strong><small>' + escapeHtml(period) + '</small></div><div><span>Esperado</span><strong>' + (expected === null || expected === undefined ? '--' : escapeHtml(cashMoney(expected))) + '</strong></div><div><span>Contado</span><strong>' + (counted === null || counted === undefined ? '--' : escapeHtml(cashMoney(counted))) + '</strong></div><div><span>Diferencia</span><strong class="cash-session-difference' + differenceClass + '">' + (difference === null || difference === undefined ? '--' : escapeHtml(cashSignedMoney(difference))) + '</strong></div></article>'
      }).join('')
    }

    function renderCashSummary(day, summary, sessions = [], currentSessionExpectedCash = null) {
      if (!summary) return
      cashUi.gross.textContent = cashMoney(summary.grossCollected)
      cashUi.methods.textContent = 'Efectivo ' + cashMoney(summary.collectedByMethod?.CASH) + ' · Transferencia ' + cashMoney(summary.collectedByMethod?.TRANSFER) + ' · Tarjeta ' + cashMoney(summary.collectedByMethod?.CARD)
      cashUi.net.textContent = cashMoney(summary.net)
      cashUi.refunds.textContent = 'Devoluciones ' + cashMoney(summary.refunds)
      cashUi.outgoing.textContent = cashMoney(Number(summary.expenses || 0) + Number(summary.withdrawals || 0))
      cashUi.incoming.textContent = 'Ingresos ' + cashMoney(summary.cashIn) + ' · Ajustes ' + cashMoney(summary.adjustments)
      const isClosed = Boolean(day?.closedAt)
      const expectedCash = Number(day?.expectedClosingCash ?? summary.expectedCash)
      const countedCash = Number(day?.countedClosingCash ?? expectedCash)
      const difference = Number(day?.closingDifference ?? countedCash - expectedCash)
      cashUi.balanceLabel.textContent = isClosed ? 'Efectivo contado' : 'Efectivo esperado'
      cashUi.expected.textContent = cashMoney(isClosed ? countedCash : summary.expectedCash)
      cashUi.opening.textContent = isClosed
        ? 'Esperado ' + cashMoney(expectedCash) + ' · Diferencia ' + cashSignedMoney(difference)
        : 'Inicial ' + cashMoney(day?.openingCash)
      cashUi.reconciliation.hidden = !isClosed || difference === 0
      cashUi.reconciliationAmount.textContent = cashSignedMoney(difference)
      cashUi.reconciliationCopy.textContent = difference > 0
        ? 'Se contó más efectivo del esperado. La diferencia quedó registrada y requiere revisión.'
        : 'Se contó menos efectivo del esperado. La diferencia quedó registrada y requiere revisión.'
      renderCashSessions(sessions, currentSessionExpectedCash)
    }

    const cashTypeLabels = { PAYMENT: 'Cobro', LEGACY_PAYMENT: 'Pago anterior sin especificar', EXPENSE: 'Gasto', WITHDRAWAL: 'Retiro', CASH_IN: 'Ingreso', ADJUSTMENT: 'Ajuste', REFUND: 'Devolución', REVERSAL: 'Contrapartida' }
    const cashMethodLabels = { CASH: 'Efectivo', TRANSFER: 'Transferencia / Mercado Pago', CARD: 'Tarjeta', UNSPECIFIED: 'Sin especificar' }

    function renderCashEntries() {
      if (!state.cashRegister.entries.length) {
        cashUi.entryList.innerHTML = '<div class="cash-inline-state">No hay movimientos para estos filtros.</div>'
      } else {
        cashUi.entryList.innerHTML = state.cashRegister.entries.map((entry) => {
          const title = entry.description || entry.counterparty || (entry.customerNames || []).join(', ') || cashTypeLabels[entry.type] || entry.type
          return '<article class="cash-entry"><div class="cash-entry-main"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(cashTypeLabels[entry.type] || entry.type) + (entry.observation ? ' · ' + escapeHtml(entry.observation) : '') + '</span></div><small>' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + '</small><small>' + escapeHtml(cashDate(entry.effectiveAt)) + '</small><small>' + escapeHtml(entry.origin || '') + '</small><strong class="cash-entry-amount ' + entry.direction.toLowerCase() + '">' + (entry.direction === 'OUTFLOW' ? '−' : '+') + cashMoney(entry.amount) + '</strong></article>'
        }).join('')
      }
      cashUi.nextPage.hidden = !state.cashRegister.nextCursor
    }

    async function loadCashEntries(options = {}) {
      const dayId = state.cashRegister.selectedDayId
      if (!dayId) return
      if (!options.append && !options.preserve) cashUi.entryList.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      const params = new URLSearchParams({ limit: '40' })
      if (isCashBusinessScopedRole() && state.businessId) params.set('businessId', state.businessId)
      if (options.append && state.cashRegister.nextCursor) params.set('cursor', state.cashRegister.nextCursor)
      if (cashUi.typeFilter.value) params.set('type', cashUi.typeFilter.value)
      if (cashUi.methodFilter.value) params.set('method', cashUi.methodFilter.value)
      if (cashUi.search.value.trim()) params.set('q', cashUi.search.value.trim())
      try {
        const page = await getJson('/cash-register/days/' + encodeURIComponent(dayId) + '/entries?' + params.toString())
        state.cashRegister.entries = options.append ? state.cashRegister.entries.concat(page.entries || []) : (page.entries || [])
        state.cashRegister.nextCursor = page.nextCursor || null
        renderCashEntries()
      } catch (error) {
        cashUi.entryList.innerHTML = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
      }
    }

    async function selectCashDay(dayId) {
      state.cashRegister.selectedDayId = dayId
      const result = await getJson(cashScoped('/cash-register/days/' + encodeURIComponent(dayId) + '/summary'))
      renderCashSummary(result.day, result.summary, result.sessions)
      await loadCashEntries()
    }

    async function loadCashRegister(options = {}) {
      if (!canUseCashPermission('canViewCashRegister') || !state.businessId) return
      const preserve = options.preserve ?? state.cashRegister.loaded
      const [current, daysResult] = await Promise.all([getJson(cashScoped('/cash-register/current')), getJson(cashScoped('/cash-register/days'))])
      state.cashRegister.current = current
      state.cashRegister.permissions = current.permissions || {}
      state.cashRegister.days = daysResult.days || []
      state.cashRegister.selectedDayId = current.day?.id || state.cashRegister.selectedDayId || state.cashRegister.days[0]?.id || null
      renderCashCurrent()
      if (current.day?.id === state.cashRegister.selectedDayId) {
        renderCashSummary(current.day, current.summary, current.sessions, current.sessionExpectedCash)
        await loadCashEntries({ preserve })
      } else if (state.cashRegister.selectedDayId) {
        await selectCashDay(state.cashRegister.selectedDayId)
      }
      state.cashRegister.loaded = true
    }

    function closeCashSessionDialog() {
      cashUi.sessionDialog.hidden = true
      cashUi.sessionFeedback.textContent = ''
    }

    function currentSessionExpectedCash() {
      const value = state.cashRegister.current?.sessionExpectedCash ?? state.cashRegister.current?.summary?.expectedCash
      return Number.isSafeInteger(Number(value)) ? Number(value) : 0
    }

    function syncCashSessionReconciliation() {
      const mode = state.cashRegister.sessionMode
      cashUi.sessionReconciliation.hidden = mode === 'open'
      if (mode === 'open') return
      const expected = currentSessionExpectedCash()
      const countedText = cashUi.countedCash.value.trim()
      const counted = Number(countedText)
      cashUi.sessionExpected.textContent = cashMoney(expected)
      cashUi.sessionCounted.textContent = countedText && Number.isSafeInteger(counted) ? cashMoney(counted) : '--'
      cashUi.sessionDifference.textContent = countedText && Number.isSafeInteger(counted) ? cashSignedMoney(counted - expected) : '--'
      cashUi.sessionDifference.classList.toggle('positive', countedText !== '' && counted > expected)
      cashUi.sessionDifference.classList.toggle('negative', countedText !== '' && counted < expected)
      const difference = countedText && Number.isSafeInteger(counted) ? counted - expected : 0
      cashUi.differenceConfirmField.hidden = !countedText || !Number.isSafeInteger(counted) || difference === 0
      cashUi.differenceConfirmCopy.textContent = difference > 0
        ? 'Confirmo que hay más efectivo del esperado y quiero dejar la diferencia registrada.'
        : 'Confirmo que hay menos efectivo del esperado y quiero dejar la diferencia registrada.'
      cashUi.sessionSubmit.textContent = mode === 'new'
        ? difference === 0 ? 'Cambiar responsable' : 'Cambiar con diferencia'
        : difference === 0 ? 'Cerrar caja' : 'Cerrar con diferencia'
    }

    async function openCashSessionDialog(mode) {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.sessionMode = mode
      cashUi.sessionForm.reset()
      renderCashResponsibleOptions()
      cashUi.differenceConfirm.checked = false
      const previousClosedDay = state.cashRegister.days.find((day) => day.closedAt && day.countedClosingCash !== null && day.countedClosingCash !== undefined)
      const inheritedOpeningCash = previousClosedDay && Number.isSafeInteger(Number(previousClosedDay.countedClosingCash))
        ? Number(previousClosedDay.countedClosingCash)
        : null
      cashUi.sessionTitle.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Nueva sesión' : 'Cerrar caja'
      cashUi.responsibleField.hidden = mode === 'close'
      cashUi.openingField.hidden = mode !== 'open' || inheritedOpeningCash !== null
      cashUi.countedField.hidden = mode === 'open'
      cashUi.openingLabel.textContent = 'Efectivo inicial (solo primera apertura)'
      cashUi.countedLabel.textContent = mode === 'new' ? 'Efectivo contado al cambiar responsable' : 'Efectivo contado al cerrar'
      cashUi.sessionHelp.textContent = mode === 'open'
        ? inheritedOpeningCash !== null
          ? 'La jornada abrirá con ' + cashMoney(inheritedOpeningCash) + ', heredado automáticamente del efectivo contado en el cierre anterior.'
          : 'Solo se usa en la primera apertura. Después, la próxima jornada conserva automáticamente el efectivo contado del cierre anterior.'
        : mode === 'new'
          ? 'Dejá asentado el efectivo físico al cambiar de responsable. Esto no reinicia ni modifica los totales del día.'
          : 'Contá el efectivo físico para compararlo con el efectivo esperado y registrar cualquier diferencia.'
      cashUi.sessionSubmit.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Cambiar responsable' : 'Cerrar caja'
      cashUi.sessionFeedback.textContent = ''
      cashUi.sessionFeedback.className = 'cash-feedback'
      syncCashSessionReconciliation()
      cashUi.sessionDialog.hidden = false
      await loadCashResponsibleOptions().catch((error) => {
        cashUi.sessionFeedback.textContent = error.message
        cashUi.sessionFeedback.className = 'cash-feedback error'
      })
    }

    function returnToAppointmentDraft() {
      if (!state.cashRegister.returnToAppointment) return
      state.cashRegister.returnToAppointment = false
      setSection('agenda')
      els.appointmentDialog.hidden = false
    }

    async function submitCashSession(event) {
      event.preventDefault()
      const mode = state.cashRegister.sessionMode
      const currentSessionId = state.cashRegister.current?.session?.id
      const openingText = cashUi.openingCash.value.trim()
      const counted = Number(cashUi.countedCash.value)
      const payload = mode === 'open'
        ? { responsibleUserId: cashUi.sessionResponsible.value, ...(openingText ? { openingCash: Number(openingText) } : {}) }
        : mode === 'new'
          ? { currentSessionId, responsibleUserId: cashUi.sessionResponsible.value, countedCash: counted, acknowledgeDifference: cashUi.differenceConfirm.checked }
          : { currentSessionId, countedCash: counted, acknowledgeDifference: cashUi.differenceConfirm.checked }
      if (isCashBusinessScopedRole()) payload.businessId = state.businessId
      if ((mode !== 'open' && !Number.isSafeInteger(counted)) || (openingText && !Number.isSafeInteger(Number(openingText)))) {
        cashUi.sessionFeedback.textContent = 'Ingresá un importe entero válido.'
        cashUi.sessionFeedback.className = 'cash-feedback error'
        return
      }
      const difference = mode === 'open' ? 0 : counted - currentSessionExpectedCash()
      if (difference !== 0 && !cashUi.differenceConfirm.checked) {
        cashUi.sessionFeedback.textContent = 'Revisá la diferencia y confirmá que querés dejarla registrada.'
        cashUi.sessionFeedback.className = 'cash-feedback error'
        return
      }
      if (!setButtonLoading(cashUi.sessionSubmit, true, 'Guardando...')) return
      try {
        await getJson('/cash-register/' + (mode === 'open' ? 'open' : mode === 'new' ? 'new-session' : 'close'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        closeCashSessionDialog()
        await loadCashRegister()
        showCrmToast(mode === 'close' ? 'Caja cerrada.' : 'Sesión de Caja activa.', 'success')
        if (state.cashRegister.returnToAppointment && mode !== 'close') {
          returnToAppointmentDraft()
          if (state.editingAppointmentId) await loadAppointmentFinance()
          else await loadCreateAppointmentCashState()
        }
      } catch (error) {
        cashUi.sessionFeedback.textContent = error.message
        cashUi.sessionFeedback.className = 'cash-feedback error'
      } finally { setButtonLoading(cashUi.sessionSubmit, false) }
    }

    function syncCashOperationFields() {
      const type = cashUi.operationType.value
      cashUi.operationDeltaField.hidden = type !== 'ADJUSTMENT'
      cashUi.operationAmountField.hidden = type === 'ADJUSTMENT'
      cashUi.operationCounterpartyField.hidden = type !== 'WITHDRAWAL'
      cashUi.operationDescriptionField.hidden = type === 'WITHDRAWAL' || type === 'ADJUSTMENT'
      cashUi.operationMethodField.hidden = ['WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT'].includes(type)
    }

    function openCashOperationDialog() {
      cashUi.operationForm.reset()
      cashUi.operationFeedback.textContent = ''
      const mayOperate = canUseCashPermission('canManageCashOperations')
      for (const option of cashUi.operationType.options) option.hidden = option.value !== 'ADJUSTMENT' && !mayOperate || option.value === 'ADJUSTMENT' && !canUseCashPermission('canAdjustCash')
      cashUi.operationType.value = Array.from(cashUi.operationType.options).find((option) => !option.hidden)?.value || 'ADJUSTMENT'
      syncCashOperationFields()
      cashUi.operationDialog.hidden = false
    }

    function closeCashOperationDialog() { cashUi.operationDialog.hidden = true }

    async function submitCashOperation(event) {
      event.preventDefault()
      const type = cashUi.operationType.value
      const payload = { type, cashSessionId: state.cashRegister.current?.session?.id, observation: cashUi.operationObservation.value.trim() || undefined }
      if (isCashBusinessScopedRole()) payload.businessId = state.businessId
      if (type === 'ADJUSTMENT') payload.delta = Number(cashUi.operationDelta.value)
      else payload.amount = Number(cashUi.operationAmount.value)
      if (type === 'WITHDRAWAL') payload.counterparty = cashUi.operationCounterparty.value.trim()
      if (!['WITHDRAWAL', 'ADJUSTMENT'].includes(type)) payload.description = cashUi.operationDescription.value.trim()
      if (['EXPENSE', 'REFUND'].includes(type)) payload.method = cashUi.operationMethod.value
      if (!setButtonLoading(cashUi.operationSubmit, true, 'Registrando...')) return
      try {
        await getJson('/cash-register/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        closeCashOperationDialog()
        await loadCashRegister()
        showCrmToast('Operación registrada.', 'success')
      } catch (error) {
        cashUi.operationFeedback.textContent = error.message
        cashUi.operationFeedback.className = 'cash-feedback error'
      } finally { setButtonLoading(cashUi.operationSubmit, false) }
    }

    function financeEntryLabel(entry) {
      return cashTypeLabels[entry.type] || entry.type
    }

    function selectedCreateAppointmentPrice() {
      const service = state.services.find((item) => item.id === els.appointmentService.value)
      const estimated = service?.priceMode === 'STARTING_AT' || !Number.isSafeInteger(Number(service?.price))
      const enteredTotal = Number(cashUi.createEstimatedTotal.value)
      return {
        estimated,
        total: estimated ? (Number.isSafeInteger(enteredTotal) && enteredTotal > 0 ? enteredTotal : null) : (service ? Number(service.price) : null)
      }
    }

    function calculateCreateAppointmentTotals() {
      const price = selectedCreateAppointmentPrice()
      const rawDiscount = Number(cashUi.createDiscountValue.value)
      let discountAmount = 0
      if (state.cashRegister.createFinance.discount && price.total !== null && Number.isFinite(rawDiscount) && rawDiscount >= 0) {
        discountAmount = cashUi.createDiscountType.value === 'PERCENTAGE'
          ? Math.round(price.total * rawDiscount / 100)
          : rawDiscount
      }
      const final = price.total === null ? null : Math.max(0, price.total - discountAmount)
      const rawDeposit = Number(cashUi.createDepositAmount.value)
      const depositAmount = state.cashRegister.createFinance.deposit && Number.isSafeInteger(rawDeposit) && rawDeposit > 0 ? rawDeposit : 0
      const payableAfterDeposit = final === null ? 0 : Math.max(0, final - depositAmount)
      let collectedAmount = 0
      if (state.cashRegister.createFinance.collectTotal && final !== null) collectedAmount = payableAfterDeposit
      return {
        price,
        discountAmount,
        final,
        depositAmount,
        payableAfterDeposit,
        paid: depositAmount + collectedAmount,
        due: final === null ? null : Math.max(0, final - depositAmount - collectedAmount)
      }
    }

    function setCreateFinanceAction(button, active) {
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    }

    function syncCreateAppointmentPayment() {
      if (cashUi.createPayment.hidden) return
      const actions = state.cashRegister.createFinance
      const totals = calculateCreateAppointmentTotals()
      const hasPaymentIntent = actions.collectTotal || actions.deposit
      cashUi.createPaymentFields.hidden = false
      cashUi.createEstimatedTotalRow.hidden = !totals.price.estimated
      cashUi.createDiscountPanel.hidden = !actions.discount
      cashUi.createDepositPanel.hidden = !actions.deposit
      cashUi.createPaymentPanel.hidden = !actions.collectTotal
      cashUi.createObservationRow.hidden = !hasPaymentIntent
      cashUi.createDiscountValueLabel.textContent = cashUi.createDiscountType.value === 'PERCENTAGE' ? 'Porcentaje' : 'Monto'
      setCreateFinanceAction(cashUi.createCollectTotal, actions.collectTotal)
      setCreateFinanceAction(cashUi.createDeposit, actions.deposit)
      setCreateFinanceAction(cashUi.createDiscountToggle, actions.discount)
      cashUi.createCollectTotal.hidden = !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.createDeposit.hidden = !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.createDiscountToggle.hidden = !canUseCashPermission('canApplyDiscounts')

      if (actions.collectTotal) {
        if (cashUi.createPaymentLineTwo.hidden) {
          cashUi.createPaymentAmount.readOnly = true
          cashUi.createPaymentAmount.value = totals.final === null ? '' : String(totals.payableAfterDeposit)
        } else {
          cashUi.createPaymentAmount.readOnly = false
          const firstAmount = Number(cashUi.createPaymentAmount.value)
          const secondAmount = Number.isSafeInteger(firstAmount) && firstAmount > 0 && firstAmount < totals.payableAfterDeposit
            ? totals.payableAfterDeposit - firstAmount
            : 0
          cashUi.createPaymentAmountTwo.value = secondAmount > 0 ? String(secondAmount) : ''
        }
      }

      cashUi.createSummaryPrice.textContent = totals.price.total === null ? 'A definir' : cashMoney(totals.price.total)
      cashUi.createSummaryDiscount.textContent = cashMoney(totals.discountAmount)
      cashUi.createSummaryTotal.textContent = totals.final === null ? 'A definir' : cashMoney(totals.final)
      cashUi.createSummaryPaid.textContent = cashMoney(totals.paid)
      cashUi.createSummaryDue.textContent = totals.due === null ? 'A definir' : cashMoney(totals.due)
      cashUi.createPaymentStatus.textContent = actions.collectTotal
        ? 'Pago total'
        : actions.deposit
          ? (totals.depositAmount > 0 ? 'Seña ' + cashMoney(totals.depositAmount) : 'Seña pendiente')
          : actions.discount
            ? 'Con descuento'
            : 'Sin pago'
      const hasSession = Boolean(state.cashRegister.current?.session?.id)
      cashUi.createCashRequired.hidden = !hasPaymentIntent || hasSession
      cashUi.createOpenCash.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.createCashRequired.querySelector('p').textContent = canUseCashPermission('canManageCashSessions') ? 'Para cobrar necesitás una sesión de Caja activa.' : 'Pedile a un responsable autorizado que abra la Caja.'
      cashUi.createPaymentFeedback.textContent = ''
    }

    async function loadCreateAppointmentCashState() {
      try {
        state.cashRegister.current = await getJson(cashScoped('/cash-register/payment-context'))
      } catch {
        state.cashRegister.current = { day: null, session: null }
      }
      syncCreateAppointmentPayment()
    }

    function prepareCreateAppointmentPayment(appointment) {
      const visible = !appointment && (canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))
      cashUi.createPayment.hidden = !visible
      cashUi.createPayment.open = false
      state.cashRegister.createFinance = { collectTotal: false, deposit: false, discount: false }
      cashUi.createPaymentFields.hidden = false
      cashUi.createPaymentAmount.value = ''
      cashUi.createPaymentAmount.readOnly = true
      cashUi.createPaymentMethod.value = 'CASH'
      cashUi.createPaymentLineTwo.hidden = true
      cashUi.createPaymentAmountTwo.value = ''
      cashUi.createPaymentMethodTwo.value = 'TRANSFER'
      cashUi.createDepositAmount.value = ''
      cashUi.createDepositMethod.value = 'CASH'
      cashUi.createDiscountType.value = 'AMOUNT'
      cashUi.createDiscountValue.value = ''
      cashUi.createEstimatedTotal.value = ''
      cashUi.createPaymentObservation.value = ''
      cashUi.createPaymentFeedback.textContent = ''
      cashUi.createPaymentStatus.textContent = 'Sin pago'
      syncCreateAppointmentPayment()
      if (visible && canUseCashPermission('canRecordAppointmentPayments')) loadCreateAppointmentCashState()
    }

    function readCreateAppointmentPayment() {
      const actions = state.cashRegister.createFinance
      const enteredEstimatedTotal = cashUi.createEstimatedTotal.value.trim()
      const hasFinanceIntent = actions.collectTotal || actions.deposit || actions.discount || Boolean(enteredEstimatedTotal)
      if (!hasFinanceIntent) return null
      const totals = calculateCreateAppointmentTotals()
      if (totals.price.total === null) throw new Error('Ingresá el total acordado para este servicio estimativo.')

      let discountValue
      if (actions.discount) {
        discountValue = Number(cashUi.createDiscountValue.value)
        if (cashUi.createDiscountType.value === 'PERCENTAGE') {
          if (!Number.isFinite(discountValue) || discountValue <= 0 || discountValue > 100) throw new Error('El porcentaje debe ser mayor a 0 y no superar 100.')
        } else if (!Number.isSafeInteger(discountValue) || discountValue <= 0) {
          throw new Error('El descuento debe ser un monto entero mayor a cero.')
        }
        if (totals.discountAmount > totals.price.total) throw new Error('El descuento no puede superar el precio del turno.')
      }

      const lines = []
      if (actions.deposit) {
        const depositAmount = Number(cashUi.createDepositAmount.value)
        if (!Number.isSafeInteger(depositAmount) || depositAmount <= 0) throw new Error('Ingresá una seña entera mayor a cero.')
        lines.push({ amount: depositAmount, method: cashUi.createDepositMethod.value })
      }
      const payableAfterDeposit = Math.max(0, totals.final - totals.depositAmount)
      if (actions.collectTotal && payableAfterDeposit > 0) {
        lines.push({ amount: Number(cashUi.createPaymentAmount.value), method: cashUi.createPaymentMethod.value })
        if (!cashUi.createPaymentLineTwo.hidden) lines.push({ amount: Number(cashUi.createPaymentAmountTwo.value), method: cashUi.createPaymentMethodTwo.value })
      }
      if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount <= 0)) {
        throw new Error('Cada pago debe ser un importe entero mayor a cero.')
      }
      const paymentTotal = lines.reduce((total, line) => total + line.amount, 0)
      if (paymentTotal > totals.final) throw new Error('El pago no puede superar el saldo pendiente del turno.')
      if (actions.collectTotal && paymentTotal !== totals.final) throw new Error('Los medios de pago deben completar exactamente el total pendiente.')
      const hasPaymentLines = lines.length > 0
      if (hasPaymentLines && !state.cashRegister.current?.session?.id) throw new Error('Para registrar el pago necesitás una sesión de Caja activa.')
      return {
        ...(hasPaymentLines ? { cashSessionId: state.cashRegister.current.session.id, lines } : {}),
        ...(hasPaymentLines && cashUi.createPaymentObservation.value.trim() ? { observation: cashUi.createPaymentObservation.value.trim() } : {}),
        ...(totals.price.estimated ? { agreedAmount: totals.price.total } : {}),
        ...(actions.discount ? { discountType: cashUi.createDiscountType.value, discountValue } : {}),
        ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
      }
    }

    function syncEditAppointmentFinanceActions() {
      const finance = state.cashRegister.appointmentFinance
      if (!finance) return
      const actions = state.cashRegister.editFinance
      const canRecord = canUseCashPermission('canRecordAppointmentPayments')
      const canDiscount = canUseCashPermission('canApplyDiscounts')
      const activeSession = Boolean(state.cashRegister.current?.session?.id)
      const hasPaymentIntent = actions.collectTotal || actions.deposit

      cashUi.editCollectTotal.hidden = !canRecord || finance.balanceAmount <= 0
      cashUi.editDeposit.hidden = !canRecord || finance.balanceAmount <= 0
      cashUi.editDiscountToggle.hidden = !canDiscount
      setCreateFinanceAction(cashUi.editCollectTotal, actions.collectTotal)
      setCreateFinanceAction(cashUi.editDeposit, actions.deposit)
      setCreateFinanceAction(cashUi.editDiscountToggle, actions.discount)
      cashUi.paymentForm.hidden = !actions.collectTotal || !canRecord || !activeSession
      cashUi.editDepositPanel.hidden = !actions.deposit || !canRecord || !activeSession
      cashUi.discountForm.hidden = !actions.discount || !canDiscount
      cashUi.editObservationRow.hidden = !hasPaymentIntent || !activeSession
      cashUi.cashRequired.hidden = !hasPaymentIntent || activeSession
      cashUi.appointmentOpenCash.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.cashRequired.querySelector('p').textContent = canUseCashPermission('canManageCashSessions') ? 'Para cobrar necesitás una sesión de Caja activa.' : 'Pedile a un responsable autorizado que abra la Caja.'

      if (actions.collectTotal) {
        if (cashUi.paymentLineTwo.hidden) {
          cashUi.paymentAmount.readOnly = true
          cashUi.paymentAmount.value = String(finance.balanceAmount)
        } else {
          cashUi.paymentAmount.readOnly = false
          const firstAmount = Number(cashUi.paymentAmount.value)
          const secondAmount = Number.isSafeInteger(firstAmount) && firstAmount > 0 && firstAmount < finance.balanceAmount
            ? finance.balanceAmount - firstAmount
            : 0
          cashUi.paymentAmountTwo.value = secondAmount > 0 ? String(secondAmount) : ''
        }
      }
    }

    function renderAppointmentFinanceSummary(finance) {
      state.cashRegister.appointmentFinance = finance
      cashUi.financeBalance.textContent = finance.balanceAmount > 0 ? 'Saldo ' + cashMoney(finance.balanceAmount) : 'Pagado'
      cashUi.financePrice.textContent = cashMoney(finance.agreedAmount)
      cashUi.financeDiscount.textContent = cashMoney(finance.discountAmount)
      cashUi.financeTotal.textContent = cashMoney(finance.finalAmount)
      cashUi.financePaid.textContent = cashMoney(finance.paidAmount)
      cashUi.financeDue.textContent = cashMoney(finance.balanceAmount)
      cashUi.estimatedTotal.value = finance.agreedAmount
      cashUi.discountType.value = 'AMOUNT'
      cashUi.discountValue.value = finance.discountAmount
      syncAppointmentDiscountField()
      cashUi.totalForm.hidden = finance.pricingMode !== 'ESTIMATED' || !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.financeHistory.innerHTML = '<div class="cash-inline-state">Abr&iacute; Pago para ver los movimientos.</div>'
      syncEditAppointmentFinanceActions()
    }

    function renderAppointmentFinance(finance) {
      renderAppointmentFinanceSummary(finance)
      cashUi.financeHistory.innerHTML = finance.entries?.length ? finance.entries.map((entry) => '<article><span>' + escapeHtml(financeEntryLabel(entry)) + ' · ' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + (entry.effectiveAt ? '<small> · ' + escapeHtml(cashDate(entry.effectiveAt)) + '</small>' : '') + '</span><strong>' + (entry.direction === 'OUTFLOW' ? '−' : '+') + cashMoney(entry.amount) + '</strong></article>').join('') : '<div class="cash-inline-state">Todav&iacute;a no hay pagos.</div>'
    }

    function resetAppointmentFinanceView() {
      state.cashRegister.appointmentFinance = null
      state.cashRegister.editFinance = { collectTotal: false, deposit: false, discount: false }
      cashUi.financeBalance.textContent = 'Cargando...'
      cashUi.financePrice.textContent = '--'
      cashUi.financeDiscount.textContent = '--'
      cashUi.financeTotal.textContent = '--'
      cashUi.financePaid.textContent = '--'
      cashUi.financeDue.textContent = '--'
      cashUi.estimatedTotal.value = ''
      cashUi.discountType.value = 'AMOUNT'
      cashUi.discountValue.value = ''
      syncAppointmentDiscountField()
      cashUi.totalForm.hidden = true
      cashUi.editCollectTotal.hidden = true
      cashUi.editDeposit.hidden = true
      cashUi.editDiscountToggle.hidden = true
      cashUi.discountForm.hidden = true
      cashUi.paymentForm.hidden = true
      cashUi.editDepositPanel.hidden = true
      cashUi.editObservationRow.hidden = true
      cashUi.paymentAmount.value = ''
      cashUi.paymentAmount.readOnly = true
      cashUi.paymentMethod.value = 'CASH'
      cashUi.paymentLineTwo.hidden = true
      cashUi.paymentAmountTwo.value = ''
      cashUi.paymentMethodTwo.value = 'TRANSFER'
      cashUi.editDepositAmount.value = ''
      cashUi.editDepositMethod.value = 'CASH'
      cashUi.paymentObservation.value = ''
      cashUi.cashRequired.hidden = true
      cashUi.financeHistory.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      cashUi.financeFeedback.textContent = 'Cargando estado financiero...'
      cashUi.financeFeedback.className = 'appointment-finance-feedback'
    }

    function scrollAppointmentFinanceIntoView() {
      requestAnimationFrame(() => cashUi.finance.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }

    async function loadAppointmentFinance(options = {}) {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      const requestId = ++state.cashRegister.appointmentFinanceRequestId
      const key = appointmentFinanceCacheKey(appointmentId)
      const cached = state.cashRegister.appointmentFinanceCache[key]
      if (cached && options.force === false) {
        renderAppointmentFinance(cached)
        cashUi.financeFeedback.textContent = ''
        return cached
      }
      const preserve = options.preserve !== false && Boolean(state.cashRegister.appointmentFinance)
      if (!preserve) resetAppointmentFinanceView()
      else {
        cashUi.financeFeedback.textContent = 'Actualizando...'
        cashUi.financeFeedback.className = 'appointment-finance-feedback'
      }
      try {
        let pending = state.cashRegister.appointmentFinanceInFlight[key]
        if (!pending) {
          const paymentContext = canUseCashPermission('canRecordAppointmentPayments')
            ? getJson(cashScoped('/cash-register/payment-context')).catch(() => ({ day: null, session: null }))
            : Promise.resolve({ day: null, session: null })
          pending = Promise.all([getJson(cashScoped('/appointments/' + encodeURIComponent(appointmentId) + '/finance')), paymentContext])
          state.cashRegister.appointmentFinanceInFlight[key] = pending
        }
        const [finance, current] = await pending
        if (state.cashRegister.appointmentFinanceInFlight[key] === pending) delete state.cashRegister.appointmentFinanceInFlight[key]
        state.cashRegister.appointmentFinanceCache[key] = finance
        cacheAppointmentFinanceSummary(appointmentId, {
          accountId: finance.accountId,
          pricingMode: finance.pricingMode,
          agreedAmount: finance.agreedAmount,
          discountAmount: finance.discountAmount,
          finalAmount: finance.finalAmount,
          paidAmount: finance.paidAmount,
          balanceAmount: finance.balanceAmount
        })
        if (appointmentId !== state.editingAppointmentId || requestId !== state.cashRegister.appointmentFinanceRequestId) return
        state.cashRegister.current = current
        renderAppointmentFinance(finance)
        cashUi.financeFeedback.textContent = ''
      } catch (error) {
        delete state.cashRegister.appointmentFinanceInFlight[key]
        if (appointmentId !== state.editingAppointmentId || requestId !== state.cashRegister.appointmentFinanceRequestId) return
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    function prepareAppointmentFinance(appointment) {
      state.cashRegister.appointmentFinanceRequestId += 1
      cashUi.finance.hidden = !appointment || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))
      cashUi.finance.open = false
      cashUi.financeFeedback.textContent = ''
      state.cashRegister.editFinance = { collectTotal: false, deposit: false, discount: false }
      const summary = appointment
        ? state.cashRegister.appointmentFinanceSummaryCache[appointmentFinanceCacheKey(appointment.id)] || appointment.financeSummary
        : null
      if (summary && !cashUi.finance.hidden) renderAppointmentFinanceSummary(summary)
      else resetAppointmentFinanceView()
      prepareCreateAppointmentPayment(appointment)
    }

    async function submitAppointmentFinanceValue(event, suffix, field, property) {
      event.preventDefault()
      const value = Number(field.value)
      if (!Number.isSafeInteger(value) || value < 0) {
        cashUi.financeFeedback.textContent = 'Ingresá un monto nominal entero válido.'
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/' + suffix, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [property]: value, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        await loadAppointmentFinance()
      } catch (error) {
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    function syncAppointmentDiscountField() {
      const percentage = cashUi.discountType.value === 'PERCENTAGE'
      cashUi.discountValueLabel.textContent = percentage ? 'Porcentaje' : 'Monto'
      cashUi.discountValue.min = percentage ? '0.01' : '0'
      cashUi.discountValue.max = percentage ? '100' : ''
      cashUi.discountValue.step = percentage ? '0.01' : '1'
      cashUi.discountHelp.textContent = percentage
        ? 'Se calcula sobre el total acordado y se redondea al peso entero más cercano.'
        : 'Se guarda como un monto nominal sobre el total del turno.'
    }

    function showAppointmentFinanceError(message) {
      cashUi.financeFeedback.textContent = message
      cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      showCrmToast(message, 'error')
    }

    async function submitAppointmentDiscount(event) {
      event.preventDefault()
      const discountType = cashUi.discountType.value
      const discountValue = Number(cashUi.discountValue.value)
      if (discountType === 'AMOUNT' && (!Number.isSafeInteger(discountValue) || discountValue < 0)) {
        showAppointmentFinanceError('El monto del descuento debe ser un número entero mayor o igual a cero.')
        return
      }
      if (discountType === 'PERCENTAGE' && (!Number.isFinite(discountValue) || discountValue <= 0 || discountValue > 100)) {
        showAppointmentFinanceError('El porcentaje debe ser mayor a 0 y no superar 100.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/discount', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discountType, discountValue, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        await loadAppointmentFinance()
        showCrmToast('Descuento actualizado.', 'success')
      } catch (error) {
        showAppointmentFinanceError(error.message)
      }
    }

    async function submitAppointmentPayment(event) {
      event.preventDefault()
      const lines = [{ amount: Number(cashUi.paymentAmount.value), method: cashUi.paymentMethod.value }]
      if (!cashUi.paymentLineTwo.hidden) lines.push({ amount: Number(cashUi.paymentAmountTwo.value), method: cashUi.paymentMethodTwo.value })
      if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount <= 0)) {
        cashUi.financeFeedback.textContent = 'Cada pago debe ser un importe entero mayor a cero.'
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
        return
      }
      const pendingAmount = Number(state.cashRegister.appointmentFinance?.balanceAmount || 0)
      if (lines.reduce((total, line) => total + line.amount, 0) !== pendingAmount) {
        showAppointmentFinanceError('Los medios de pago deben completar exactamente el saldo pendiente.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashSessionId: state.cashRegister.current?.session?.id, lines, observation: cashUi.paymentObservation.value.trim() || undefined, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.paymentAmount.value = ''
        cashUi.paymentMethod.value = 'CASH'
        cashUi.paymentAmountTwo.value = ''
        cashUi.paymentMethodTwo.value = 'TRANSFER'
        cashUi.paymentObservation.value = ''
        cashUi.paymentLineTwo.hidden = true
        await loadAppointmentFinance()
        showCrmToast('Pago registrado.', 'success')
      } catch (error) {
        if (error.body?.code === 'CASH_CLOSED' || error.body?.code === 'STALE_SESSION') await loadAppointmentFinance()
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    async function submitAppointmentDeposit(event) {
      event.preventDefault()
      const amount = Number(cashUi.editDepositAmount.value)
      const pendingAmount = Number(state.cashRegister.appointmentFinance?.balanceAmount || 0)
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        showAppointmentFinanceError('Ingresá una seña entera mayor a cero.')
        return
      }
      if (amount > pendingAmount) {
        showAppointmentFinanceError('La seña no puede superar el saldo pendiente del turno.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashSessionId: state.cashRegister.current?.session?.id, lines: [{ amount, method: cashUi.editDepositMethod.value }], observation: cashUi.paymentObservation.value.trim() || undefined, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.editDepositAmount.value = ''
        cashUi.editDepositMethod.value = 'CASH'
        cashUi.paymentObservation.value = ''
        await loadAppointmentFinance()
        showCrmToast('Seña registrada.', 'success')
      } catch (error) {
        if (error.body?.code === 'CASH_CLOSED' || error.body?.code === 'STALE_SESSION') await loadAppointmentFinance()
        showAppointmentFinanceError(error.message)
      }
    }

    cashUi.openEmpty.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.openToolbar.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.newSession.addEventListener('click', () => openCashSessionDialog('new'))
    cashUi.closeDay.addEventListener('click', () => openCashSessionDialog('close'))
    cashUi.sessionX.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
    cashUi.sessionCancel.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
    cashUi.countedCash.addEventListener('input', () => {
      cashUi.differenceConfirm.checked = false
      syncCashSessionReconciliation()
    })
    cashUi.sessionForm.addEventListener('submit', submitCashSession)
    cashUi.operationOpen.addEventListener('click', openCashOperationDialog)
    cashUi.operationX.addEventListener('click', closeCashOperationDialog)
    cashUi.operationCancel.addEventListener('click', closeCashOperationDialog)
    cashUi.operationType.addEventListener('change', syncCashOperationFields)
    cashUi.operationForm.addEventListener('submit', submitCashOperation)
    cashUi.refresh.addEventListener('click', () => loadCashRegister().catch((error) => showCrmToast(error.message, 'error')))
    cashUi.daySelect.addEventListener('change', () => selectCashDay(cashUi.daySelect.value).catch((error) => showCrmToast(error.message, 'error')))
    cashUi.typeFilter.addEventListener('change', () => loadCashEntries())
    cashUi.methodFilter.addEventListener('change', () => loadCashEntries())
    cashUi.search.addEventListener('input', () => { clearTimeout(state.cashRegister.searchTimer); state.cashRegister.searchTimer = setTimeout(() => loadCashEntries(), 250) })
    cashUi.nextPage.addEventListener('click', () => loadCashEntries({ append: true }))
    cashUi.finance.addEventListener('toggle', () => { if (cashUi.finance.open) { scrollAppointmentFinanceIntoView(); loadAppointmentFinance({ force: false, preserve: true }) } })
    cashUi.totalSubmit.addEventListener('click', (event) => submitAppointmentFinanceValue(event, 'estimated-total', cashUi.estimatedTotal, 'agreedAmount'))
    cashUi.discountType.addEventListener('change', () => { cashUi.discountValue.value = ''; syncAppointmentDiscountField() })
    cashUi.discountSubmit.addEventListener('click', submitAppointmentDiscount)
    cashUi.editCollectTotal.addEventListener('click', () => {
      state.cashRegister.editFinance.collectTotal = !state.cashRegister.editFinance.collectTotal
      if (state.cashRegister.editFinance.collectTotal) {
        state.cashRegister.editFinance.deposit = false
        cashUi.paymentMethod.value = 'CASH'
      }
      cashUi.paymentLineTwo.hidden = true
      cashUi.paymentAmountTwo.value = ''
      syncEditAppointmentFinanceActions()
    })
    cashUi.editDeposit.addEventListener('click', () => {
      state.cashRegister.editFinance.deposit = !state.cashRegister.editFinance.deposit
      if (state.cashRegister.editFinance.deposit) {
        state.cashRegister.editFinance.collectTotal = false
        cashUi.editDepositMethod.value = 'CASH'
      }
      syncEditAppointmentFinanceActions()
    })
    cashUi.editDiscountToggle.addEventListener('click', () => {
      state.cashRegister.editFinance.discount = !state.cashRegister.editFinance.discount
      syncEditAppointmentFinanceActions()
    })
    cashUi.addPaymentLine.addEventListener('click', () => {
      cashUi.paymentLineTwo.hidden = !cashUi.paymentLineTwo.hidden
      if (cashUi.paymentLineTwo.hidden) cashUi.paymentAmount.value = String(state.cashRegister.appointmentFinance?.balanceAmount || '')
      syncEditAppointmentFinanceActions()
    })
    cashUi.paymentAmount.addEventListener('input', syncEditAppointmentFinanceActions)
    cashUi.paymentSubmit.addEventListener('click', submitAppointmentPayment)
    cashUi.editDepositSubmit.addEventListener('click', submitAppointmentDeposit)
    cashUi.createPayment.addEventListener('toggle', syncCreateAppointmentPayment)
    cashUi.createCollectTotal.addEventListener('click', () => {
      state.cashRegister.createFinance.collectTotal = !state.cashRegister.createFinance.collectTotal
      if (state.cashRegister.createFinance.collectTotal) cashUi.createPaymentMethod.value = 'CASH'
      cashUi.createPaymentLineTwo.hidden = true
      cashUi.createPaymentAmountTwo.value = ''
      syncCreateAppointmentPayment()
    })
    cashUi.createDeposit.addEventListener('click', () => {
      state.cashRegister.createFinance.deposit = !state.cashRegister.createFinance.deposit
      if (state.cashRegister.createFinance.deposit) cashUi.createDepositMethod.value = 'CASH'
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountToggle.addEventListener('click', () => {
      state.cashRegister.createFinance.discount = !state.cashRegister.createFinance.discount
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountType.addEventListener('change', () => {
      cashUi.createDiscountValue.value = ''
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountValue.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createDepositAmount.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createEstimatedTotal.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createPaymentAmount.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createAddPaymentLine.addEventListener('click', () => {
      cashUi.createPaymentLineTwo.hidden = !cashUi.createPaymentLineTwo.hidden
      if (!cashUi.createPaymentLineTwo.hidden) cashUi.createPaymentAmount.value = ''
      syncCreateAppointmentPayment()
    })
    els.appointmentService.addEventListener('change', () => {
      syncCreateAppointmentPayment()
    })
    els.appointmentProfessional.addEventListener('change', () => {
      syncCreateAppointmentPayment()
    })
    cashUi.createOpenCash.addEventListener('click', () => {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.returnToAppointment = true
      els.appointmentDialog.hidden = true
      setSection('cash')
      openCashSessionDialog('open')
    })
    cashUi.appointmentOpenCash.addEventListener('click', () => {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.returnToAppointment = true
      els.appointmentDialog.hidden = true
      setSection('cash')
      openCashSessionDialog('open')
    })
`
