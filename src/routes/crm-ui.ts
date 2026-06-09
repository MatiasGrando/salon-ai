import type { FastifyInstance } from 'fastify'

export async function crmUiRoutes(app: FastifyInstance) {
  app.get('/crm', async (_request, reply) => {
    return reply.type('text/html').send(crmHtml)
  })
}

const crmHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CRM Salon AI</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f5;
      --surface: #ffffff;
      --surface-soft: #f8faf9;
      --line: #d9e0dd;
      --line-strong: #bcc8c3;
      --text: #1f2a26;
      --muted: #65736d;
      --accent: #087f73;
      --accent-strong: #066b61;
      --accent-soft: #e3f3f0;
      --warn: #a65f00;
      --warn-soft: #fff1d6;
      --danger: #b42318;
      --danger-soft: #fee4df;
      --shadow: 0 14px 38px rgba(31, 42, 38, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      height: 100%;
      overflow: hidden;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }

    button,
    input,
    textarea,
    select {
      font: inherit;
    }

    button {
      border: 0;
      cursor: pointer;
    }

    .app {
      display: grid;
      grid-template-columns: minmax(280px, 340px) minmax(360px, 1fr) minmax(300px, 360px);
      height: 100dvh;
      overflow: hidden;
      min-height: 0;
    }

    .sidebar,
    .details {
      min-width: 0;
      min-height: 0;
      height: 100%;
      background: var(--surface);
      border-color: var(--line);
      border-style: solid;
      display: flex;
      flex-direction: column;
    }

    .sidebar {
      border-width: 0 1px 0 0;
    }

    .details {
      border-width: 0 0 0 1px;
      overflow: auto;
    }

    .mobile-nav,
    .mobile-only {
      display: none;
    }

    .topbar {
      min-height: 64px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .brand {
      min-width: 0;
    }

    .brand h1,
    .panel-title {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
      font-weight: 750;
      letter-spacing: 0;
    }

    .brand p,
    .hint,
    .meta {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .search {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      gap: 8px;
      background: var(--surface-soft);
      flex-shrink: 0;
    }

    .ops-panel {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 8px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .ops-panel .row {
      align-items: center;
    }

    .counter {
      min-width: 28px;
      height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      color: var(--danger);
      background: var(--danger-soft);
      font-weight: 800;
      font-size: 12px;
    }

    .search input,
    .field,
    textarea,
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: var(--text);
      outline: none;
    }

    .search input,
    .field,
    select {
      height: 38px;
      padding: 0 10px;
    }

    .search input:focus,
    .field:focus,
    textarea:focus,
    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .icon-button,
    .primary,
    .secondary,
    .danger {
      height: 38px;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      white-space: nowrap;
      font-weight: 650;
      font-size: 13px;
    }

    .icon-button {
      width: 38px;
      color: var(--text);
      background: #fff;
      border: 1px solid var(--line);
    }

    .primary {
      padding: 0 14px;
      color: #fff;
      background: var(--accent);
    }

    .primary:hover {
      background: var(--accent-strong);
    }

    .secondary {
      padding: 0 12px;
      color: var(--text);
      background: #fff;
      border: 1px solid var(--line);
    }

    .danger {
      padding: 0 12px;
      color: var(--danger);
      background: var(--danger-soft);
    }

    .conversation-list,
    .scroll {
      overflow: auto;
      min-height: 0;
    }

    .conversation-list {
      flex: 1;
    }

    .conversation {
      width: 100%;
      min-height: 78px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      text-align: left;
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .conversation:hover,
    .conversation.active {
      background: var(--accent-soft);
    }

    .avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #fff;
      background: var(--accent);
      font-size: 14px;
      font-weight: 800;
    }

    .conversation-main {
      min-width: 0;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .phone,
    .item-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
      font-weight: 720;
      color: var(--text);
    }

    .preview {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .chip {
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      color: var(--accent-strong);
      background: var(--accent-soft);
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
    }

    .chip.warn {
      color: var(--warn);
      background: var(--warn-soft);
    }

    .chip.handoff {
      color: var(--danger);
      background: var(--danger-soft);
    }

    .chip.manual {
      color: var(--warn);
      background: var(--warn-soft);
    }

    .chat {
      min-width: 0;
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #eef3f1;
    }

    .chat-header {
      min-height: 64px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .chat-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chat-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .messages {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .message {
      max-width: min(680px, 78%);
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 1px 0 rgba(31, 42, 38, 0.04);
      line-height: 1.45;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .message.outbound {
      align-self: flex-end;
      background: #d9f2ed;
    }

    .message.inbound {
      align-self: flex-start;
    }

    .message-time {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      text-align: right;
    }

    .composer {
      padding: 12px 14px;
      border-top: 1px solid var(--line);
      background: var(--surface);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: end;
      flex-shrink: 0;
    }

    textarea {
      min-height: 44px;
      max-height: 140px;
      resize: vertical;
      padding: 10px 12px;
      line-height: 1.35;
    }

    .send-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }

    .toggle {
      height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .toggle input {
      width: 16px;
      height: 16px;
      accent-color: var(--accent);
    }

    .details-section {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .data-grid {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .data-row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 8px;
      font-size: 13px;
    }

    .label {
      color: var(--muted);
    }

    .value {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 650;
    }

    .item {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .item p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .block-form {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .block-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .empty,
    .error {
      padding: 18px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
      line-height: 1.4;
    }

    .error {
      color: var(--danger);
    }

    @media (max-width: 1120px) {
      .app {
        grid-template-columns: minmax(260px, 320px) 1fr;
      }

      .details {
        display: none;
      }
    }

    @media (max-width: 760px) {
      body {
        min-height: 100dvh;
      }

      .mobile-nav {
        height: 52px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        padding: 6px;
        border-bottom: 1px solid var(--line);
        background: var(--surface);
      }

      .mobile-nav button {
        height: 40px;
        border-radius: 7px;
        color: var(--muted);
        background: var(--surface-soft);
        font-size: 13px;
        font-weight: 750;
      }

      .mobile-nav button.active {
        color: #fff;
        background: var(--accent);
      }

      .mobile-only {
        display: inline-flex;
      }

      .app {
        display: block;
        height: calc(100dvh - 52px);
        min-height: 0;
      }

      .sidebar,
      .chat,
      .details {
        width: 100%;
        height: 100%;
        min-height: 0;
        border-width: 0;
      }

      .sidebar {
        display: none;
      }

      .chat,
      .details {
        display: none;
      }

      body[data-mobile-view="inbox"] .sidebar,
      body[data-mobile-view="chat"] .chat,
      body[data-mobile-view="details"] .details {
        display: flex;
      }

      body[data-mobile-view="details"] .details {
        overflow: auto;
      }

      .topbar,
      .chat-header {
        min-height: 58px;
        padding: 10px 12px;
      }

      .search {
        padding: 10px;
      }

      .conversation {
        min-height: 84px;
      }

      .messages {
        padding: 14px;
      }

      .composer {
        grid-template-columns: 1fr;
      }

      .message {
        max-width: 92%;
      }
    }
  </style>
</head>
<body data-mobile-view="inbox">
  <nav class="mobile-nav" aria-label="Vistas CRM">
    <button class="active" id="mobile-inbox" type="button">Chats</button>
    <button id="mobile-chat" type="button">Conversacion</button>
    <button id="mobile-details" type="button">Cliente</button>
  </nav>

  <main class="app">
    <aside class="sidebar">
      <div class="topbar">
        <div class="brand">
          <h1>CRM Salon AI</h1>
          <p id="conversation-count">Conversaciones</p>
        </div>
        <button class="icon-button" id="refresh" title="Actualizar">R</button>
      </div>
      <div class="search">
        <input id="search" type="search" placeholder="Buscar telefono">
        <button class="secondary" id="search-button">Buscar</button>
      </div>
      <div class="ops-panel">
        <div class="row">
          <span class="hint">Derivados sin responder</span>
          <span class="counter" id="handoff-count">0</span>
        </div>
        <button class="secondary" id="global-ai-toggle" type="button">IA general activa</button>
      </div>
      <div class="conversation-list" id="conversation-list">
        <div class="empty">Cargando conversaciones...</div>
      </div>
    </aside>

    <section class="chat">
      <header class="chat-header">
        <div class="chat-title">
          <button class="icon-button mobile-only" id="mobile-back" type="button" title="Volver a chats">&lt;</button>
          <div class="avatar" id="chat-avatar">--</div>
          <div>
            <div class="panel-title" id="chat-phone">Selecciona una conversacion</div>
            <div class="hint" id="chat-status">Historial y respuesta manual</div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="secondary" id="conversation-ai-toggle" type="button" disabled>Desactivar IA</button>
          <span class="chip" id="step-chip">CRM</span>
        </div>
      </header>
      <div class="messages" id="messages">
        <div class="empty">Elegi un chat para ver los mensajes.</div>
      </div>
      <form class="composer" id="reply-form">
        <textarea id="reply-text" placeholder="Escribir respuesta manual" disabled></textarea>
        <div class="send-options">
          <label class="toggle">
            <input id="send-whatsapp" type="checkbox" checked>
            Enviar WhatsApp
          </label>
          <button class="primary" id="send-button" type="submit" disabled>Enviar</button>
        </div>
      </form>
    </section>

    <aside class="details">
      <div class="topbar">
        <div>
          <div class="panel-title">Cliente</div>
          <p class="hint">Turnos y bloqueos rapidos</p>
        </div>
      </div>

      <div class="details-section">
        <div class="data-grid">
          <div class="data-row">
            <div class="label">Telefono</div>
            <div class="value" id="detail-phone">--</div>
          </div>
          <div class="data-row">
            <div class="label">Estado bot</div>
            <div class="value" id="detail-step">--</div>
          </div>
          <div class="data-row">
            <div class="label">Ultimo msg</div>
            <div class="value" id="detail-updated">--</div>
          </div>
        </div>
      </div>

      <div class="details-section">
        <div class="row">
          <div class="panel-title">Turnos activos</div>
          <span class="chip" id="appointment-count">0</span>
        </div>
        <div class="stack" id="appointments">
          <div class="empty">Sin cliente seleccionado.</div>
        </div>
      </div>

      <div class="details-section">
        <div class="row">
          <div class="panel-title">Bloquear agenda</div>
          <span class="chip warn">Manual</span>
        </div>
        <form class="block-form" id="block-form">
          <select id="block-reason">
            <option value="ABSENCE">Falta</option>
            <option value="VACATION">Vacaciones</option>
            <option value="LATE_ARRIVAL">Llegada tarde</option>
            <option value="SICK_LEAVE">Enfermedad</option>
            <option value="PERSONAL">Personal</option>
            <option value="HOLIDAY">Feriado</option>
            <option value="OTHER">Otro</option>
          </select>
          <select id="block-professional">
            <option value="">Todo el salon</option>
          </select>
          <div class="block-grid">
            <input class="field" id="block-start" type="datetime-local">
            <input class="field" id="block-end" type="datetime-local">
          </div>
          <input class="field" id="block-title" placeholder="Titulo opcional">
          <button class="secondary" type="submit">Crear bloqueo</button>
          <p class="hint" id="block-feedback"></p>
        </form>
      </div>
    </aside>
  </main>

  <script>
    const state = {
      conversations: [],
      selected: null,
      messages: [],
      appointments: [],
      professionals: [],
      aiSettings: {
        aiEnabled: true
      },
      businessId: null,
      isRefreshing: false
    }

    const els = {
      list: document.getElementById('conversation-list'),
      count: document.getElementById('conversation-count'),
      search: document.getElementById('search'),
      searchButton: document.getElementById('search-button'),
      refresh: document.getElementById('refresh'),
      handoffCount: document.getElementById('handoff-count'),
      globalAiToggle: document.getElementById('global-ai-toggle'),
      messages: document.getElementById('messages'),
      chatAvatar: document.getElementById('chat-avatar'),
      chatPhone: document.getElementById('chat-phone'),
      chatStatus: document.getElementById('chat-status'),
      stepChip: document.getElementById('step-chip'),
      conversationAiToggle: document.getElementById('conversation-ai-toggle'),
      replyForm: document.getElementById('reply-form'),
      replyText: document.getElementById('reply-text'),
      sendButton: document.getElementById('send-button'),
      sendWhatsApp: document.getElementById('send-whatsapp'),
      detailPhone: document.getElementById('detail-phone'),
      detailStep: document.getElementById('detail-step'),
      detailUpdated: document.getElementById('detail-updated'),
      appointments: document.getElementById('appointments'),
      appointmentCount: document.getElementById('appointment-count'),
      blockForm: document.getElementById('block-form'),
      blockReason: document.getElementById('block-reason'),
      blockProfessional: document.getElementById('block-professional'),
      blockStart: document.getElementById('block-start'),
      blockEnd: document.getElementById('block-end'),
      blockTitle: document.getElementById('block-title'),
      blockFeedback: document.getElementById('block-feedback'),
      mobileInbox: document.getElementById('mobile-inbox'),
      mobileChat: document.getElementById('mobile-chat'),
      mobileDetails: document.getElementById('mobile-details'),
      mobileBack: document.getElementById('mobile-back')
    }

    function initials(phone) {
      const digits = String(phone || '').replace(/\\D/g, '')
      return digits.slice(-2) || '--'
    }

    function formatDateTime(value) {
      if (!value) return '--'
      return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    }

    function formatAppointment(value) {
      return new Intl.DateTimeFormat('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value))
    }

    async function getJson(url, options) {
      const response = await fetch(url, options)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message || 'Error de servidor')
      }
      return response.json()
    }

    async function loadBasics() {
      const businesses = await getJson('/businesses')
      state.businessId = businesses[0]?.id || null
      state.aiSettings = await getJson('/crm/ai-settings' + (state.businessId ? '?businessId=' + encodeURIComponent(state.businessId) : ''))
      state.professionals = await getJson('/professionals')
      renderAiControls()
      renderProfessionals()
    }

    async function loadConversations(options = {}) {
      if (state.isRefreshing) return
      state.isRefreshing = true
      const params = new URLSearchParams()
      const phone = els.search.value.trim()
      if (phone) params.set('phone', phone)
      params.set('take', '100')
      const query = params.toString() ? '?' + params.toString() : ''

      try {
        state.conversations = await getJson('/crm/conversations' + query)
        state.conversations.sort((left, right) => latestConversationActivityAt(right) - latestConversationActivityAt(left))
        renderConversations()
        renderAiControls()

        if (!state.selected && state.conversations[0]) {
          await selectConversation(state.conversations[0].id)
        } else if (state.selected) {
          const fresh = state.conversations.find((item) => item.id === state.selected.id)
          if (fresh) {
            state.selected = fresh
            await refreshSelectedConversation()
          }
          renderConversations()
        }

        els.count.textContent = state.conversations.length + ' conversaciones · actualizado ' + new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      } catch (error) {
        if (!options.silent) {
          els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        }
      } finally {
        state.isRefreshing = false
      }
    }

    function renderConversations() {
      els.count.textContent = state.conversations.length + ' conversaciones'
      if (state.conversations.length === 0) {
        els.list.innerHTML = '<div class="empty">No hay conversaciones.</div>'
        return
      }

      els.list.innerHTML = state.conversations.map((conversation) => {
        const last = conversation.messages?.[0]
        const active = state.selected?.id === conversation.id ? ' active' : ''
        return '<button class="conversation' + active + '" data-id="' + conversation.id + '">' +
          '<div class="avatar">' + initials(conversation.phone) + '</div>' +
          '<div class="conversation-main">' +
            '<div class="row">' +
              '<div class="phone">' + escapeHtml(conversation.phone) + '</div>' +
              '<span class="' + conversationStepChipClass(conversation.currentStep, conversation.aiEnabled) + '">' + escapeHtml(conversation.aiEnabled === false ? 'IA OFF' : conversation.currentStep) + '</span>' +
            '</div>' +
            '<p class="preview">' + escapeHtml(last?.body || conversation.lastMessage || 'Sin mensajes') + '</p>' +
            '<p class="meta">' + formatDateTime(latestConversationActivityValue(conversation)) + '</p>' +
          '</div>' +
        '</button>'
      }).join('')

      for (const button of els.list.querySelectorAll('.conversation')) {
        button.addEventListener('click', () => selectConversation(button.dataset.id))
      }
    }

    async function selectConversation(id) {
      const conversation = state.conversations.find((item) => item.id === id)
      if (!conversation) return
      state.selected = conversation
      await refreshSelectedConversation()
      if (isMobile()) {
        setMobileView('chat')
      }
    }

    async function refreshSelectedConversation() {
      if (!state.selected) return
      state.messages = await getJson('/crm/conversations/' + state.selected.id + '/messages')
      await loadAppointments()
      renderSelected()
      renderConversations()
    }

    async function loadAppointments() {
      state.appointments = []
      if (!state.selected) return
      const all = await getJson('/appointments')
      const now = Date.now()
      state.appointments = all
        .filter((appointment) => appointment.customer?.phone === state.selected.phone)
        .filter((appointment) => appointment.status !== 'CANCELLED')
        .filter((appointment) => new Date(appointment.startAt).getTime() >= now)
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    }

    function renderSelected() {
      const selected = state.selected
      if (!selected) return

      els.chatAvatar.textContent = initials(selected.phone)
      els.chatPhone.textContent = selected.phone
      els.chatStatus.textContent = 'Actualizado ' + formatDateTime(latestConversationActivityValue(selected))
      els.stepChip.textContent = selected.currentStep
      els.stepChip.className = conversationStepChipClass(selected.currentStep, selected.aiEnabled)
      els.conversationAiToggle.disabled = false
      els.conversationAiToggle.textContent = selected.aiEnabled === false ? 'Activar IA' : 'Desactivar IA'
      els.conversationAiToggle.className = selected.aiEnabled === false ? 'secondary' : 'danger'
      els.detailPhone.textContent = selected.phone
      els.detailStep.textContent = selected.currentStep
      els.detailUpdated.textContent = formatDateTime(latestConversationActivityValue(selected))
      els.replyText.disabled = false
      els.sendButton.disabled = false

      renderMessages()
      renderAppointments()
    }

    function renderMessages() {
      if (!state.messages.length) {
        els.messages.innerHTML = '<div class="empty">Esta conversacion no tiene mensajes guardados.</div>'
        return
      }

      els.messages.innerHTML = state.messages.map((message) => {
        const direction = message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'
        return '<article class="message ' + direction + '">' +
          escapeHtml(message.body) +
          '<div class="message-time">' + formatDateTime(message.createdAt) + '</div>' +
        '</article>'
      }).join('')
      els.messages.scrollTop = els.messages.scrollHeight
    }

    function renderAppointments() {
      els.appointmentCount.textContent = String(state.appointments.length)
      if (!state.selected) {
        els.appointments.innerHTML = '<div class="empty">Sin cliente seleccionado.</div>'
        return
      }

      if (state.appointments.length === 0) {
        els.appointments.innerHTML = '<div class="empty">No hay turnos activos.</div>'
        return
      }

      els.appointments.innerHTML = state.appointments.map((appointment) => {
        return '<div class="item">' +
          '<div class="item-title">' + escapeHtml(appointment.service?.name || 'Servicio') + '</div>' +
          '<p>' + escapeHtml(appointment.professional?.name || 'Profesional') + ' · ' + formatAppointment(appointment.startAt) + '</p>' +
        '</div>'
      }).join('')
    }

    function renderProfessionals() {
      const options = ['<option value="">Todo el salon</option>']
      for (const professional of state.professionals) {
        options.push('<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>')
      }
      els.blockProfessional.innerHTML = options.join('')
    }

    function renderAiControls() {
      const pending = state.conversations.filter((conversation) => {
        return conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt
      }).length
      els.handoffCount.textContent = String(pending)
      els.globalAiToggle.textContent = state.aiSettings.aiEnabled === false ? 'IA general apagada' : 'IA general activa'
      els.globalAiToggle.className = state.aiSettings.aiEnabled === false ? 'danger' : 'secondary'
    }

    async function sendReply(event) {
      event.preventDefault()
      if (!state.selected) return
      const text = els.replyText.value.trim()
      if (!text) return

      els.sendButton.disabled = true
      try {
        await getJson('/crm/conversations/' + state.selected.id + '/manual-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            sendWhatsApp: els.sendWhatsApp.checked
          })
        })
        els.replyText.value = ''
        await selectConversation(state.selected.id)
        await loadConversations()
      } catch (error) {
        alert(error.message)
      } finally {
        els.sendButton.disabled = false
      }
    }

    async function toggleGlobalAi() {
      const nextValue = state.aiSettings.aiEnabled === false
      try {
        state.aiSettings = await getJson('/crm/ai-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            aiEnabled: nextValue
          })
        })
        renderAiControls()
      } catch (error) {
        alert(error.message)
      }
    }

    async function toggleConversationAi() {
      if (!state.selected) return
      const nextValue = state.selected.aiEnabled === false
      els.conversationAiToggle.disabled = true
      try {
        const updated = await getJson('/crm/conversations/' + state.selected.id + '/ai', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiEnabled: nextValue
          })
        })
        state.selected = updated
        await loadConversations()
        renderSelected()
      } catch (error) {
        alert(error.message)
      } finally {
        els.conversationAiToggle.disabled = false
      }
    }

    async function createBlock(event) {
      event.preventDefault()
      if (!state.businessId) {
        els.blockFeedback.textContent = 'No encontre un negocio cargado.'
        return
      }

      const startAt = els.blockStart.value
      const endAt = els.blockEnd.value
      if (!startAt || !endAt) {
        els.blockFeedback.textContent = 'Completa inicio y fin.'
        return
      }

      try {
        await getJson('/schedule-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            professionalId: els.blockProfessional.value || undefined,
            reason: els.blockReason.value,
            title: els.blockTitle.value.trim() || undefined,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString()
          })
        })
        els.blockFeedback.textContent = 'Bloqueo creado.'
        els.blockTitle.value = ''
      } catch (error) {
        els.blockFeedback.textContent = error.message
      }
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    function latestConversationActivityValue(conversation) {
      return conversation.messages?.[0]?.createdAt || conversation.updatedAt || conversation.createdAt
    }

    function latestConversationActivityAt(conversation) {
      const value = latestConversationActivityValue(conversation)
      return value ? new Date(value).getTime() : 0
    }

    function conversationStepChipClass(step, aiEnabled) {
      if (aiEnabled === false) return 'chip manual'
      return step === 'HUMAN_HANDOFF' ? 'chip handoff' : 'chip'
    }

    function isMobile() {
      return window.matchMedia('(max-width: 760px)').matches
    }

    function setMobileView(view) {
      document.body.dataset.mobileView = view
      els.mobileInbox.classList.toggle('active', view === 'inbox')
      els.mobileChat.classList.toggle('active', view === 'chat')
      els.mobileDetails.classList.toggle('active', view === 'details')
    }

    els.replyForm.addEventListener('submit', sendReply)
    els.blockForm.addEventListener('submit', createBlock)
    els.globalAiToggle.addEventListener('click', toggleGlobalAi)
    els.conversationAiToggle.addEventListener('click', toggleConversationAi)
    els.refresh.addEventListener('click', loadConversations)
    els.searchButton.addEventListener('click', loadConversations)
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadConversations()
    })
    els.mobileInbox.addEventListener('click', () => setMobileView('inbox'))
    els.mobileChat.addEventListener('click', () => setMobileView('chat'))
    els.mobileDetails.addEventListener('click', () => setMobileView('details'))
    els.mobileBack.addEventListener('click', () => setMobileView('inbox'))

    loadBasics()
      .then(loadConversations)
      .catch((error) => {
        els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
      })

    setInterval(() => {
      loadConversations({ silent: true })
    }, 5000)
  </script>
</body>
</html>`
