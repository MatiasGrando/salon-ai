// One scoped dialog: fixed header/navigation, grouped responsive fields, scrollable
// tables and a fixed feedback/action footer. Every interior size follows --bp-scale.
export const bookingProgramsStyles = `
  #booking-programs[hidden] { display:none !important; }
  body:has(#booking-programs:not([hidden])) #confirmation-dialog { z-index:181; }
  #booking-programs { position:fixed; inset:0; z-index:180; display:grid; place-items:center; padding:16px; background:rgba(15,23,42,.58); }
  #booking-programs .bp-dialog { --bp-scale:1; font-size:calc(14px * var(--bp-scale)); width:900px; height:600px; min-width:620px; min-height:420px; max-width:calc(100vw - 32px); max-height:calc(100dvh - 32px); resize:both; overflow:hidden; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; color:var(--text,#111827); background:var(--surface,#fff); border:1px solid var(--line,#dbe1ea); border-radius:1em; box-shadow:0 24px 80px #0004; }
  #booking-programs * { box-sizing:border-box; }
  #booking-programs .bp-dialog.bp-benefits { grid-template-rows:auto minmax(0,1fr) auto; }
  #booking-programs [hidden] { display:none !important; }
  #booking-programs .bp-head { display:flex; justify-content:space-between; align-items:start; gap:1em; padding:1.25em 1.5em; border-bottom:1px solid var(--line); }
  #booking-programs h2 { margin:0; font-size:1.4em; }
  #booking-programs h3 { margin:0 0 .7em; font-size:1.1em; }
  #booking-programs p { margin:.4em 0; line-height:1.5; }
  #booking-programs .bp-copy { color:var(--muted,#64748b); font-size:.92em; }
  #booking-programs .bp-tabs { display:flex; flex-wrap:wrap; gap:.5em; padding:.8em 1.5em; border-bottom:1px solid var(--line); }
  #booking-programs .bp-body { min-width:0; overflow:auto; padding:1.4em 1.5em; }
  #booking-programs .bp-section { margin-bottom:1.3em; padding:1em; border:1px solid var(--line); border-radius:.7em; min-width:0; }
  #booking-programs .bp-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1em; }
  #booking-programs label { display:grid; gap:.45em; font-size:1em; min-width:0; }
  #booking-programs .bp-check { display:flex; align-items:center; gap:.6em; }
  #booking-programs input, #booking-programs select { width:100%; min-width:0; min-height:2.65em; padding:.55em .7em; font:inherit; color:inherit; background:var(--surface,#fff); border:1px solid var(--line-strong,#cbd5e1); border-radius:.4em; }
  #booking-programs select[multiple] { min-height:7em; }
  #booking-programs input[type=checkbox] { width:1.15em; height:1.15em; min-height:0; accent-color:var(--accent,#2563eb); }
  #booking-programs button { font:inherit; min-height:2.5em; padding:.5em .85em; border:1px solid var(--line-strong,#cbd5e1); border-radius:.45em; color:inherit; background:var(--surface,#fff); cursor:pointer; }
  #booking-programs button.bp-primary, #booking-programs button[aria-selected=true] { color:#fff; background:var(--accent,#2563eb); border-color:var(--accent,#2563eb); }
  #booking-programs button:disabled { opacity:.55; cursor:wait; }
  #booking-programs :focus-visible { outline:2px solid var(--accent,#2563eb); outline-offset:2px; }
  #booking-programs [aria-invalid=true] { border-color:var(--danger,#dc2626); }
  #booking-programs .bp-actions { display:flex; gap:.6em; flex-wrap:wrap; align-items:center; margin-top:.9em; }
  #booking-programs .bp-table-wrap { width:100%; overflow:auto; }
  #booking-programs .bp-service-editor { min-width:52em; }
  #booking-programs .bp-service-editor input { min-width:5em; }
  #booking-programs .bp-service-editor select { min-width:8em; }
  #booking-programs .bp-total { font-size:1.15em; font-weight:700; }
  #booking-programs #bp-plan-form > h3:not(:first-child) { margin-top:1.3em; }
  #booking-programs #bp-plan-editor > summary { padding:.7em 0; font-weight:600; cursor:pointer; }
  #booking-programs table { width:100%; border-collapse:collapse; font:inherit; text-align:left; }
  #booking-programs th, #booking-programs td { padding:.7em .6em; border-bottom:1px solid var(--line); vertical-align:top; font-size:.94em; }
  #booking-programs th { color:var(--muted,#64748b); font-size:.85em; }
  #booking-programs .bp-range { display:flex; align-items:center; gap:.4em; margin-bottom:.4em; }
  #booking-programs .bp-range input { min-width:7em; }
  #booking-programs .bp-foot { display:flex; flex-wrap:wrap; align-items:center; gap:.8em; padding:.85em 1.5em; border-top:1px solid var(--line); background:var(--surface-soft,#f8fafc); }
  #booking-programs .bp-feedback { min-height:1.5em; overflow-wrap:anywhere; }
  #booking-programs .bp-feedback.bp-error { color:var(--danger,#dc2626); }
  #booking-programs .bp-full { grid-column:1/-1; }
  @media(max-width:680px) {
    #booking-programs { padding:8px; }
    #booking-programs .bp-dialog { --bp-scale:1 !important; width:100% !important; height:calc(100dvh - 16px) !important; min-width:0; min-height:0; max-width:100%; max-height:calc(100dvh - 16px); resize:none; }
    #booking-programs .bp-grid { grid-template-columns:1fr; }
    #booking-programs .bp-head, #booking-programs .bp-body, #booking-programs .bp-foot, #booking-programs .bp-tabs { padding:1em; }
    #booking-programs .bp-range { flex-wrap:wrap; }
    #booking-programs .bp-range input { min-width:0; width:7em; }
  }
`
export const bookingProgramsMarkup = `
  <div id="booking-programs" hidden>
    <section class="bp-dialog" role="dialog" aria-modal="true" aria-labelledby="bp-title">
      <header class="bp-head"><div><h2 id="bp-title">Agenda y beneficios</h2><p class="bp-copy" id="bp-context"></p></div><button type="button" data-bp-close aria-label="Cerrar">&times;</button></header>
      <nav class="bp-tabs" aria-label="Funciones de agenda"><button type="button" data-bp-tab="week">Disponibilidad por semana</button><button type="button" data-bp-tab="recurring">Turnos recurrentes</button><button type="button" data-bp-tab="benefits">Beneficios del cliente</button></nav>
      <div class="bp-body" id="bp-body"></div>
      <footer class="bp-foot"><button class="bp-primary" type="submit" form="bp-plan-form" id="bp-plan-submit" hidden>Crear plan</button><p class="bp-feedback" id="bp-feedback" role="status" aria-live="polite"></p></footer>
    </section>
  </div>
`

export const bookingProgramsScript = String.raw`
    const bpRoot = document.getElementById('booking-programs')
    const bpDialog = bpRoot.querySelector('.bp-dialog')
    const bpBody = document.getElementById('bp-body')
    let bpCustomer = null, bpBusiness = null, bpTab = 'week', bpRevision = 0, bpRules = [], bpPlans = [], bpGrants = [], bpBusy = false, bpOpener = null, bpLoadVersion = 0
    const bpEscape = value => escapeHtml(String(value ?? ''))
    const bpToday = () => new Date().toLocaleDateString('en-CA', { timeZone: state.business?.timezone || 'America/Argentina/Buenos_Aires' })
    function bpDateAdd(date, days) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10) }
    function bpMonday(date) { const day = new Date(date).getUTCDay(); return bpDateAdd(date, -(day === 0 ? 6 : day - 1)) }
    function bpFeedback(message, error = false) { const el = document.getElementById('bp-feedback'); el.textContent = message; el.classList.toggle('bp-error', error); el.setAttribute('role', error ? 'alert' : 'status') }
    function bpPath(path, params = {}) { const q = new URLSearchParams({ ...params, businessId: bpBusiness }); return path + '?' + q.toString() }
    async function bpRead(path, params) { const business = bpBusiness; const result = await getJson(bpPath(path, params)); if (business !== state.businessId || business !== bpBusiness) throw new Error('El comercio cambio. Reabri la ventana.'); return result }
    async function bpWrite(path, data, method = 'POST') { const business = bpBusiness; const result = await getJson(path, { method, headers: { 'Content-Type':'application/json' }, body:JSON.stringify({ ...data, businessId:business }) }); if (business !== state.businessId || business !== bpBusiness) throw new Error('El comercio cambio. Reabri la ventana.'); return result }
    function bpProfessionals(selected) { return state.professionals.filter(p => p.isActive !== false && (state.currentUser?.role !== 'STAFF' || state.currentUser.agendaScope !== 'OWN' || state.currentUser.professionalId === p.id)).map(p => '<option value="' + bpEscape(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + bpEscape(p.name) + '</option>').join('') }
    function bpServices(selected) { return state.services.filter(s => s.isActive !== false).map(s => '<option value="' + bpEscape(s.id) + '"' + (s.id === selected ? ' selected' : '') + '>' + bpEscape(s.name) + '</option>').join('') }
    function bpMoney(value) { return Number(value || 0).toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:0 }) }
    function bpCanFinance() { return state.currentUser?.role !== 'STAFF' || state.currentUser.canRecordAppointmentPayments === true }
    function bpCanHours() { return state.currentUser?.role !== 'STAFF' || state.currentUser.canManageScheduleBlocks === true }
    function bpResize() {
      if (bpRoot.hidden) return
      const rect = bpDialog.getBoundingClientRect()
      const scale = innerWidth <= 680 ? 1 : Math.max(1, rect.width / 900, rect.height / 600)
      bpDialog.style.setProperty('--bp-scale', String(scale))
      if (innerWidth > 680) try { localStorage.setItem('weex-booking-program-size', JSON.stringify({ width:parseFloat(bpDialog.style.width) || 900, height:parseFloat(bpDialog.style.height) || 600 })) } catch {}
    }
    new ResizeObserver(bpResize).observe(bpDialog)
    window.addEventListener('resize', bpResize)
    function bpClose() { if (bpBusy) return; bpRoot.hidden = true; bpLoadVersion++; bpOpener?.focus() }
    async function openBookingPrograms(tab = 'week', customer = null) {
      if (!state.businessId) return
      bpOpener = document.activeElement; bpBusiness = state.businessId; bpCustomer = customer; bpTab = tab
      if (innerWidth > 680) try { const saved = JSON.parse(localStorage.getItem('weex-booking-program-size') || 'null'); if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) { bpDialog.style.width = Math.max(620,saved.width) + 'px'; bpDialog.style.height = Math.max(420,saved.height) + 'px' } } catch {}
      bpRoot.hidden = false; bpResize(); bpRoot.querySelector('[data-bp-close]').focus(); await bpRender()
    }
    async function bpRender() {
      const version = ++bpLoadVersion
      bpDialog.classList.toggle('bp-benefits', bpTab === 'benefits')
      bpRoot.querySelector('.bp-tabs').hidden = bpTab === 'benefits'
      document.getElementById('bp-title').textContent = bpTab === 'benefits' ? 'Membresías' : 'Agenda y beneficios'
      document.getElementById('bp-plan-submit').hidden = true
      document.getElementById('bp-context').textContent = bpCustomer ? bpCustomer.name : state.business?.name || ''
      bpRoot.querySelectorAll('[data-bp-tab]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.bpTab === bpTab)); b.hidden = (bpTab === 'benefits' && b.dataset.bpTab !== 'benefits') || b.dataset.bpTab === 'benefits' && !bpCanFinance() })
      bpBody.innerHTML = '<p>Cargando...</p>'; bpFeedback('')
      try {
        if (bpTab === 'week') {
          bpBody.innerHTML = '<section class="bp-section"><h3>Horarios del profesional</h3><div class="bp-grid"><label>Profesional<select id="bp-professional">' + bpProfessionals(document.getElementById('agenda-professional')?.value) + '</select></label><label>Semana<input type="date" id="bp-week" value="' + bpMonday(bpToday()) + '"></label><label>Modalidad<select id="bp-mode"><option value="HABITUAL">Horario habitual</option><option value="MANUAL">Publicacion manual</option></select></label><div><p class="bp-copy">La publicacion manual habilita solo fechas publicadas. Las reservas existentes se conservan.</p><button type="button" data-bp-action="mode">Guardar modalidad</button></div></div></section><section class="bp-section"><h3>Franjas por fecha</h3><p class="bp-copy" id="bp-week-status"></p><div class="bp-table-wrap"><table><thead><tr><th>Fecha</th><th>Horarios de atencion</th></tr></thead><tbody id="bp-hours"></tbody></table></div><div class="bp-actions"><button type="button" data-bp-action="copy">Copiar semana anterior</button><button type="button" data-bp-action="draft">Guardar borrador</button><button type="button" data-bp-action="preview">Revisar antes de publicar</button><button type="button" class="bp-primary" data-bp-action="publish">Publicar horarios</button></div><div id="bp-summary"></div></section>'
          await bpLoadWeek(); return
        }
        if (bpTab === 'recurring') {
          bpRules = await bpRead('/recurring-bookings', bpCustomer ? { customerId:bpCustomer.id } : {})
          if (version !== bpLoadVersion) return
          bpBody.innerHTML = '<section class="bp-section"><h3>Repetir turno</h3><form id="bp-recurring-form" novalidate><div class="bp-grid">' + bpCustomerField() + '<label>Profesional<select name="professionalId">' + bpProfessionals() + '</select></label><label>Servicio<select name="serviceId">' + bpServices() + '</select></label><label>Primera fecha<input type="date" name="startsOn" value="' + bpToday() + '" required></label><label>Horario<input type="time" name="time" value="18:00" required></label><label>Frecuencia<select name="frequency"><option value="WEEKLY">Semanal</option><option value="FORTNIGHTLY">Cada dos semanas</option><option value="MONTHLY">Mensual (mismo dia del mes)</option></select></label><label>Ultima fecha (opcional)<input type="date" name="endsOn"></label><label class="bp-check"><input type="checkbox" name="useBenefits"> Requiere cobertura de pack o membresia</label></div><p class="bp-copy">La regla se conserva aunque la semana no este publicada. Pausar o terminar detiene la generacion; los turnos ya confirmados se gestionan desde Agenda.</p><div class="bp-actions"><button class="bp-primary" type="submit">Crear repeticion</button><button type="button" data-bp-action="refresh">Reintentar conflictos</button></div></form></section><section class="bp-section"><h3>Repeticiones e incidencias</h3><div class="bp-table-wrap"><table><thead><tr><th>Cliente / servicio</th><th>Frecuencia</th><th>Estado / acciones</th></tr></thead><tbody>' + (bpRules.map(r => '<tr><td>' + bpEscape(r.customer.name) + '<br>' + bpEscape(r.service.name) + ' / ' + bpEscape(r.professional.name) + '</td><td>' + bpEscape(({WEEKLY:'Semanal',FORTNIGHTLY:'Quincenal',MONTHLY:'Mensual'})[r.frequency]) + '<br>' + bpEscape(r.startsOn) + ' / ' + bpEscape(r.time) + '</td><td>' + bpEscape(({ACTIVE:'Activa',PAUSED:'Pausada',ENDED:'Finalizada'})[r.status]) + (r.status !== 'ENDED' ? '<div class="bp-actions"><button data-bp-rule="' + bpEscape(r.id) + '" data-bp-status="' + (r.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE') + '">' + (r.status === 'ACTIVE' ? 'Pausar' : 'Retomar') + '</button><button data-bp-rule="' + bpEscape(r.id) + '" data-bp-status="ENDED">Terminar</button></div>' : '') + r.occurrences.map(o => '<p>' + bpEscape(o.date) + ': ' + bpEscape(o.conflict) + ' <button data-bp-skip="' + bpEscape(r.id) + '" data-bp-date="' + bpEscape(o.date) + '">Saltar fecha</button></p>').join('') + '</td></tr>').join('') || '<tr><td colspan="3">Todavia no hay repeticiones.</td></tr>') + '</tbody></table></div></section>'
          return
        }
        bpPlans = await bpRead('/benefit-plans')
        bpGrants = bpCustomer ? await bpRead('/customers/' + encodeURIComponent(bpCustomer.id) + '/benefits') : []
        if (version !== bpLoadVersion) return
        bpBody.innerHTML = '<section class="bp-section"><h3>Beneficios' + (bpCustomer ? ' de ' + bpEscape(bpCustomer.name) : '') + '</h3><p class="bp-copy">Cada compra conserva sus condiciones. Los usos vencen segun la fecha de atencion; reservar no extiende la vigencia.</p>' + (bpCustomer ? '<div class="bp-table-wrap"><table><thead><tr><th>Beneficio</th><th>Vigencia</th><th>Usos</th></tr></thead><tbody>' + (bpGrants.map(g => '<tr><td>' + bpEscape(g.name) + '<br>' + (g.revoked ? 'Compra revertida' : g.expired ? 'Vencido' : g.startsOn > bpToday() ? 'Comienza el ' + bpEscape(g.startsOn) : 'Vigente') + '</td><td>' + bpEscape(g.startsOn) + '<br>' + bpEscape(g.endsOn) + '</td><td>' + ((g.serviceBalances || []).length ? g.serviceBalances.map(r => bpEscape(r.name) + ': ' + r.used + ' usados / ' + r.reserved + ' reservados / ' + r.available + ' disponibles').join('<br>') : g.used + ' utilizados / ' + g.reserved + ' reservados / ' + (g.available === null ? 'sin limite' : g.available + ' disponibles')) + '</td></tr>').join('') || '<tr><td colspan="3">Sin compras registradas.</td></tr>') + '</tbody></table></div>' : '<p>Abr&iacute; Membres&iacute;as desde la ficha del cliente para registrar su compra y ver sus usos.</p>') + '</section>' + (bpCustomer ? '<section class="bp-section"><h3>Comprar pack o renovar membresia</h3><form id="bp-purchase-form" novalidate><div class="bp-grid"><label>Plan<select name="planId" id="bp-purchase-plan" required><option value="">Seleccionar plan</option>' + bpPlans.filter(p => p.isActive).map(p => '<option value="' + bpEscape(p.id) + '">' + bpEscape(p.name) + ' / ' + bpMoney(p.price) + '</option>').join('') + '</select></label><label>Inicio del periodo<input type="date" name="startsOn" value="' + bpToday() + '"></label><label>Medio de pago<select name="paymentMethodId" id="bp-purchase-method" required><option value="">Cargando medios de pago...</option></select></label></div><p class="bp-copy" id="bp-purchase-terms">Selecciona un plan para revisar sus condiciones antes de cobrar.</p><div class="bp-actions"><button type="submit" class="bp-primary">Registrar compra y cobro en Caja</button></div></form></section><section class="bp-section"><h3>Aplicar a un turno</h3><form id="bp-apply-form" novalidate><div class="bp-grid"><label>Beneficio<select name="benefitId">' + bpGrants.filter(g => !g.revoked && !g.expired).map(g => '<option value="' + bpEscape(g.id) + '">' + bpEscape(g.name) + ' / vence ' + bpEscape(g.endsOn) + '</option>').join('') + '</select></label><label>Turno pendiente<select name="appointmentId" id="bp-benefit-appointment"></select></label></div><p class="bp-copy">Los servicios incluidos ya est&aacute;n pagados. Se aparta un uso por servicio; los servicios adicionales se cobran normalmente.</p><div class="bp-actions"><button type="submit">Aplicar beneficio al turno</button></div></form></section>' : '') + bpPlanForm()
        if (bpCustomer) {
          const [context, appointments, methods] = await Promise.all([bpRead('/cash-register/payment-context'), bpRead('/appointments', { customerId:bpCustomer.id }), bpRead('/cash-register/payment-methods')])
          if (version !== bpLoadVersion) return
          document.getElementById('bp-purchase-form').dataset.session = context.current?.session?.id || context.session?.id || ''
          document.getElementById('bp-purchase-method').innerHTML = methods.filter(m => m.isActive !== false).map(m => '<option value="' + bpEscape(m.id) + '">' + bpEscape(m.name) + '</option>').join('')
          document.getElementById('bp-benefit-appointment').innerHTML = appointments.filter(a => ['PENDING','CONFIRMED'].includes(a.status) && new Date(a.startAt) > new Date()).map(a => '<option value="' + bpEscape(a.id) + '">' + bpEscape(new Date(a.startAt).toLocaleString('es-AR')) + ' / ' + bpEscape(a.service?.name || '') + '</option>').join('')
        }
      } catch (error) { if (version === bpLoadVersion) bpFeedback(error.message, true) }
    }
    function bpCustomerField() { return bpCustomer ? '<input name="customerId" type="hidden" value="' + bpEscape(bpCustomer.id) + '"><label>Cliente<input value="' + bpEscape(bpCustomer.name) + '" disabled></label>' : '<label>Buscar cliente<input id="bp-customer-search" type="search" placeholder="Nombre o telefono"><select name="customerId" id="bp-customer-results"><option value="">Busca y selecciona un cliente</option></select></label>' }
    function bpServiceTerms(plan) {
      return (plan.serviceRules || []).map(r => r.uses + ' x ' + r.name + ' (' + bpMoney(r.unitPrice) + ' por servicio)').join(' / ') || (plan.totalUses === null ? plan.discountPercent + '% de descuento' : plan.totalUses + ' usos compartidos')
    }
    function bpServiceRows() {
      return state.services.filter(s => s.isActive !== false && (s.priceMode || 'FIXED') === 'FIXED' && s.price !== null).map(s => '<tr data-bp-service="' + bpEscape(s.id) + '" data-list-price="' + Number(s.price) + '"><td><strong>' + bpEscape(s.name) + '</strong><p class="bp-copy">Habitual: ' + bpMoney(s.price) + '</p></td><td><input data-bp-uses type="number" min="0" max="10000" step="1" value="0" aria-label="Cantidad de ' + bpEscape(s.name) + '"></td><td><select data-bp-pricing aria-label="Valor de ' + bpEscape(s.name) + '"><option value="FIXED">Precio fijo</option><option value="PERCENTAGE">Descuento %</option></select></td><td><input data-bp-value type="number" min="0" step="1" value="' + Number(s.price) + '" aria-label="Precio o porcentaje de ' + bpEscape(s.name) + '"></td><td data-bp-unit>' + bpMoney(s.price) + '</td><td data-bp-subtotal>' + bpMoney(0) + '</td></tr>').join('')
    }
    function bpPlanForm() {
      return '<section class="bp-section"><h3>Membres&iacute;as y packs</h3><div class="bp-table-wrap"><table><thead><tr><th>Plan</th><th>Servicios pagados</th><th>Vigencia</th><th>Precio</th></tr></thead><tbody>' + (bpPlans.map(p => '<tr><td>' + bpEscape(p.name) + (p.isActive ? '' : ' (inactivo)') + '</td><td>' + bpEscape(bpServiceTerms(p)) + '</td><td>' + p.validityDays + ' d&iacute;as</td><td>' + bpMoney(p.price) + '</td></tr>').join('') || '<tr><td colspan="4">Cre&aacute; tu primera membres&iacute;a.</td></tr>') + '</tbody></table></div>' + (state.currentUser?.role === 'STAFF' ? '' : '<details id="bp-plan-editor"><summary>Crear membres&iacute;a o pack</summary><form id="bp-plan-form" novalidate><h3>Condiciones de compra</h3><div class="bp-grid"><label>Nombre<input name="name" maxlength="120" placeholder="Ej.: Plata" required></label><label>Tipo<select name="kind"><option value="MEMBERSHIP">Membres&iacute;a</option><option value="PACK">Pack</option></select></label><label>Precio total de compra<input name="price" type="number" min="1" max="2147483647" step="1" placeholder="Ej.: 50000" required></label><label>Vigencia en d&iacute;as<input name="validityDays" type="number" min="1" max="3650" step="1" value="30" required></label></div><h3>Servicios incluidos y valor para comisiones</h3><p class="bp-copy">Indic&aacute; los usos de cada servicio. Dejalo en 0 para no incluirlo. El precio fijo o descuento define su valor dentro de la compra y la base para comisionar. El cliente no vuelve a pagarlo.</p><div class="bp-table-wrap"><table class="bp-service-editor"><thead><tr><th>Servicio</th><th>Usos</th><th>Valor</th><th>Importe / %</th><th>Por servicio</th><th>Subtotal</th></tr></thead><tbody>' + bpServiceRows() + '</tbody></table></div><p id="bp-plan-total" class="bp-total" aria-live="polite">Total de servicios: ' + bpMoney(0) + '</p><p class="bp-copy">La suma debe coincidir con el precio de compra. Solo se incluyen servicios con precio definido.</p><details><summary>Cancelaciones y ausencias</summary><div class="bp-grid"><label>Cancelaci&oacute;n sin consumir uso hasta (horas antes)<input name="cancellationHours" type="number" min="0" max="720" value="24" required></label><label class="bp-check"><input name="consumeLateCancellation" type="checkbox"> Consumir uso por cancelaci&oacute;n tard&iacute;a</label><label class="bp-check"><input name="consumeNoShow" type="checkbox"> Consumir uso por ausencia</label></div></details><p class="bp-copy">Los cambios futuros no modifican las compras realizadas.</p></form></details>') + '</section>'
    }
    function bpPlanItems() {
      return [...bpBody.querySelectorAll('[data-bp-service]')].filter(r => Number(r.querySelector('[data-bp-uses]').value) > 0).map(r => {
        const pricingMode = r.querySelector('[data-bp-pricing]').value, value = Number(r.querySelector('[data-bp-value]').value)
        return { serviceId:r.dataset.bpService, uses:Number(r.querySelector('[data-bp-uses]').value), pricingMode, ...(pricingMode === 'FIXED' ? {fixedPrice:value} : {discountPercent:value}) }
      })
    }
    function bpUpdateTotal() {
      let total = 0
      for (const row of bpBody.querySelectorAll('[data-bp-service]')) {
        const value = Number(row.querySelector('[data-bp-value]').value), quantity = Number(row.querySelector('[data-bp-uses]').value)
        const unit = row.querySelector('[data-bp-pricing]').value === 'FIXED' ? value : Math.round(Number(row.dataset.listPrice) * (100 - value) / 100)
        row.querySelector('[data-bp-unit]').textContent = bpMoney(unit); row.querySelector('[data-bp-subtotal]').textContent = bpMoney(unit * quantity); total += unit * quantity
      }
      const output = document.getElementById('bp-plan-total'); if (output) output.textContent = 'Total de servicios: ' + bpMoney(total)
      return total
    }
    function bpRange(date, start = '09:00', end = '18:00') { return '<div class="bp-range"><input type="time" data-bp-start value="' + bpEscape(start) + '" aria-label="Inicio ' + date + '"><span>a</span><input type="time" data-bp-end value="' + bpEscape(end) + '" aria-label="Fin ' + date + '"><button type="button" data-bp-remove aria-label="Quitar franja">&times;</button></div>' }
    function bpRenderHours(hours) {
      const week = bpMonday(document.getElementById('bp-week').value)
      document.getElementById('bp-hours').innerHTML = Array.from({length:7}, (_,i) => { const date = bpDateAdd(week,i); return '<tr data-bp-day="' + date + '"><td>' + bpEscape(new Date(date + 'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'numeric'})) + '</td><td><div data-bp-ranges>' + hours.filter(h => h.date === date).map(h => bpRange(date,h.startTime,h.endTime)).join('') + '</div><button type="button" data-bp-add="' + date + '">+ Franja</button></td></tr>' }).join('')
    }
    async function bpLoadWeek() {
      const professionalId = document.getElementById('bp-professional')?.value, date = document.getElementById('bp-week')?.value
      if (!professionalId || !date) { bpFeedback('Selecciona un profesional y una semana.', true); return }
      const week = bpMonday(date); document.getElementById('bp-week').value = week
      const result = await bpRead('/availability-weeks', { professionalId, weekStart:week })
      if (bpTab !== 'week' || document.getElementById('bp-professional')?.value !== professionalId || document.getElementById('bp-week')?.value !== week) return
      bpRevision = result.revision; document.getElementById('bp-mode').value = result.mode; bpRenderHours(result.draftHours)
      document.getElementById('bp-week-status').textContent = result.publishedAt ? 'Publicada. Los cambios del borrador se aplican al volver a publicar.' : 'Semana sin publicar. El borrador no habilita reservas en modalidad manual.'
      document.getElementById('bp-summary').innerHTML = ''
      bpBody.querySelectorAll('[data-bp-action]').forEach(b => { b.disabled = !bpCanHours() })
    }
    function bpHours() { return [...bpBody.querySelectorAll('[data-bp-day]')].flatMap(day => [...day.querySelectorAll('.bp-range')].map(range => ({date:day.dataset.bpDay, startTime:range.querySelector('[data-bp-start]').value, endTime:range.querySelector('[data-bp-end]').value}))) }
    function bpSummary(result) {
      const conflicts = [...result.appointmentConflicts.map(c => ({date:new Date(c.startAt).toLocaleString('es-AR'), customer:c.customer, reason:c.reason})), ...result.recurringConflicts]
      document.getElementById('bp-summary').innerHTML = '<p><strong>' + result.daysEnabled + ' dias habilitados / ' + result.recurringCount + ' turnos recurrentes / ' + conflicts.length + ' conflictos.</strong></p>' + (conflicts.length ? '<div class="bp-table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Conflicto</th></tr></thead><tbody>' + conflicts.map(c => '<tr><td>' + bpEscape(c.date) + '</td><td>' + bpEscape(c.customer) + '</td><td>' + bpEscape(c.reason) + '</td></tr>').join('') + '</tbody></table></div>' : '')
    }
    async function bpRun(action) { if (bpBusy) return; bpBusy = true; bpRoot.setAttribute('aria-busy','true'); bpFeedback('Procesando...'); try { await action() } catch(error) { bpFeedback(error.message, true) } finally { bpBusy = false; bpRoot.removeAttribute('aria-busy') } }
    bpRoot.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || bpBusy) return
      if (button.hasAttribute('data-bp-close')) { bpClose(); return }
      if (button.dataset.bpTab) { bpTab = button.dataset.bpTab; void bpRender(); return }
      if (button.dataset.bpAdd) { button.parentElement.querySelector('[data-bp-ranges]').insertAdjacentHTML('beforeend', bpRange(button.dataset.bpAdd)); return }
      if (button.hasAttribute('data-bp-remove')) { button.closest('.bp-range').remove(); return }
      void bpRun(async () => {
        if (button.dataset.bpRule) {
          const rule = bpRules.find(r => r.id === button.dataset.bpRule)
          await bpWrite('/recurring-bookings/' + encodeURIComponent(rule.id), {status:button.dataset.bpStatus, revision:rule.revision}, 'PATCH'); await bpRender(); return
        }
        if (button.dataset.bpSkip) { await bpWrite('/recurring-bookings/' + encodeURIComponent(button.dataset.bpSkip) + '/skip', {date:button.dataset.bpDate}); await bpRender(); return }
        const action = button.dataset.bpAction
        if (action === 'refresh') { await bpWrite('/recurring-bookings/refresh', {}); await bpRender(); bpFeedback('Repeticiones revisadas.'); return }
        if (!action) return
        const professionalId = document.getElementById('bp-professional').value, week = document.getElementById('bp-week').value
        if (action === 'mode') { await bpWrite('/availability-weeks/mode', {professionalId, mode:document.getElementById('bp-mode').value}, 'PUT'); bpFeedback('Modalidad guardada.'); return }
        if (action === 'copy') { const previous = await bpRead('/availability-weeks', {professionalId,weekStart:bpDateAdd(week,-7)}); bpRenderHours((previous.publishedHours || previous.draftHours).map(h => ({...h,date:bpDateAdd(h.date,7)}))); bpFeedback('Horarios copiados al borrador.'); return }
        const payload = { professionalId, weekStart:week, hours:bpHours(), revision:bpRevision, action:action === 'draft' ? 'DRAFT' : 'PREVIEW' }
        const review = await bpWrite('/availability-weeks', payload, 'PUT'); bpSummary(review)
        if (action === 'publish') {
          if (review.appointmentConflicts.length) throw new Error('Resuelve las reservas fuera de las franjas antes de publicar.')
          if (review.recurringConflicts.length && !await requestCrmConfirmation('Hay ' + review.recurringConflicts.length + ' repeticiones con conflictos. Se publicaran los lugares compatibles y quedaran incidencias pendientes.')) return
          const result = await bpWrite('/availability-weeks', {...payload,action:'PUBLISH',acknowledgeConflicts:true}, 'PUT'); bpRevision = result.revision; bpSummary(result); bpFeedback('Horarios publicados. Repeticiones compatibles reservadas.'); return
        }
        bpRevision = review.revision; bpFeedback(action === 'draft' ? 'Borrador guardado.' : 'Revisa el resumen antes de publicar.')
      })
    })
    let bpCustomerTimer, bpCustomerRequest = 0
    bpRoot.addEventListener('input', event => { if (event.target.id !== 'bp-customer-search') return; clearTimeout(bpCustomerTimer); const query = event.target.value, version = ++bpCustomerRequest; bpCustomerTimer = setTimeout(() => { void bpRead('/customers/search', {q:query}).then(rows => { if (version !== bpCustomerRequest || !document.getElementById('bp-customer-results')) return; document.getElementById('bp-customer-results').innerHTML = '<option value="">Selecciona un cliente</option>' + rows.map(c => '<option value="' + bpEscape(c.id) + '">' + bpEscape(c.name) + ' / ' + bpEscape(c.phone) + '</option>').join('') }).catch(error => bpFeedback(error.message,true)) },250) })
    bpRoot.addEventListener('input', event => { if (event.target.closest('#bp-plan-form')) { event.target.removeAttribute('aria-invalid'); bpUpdateTotal() } })
    bpRoot.addEventListener('change', event => {
      if (event.target.matches('[data-bp-pricing]')) { const row=event.target.closest('[data-bp-service]'), field=row.querySelector('[data-bp-value]'); field.value = event.target.value === 'FIXED' ? row.dataset.listPrice : '0'; if (event.target.value === 'PERCENTAGE') field.max='100'; else field.removeAttribute('max'); bpUpdateTotal() }
      if (['bp-professional','bp-week'].includes(event.target.id)) void bpRun(bpLoadWeek)
      if (event.target.id === 'bp-purchase-plan') { const p = bpPlans.find(p => p.id === event.target.value); if (!p) return; const current = bpGrants.filter(g => g.planId === p.id && !g.revoked).sort((a,b) => b.endsOn.localeCompare(a.endsOn))[0]; if (p.kind === 'MEMBERSHIP' && current && current.endsOn >= bpToday()) document.querySelector('#bp-purchase-form [name=startsOn]').value = bpDateAdd(current.endsOn,1); document.getElementById('bp-purchase-terms').textContent = p.name + ': ' + bpMoney(p.price) + '. ' + bpServiceTerms(p) + '. Vigencia: ' + p.validityDays + ' dias desde el inicio. Servicios incluidos pagados en esta compra.' + ' Cancelacion sin cargo hasta ' + p.cancellationHours + ' h antes. Cancelacion tardia: ' + (p.consumeLateCancellation ? 'consume uso.' : 'libera uso.') + ' Ausencia: ' + (p.consumeNoShow ? 'consume uso.' : 'libera uso.') }
    })
    bpRoot.addEventListener('toggle', event => { if (event.target.id === 'bp-plan-editor') document.getElementById('bp-plan-submit').hidden = !event.target.open }, true)
    bpRoot.addEventListener('submit', event => { event.preventDefault(); const form = event.target; void bpRun(async () => {
      const invalid = [...form.querySelectorAll('input,select')].find(field => !field.validity.valid)
      if (invalid) { invalid.setAttribute('aria-invalid','true'); invalid.focus(); throw new Error('Revisa el campo resaltado y completa los datos requeridos.') }
      const data = Object.fromEntries(new FormData(form))
      if (form.id === 'bp-recurring-form') { await bpWrite('/recurring-bookings', {...data, endsOn:data.endsOn || null,useBenefits:form.elements.useBenefits.checked}); await bpRender(); bpFeedback('Repeticion creada. Revisa sus incidencias.'); return }
      if (form.id === 'bp-plan-form') { if (!bpPlanItems().length || bpUpdateTotal() !== Number(data.price)) { form.elements.price.setAttribute('aria-invalid','true'); form.elements.price.focus(); throw new Error('Agrega usos y verifica que la suma de los servicios coincida con el precio de compra.') } await bpWrite('/benefit-plans', {...data, serviceRules:bpPlanItems(), price:Number(data.price),validityDays:Number(data.validityDays),cancellationHours:Number(data.cancellationHours),consumeLateCancellation:form.elements.consumeLateCancellation.checked,consumeNoShow:form.elements.consumeNoShow.checked}); await bpRender(); bpFeedback('Plan creado.'); return }
      if (form.id === 'bp-purchase-form') { if (!form.dataset.session) throw new Error('Abri Caja antes de registrar la compra.'); if (!await requestCrmConfirmation('Se registrara el cobro de ' + bpMoney(bpPlans.find(p => p.id === data.planId)?.price) + ' por la membresia elegida y se habilitaran sus servicios pagados.', {title:'Registrar compra',confirmLabel:'Confirmar cobro',danger:false})) return; form.dataset.key ||= crypto.randomUUID(); await bpWrite('/customer-benefits', {...data,customerId:bpCustomer.id,cashSessionId:form.dataset.session,requestKey:form.dataset.key,expectedPrice:bpPlans.find(p => p.id === data.planId)?.price}); await bpRender(); bpFeedback('Compra registrada y beneficio habilitado.'); return }
      if (form.id === 'bp-apply-form') { await bpWrite('/customer-benefits/apply', {...data,customerId:bpCustomer.id}); await bpRender(); bpFeedback('Beneficio aplicado. El uso queda reservado hasta la atencion.'); }
    }) })
    bpRoot.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); bpClose() }
      if (event.key !== 'Tab') return
      const focusable = [...bpRoot.querySelectorAll('button,input,select,summary,[tabindex]')].filter(el => !el.disabled && el.getClientRects().length)
      if (!focusable.length) return
      const first=focusable[0], last=focusable[focusable.length-1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    })
    for (const button of document.querySelectorAll('[data-membership-catalog]')) {
      button.addEventListener('click', () => {
        if (bpCanFinance()) void openBookingPrograms('benefits')
      })
    }
    document.getElementById('agenda-week-availability')?.addEventListener('click', () => void openBookingPrograms('week'))
    document.getElementById('agenda-recurring-bookings')?.addEventListener('click', () => void openBookingPrograms('recurring'))
    document.addEventListener('click', event => { const button=event.target.closest('[data-customer-benefits]'); if (!button) return; const customer=state.customerOverview.find(c => c.id === button.dataset.customerBenefits); if (customer && bpCanFinance()) void openBookingPrograms('benefits',customer) })
`
