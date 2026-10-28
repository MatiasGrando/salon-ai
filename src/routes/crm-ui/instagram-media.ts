import { instagramAutomationMarkup, instagramAutomationScript, instagramAutomationStyles } from './instagram-automation.js'

export const instagramMediaStyles = `
    ${instagramAutomationStyles}
    .instagram-media-panel { min-width: 0; display: grid; gap: 14px; padding: 18px; border: 1px solid #dce3ef; border-radius: 14px; background: #fff; }
    .instagram-media-panel h4, .instagram-media-history h4 { margin: 0; color: #17213a; font-size: 16px; }
    .instagram-media-panel p { margin: 0; color: #52617b; font-size: 13px; line-height: 1.5; }
    .instagram-media-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 14px; border-radius: 10px; background: #f8faff; }
    .instagram-media-filters label { min-width: 0; display: grid; gap: 6px; color: #405176; font-size: 12px; font-weight: 750; }
    .instagram-media-filters input, .instagram-media-filters select { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #17213a; font: inherit; }
    .instagram-media-filters :is(input, select):focus { border-color: #2563eb; outline: 3px solid #dbeafe; }
    .instagram-media-actions, .instagram-media-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .instagram-media-actions { grid-column: 1 / -1; }
    .instagram-media-actions button, .instagram-media-pagination button, .instagram-media-history button, .instagram-media-table button { min-height: 38px; padding: 9px 12px; border: 1px solid #ccd6e5; border-radius: 8px; background: #fff; color: #243b63; font-weight: 750; cursor: pointer; }
    .instagram-media-panel button:focus-visible { outline: 3px solid #bfdbfe; outline-offset: 2px; }
    .instagram-media-panel button:disabled { opacity: .5; cursor: default; }
    .instagram-media-feedback.error { color: #b42318; }
    .instagram-media-table-wrap { min-width: 0; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
    .instagram-media-table { width: 100%; min-width: 900px; border-collapse: collapse; text-align: left; }
    .instagram-media-table th, .instagram-media-table td { padding: 13px; border-bottom: 1px solid #e8edf5; vertical-align: top; font-size: 12px; color: #334155; }
    .instagram-media-table th { background: #f8fafc; font-weight: 750; }
    .instagram-media-table td:first-child { max-width: 230px; overflow-wrap: anywhere; }
    .instagram-media-table strong { display: block; font-size: 15px; color: #17213a; }
    .instagram-media-table small { display: block; margin-top: 5px; max-width: 190px; color: #64748b; line-height: 1.45; }
    .instagram-media-table a { color: #1d4ed8; text-decoration: underline; }
    .instagram-media-secondary { display: grid; gap: 10px; margin: 10px 0 0; min-width: 200px; }
    .instagram-media-secondary dt { color: #52617b; } .instagram-media-secondary dd { margin: 3px 0 0; }
    .instagram-media-history { min-width: 0; display: grid; gap: 12px; padding: 16px; border: 1px solid #bfdbfe; border-radius: 12px; background: #f8faff; }
    .instagram-media-local-heading { display: grid; gap: 5px; } .instagram-media-local-heading h4, .instagram-media-local-heading p { margin: 0; }
    .instagram-media-local-heading p { color: #64748b; font-size: 13px; }
    @media (max-width: 720px) { .instagram-media-panel { padding: 12px; } .instagram-media-filters { grid-template-columns: minmax(0, 1fr); padding: 12px; } .instagram-media-actions button { flex: 1 1 120px; } .instagram-media-table button { min-height: 44px; } .instagram-media-history { padding: 12px; } }
`

export const instagramMediaMarkup = `
          <section class="instagram-media-panel" id="instagram-media-catalogue" aria-labelledby="instagram-media-title">
            <div><h4 id="instagram-media-title">Reels publicados y alcance org&aacute;nico</h4><p>Totales observados de cada Reel, sin sumar personas entre publicaciones. Las mediciones comienzan al sincronizar.</p></div>
            <form class="instagram-media-filters" id="instagram-media-filters" novalidate>
              <label>Publicado desde<input id="instagram-media-from" type="date"></label>
              <label>Publicado hasta<input id="instagram-media-to" type="date"></label>
              <label>Ordenar por<select id="instagram-media-sort"><option value="publishedAt">Publicaci&oacute;n m&aacute;s reciente</option><option value="reach">Mayor alcance org&aacute;nico</option><option value="views">M&aacute;s vistas org&aacute;nicas</option></select></label>
              <div class="instagram-media-actions"><button type="submit">Aplicar filtros</button><button id="instagram-media-refresh" type="button">Releer datos guardados</button><button id="instagram-media-sync" type="button">Sincronizar Instagram</button><button id="instagram-media-pause" type="button" hidden>Pausar</button></div>
            </form>
            <p>Los filtros seleccionan fechas de publicaci&oacute;n; no cambian el per&iacute;odo de las m&eacute;tricas. Cada valor muestra su propia fecha de lectura.</p>
            <p class="instagram-media-feedback" id="instagram-media-feedback" role="status" aria-live="polite"></p>
            <div class="instagram-media-table-wrap"><table class="instagram-media-table"><thead><tr><th>Reel</th><th>Publicado</th><th>Alcance org&aacute;nico</th><th>Vistas org&aacute;nicas</th><th>Otras m&eacute;tricas</th><th>&Uacute;ltimo intento</th><th>Observaciones</th></tr></thead><tbody id="instagram-media-body"><tr><td colspan="7">Carg&aacute; los datos guardados de Instagram.</td></tr></tbody></table></div>
            <div class="instagram-media-pagination"><button id="instagram-media-prev" type="button">Anterior</button><span id="instagram-media-summary"></span><button id="instagram-media-next" type="button">Siguiente</button></div>
            <section class="instagram-media-history" id="instagram-media-history" hidden aria-labelledby="instagram-media-history-title">
              <div class="instagram-media-actions"><h4 id="instagram-media-history-title">Historial de observaciones</h4><button id="instagram-media-history-close" type="button">Cerrar historial</button></div>
              <p id="instagram-media-history-caption"></p><p>Lecturas reales desde la primera sincronizaci&oacute;n; no representan una serie diaria anterior.</p>
              <p class="instagram-media-feedback" id="instagram-media-history-feedback" role="status" aria-live="polite"></p>
              <div class="instagram-media-table-wrap"><table class="instagram-media-table"><thead><tr><th>Observado</th><th>Estado</th><th>Alcance</th><th>Vistas</th><th>Me gusta</th><th>Comentarios</th><th>Compartidos</th><th>Guardados</th><th>Interacciones</th></tr></thead><tbody id="instagram-media-history-body"></tbody></table></div>
              <div class="instagram-media-pagination"><button id="instagram-media-history-prev" type="button">Observaciones anteriores</button><span id="instagram-media-history-summary"></span><button id="instagram-media-history-next" type="button">M&aacute;s observaciones</button></div>
            </section>
            ${instagramAutomationMarkup}
          </section>
`

export const instagramMediaScript = String.raw`
    ${instagramAutomationScript}
    function resetInstagramMediaState() {
      if(typeof instagramStoriesReset==='function')instagramStoriesReset()
      state.instagramPlanning?.controller.abort()
      state.instagramPlanning?.editor?.controller.abort()
      state.instagramPlanning = null
      document.getElementById('instagram-reel-dialog')?.setAttribute('hidden', '')
      state.instagramMedia?.automation?.controller.abort()
      document.getElementById('instagram-automation-panel')?.setAttribute('hidden', '')
      state.instagramMedia = null
      state.instagramMediaGeneration = (state.instagramMediaGeneration || 0) + 1
    }

    function instagramMediaContext() {
      if (state.instagramMedia && state.instagramMedia.businessId !== state.businessId) resetInstagramMediaState()
      if (!state.instagramMedia) {
        state.instagramMedia = { businessId: state.businessId, accountId: null, generation: state.instagramMediaGeneration || 0,
          data: null, loaded: false, loading: false, readSequence: 0, offset: 0, filters: { from: '', to: '', sort: 'publishedAt' },
          error: '', message: '', syncing: false, pause: false, continuation: null, processed: 0, partial: false, history: null }
      }
      return state.instagramMedia
    }

    function instagramMediaCurrent(context) {
      return state.instagramMedia === context && state.businessId === context.businessId
    }

    function instagramMediaObserveAccount(accountId) {
      if (state.instagramMedia?.accountId && state.instagramMedia.accountId !== accountId) resetInstagramMediaState()
    }

    function instagramMediaNodes() {
      const names = ['body', 'filters', 'from', 'to', 'sort', 'refresh', 'sync', 'pause', 'summary', 'prev', 'next', 'feedback', 'history', 'history-body', 'history-caption', 'history-feedback', 'history-prev', 'history-next', 'history-summary', 'history-close']
      return Object.fromEntries(names.map((name) => [name, document.getElementById('instagram-media-' + name)]))
    }

    function instagramMediaDate(value) {
      const date = value ? new Date(value) : null
      return date && Number.isFinite(date.getTime()) ? date.toLocaleString('es-AR') : 'Sin registro'
    }

    function instagramMediaNumber(value) {
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('es-AR') : 'Sin datos'
    }

    function instagramMediaHtml(value) {
      return escapeHtml(value).replace(/[^\u0000-\u007f]/gu, (character) => '&#' + character.codePointAt(0) + ';')
    }

    function instagramMediaLink(value) {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) ? url.href : null
      } catch { return null }
    }

    function instagramMediaMetric(row, name) {
      const value = row.latestMetrics?.values?.[name]
      const known = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      return '<strong>' + instagramMediaHtml(instagramMediaNumber(value)) + '</strong>' + (known
        ? '<small>Observado: ' + instagramMediaHtml(instagramMediaDate(row.latestMetrics?.observedAtByMetric?.[name])) + '</small>' : '')
    }

    function instagramMediaStatus(status) {
      return ({ complete: 'Completo', partial: 'Parcial; revisá la fecha de cada dato', unavailable: 'Métricas no disponibles', not_applicable: 'Sin medición de Reels' })[status] || 'Sin medición'
    }

    function renderInstagramMediaCatalogue() {
      const m = instagramMediaContext()
      const nodes = instagramMediaNodes()
      if (nodes.filters.dataset.mediaContext !== String(m.generation)) {
        nodes.from.value = m.filters.from
        nodes.to.value = m.filters.to
        nodes.sort.value = m.filters.sort
        nodes.filters.dataset.mediaContext = String(m.generation)
      }
      const items = m.data?.items || []
      nodes.body.innerHTML = items.length ? items.map((row) => {
        const link = instagramMediaLink(row.permalink)
        const caption = instagramMediaHtml(row.caption || 'Reel sin descripción')
        const secondary = [['likes', 'Me gusta'], ['comments', 'Comentarios'], ['shares', 'Compartidos'], ['saved', 'Guardados'], ['total_interactions', 'Interacciones']]
          .map(([name, label]) => '<div><dt>' + label + '</dt><dd>' + instagramMediaMetric(row, name) + '</dd></div>').join('')
        return '<tr><td>' + (link ? '<a href="' + instagramMediaHtml(link) + '" target="_blank" rel="noopener noreferrer">' + caption + '</a>' : caption) + '</td>' +
          '<td>' + instagramMediaHtml(instagramMediaDate(row.publishedAt)) + '</td><td>' + instagramMediaMetric(row, 'reach') + '</td><td>' + instagramMediaMetric(row, 'views') + '</td>' +
          '<td><details><summary>Ver interacciones</summary><dl class="instagram-media-secondary">' + secondary + '</dl></details></td>' +
          '<td>' + instagramMediaHtml(instagramMediaStatus(row.insightsStatus)) + '<small>Intento: ' + instagramMediaHtml(instagramMediaDate(row.lastInsightAttemptAt)) + '</small></td>' +
          '<td><button type="button" data-instagram-media-history="' + instagramMediaHtml(row.id) + '">Ver historial</button> <button type="button" data-instagram-automation="media" data-instagram-automation-id="' + instagramMediaHtml(row.id) + '">Configurar respuestas</button></td></tr>'
      }).join('') : '<tr><td colspan="7">' + (m.loading ? 'Cargando datos guardados...' : m.accountId ? 'Sin Reels para estas fechas. Pod&eacute;s sincronizar Instagram.' : 'Conect&aacute; Instagram en Ajustes para importar tus Reels.') + '</td></tr>'
      nodes.feedback.textContent = m.error || m.message || (m.loading ? 'Leyendo datos guardados...' : 'Los datos guardados se actualizan solo con Sincronizar Instagram.')
      nodes.feedback.className = 'instagram-media-feedback' + (m.error ? ' error' : '')
      nodes.sync.disabled = m.syncing || !m.accountId
      nodes.sync.textContent = m.continuation ? 'Continuar sincronización' : 'Sincronizar Instagram'
      nodes.pause.hidden = !m.syncing
      nodes.pause.disabled = m.pause
      const displayedOffset = m.data?.offset || 0
      nodes.prev.disabled = m.loading || Boolean(m.error) || displayedOffset === 0
      nodes.next.disabled = m.loading || Boolean(m.error) || displayedOffset + 25 >= (m.data?.total || 0)
      nodes.summary.textContent = items.length ? (displayedOffset + 1) + '–' + (displayedOffset + items.length) + ' de ' + m.data.total + ' Reels' : '0 Reels en este filtro'
      renderInstagramMediaHistory()
    }

    async function loadInstagramMediaCatalogue() {
      const m = instagramMediaContext()
      if (!m.businessId) return
      const sequence = ++m.readSequence
      m.loading = true
      renderInstagramMediaCatalogue()
      const query = new URLSearchParams({ kind: 'REELS', sort: m.filters.sort, limit: '25', offset: String(m.offset) })
      for (const name of ['from', 'to']) {
        if (m.filters[name]) {
          const date = new Date(m.filters[name] + (name === 'from' ? 'T00:00:00' : 'T23:59:59.999'))
          query.set(name, date.toISOString())
        }
      }
      try {
        const response = await getJson('/businesses/' + encodeURIComponent(m.businessId) + '/instagram-media?' + query)
        if (!instagramMediaCurrent(m) || sequence !== m.readSequence) return
        if (!Array.isArray(response?.items) || !Array.isArray(response.linkedPublicationIds) || !Number.isSafeInteger(response.total) || response.total < 0) throw new Error('Invalid catalogue')
        if (m.accountId && m.accountId !== response.accountId) {
          resetInstagramMediaState()
          return loadInstagramMediaCatalogue()
        }
        m.accountId = response.accountId || null
        m.data = response
        m.loaded = true
        m.error = ''
        renderInstagramReels()
        return true
      } catch {
        if (instagramMediaCurrent(m) && sequence === m.readSequence) m.error = 'No pudimos leer el catálogo. Conservamos la última lectura.'
        return false
      } finally {
        if (instagramMediaCurrent(m) && sequence === m.readSequence) { m.loading = false; renderInstagramMediaCatalogue() }
      }
    }

    function applyInstagramMediaFilters(event) {
      event?.preventDefault()
      const m = instagramMediaContext()
      const nodes = instagramMediaNodes()
      const from = nodes.from.value
      const to = nodes.to.value
      if ((from && !Number.isFinite(new Date(from + 'T00:00:00').getTime())) || (to && !Number.isFinite(new Date(to + 'T00:00:00').getTime())) || (from && to && from > to)) {
        m.error = 'Revisá las fechas: el inicio debe ser anterior al final.'
        renderInstagramMediaCatalogue()
        return
      }
      m.filters = { from, to, sort: ['publishedAt', 'reach', 'views'].includes(nodes.sort.value) ? nodes.sort.value : 'publishedAt' }
      m.offset = 0
      m.history = null
      return loadInstagramMediaCatalogue()
    }

    async function syncInstagramMediaCatalogue() {
      const m = instagramMediaContext()
      if (m.syncing || !m.businessId || !m.accountId) return
      m.syncing = true
      m.pause = false
      m.error = ''
      if (!m.continuation) { m.processed = 0; m.partial = false }
      try {
        while (instagramMediaCurrent(m) && !m.pause && state.marketingView === 'instagram-reels' && els.appShell.dataset.section === 'campaigns' && !document.hidden) {
          m.message = 'Sincronizando: ' + m.processed + ' publicaciones procesadas.'
          renderInstagramMediaCatalogue()
          const result = await getJson('/businesses/' + encodeURIComponent(m.businessId) + '/instagram-media/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m.continuation ? { continuation: m.continuation } : {}) })
          if (!instagramMediaCurrent(m)) return
          if (!result || !['more', 'complete', 'partial', 'failed'].includes(result.status) || typeof result.accountId !== 'string') throw new Error('Invalid sync response')
          if (result.accountId !== m.accountId) { resetInstagramMediaState(); await loadInstagramMediaCatalogue(); return }
          if (result.continuation != null && !/^[a-f0-9-]{36}$/i.test(result.continuation)) throw new Error('Invalid continuation')
          m.continuation = result.continuation || null
          if (result.status === 'failed') { m.error = 'La actualización se pausó. Podés continuar o revisar la conexión en Ajustes.'; break }
          m.processed += Number.isSafeInteger(result.imported) && result.imported >= 0 ? result.imported : 0
          m.partial = m.partial || result.status === 'partial'
          const refreshed = await loadInstagramMediaCatalogue()
          if (!instagramMediaCurrent(m)) return
          if (refreshed === false) { m.pause = true; break }
          if (!m.continuation) { m.message = 'Finalizada: ' + m.processed + ' publicaciones procesadas.' + (m.partial ? ' Hay métricas parciales; revisá las fechas de cada valor.' : ''); break }
        }
        if (m.continuation && !m.error) m.message = 'Pausada: ' + m.processed + ' publicaciones procesadas. Podés continuar.'
      } catch (error) {
        if (!instagramMediaCurrent(m)) return
        if (error.body?.statusCode === 409 || /cambio|vencio|continuacion/i.test(error.message || '')) m.continuation = null
        m.error = m.continuation ? 'La actualización se pausó. Podés continuar con la próxima página.' : 'No pudimos actualizar. Iniciá otra sincronización o revisá la conexión.'
      } finally {
        if (instagramMediaCurrent(m)) { m.syncing = false; renderInstagramMediaCatalogue() }
      }
    }

    function pauseInstagramMediaSync() {
      const m = instagramMediaContext()
      m.pause = true
      m.message = 'Se pausará al terminar la página actual.'
      renderInstagramMediaCatalogue()
    }

    async function openInstagramMediaHistory(id, offset = 0) {
      const m = instagramMediaContext()
      const row = m.data?.items?.find((item) => item.id === id)
      if (!row) return
      if (m.history?.id !== id) m.history = { id, caption: row.caption || 'Reel sin descripción', data: null, offset: 0, sequence: 0, error: '', loading: false }
      const history = m.history
      history.offset = Math.max(0, offset)
      history.loading = true
      const sequence = ++history.sequence
      renderInstagramMediaHistory()
      try {
        const response = await getJson('/businesses/' + encodeURIComponent(m.businessId) + '/instagram-media/' + encodeURIComponent(id) + '/history?limit=5&offset=' + history.offset)
        if (!instagramMediaCurrent(m) || m.history !== history || history.sequence !== sequence || response.accountId !== m.accountId) return
        if (!Array.isArray(response.items) || !Number.isSafeInteger(response.total) || response.total < 0) throw new Error('Invalid history')
        history.data = response
        history.error = ''
      } catch {
        if (instagramMediaCurrent(m) && m.history === history && sequence === history.sequence) history.error = 'No pudimos leer las observaciones. Conservamos las anteriores.'
      } finally {
        if (instagramMediaCurrent(m) && m.history === history && sequence === history.sequence) { history.loading = false; renderInstagramMediaHistory() }
      }
    }

    function renderInstagramMediaHistory() {
      const m = instagramMediaContext()
      const nodes = instagramMediaNodes()
      const history = m.history
      nodes.history.hidden = !history
      if (!history) return
      nodes['history-caption'].textContent = history.caption
      nodes['history-feedback'].textContent = history.error || (history.loading ? 'Leyendo observaciones...' : 'Solo se muestran lecturas reales guardadas.')
      nodes['history-feedback'].className = 'instagram-media-feedback' + (history.error ? ' error' : '')
      const items = history.data?.items || []
      nodes['history-body'].innerHTML = items.length ? items.map((item) => '<tr><td>' + instagramMediaHtml(instagramMediaDate(item.observedAt)) + '</td><td>' + instagramMediaHtml(instagramMediaStatus(item.status)) + '</td>' + ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'].map((name) => '<td>' + instagramMediaHtml(instagramMediaNumber(item.values?.[name])) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="9">Todav&iacute;a no hay observaciones para este Reel.</td></tr>'
      const displayedOffset = history.data?.offset || 0
      nodes['history-prev'].disabled = history.loading || Boolean(history.error) || displayedOffset === 0
      nodes['history-next'].disabled = history.loading || Boolean(history.error) || displayedOffset + 5 >= (history.data?.total || 0)
      nodes['history-summary'].textContent = items.length ? (displayedOffset + 1) + '–' + (displayedOffset + items.length) + ' de ' + history.data.total + ' lecturas' : '0 lecturas'
    }

    function bindInstagramMediaControls() {
      instagramMediaAutomationBind()
      const nodes = instagramMediaNodes()
      nodes.filters.addEventListener('submit', applyInstagramMediaFilters)
      nodes.refresh.addEventListener('click', () => loadInstagramMediaCatalogue())
      nodes.sync.addEventListener('click', syncInstagramMediaCatalogue)
      nodes.pause.addEventListener('click', pauseInstagramMediaSync)
      nodes.prev.addEventListener('click', () => { const m = instagramMediaContext(); m.offset = Math.max(0, m.offset - 25); loadInstagramMediaCatalogue() })
      nodes.next.addEventListener('click', () => { const m = instagramMediaContext(); if (m.offset + 25 < (m.data?.total || 0)) { m.offset += 25; loadInstagramMediaCatalogue() } })
      nodes.body.addEventListener('click', (event) => { const button = event.target.closest('[data-instagram-media-history]'); if (button) openInstagramMediaHistory(button.dataset.instagramMediaHistory) })
      nodes['history-close'].addEventListener('click', () => { instagramMediaContext().history = null; renderInstagramMediaHistory() })
      nodes['history-prev'].addEventListener('click', () => { const history = instagramMediaContext().history; if (history) openInstagramMediaHistory(history.id, Math.max(0, history.offset - 5)) })
      nodes['history-next'].addEventListener('click', () => { const history = instagramMediaContext().history; if (history && history.offset + 5 < (history.data?.total || 0)) openInstagramMediaHistory(history.id, history.offset + 5) })
    }
`
