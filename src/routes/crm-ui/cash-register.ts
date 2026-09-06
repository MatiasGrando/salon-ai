export const cashRegisterStyles = `
    .cash-register-view { display: none; min-width: 0; overflow: auto; background: var(--bg); }
    .app[data-section="cash"] { grid-template-columns: 80px minmax(0, 1fr); }
    .app[data-section="cash"] > :not(.workspace-nav):not(.cash-register-view):not(.crm-toast):not(.dialog-backdrop) { display: none; }
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
    .cash-dialog { width: min(620px, 100%); max-height: calc(100vh - 36px); overflow: auto; background: var(--surface); border-radius: 18px; padding: 22px; box-shadow: 0 24px 64px rgba(0,0,0,.24); }
    .cash-dialog-form { display: grid; gap: 14px; margin-top: 18px; }
    .cash-dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .cash-dialog-form label { display: grid; gap: 6px; font-weight: 750; }
    .cash-dialog-form :is(input,select,textarea) { width: 100%; border: 1px solid var(--line); border-radius: 9px; padding: 10px; }
    .cash-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .cash-feedback, .appointment-finance-feedback { min-height: 20px; margin: 0; color: var(--muted); white-space: pre-line; }
    .cash-feedback.error, .appointment-finance-feedback.error { color: var(--danger); }
    .cash-feedback.success, .appointment-finance-feedback.success { color: #047857; }
    .appointment-finance { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .appointment-finance > summary { cursor: pointer; padding: 13px; display: flex; justify-content: space-between; gap: 12px; font-weight: 850; background: var(--surface-soft); }
    .appointment-finance-content { padding: 14px; display: grid; gap: 14px; }
    .appointment-finance-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .appointment-finance-summary div { background: var(--surface-soft); border-radius: 9px; padding: 10px; display: grid; gap: 4px; }
    .appointment-finance-summary span { color: var(--muted); font-size: 12px; }
    .appointment-finance-form { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
    .appointment-finance-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; }
    .appointment-finance-history { display: grid; gap: 7px; }
    .appointment-finance-history article { display: flex; justify-content: space-between; gap: 8px; padding: 9px; border-radius: 8px; background: var(--surface-soft); }
    @media (max-width: 900px) {
      .app[data-section="cash"] { display: block; }
      .app[data-section="cash"] .cash-register-view { min-height: 100vh; padding-top: 70px; }
      .cash-shell { padding: 16px; }
      .cash-summary-grid { grid-template-columns: 1fr 1fr; }
      .cash-entry { grid-template-columns: 1fr auto; }
      .cash-entry > :not(.cash-entry-main):not(.cash-entry-amount) { display: none; }
    }
    @media (max-width: 560px) {
      .cash-header, .cash-toolbar, .cash-session-strip, .cash-filter-row { align-items: stretch; flex-direction: column; }
      .cash-summary-grid, .cash-dialog-grid, .appointment-finance-summary, .appointment-finance-row { grid-template-columns: 1fr; }
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
            <article class="cash-summary-card"><span>Efectivo esperado</span><strong id="cash-expected">$0</strong><small id="cash-opening">Inicial $0</small></article>
          </section>
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
          <label id="cash-responsible-field">Responsable<select id="cash-session-responsible"></select></label>
          <label id="cash-opening-field">Efectivo inicial<input id="cash-opening-cash" type="number" min="0" step="1" inputmode="numeric"></label>
          <label id="cash-counted-field" hidden>Efectivo contado<input id="cash-counted-cash" type="number" min="0" step="1" inputmode="numeric"></label>
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
          <details class="appointment-finance" id="appointment-finance" hidden>
            <summary><span>Pago del turno</span><span id="appointment-finance-balance">Cargando...</span></summary>
            <div class="appointment-finance-content">
              <div class="appointment-finance-summary"><div><span>Total final</span><strong id="appointment-finance-total">--</strong></div><div><span>Pagado</span><strong id="appointment-finance-paid">--</strong></div><div><span>Saldo</span><strong id="appointment-finance-due">--</strong></div></div>
              <form class="appointment-finance-form" id="appointment-total-form"><strong>Total estimativo</strong><div class="appointment-finance-row"><label>Importe<input id="appointment-estimated-total" type="number" min="0" step="1" inputmode="numeric"></label><span></span><button class="secondary" type="submit">Guardar total</button></div></form>
              <form class="appointment-finance-form" id="appointment-discount-form"><strong>Descuento nominal</strong><div class="appointment-finance-row"><label>Importe<input id="appointment-discount" type="number" min="0" step="1" inputmode="numeric"></label><span></span><button class="secondary" type="submit">Aplicar</button></div></form>
              <div class="appointment-finance-form"><strong>Historial</strong><div class="appointment-finance-history" id="appointment-finance-history"></div></div>
              <form class="appointment-finance-form" id="appointment-payment-form"><strong>Registrar pago</strong><div class="appointment-finance-row"><label>Importe<input id="appointment-payment-amount" type="number" min="1" step="1" inputmode="numeric"></label><label>Medio<select id="appointment-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="secondary" id="appointment-add-payment-line" type="button">Pago mixto</button></div><div class="appointment-finance-row" id="appointment-payment-line-two" hidden><label>Segundo importe<input id="appointment-payment-amount-two" type="number" min="1" step="1" inputmode="numeric"></label><label>Segundo medio<select id="appointment-payment-method-two"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div><label>Observaci&oacute;n<input id="appointment-payment-observation" maxlength="500"></label><button class="primary" type="submit">Registrar pago</button></form>
              <div id="appointment-cash-required" hidden><p>Para cobrar necesit&aacute;s una sesi&oacute;n de Caja activa.</p><button class="primary" id="appointment-open-cash" type="button">Abrir caja</button></div>
              <p class="appointment-finance-feedback" id="appointment-finance-feedback" role="status"></p>
            </div>
          </details>
`

export const cashRegisterScript = `
    const cashUi = {
      view: document.getElementById('cash-register-view'), status: document.getElementById('cash-status'), empty: document.getElementById('cash-empty-state'), emptyCopy: document.getElementById('cash-empty-copy'), dashboard: document.getElementById('cash-dashboard'),
      openEmpty: document.getElementById('cash-open-empty'), openToolbar: document.getElementById('cash-open-toolbar'), sessionStrip: document.getElementById('cash-session-strip'), responsible: document.getElementById('cash-responsible'), sessionTime: document.getElementById('cash-session-time'), operationOpen: document.getElementById('cash-operation-open'), newSession: document.getElementById('cash-new-session'), closeDay: document.getElementById('cash-close-day'), daySelect: document.getElementById('cash-day-select'), refresh: document.getElementById('cash-refresh'),
      gross: document.getElementById('cash-gross'), methods: document.getElementById('cash-methods'), net: document.getElementById('cash-net'), refunds: document.getElementById('cash-refunds'), outgoing: document.getElementById('cash-outgoing'), incoming: document.getElementById('cash-incoming'), expected: document.getElementById('cash-expected'), opening: document.getElementById('cash-opening'),
      typeFilter: document.getElementById('cash-type-filter'), methodFilter: document.getElementById('cash-method-filter'), search: document.getElementById('cash-search'), entryList: document.getElementById('cash-entry-list'), nextPage: document.getElementById('cash-next-page'),
      sessionDialog: document.getElementById('cash-session-dialog'), sessionTitle: document.getElementById('cash-session-title'), sessionForm: document.getElementById('cash-session-form'), sessionX: document.getElementById('cash-session-x'), sessionCancel: document.getElementById('cash-session-cancel'), sessionSubmit: document.getElementById('cash-session-submit'), sessionResponsible: document.getElementById('cash-session-responsible'), responsibleField: document.getElementById('cash-responsible-field'), openingField: document.getElementById('cash-opening-field'), countedField: document.getElementById('cash-counted-field'), openingCash: document.getElementById('cash-opening-cash'), countedCash: document.getElementById('cash-counted-cash'), sessionFeedback: document.getElementById('cash-session-feedback'),
      operationDialog: document.getElementById('cash-operation-dialog'), operationForm: document.getElementById('cash-operation-form'), operationX: document.getElementById('cash-operation-x'), operationCancel: document.getElementById('cash-operation-cancel'), operationType: document.getElementById('cash-operation-type'), operationMethod: document.getElementById('cash-operation-method'), operationMethodField: document.getElementById('cash-operation-method-field'), operationAmount: document.getElementById('cash-operation-amount'), operationAmountField: document.getElementById('cash-operation-amount-field'), operationDelta: document.getElementById('cash-operation-delta'), operationDeltaField: document.getElementById('cash-operation-delta-field'), operationDescription: document.getElementById('cash-operation-description'), operationDescriptionField: document.getElementById('cash-operation-description-field'), operationCounterparty: document.getElementById('cash-operation-counterparty'), operationCounterpartyField: document.getElementById('cash-operation-counterparty-field'), operationObservation: document.getElementById('cash-operation-observation'), operationFeedback: document.getElementById('cash-operation-feedback'), operationSubmit: document.getElementById('cash-operation-submit'),
      finance: document.getElementById('appointment-finance'), financeBalance: document.getElementById('appointment-finance-balance'), financeTotal: document.getElementById('appointment-finance-total'), financePaid: document.getElementById('appointment-finance-paid'), financeDue: document.getElementById('appointment-finance-due'), financeHistory: document.getElementById('appointment-finance-history'), financeFeedback: document.getElementById('appointment-finance-feedback'), totalForm: document.getElementById('appointment-total-form'), estimatedTotal: document.getElementById('appointment-estimated-total'), discountForm: document.getElementById('appointment-discount-form'), discount: document.getElementById('appointment-discount'), paymentForm: document.getElementById('appointment-payment-form'), paymentAmount: document.getElementById('appointment-payment-amount'), paymentMethod: document.getElementById('appointment-payment-method'), paymentLineTwo: document.getElementById('appointment-payment-line-two'), paymentAmountTwo: document.getElementById('appointment-payment-amount-two'), paymentMethodTwo: document.getElementById('appointment-payment-method-two'), addPaymentLine: document.getElementById('appointment-add-payment-line'), paymentObservation: document.getElementById('appointment-payment-observation'), cashRequired: document.getElementById('appointment-cash-required'), appointmentOpenCash: document.getElementById('appointment-open-cash')
    }
    state.cashRegister = { current: null, days: [], selectedDayId: null, entries: [], nextCursor: null, permissions: {}, responsibleUsers: [], sessionMode: 'open', returnToAppointment: false, searchTimer: null, eventSource: null }

    function canUseCashPermission(permission) {
      if (state.currentUser?.role === 'BUSINESS_ADMIN' || state.currentUser?.role === 'SUPER_ADMIN') return true
      if (state.currentUser?.role !== 'STAFF') return false
      return state.currentUser?.[permission] === true
    }

    function cashMoney(value) {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0))
    }

    function cashDate(value) {
      return value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: state.business?.timezone }) : '--'
    }

    function cashScoped(path) {
      if (state.currentUser?.role !== 'SUPER_ADMIN' || !state.businessId) return path
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
        if (document.body.dataset.currentSection === 'cash') loadCashRegister().catch((error) => showCrmToast(error.message, 'error'))
        if (state.editingAppointmentId && !cashUi.finance.hidden) loadAppointmentFinance()
      })
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
      cashUi.daySelect.innerHTML = state.cashRegister.days.map((day) => '<option value="' + escapeHtml(day.id) + '"' + (day.id === state.cashRegister.selectedDayId ? ' selected' : '') + '>' + escapeHtml(cashDate(day.openedAt)) + (day.closedAt ? ' · Cerrada' : ' · Abierta') + '</option>').join('')
      if (!isOpen) return
      cashUi.responsible.textContent = current.session.responsibleName || 'Responsable'
      cashUi.sessionTime.textContent = 'Desde ' + cashDate(current.session.openedAt)
      cashUi.operationOpen.hidden = !(canUseCashPermission('canManageCashOperations') || canUseCashPermission('canAdjustCash'))
      cashUi.newSession.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.closeDay.hidden = !canUseCashPermission('canManageCashSessions')
    }

    function renderCashSummary(day, summary) {
      if (!summary) return
      cashUi.gross.textContent = cashMoney(summary.grossCollected)
      cashUi.methods.textContent = 'Efectivo ' + cashMoney(summary.collectedByMethod?.CASH) + ' · Transferencia ' + cashMoney(summary.collectedByMethod?.TRANSFER) + ' · Tarjeta ' + cashMoney(summary.collectedByMethod?.CARD)
      cashUi.net.textContent = cashMoney(summary.net)
      cashUi.refunds.textContent = 'Devoluciones ' + cashMoney(summary.refunds)
      cashUi.outgoing.textContent = cashMoney(Number(summary.expenses || 0) + Number(summary.withdrawals || 0))
      cashUi.incoming.textContent = 'Ingresos ' + cashMoney(summary.cashIn) + ' · Ajustes ' + cashMoney(summary.adjustments)
      cashUi.expected.textContent = cashMoney(summary.expectedCash)
      cashUi.opening.textContent = 'Inicial ' + cashMoney(day?.openingCash)
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
      if (!options.append) cashUi.entryList.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      const params = new URLSearchParams({ limit: '40' })
      if (state.currentUser?.role === 'SUPER_ADMIN' && state.businessId) params.set('businessId', state.businessId)
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
      renderCashSummary(result.day, result.summary)
      await loadCashEntries()
    }

    async function loadCashRegister() {
      if (!canUseCashPermission('canViewCashRegister') || !state.businessId) return
      const [current, daysResult] = await Promise.all([getJson(cashScoped('/cash-register/current')), getJson(cashScoped('/cash-register/days'))])
      state.cashRegister.current = current
      state.cashRegister.permissions = current.permissions || {}
      state.cashRegister.days = daysResult.days || []
      state.cashRegister.selectedDayId = current.day?.id || state.cashRegister.selectedDayId || state.cashRegister.days[0]?.id || null
      renderCashCurrent()
      if (current.day?.id === state.cashRegister.selectedDayId) {
        renderCashSummary(current.day, current.summary)
        await loadCashEntries()
      } else if (state.cashRegister.selectedDayId) {
        await selectCashDay(state.cashRegister.selectedDayId)
      }
    }

    function closeCashSessionDialog() {
      cashUi.sessionDialog.hidden = true
      cashUi.sessionFeedback.textContent = ''
    }

    async function openCashSessionDialog(mode) {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.sessionMode = mode
      renderCashResponsibleOptions()
      cashUi.sessionTitle.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Nueva sesión' : 'Cerrar caja'
      cashUi.responsibleField.hidden = mode === 'close'
      cashUi.openingField.hidden = mode !== 'open'
      cashUi.countedField.hidden = mode === 'open'
      cashUi.sessionSubmit.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Cambiar responsable' : 'Cerrar caja'
      cashUi.sessionFeedback.textContent = ''
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
          ? { currentSessionId, responsibleUserId: cashUi.sessionResponsible.value, countedCash: counted }
          : { currentSessionId, countedCash: counted }
      if (state.currentUser?.role === 'SUPER_ADMIN') payload.businessId = state.businessId
      if ((mode !== 'open' && !Number.isSafeInteger(counted)) || (openingText && !Number.isSafeInteger(Number(openingText)))) {
        cashUi.sessionFeedback.textContent = 'Ingresá un importe entero válido.'
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
          await loadAppointmentFinance()
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
      if (state.currentUser?.role === 'SUPER_ADMIN') payload.businessId = state.businessId
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

    function renderAppointmentFinance(finance) {
      cashUi.financeBalance.textContent = 'Saldo ' + cashMoney(finance.balanceAmount)
      cashUi.financeTotal.textContent = cashMoney(finance.finalAmount)
      cashUi.financePaid.textContent = cashMoney(finance.paidAmount)
      cashUi.financeDue.textContent = cashMoney(finance.balanceAmount)
      cashUi.estimatedTotal.value = finance.agreedAmount
      cashUi.discount.value = finance.discountAmount
      cashUi.totalForm.hidden = finance.pricingMode !== 'ESTIMATED' || !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.discountForm.hidden = !canUseCashPermission('canApplyDiscounts')
      const activeSession = state.cashRegister.current?.session
      cashUi.paymentForm.hidden = !canUseCashPermission('canRecordAppointmentPayments') || !activeSession
      cashUi.cashRequired.hidden = !canUseCashPermission('canRecordAppointmentPayments') || Boolean(activeSession)
      cashUi.appointmentOpenCash.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.cashRequired.querySelector('p').textContent = canUseCashPermission('canManageCashSessions') ? 'Para cobrar necesitás una sesión de Caja activa.' : 'Pedile a un responsable autorizado que abra la Caja.'
      cashUi.financeHistory.innerHTML = finance.entries?.length ? finance.entries.map((entry) => '<article><span>' + escapeHtml(financeEntryLabel(entry)) + ' · ' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + (entry.effectiveAt ? '<small> · ' + escapeHtml(cashDate(entry.effectiveAt)) + '</small>' : '') + '</span><strong>' + (entry.direction === 'OUTFLOW' ? '−' : '+') + cashMoney(entry.amount) + '</strong></article>').join('') : '<div class="cash-inline-state">Todav&iacute;a no hay pagos.</div>'
    }

    async function loadAppointmentFinance() {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      cashUi.financeFeedback.textContent = 'Cargando estado financiero...'
      try {
        const [finance, current] = await Promise.all([getJson(cashScoped('/appointments/' + encodeURIComponent(appointmentId) + '/finance')), getJson(cashScoped('/cash-register/current')).catch(() => ({ day: null, session: null }))])
        state.cashRegister.current = current
        renderAppointmentFinance(finance)
        cashUi.financeFeedback.textContent = ''
      } catch (error) {
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    function prepareAppointmentFinance(appointment) {
      cashUi.finance.hidden = !appointment || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))
      cashUi.finance.open = false
      cashUi.financeFeedback.textContent = ''
      if (appointment && !cashUi.finance.hidden) loadAppointmentFinance()
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
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/' + suffix, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [property]: value, ...(state.currentUser?.role === 'SUPER_ADMIN' ? { businessId: state.businessId } : {}) }) })
        await loadAppointmentFinance()
      } catch (error) {
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
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
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashSessionId: state.cashRegister.current?.session?.id, lines, observation: cashUi.paymentObservation.value.trim() || undefined, ...(state.currentUser?.role === 'SUPER_ADMIN' ? { businessId: state.businessId } : {}) }) })
        cashUi.paymentForm.reset()
        cashUi.paymentLineTwo.hidden = true
        await loadAppointmentFinance()
        showCrmToast('Pago registrado.', 'success')
      } catch (error) {
        if (error.body?.code === 'CASH_CLOSED' || error.body?.code === 'STALE_SESSION') await loadAppointmentFinance()
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    cashUi.openEmpty.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.openToolbar.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.newSession.addEventListener('click', () => openCashSessionDialog('new'))
    cashUi.closeDay.addEventListener('click', () => openCashSessionDialog('close'))
    cashUi.sessionX.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
    cashUi.sessionCancel.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
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
    cashUi.finance.addEventListener('toggle', () => { if (cashUi.finance.open) loadAppointmentFinance() })
    cashUi.totalForm.addEventListener('submit', (event) => submitAppointmentFinanceValue(event, 'estimated-total', cashUi.estimatedTotal, 'agreedAmount'))
    cashUi.discountForm.addEventListener('submit', (event) => submitAppointmentFinanceValue(event, 'discount', cashUi.discount, 'discountAmount'))
    cashUi.addPaymentLine.addEventListener('click', () => { cashUi.paymentLineTwo.hidden = !cashUi.paymentLineTwo.hidden })
    cashUi.paymentForm.addEventListener('submit', submitAppointmentPayment)
    cashUi.appointmentOpenCash.addEventListener('click', () => {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.returnToAppointment = true
      els.appointmentDialog.hidden = true
      setSection('cash')
      openCashSessionDialog('open')
    })
`
