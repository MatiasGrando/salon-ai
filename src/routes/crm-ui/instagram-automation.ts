export const instagramAutomationStyles = `
    .instagram-automation-panel { min-width: 0; display: grid; gap: 16px; padding: 18px; border: 1px solid #b6cced; border-radius: 12px; background: #f8fbff; }
    .instagram-automation-panel[hidden] { display: none !important; }
    .instagram-automation-heading, .instagram-automation-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
    .instagram-automation-panel h4, .instagram-automation-panel p { margin: 0; overflow-wrap: anywhere; }
    .instagram-automation-panel form { display: grid; gap: 16px; min-width: 0; }
    .instagram-automation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .instagram-automation-panel fieldset { display: grid; align-content: start; gap: 10px; margin: 0; padding: 14px; min-width: 0; border: 1px solid #d6e2f1; border-radius: 10px; background: #fff; }
    .instagram-automation-panel legend { padding: 0 6px; color: #243b63; font-weight: 750; }
    .instagram-automation-field { display: grid; gap: 7px; min-width: 0; color: #405176; font-size: 13px; }
    .instagram-automation-check { display: flex; align-items: center; gap: 9px; min-height: 38px; font-size: 13px; color: #243b63; }
    .instagram-automation-panel input[type=checkbox] { width: 18px !important; max-width: 18px; height: 18px; flex: 0 0 18px; }
    .instagram-automation-panel :is(input[type=text], textarea) { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px; border: 1px solid #bfcfe4; border-radius: 8px; color: #17213a; background: #fff; font: inherit; }
    .instagram-automation-panel textarea { min-height: 110px; resize: none; }
    .instagram-automation-panel button { min-height: 38px; padding: 9px 12px; border: 1px solid #bfcfe4; border-radius: 8px; background: #fff; color: #243b63; font-weight: 750; cursor: pointer; }
    .instagram-automation-panel :is(button, input, textarea):focus-visible { outline: 3px solid #bfdbfe; outline-offset: 2px; }
    .instagram-automation-panel [aria-invalid=true] { border-color: #b42318; }
    .instagram-automation-panel button:disabled { opacity: .5; cursor: default; }
    .instagram-reels-manager [data-instagram-automation] { min-height: 38px; padding: 9px 12px; border: 1px solid #bfcfe4; border-radius: 8px; background: #fff; color: #243b63; font-weight: 750; cursor: pointer; }
    .instagram-reels-manager [data-instagram-automation]:focus-visible { outline: 3px solid #bfdbfe; outline-offset: 2px; }
    .instagram-automation-feedback.error { color: #b42318; }
    @media(max-width:720px) { .instagram-automation-panel { padding: 12px; } .instagram-automation-grid { grid-template-columns: minmax(0, 1fr); } .instagram-automation-panel button, .instagram-automation-check, .instagram-reels-manager [data-instagram-automation] { min-height: 44px; } .instagram-automation-actions button { flex: 1 1 140px; } }
`
export const instagramAutomationMarkup = `
            <section id="instagram-automation-panel" class="instagram-automation-panel" hidden aria-labelledby="instagram-automation-title">
              <div class="instagram-automation-heading"><div><h4 id="instagram-automation-title">Respuestas por palabra clave</h4><p id="instagram-automation-caption"></p></div><button type="button" id="instagram-automation-close">Cerrar</button></div>
              <p id="instagram-automation-state"></p>
              <form id="instagram-automation-form" novalidate>
                <label class="instagram-automation-check"><input type="checkbox" id="instagram-automation-enabled">Automatizaci&oacute;n activa</label>
                <label class="instagram-automation-field" for="instagram-automation-keywords">Palabras clave, separadas por coma<input type="text" id="instagram-automation-keywords" maxlength="2400" placeholder="precio, turno"></label>
                <div class="instagram-automation-grid">
                  <fieldset><legend>Comentario p&uacute;blico</legend><label class="instagram-automation-check"><input type="checkbox" id="instagram-automation-public-enabled">Responder en el comentario</label><label class="instagram-automation-field" for="instagram-automation-public-text">Texto p&uacute;blico<textarea id="instagram-automation-public-text" maxlength="1000"></textarea></label><p>No incluyas enlaces privados de formularios.</p></fieldset>
                  <fieldset><legend>Mensaje privado</legend><label class="instagram-automation-check"><input type="checkbox" id="instagram-automation-private-enabled">Enviar la respuesta privada existente</label><label class="instagram-automation-field" for="instagram-automation-private-text">Texto privado<textarea id="instagram-automation-private-text" maxlength="1000"></textarea></label><p>Pod&eacute;s conservar los enlaces de formulario. La continuidad por DM mantiene sus reglas actuales.</p></fieldset>
                </div>
                <p id="instagram-automation-feedback" class="instagram-automation-feedback" role="status" aria-live="polite"></p>
                <div class="instagram-automation-actions"><button type="submit" id="instagram-automation-save">Guardar cambios</button><button type="button" id="instagram-automation-pause">Pausar automatizaci&oacute;n</button><button type="button" id="instagram-automation-reload">Releer configuraci&oacute;n</button></div>
              </form>
              <h4>Acciones recientes</h4><p>Cada respuesta tiene su propio resultado. Un resultado incierto requiere revisar Instagram; no se reenv&iacute;a desde este panel.</p>
              <div class="instagram-media-table-wrap"><table class="instagram-media-table"><thead><tr><th>Acci&oacute;n</th><th>Resultado</th><th>Intentos</th><th>Enviada</th><th>Detalle</th></tr></thead><tbody id="instagram-automation-results"></tbody></table></div>
            </section>
`
export const instagramAutomationScript = String.raw`
    function instagramMediaAutomationNodes() {
      return Object.fromEntries(['panel', 'caption', 'state', 'form', 'enabled', 'keywords', 'public-enabled', 'public-text', 'private-enabled', 'private-text', 'feedback', 'save', 'pause', 'reload', 'close', 'results'].map((key) => [key, document.getElementById('instagram-automation-' + key)]))
    }

    function instagramMediaAutomationClose(returnFocus = true) {
      const m = state.instagramMedia
      const editor = m?.automation
      editor?.controller.abort()
      if (m) m.automation = null
      instagramMediaAutomationNodes().panel.hidden = true
      if (returnFocus && editor) {
        const replacement = [...document.querySelectorAll('[data-instagram-automation]')].find((button) =>
          button.dataset.instagramAutomation === editor.type && button.dataset.instagramAutomationId === editor.id)
        const target = editor.origin?.isConnected ? editor.origin : replacement || instagramMediaNodes().refresh
        target?.focus()
      }
    }

    function instagramMediaAutomationCurrent(m, editor) {
      return instagramMediaCurrent(m) && m.automation === editor && state.marketingView === 'instagram-reels' && els.appShell.dataset.section === 'campaigns'
    }

    function instagramMediaAutomationHydrate(editor) {
      const nodes = instagramMediaAutomationNodes()
      const config = editor.data.automation || { enabled: false, keywords: [], privateReplyEnabled: true, privateReplyText: '', publicReplyEnabled: false, publicReplyText: '' }
      nodes.enabled.checked = config.enabled
      nodes.keywords.value = config.keywords.join(', ')
      nodes['private-enabled'].checked = config.privateReplyEnabled
      nodes['private-text'].value = config.privateReplyText
      nodes['public-enabled'].checked = config.publicReplyEnabled
      nodes['public-text'].value = config.publicReplyText
    }

    function instagramMediaAutomationRender() {
      const editor = state.instagramMedia?.automation
      const nodes = instagramMediaAutomationNodes()
      nodes.panel.hidden = !editor
      if (!editor) return
      nodes.caption.textContent = editor.caption
      nodes.state.textContent = editor.data?.automation ? (editor.data.automation.enabled ? 'Activa' : 'Pausada') : 'Sin configurar'
      nodes.feedback.textContent = editor.error || editor.message || (editor.loading ? 'Leyendo configuración...' : '')
      nodes.feedback.className = 'instagram-automation-feedback' + (editor.error ? ' error' : '')
      for (const key of ['enabled', 'keywords', 'private-enabled', 'private-text', 'public-enabled', 'public-text', 'save', 'pause']) nodes[key].disabled = editor.loading || editor.saving || !editor.data
      nodes.reload.disabled = editor.loading || editor.saving
      nodes.pause.disabled = nodes.pause.disabled || !editor.data?.automation
      const statuses = { READY: 'Pendiente', CLAIMED: 'Preparando', SENDING: 'Enviando', RETRY: 'Reintento pendiente', SENT: 'Enviada', UNKNOWN: 'Incierta: revisar Instagram', FAILED: 'Fallida', SKIPPED: 'Omitida' }
      nodes.results.innerHTML = (editor.data?.recentActions || []).map((action) => '<tr><td>' + (action.kind === 'PUBLIC_REPLY' ? 'Comentario p&uacute;blico' : action.kind === 'PRIVATE_REPLY' ? 'Mensaje privado' : 'Acci&oacute;n desconocida') + '</td><td>' + instagramMediaHtml(statuses[action.status] || 'Sin estado confirmado') + '</td><td>' + instagramMediaHtml(instagramMediaNumber(action.attempts)) + '</td><td>' + instagramMediaHtml(instagramMediaDate(action.sentAt)) + '</td><td>' + (action.lastError ? 'No se pudo completar esta acci&oacute;n. Revis&aacute; su estado.' : '&mdash;') + '</td></tr>').join('') || '<tr><td colspan="5">Todav&iacute;a no hay acciones registradas.</td></tr>'
    }

    function instagramMediaAutomationResponse(editor, response) {
      const config = response?.automation
      if (!response || response.accountId !== editor.accountId || !Array.isArray(response.recentActions) ||
        (editor.type === 'media' ? response.mediaId !== editor.id : response.publicationId !== editor.id) ||
        (config !== null && (!config || !Array.isArray(config.keywords) || config.keywords.some((k) => typeof k !== 'string') ||
          ['enabled', 'publicReplyEnabled', 'privateReplyEnabled'].some((key) => typeof config[key] !== 'boolean') ||
          ['publicReplyText', 'privateReplyText'].some((key) => typeof config[key] !== 'string')))) throw new Error('Invalid configuration context')
      return response
    }

    async function instagramMediaAutomationOpen(type, id, origin) {
      const m = instagramMediaContext()
      const row = type === 'media' ? m.data?.items?.find((item) => item.id === id && item.accountId === m.accountId) : type === 'publications' ? state.instagramReels.find((item) => item.id === id && item.status === 'PUBLISHED') : null
      if (!row || !m.accountId) return
      instagramMediaAutomationClose(false)
      const editor = m.automation = { id, type, caption: row.caption || 'Reel sin descripción', accountId: m.accountId, origin,
        controller: new AbortController(), loading: false, saving: false, data: null, error: '', message: '', sequence: 0 }
      editor.url = '/businesses/' + encodeURIComponent(m.businessId) + '/instagram-' + type + '/' + encodeURIComponent(id) + '/automation'
      await instagramMediaAutomationLoad(m, editor)
      if (instagramMediaAutomationCurrent(m, editor)) { instagramMediaAutomationNodes().panel.scrollIntoView({ block: 'nearest' }); instagramMediaAutomationNodes().keywords.focus() }
    }

    async function instagramMediaAutomationLoad(m, editor) {
      if (!instagramMediaAutomationCurrent(m, editor) || editor.saving) return
      const sequence = ++editor.sequence
      editor.loading = true; editor.error = ''; editor.message = ''
      instagramMediaAutomationRender()
      try {
        const response = await getJson(editor.url, { signal: editor.controller.signal })
        if (!instagramMediaAutomationCurrent(m, editor) || sequence !== editor.sequence) return
        editor.data = instagramMediaAutomationResponse(editor, response)
        instagramMediaAutomationHydrate(editor)
      } catch {
        if (instagramMediaAutomationCurrent(m, editor) && sequence === editor.sequence) editor.error = 'No pudimos leer la configuración. Tus cambios siguen en pantalla.'
      } finally {
        if (instagramMediaAutomationCurrent(m, editor) && sequence === editor.sequence) { editor.loading = false; instagramMediaAutomationRender() }
      }
    }

    function instagramMediaAutomationPayload(paused) {
      const n = instagramMediaAutomationNodes()
      return { enabled: paused ? false : n.enabled.checked,
        keywords: [...new Map(n.keywords.value.split(/[,;]/).map((value) => [normalizeInstagramReelKeyword(value), value.trim()])).entries()].filter(([key]) => key).map(([, value]) => value),
        publicReplyEnabled: n['public-enabled'].checked, publicReplyText: n['public-text'].value.trim(),
        privateReplyEnabled: n['private-enabled'].checked, privateReplyText: n['private-text'].value.trim() }
    }

    async function instagramMediaAutomationSave(event, paused = false) {
      event?.preventDefault()
      const m = instagramMediaContext(), editor = m.automation
      if (!editor?.data || editor.saving || editor.loading || !instagramMediaAutomationCurrent(m, editor)) return
      const nodes = instagramMediaAutomationNodes(), payload = instagramMediaAutomationPayload(paused)
      for (const key of ['keywords', 'public-text', 'private-text']) nodes[key].removeAttribute('aria-invalid')
      const field = payload.keywords.length > 20 || payload.keywords.some((k) => k.length > 120) || (payload.enabled && !payload.keywords.length) ? 'keywords'
        : (payload.enabled && !payload.publicReplyEnabled && !payload.privateReplyEnabled) || payload.publicReplyText.length > 1000 || (payload.enabled && payload.publicReplyEnabled && !payload.publicReplyText) || (payload.publicReplyEnabled && /{{weex_form:|[?&]ref=/i.test(payload.publicReplyText)) ? 'public-text'
        : payload.privateReplyText.length > 1000 || (payload.enabled && payload.privateReplyEnabled && !payload.privateReplyText) ? 'private-text' : null
      if (field) { editor.error = 'Revisá palabras clave y textos de las acciones activas. Los enlaces privados no van en comentarios.'; instagramMediaAutomationRender(); nodes[field].setAttribute('aria-invalid', 'true'); nodes[field].focus(); return }
      editor.saving = true; editor.error = ''; editor.message = 'Guardando configuración...'
      instagramMediaAutomationRender()
      try {
        const response = await getJson(editor.url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: editor.controller.signal })
        if (!instagramMediaAutomationCurrent(m, editor)) return
        const data = instagramMediaAutomationResponse(editor, response)
        if (!data.automation) throw new Error('Missing saved automation')
        editor.data = data; instagramMediaAutomationHydrate(editor)
        editor.message = paused ? 'Automatización pausada.' : 'Configuración guardada.'
      } catch {
        if (instagramMediaAutomationCurrent(m, editor)) { editor.error = 'No se guardó la configuración. Conservamos tus cambios para que puedas intentarlo de nuevo.'; editor.message = '' }
      } finally {
        if (instagramMediaAutomationCurrent(m, editor)) { editor.saving = false; instagramMediaAutomationRender() }
      }
    }

    function instagramMediaAutomationBind() {
      const nodes = instagramMediaAutomationNodes()
      for (const container of [instagramMediaNodes().body, els.instagramReelsTableBody]) container.addEventListener('click', (event) => {
        const button = event.target.closest('[data-instagram-automation]')
        if (button) return instagramMediaAutomationOpen(button.dataset.instagramAutomation, button.dataset.instagramAutomationId, button)
      })
      nodes.form.addEventListener('submit', instagramMediaAutomationSave)
      nodes.pause.addEventListener('click', (event) => instagramMediaAutomationSave(event, true))
      nodes.close.addEventListener('click', () => instagramMediaAutomationClose())
      nodes.reload.addEventListener('click', () => { const m = instagramMediaContext(); if (m.automation) instagramMediaAutomationLoad(m, m.automation) })
    }
`
