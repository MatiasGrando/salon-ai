export const instagramPlanningStyles = `
    .instagram-planning { padding:18px; min-width:0; display:grid; gap:14px; border:1px solid #dce3ef; border-radius:14px; background:#fff; }
    .instagram-planning-header,.instagram-planning-controls { display:flex; flex-wrap:wrap; align-items:center; gap:10px; justify-content:space-between; }
    .instagram-planning h4,.instagram-planning p { margin:0; overflow-wrap:anywhere; }
    .instagram-planning button { min-height:38px; padding:9px 12px; border:1px solid #bfcfe4; border-radius:8px; background:#fff; color:#243b63; cursor:pointer; }
    .instagram-planning button[aria-pressed=true] { background:#e4efff; border-color:#2563eb; }
    .instagram-planning :is(button,input,select):focus-visible { outline:3px solid #bfdbfe; outline-offset:2px; }
    .instagram-planning-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
    .instagram-planning-days button { min-width:0; padding:8px 2px; overflow-wrap:anywhere; }
    .instagram-planning small { display:block; }
    .instagram-planning-error { color:#b42318; }
    .instagram-reel-dialog .instagram-reel-switch { min-height:38px; }
    .instagram-reel-dialog .instagram-reel-switch input[type=checkbox] { width:18px!important; max-width:18px; flex:0 0 18px; }
    .instagram-reel-time-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .instagram-reel-time-grid :is(input,select) { box-sizing:border-box; min-width:0; width:100%; padding:10px; border:1px solid #bfcfe4; border-radius:8px; font:inherit; }
    .instagram-reel-time-grid button { min-height:38px; }
    @media(max-width:720px) { .instagram-planning { padding:12px; } .instagram-planning button,.instagram-reel-dialog .instagram-reel-switch,.instagram-reel-time-grid button { min-height:44px; } .instagram-reel-time-grid { grid-template-columns:minmax(0,1fr); } }
`
export const instagramPlanningMarkup = `
          <section class="instagram-planning" id="instagram-planning" aria-labelledby="instagram-planning-title">
            <div class="instagram-planning-header"><div><h4 id="instagram-planning-title">Calendario de Instagram</h4><p id="instagram-planning-zone"></p></div><button type="button" id="instagram-planning-refresh">Releer calendario</button></div>
            <div class="instagram-planning-controls"><div role="group" aria-label="Contenido del calendario"><button type="button" data-instagram-plan-type="REEL">Reels</button><button type="button" data-instagram-plan-type="STORY">Historias</button></div><div role="group" aria-label="Vista del calendario"><button type="button" data-instagram-plan-view="week">Semana</button><button type="button" data-instagram-plan-view="month">Mes</button><button type="button" data-instagram-plan-view="list">Lista</button></div><div><button type="button" data-instagram-plan-move="-1">Anterior</button><button type="button" data-instagram-plan-move="0">Hoy</button><button type="button" data-instagram-plan-move="1">Siguiente</button></div></div>
            <p id="instagram-planning-range"></p><div class="instagram-planning-days" id="instagram-planning-days"></div>
            <p id="instagram-planning-feedback" role="status" aria-live="polite"></p>
            <div class="instagram-media-table-wrap"><table class="instagram-media-table"><thead><tr><th>Reel</th><th>Estado</th><th>Horario deseado</th><th>Publicaci&oacute;n real</th><th>Acciones</th></tr></thead><tbody id="instagram-planning-body"></tbody></table></div>
            <h4>Sin fecha comprobable</h4><p>Borradores e intentos sin horario registrado. Una fecha ausente no significa que se haya publicado.</p>
            <div class="instagram-media-table-wrap"><table class="instagram-media-table"><thead><tr><th>Reel</th><th>Estado</th><th>Horario deseado</th><th>Publicaci&oacute;n real</th><th>Acciones</th></tr></thead><tbody id="instagram-planning-undated"></tbody></table></div>
            <div class="instagram-planning-controls"><span id="instagram-planning-summary"></span><button type="button" id="instagram-planning-more">Cargar m&aacute;s registros</button></div>
          </section>
`
export const instagramPlanningScript = String.raw`
    function instagramMediaPlanNodes() {
      return Object.fromEntries(['zone','range','days','feedback','body','undated','summary','more','refresh'].map(key => [key,document.getElementById('instagram-planning-'+key)]))
    }

    function instagramMediaPlanDate(instant, zone) {
      const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant)
      const part = key => parts.find(item => item.type === key).value
      return part('year')+'-'+part('month')+'-'+part('day')
    }

    function instagramMediaPlanShift(date, days, months = 0) {
      const [year,month,day] = date.split('-').map(Number)
      return new Date(Date.UTC(year,month-1+months,day+days)).toISOString().slice(0,10)
    }

    function instagramMediaPlanContext() {
      if (!state.instagramPlanning || state.instagramPlanning.businessId !== state.businessId || state.instagramPlanning.zone !== state.business?.timezone) {
        state.instagramPlanning?.controller.abort()
        state.instagramPlanning?.editor?.controller.abort()
        if (state.instagramPlanning?.editor) els.instagramReelDialog.hidden = true
        state.instagramPlanning = { businessId:state.businessId, zone:state.business?.timezone, view:'week', data:null, offset:0,
          controller:new AbortController(), sequence:0, loading:false, error:'', action:false, editor:null }
      }
      return state.instagramPlanning
    }

    function instagramMediaPlanCurrent(p) {
      return state.instagramPlanning === p && state.businessId === p.businessId && p.zone === state.business?.timezone && state.marketingView === 'instagram-reels' && els.appShell.dataset.section === 'campaigns'
    }

    function instagramMediaPlanLeave() {
      state.instagramPlanning?.controller.abort()
      if (state.instagramPlanning?.editor) closeInstagramReelDialog()
      state.instagramPlanning = null
    }

    function instagramMediaPlanPeriod(p) {
      const anchor = p.anchor || instagramMediaPlanDate(new Date(),p.zone)
      let first = anchor
      if (p.view === 'week') { const weekday = new Date(anchor+'T12:00:00Z').getUTCDay(); first = instagramMediaPlanShift(anchor,-((weekday+6)%7)) }
      else first = anchor.slice(0,8)+'01'
      return { first, end:p.view === 'week' ? instagramMediaPlanShift(first,7) : instagramMediaPlanShift(first,0,1) }
    }

    async function instagramMediaPlanBoundary(p, date) {
      let invalid = -1
      const resolve = async minute => {
        const result = await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-calendar/time-options?date='+date+'&minute='+minute,{signal:p.controller.signal})
        if (result.timezone !== p.zone || !result.candidates?.length) throw new Error('La zona del comercio cambió. Reabrí Instagram.')
        return result.candidates[0].instant
      }
      for (let minute=0;minute<=180;minute+=30) {
        try {
          let instant = await resolve(minute), first = minute
          while (invalid>=0 && first-invalid>1) {
            const middle = Math.floor((first+invalid)/2)
            try { instant=await resolve(middle); first=middle }
            catch(error) { if(error.status!==400)throw error; invalid=middle }
          }
          return instant
        } catch (error) { if (error.status !== 400 || minute === 180) throw error; invalid=minute }
      }
    }

    async function instagramMediaPlanLoad(more = false) {
      const p = instagramMediaPlanContext(), nodes = instagramMediaPlanNodes()
      if (p.loading) return
      const sequence = ++p.sequence
      p.loading = true; p.error = ''; nodes.feedback.textContent = 'Leyendo calendario guardado...'
      try {
        if (!p.zone) throw new Error('Configurá la zona horaria del comercio en Ajustes.')
        const period = instagramMediaPlanPeriod(p)
        const [from,to] = await Promise.all([instagramMediaPlanBoundary(p,period.first),instagramMediaPlanBoundary(p,period.end)])
        if (!instagramMediaPlanCurrent(p) || sequence !== p.sequence) return
        const offset = more ? p.offset+50 : 0
        const result = await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-calendar?'+new URLSearchParams({from,to,limit:'50',offset:String(offset),publicationType:p.publicationType||'REEL'}),{signal:p.controller.signal})
        if (!instagramMediaPlanCurrent(p) || sequence !== p.sequence) return
        if (result.timezone !== p.zone || !Array.isArray(result.items) || !Array.isArray(result.undatedItems)) throw new Error('No pudimos confirmar el contexto del calendario.')
        if (p.accountId !== undefined && p.accountId !== result.accountId) { p.editor?.controller.abort(); p.editor = null; els.instagramReelDialog.hidden = true }
        p.accountId = result.accountId; p.offset = offset; p.period = period
        const merge = (old, incoming) => [...new Map([...old,...incoming].map(row => [row.kind+':'+row.id,row])).values()]
        p.data = { ...result, items:more ? merge(p.data?.items || [],result.items) : result.items,
          undatedItems:more ? merge(p.data?.undatedItems || [],result.undatedItems) : result.undatedItems }
      } catch (error) { if (instagramMediaPlanCurrent(p)) p.error = error.message || 'No pudimos leer el calendario. Conservamos los datos anteriores.' }
      finally { if (instagramMediaPlanCurrent(p) && sequence === p.sequence) { p.loading = false; instagramMediaPlanRender() } }
    }

    function instagramMediaPlanRender() {
      const p = instagramMediaPlanContext(), nodes = instagramMediaPlanNodes(), data = p.data
      nodes.zone.textContent = p.zone ? 'Zona del comercio: '+p.zone : 'Zona horaria pendiente de configurar'
      nodes.range.textContent = p.period ? p.period.first+' al '+instagramMediaPlanShift(p.period.end,-1)+' · '+(p.view==='week'?'Semana':p.view==='month'?'Mes':'Lista') : ''
      nodes.feedback.textContent = p.error || (p.loading ? 'Leyendo calendario...' : 'Datos guardados; navegar no sincroniza Instagram.')
      nodes.feedback.className = p.error ? 'instagram-planning-error' : ''
      const date = value => value ? new Intl.DateTimeFormat('es-AR',{timeZone:p.zone,dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : 'Sin fecha'
      const rows = items => items.map(row => {
        if(p.publicationType==='STORY') {
          const button=(action,label)=>'<button type="button" data-instagram-story-action="'+action+'" data-id="'+instagramMediaHtml(row.id)+'">'+label+'</button>'
          return '<tr><td>'+instagramMediaHtml(row.caption||'Historia sin nota')+'</td><td>'+instagramMediaHtml(typeof instagramStoryStatus==='function'?instagramStoryStatus(row.status):row.status)+'</td><td>'+instagramMediaHtml(date(row.scheduledAt))+'</td><td>'+instagramMediaHtml(date(row.publishedAt))+(row.manuallyCompletedAt?'<small>Finalizada manualmente: '+instagramMediaHtml(date(row.manuallyCompletedAt))+'</small>':'')+'</td><td>'+(row.kind==='publication'?button('open','Abrir')+(row.status==='SCHEDULED'?button('cancel','Cancelar horario'):'')+button('download','Descargar'):'Publicada en Instagram')+'</td></tr>'
        }
        const editable = row.kind === 'publication' && ['DRAFT','CANCELLED'].includes(row.status)
        const action = (name,label) => '<button type="button" data-instagram-plan-action="'+name+'" data-kind="'+instagramMediaHtml(row.kind)+'" data-id="'+instagramMediaHtml(row.id)+'">'+label+'</button>'
        return '<tr><td>'+instagramMediaHtml(row.caption || 'Reel sin descripción')+(row.unverifiedAccount?'<small>Cuenta hist&oacute;rica no verificada</small>':'')+'</td><td>'+instagramReelStatusMeta(row.status).label+'</td><td>'+instagramMediaHtml(date(row.scheduledAt))+'</td><td>'+instagramMediaHtml(date(row.publishedAt))+'</td><td>'+(editable?action('edit','Editar'):'')+(row.kind==='publication'&&row.status==='SCHEDULED'?action('reprogram','Reprogramar')+action('cancel','Cancelar programaci&oacute;n'):'')+action('duplicate','Duplicar')+'</td></tr>'
      }).join('') || '<tr><td colspan="5">Sin registros en esta p&aacute;gina.</td></tr>'
      nodes.body.innerHTML = rows((data?.items || []).filter(row => !p.day || instagramMediaPlanDate(new Date(row.eventAt),p.zone) === p.day))
      nodes.undated.innerHTML = rows(data?.undatedItems || [])
      nodes.summary.textContent = data ? data.items.length+' de '+data.total+' con fecha · '+data.undatedItems.length+' de '+data.undatedTotal+' sin fecha' : ''
      nodes.more.disabled = p.loading || !data || (p.offset+50 >= Math.max(data.total,data.undatedTotal))
      nodes.days.hidden = p.view === 'list'
      let buttons = ''
      if (p.period) for (let day=p.period.first;day<p.period.end;day=instagramMediaPlanShift(day,1)) buttons += '<button type="button" data-instagram-plan-day="'+day+'" aria-pressed="'+(p.day===day)+'">'+day.slice(8)+'</button>'
      nodes.days.innerHTML = buttons
      for(const button of document.querySelectorAll('[data-instagram-plan-type]'))button.setAttribute('aria-pressed',String(button.dataset.instagramPlanType===(p.publicationType||'REEL')))
      for (const button of document.querySelectorAll('[data-instagram-plan-view]')) button.setAttribute('aria-pressed',String(button.dataset.instagramPlanView===p.view))
    }

    function instagramMediaPlanNew(origin) {
      const p = instagramMediaPlanContext()
      p.editor?.controller.abort()
      p.editor = { controller:new AbortController(), origin:origin || els.instagramReelNew, publication:null, verified:null, saving:false, sequence:0 }
      document.getElementById('instagram-reel-dialog-title').textContent = 'Nuevo Reel'
      document.getElementById('instagram-reel-destination').value = 'draft'
      document.getElementById('instagram-reel-time-options').innerHTML = '<option value="">Eleg&iacute; un horario y verific&aacute; sus opciones</option>'
      document.getElementById('instagram-reel-public-enabled').checked = false
      document.getElementById('instagram-reel-private-enabled').checked = true
      document.getElementById('instagram-reel-public-reply').value = ''
      return p.editor
    }

    function instagramMediaPlanEditorCurrent(p, editor) {
      return instagramMediaPlanCurrent(p) && p.editor === editor && !els.instagramReelDialog.hidden
    }

    function instagramMediaPlanPublication(p, row, id) {
      if (!row?.id || row.businessId !== p.businessId || (id && row.id !== id) || !Number.isInteger(row.revision)) throw new Error('No se confirmó el borrador en este comercio.')
      return row
    }

    async function instagramMediaPlanOpen(row, action, origin) {
      openInstagramReelDialog()
      const p = instagramMediaPlanContext(), editor = p.editor
      editor.origin = origin
      editor.loading = true; els.instagramReelSubmit.disabled = true
      try {
        const base = '/businesses/'+encodeURIComponent(p.businessId)+'/instagram-'+(row.kind==='media'?'media':'publications')+'/'+encodeURIComponent(row.id)
        const result = await getJson(base+(action==='duplicate'?'/duplicate':''),action==='duplicate'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:row.revision}),signal:editor.controller.signal}:{signal:editor.controller.signal})
        if (!instagramMediaPlanEditorCurrent(p,editor)) return
        editor.publication = action==='duplicate'?(result.publication?instagramMediaPlanPublication(p,result.publication):null):instagramMediaPlanPublication(p,result,row.id)
        const content = action==='duplicate'?result.content:result
        const automation = content.automation || {}
        els.instagramReelCaption.value = content.caption || ''; els.instagramReelShareToFeed.checked = content.shareToFeed !== false
        els.instagramReelAutomationEnabled.checked = !!automation.enabled
        state.instagramReelKeywords = (automation.keywords || []).map(keyword => typeof keyword==='string'?keyword:keyword.value)
        els.instagramReelPrivateReply.value = automation.privateReplyText || ''
        document.getElementById('instagram-reel-private-enabled').checked = automation.privateReplyEnabled !== false
        document.getElementById('instagram-reel-public-enabled').checked = !!automation.publicReplyEnabled
        document.getElementById('instagram-reel-public-reply').value = automation.publicReplyText || ''
        document.getElementById('instagram-reel-dialog-title').textContent = action==='duplicate'?'Duplicar Reel':action==='reprogram'?'Reprogramar Reel':'Editar Reel'
        document.getElementById('instagram-reel-destination').value = action==='reprogram'?'schedule':'draft'
        editor.reprogram = action==='reprogram'
        for (const field of [els.instagramReelVideo,els.instagramReelCaption,els.instagramReelShareToFeed,els.instagramReelAutomationEnabled,els.instagramReelPrivateReply,els.instagramReelKeywordInput,els.instagramReelKeywordAdd,document.getElementById('instagram-reel-public-reply'),document.getElementById('instagram-reel-public-enabled'),document.getElementById('instagram-reel-private-enabled')]) field.disabled = editor.reprogram
        setInstagramReelFeedback(result.requiresFile?'Esta copia necesita un video propio. Seleccionalo para guardar.':editor.reprogram?'El contenido programado se conserva; elegí otro horario.':'Archivo guardado. Sólo se subirá otro si lo seleccionás.')
        renderInstagramReelKeywords(); renderInstagramReelReview()
      } catch { if (instagramMediaPlanEditorCurrent(p,editor)) { editor.failedLoad=true; setInstagramReelFeedback('No pudimos abrir este Reel. Actualizá su estado e intentá nuevamente.','error') } }
      finally { if (instagramMediaPlanEditorCurrent(p,editor)) { editor.loading=false; els.instagramReelSubmit.disabled=!!editor.failedLoad } }
    }

    async function instagramMediaPlanResolve() {
      const p = instagramMediaPlanContext(), editor = p.editor, select = document.getElementById('instagram-reel-time-options')
      if (!editor) return
      const sequence = ++editor.sequence, date = document.getElementById('instagram-reel-schedule-date').value, time = document.getElementById('instagram-reel-schedule-time').value
      select.innerHTML = '<option value="">Verificando horario...</option>'
      try {
        if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Elegí fecha y hora.')
        const [hour,minute] = time.split(':').map(Number)
        const result = await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-calendar/time-options?'+new URLSearchParams({date,minute:String(hour*60+minute)}),{signal:editor.controller.signal})
        if (!instagramMediaPlanEditorCurrent(p,editor) || sequence!==editor.sequence) return
        editor.wall = date+'T'+time
        select.innerHTML = '<option value="">Eleg&iacute; la opci&oacute;n horaria</option>'+result.candidates.map(candidate=>'<option value="'+instagramMediaHtml(candidate.instant)+'">'+instagramMediaHtml(time+' · '+candidate.offset+' · '+result.timezone)+'</option>').join('')
        if (!result.requiresChoice && result.candidates.length===1) select.value = result.candidates[0].instant
        setInstagramReelFeedback(result.requiresChoice?'Ese horario ocurre dos veces. Elegí el desfase explícitamente.':'Horario verificado en '+result.timezone+'.')
      } catch { if (instagramMediaPlanEditorCurrent(p,editor)) { select.innerHTML='<option value="">Horario no v&aacute;lido</option>'; setInstagramReelFeedback('Ese horario no existe o no pudo verificarse en la zona del comercio.','error'); select.focus() } }
    }

    async function instagramMediaPlanSubmit(event) {
      event.preventDefault()
      const p = instagramMediaPlanContext(), editor = p.editor || instagramMediaPlanNew()
      if (editor.saving || editor.loading || editor.failedLoad || !instagramMediaPlanEditorCurrent(p,editor)) return
      const file = els.instagramReelVideo.files?.[0], mimeType = instagramReelMimeType(file)
      const destination = document.getElementById('instagram-reel-destination').value
      const automation = { enabled:els.instagramReelAutomationEnabled.checked, keywords:state.instagramReelKeywords,
        privateReplyEnabled:document.getElementById('instagram-reel-private-enabled').checked,privateReplyText:els.instagramReelPrivateReply.value.trim(),
        publicReplyEnabled:document.getElementById('instagram-reel-public-enabled').checked,publicReplyText:document.getElementById('instagram-reel-public-reply').value.trim() }
      const fail = (message,field) => { setInstagramReelFeedback(message,'error'); field.focus() }
      if (!editor.publication && !editor.verified && (!file || !mimeType)) return fail('Elegí un video MP4 o MOV.',els.instagramReelVideo)
      if (automation.enabled && !automation.keywords.length) return fail('Agregá al menos una palabra clave.',els.instagramReelKeywordInput)
      if (automation.enabled && automation.privateReplyEnabled && !automation.privateReplyText) return fail('Escribí el mensaje privado.',els.instagramReelPrivateReply)
      if (automation.enabled && ((!automation.publicReplyEnabled && !automation.privateReplyEnabled) || (automation.publicReplyEnabled && !automation.publicReplyText))) return fail('Seleccioná una acción y completá su texto.',document.getElementById('instagram-reel-public-reply'))
      if (automation.publicReplyEnabled && /{{weex_form:|[?&]ref=/i.test(automation.publicReplyText)) return fail('Los enlaces privados no van en comentarios públicos.',document.getElementById('instagram-reel-public-reply'))
      const scheduledAt = document.getElementById('instagram-reel-time-options').value
      if (destination==='schedule' && (!scheduledAt || editor.wall!==document.getElementById('instagram-reel-schedule-date').value+'T'+document.getElementById('instagram-reel-schedule-time').value)) return fail('Verificá y elegí la opción horaria.',document.getElementById('instagram-reel-time-options'))
      editor.saving = true; setButtonLoading(els.instagramReelSubmit,true,'Guardando...')
      const basePath = '/businesses/'+encodeURIComponent(p.businessId)+'/instagram-publications'
      const request = (url,method,body) => getJson(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:editor.controller.signal})
      try {
        if (file && editor.file !== file) {
          setInstagramReelFeedback('Preparando una carga segura...'); setInstagramReelProgress(10)
          const upload = await request(basePath+'/uploads','POST',{mimeType,sizeBytes:file.size})
          if (!instagramMediaPlanEditorCurrent(p,editor)) return
          if (!upload?.uploadUrl || new URL(upload.uploadUrl).protocol!=='https:' || !upload.objectPath || !upload.uploadHeaders) throw new Error('Carga inválida.')
          await uploadInstagramReelFile(upload,file,editor.controller.signal)
          if (!instagramMediaPlanEditorCurrent(p,editor)) return
          editor.verified = await request(basePath+'/uploads/verify','POST',{objectPath:upload.objectPath,mimeType,sizeBytes:file.size})
          if (!editor.verified?.verified || editor.verified.objectPath!==upload.objectPath || editor.verified.mimeType!==mimeType || editor.verified.sizeBytes!==file.size) { editor.verified=null; throw new Error('No se verificó el archivo.') }
          editor.file = file
        }
        if (!instagramMediaPlanEditorCurrent(p,editor)) return
        if (editor.publication) {
          const latest = instagramMediaPlanPublication(p,await getJson(basePath+'/'+encodeURIComponent(editor.publication.id),{signal:editor.controller.signal}),editor.publication.id)
          if (!instagramMediaPlanEditorCurrent(p,editor)) return
          if (!['DRAFT','CANCELLED','SCHEDULED'].includes(latest.status)) { setInstagramReelFeedback('El Reel ya cambió de estado. No se reenvió.'); return }
          if (latest.revision!==editor.publication.revision) throw new Error('La revisión cambió. Reabrí el Reel antes de editarlo.')
        }
        const content = { caption:els.instagramReelCaption.value.trim(),shareToFeed:els.instagramReelShareToFeed.checked,automation,
          ...(editor.verified?{videoObjectPath:editor.verified.objectPath,videoMimeType:editor.verified.mimeType,videoSizeBytes:editor.verified.sizeBytes}:{}) }
        if (!editor.reprogram) editor.publication = instagramMediaPlanPublication(p,editor.publication
          ? await request(basePath+'/'+encodeURIComponent(editor.publication.id),'PATCH',{...content,expectedRevision:editor.publication.revision})
          : await request(basePath,'POST',content),editor.publication?.id)
        if (!instagramMediaPlanEditorCurrent(p,editor)) return
        const publication = editor.publication
        if (destination!=='draft') editor.publication = instagramMediaPlanPublication(p,await request(basePath+'/'+encodeURIComponent(publication.id)+(destination==='now'?'/publish':'/schedule'),'POST',
          {expectedRevision:publication.revision,...(destination==='schedule'?{scheduledAt}:{})}),publication.id)
        if (!instagramMediaPlanEditorCurrent(p,editor)) return
        setInstagramReelProgress(100); setInstagramReelFeedback(destination==='draft'?'Borrador guardado.':destination==='schedule'?'Programación guardada.':'Publicación en cola; todavía no confirma publicación real.')
        await loadInstagramReels(); await instagramMediaPlanLoad()
      } catch { if (instagramMediaPlanEditorCurrent(p,editor)) setInstagramReelFeedback(editor.publication?'El borrador sigue guardado. No se confirmó el último paso; podés actualizar e intentar nuevamente.':'No se pudo guardar. Conservamos el archivo y tus cambios.','error') }
      finally { if (instagramMediaPlanEditorCurrent(p,editor)) { editor.saving=false; setButtonLoading(els.instagramReelSubmit,false); els.instagramReelSubmit.textContent='Guardar' } }
    }

    async function instagramMediaPlanAction(event) {
      const button = event.target.closest('[data-instagram-plan-action]')
      if (!button) return
      const p = instagramMediaPlanContext(), row = [...(p.data?.items||[]),...(p.data?.undatedItems||[])].find(item=>item.kind===button.dataset.kind && item.id===button.dataset.id)
      if (!row || p.action) return
      if (button.dataset.instagramPlanAction!=='cancel') {
        p.action=true
        try { return await instagramMediaPlanOpen(row,button.dataset.instagramPlanAction,button) }
        finally { if(instagramMediaPlanCurrent(p))p.action=false }
      }
      p.action=true
      try { await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-publications/'+encodeURIComponent(row.id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:row.revision}),signal:p.controller.signal}); if(instagramMediaPlanCurrent(p))await instagramMediaPlanLoad() }
      catch { if(instagramMediaPlanCurrent(p)){p.error='No se confirmó la cancelación. Actualizá el estado antes de reintentar.';instagramMediaPlanRender()} }
      finally { if(instagramMediaPlanCurrent(p))p.action=false }
    }

    function bindInstagramPlanningControls() {
      const nodes=instagramMediaPlanNodes()
      for(const body of [nodes.body,nodes.undated]){body.addEventListener('click',instagramMediaPlanAction);if(typeof instagramStoryAction==='function')body.addEventListener('click',instagramStoryAction)}
      nodes.refresh.addEventListener('click',()=>{instagramMediaPlanLoad();if(typeof instagramStoriesLoad==='function')instagramStoriesLoad()})
      nodes.more.addEventListener('click',()=>instagramMediaPlanLoad(true))
      document.getElementById('instagram-planning').addEventListener('click',event=>{
        const p=instagramMediaPlanContext(),view=event.target.closest('[data-instagram-plan-view]'),move=event.target.closest('[data-instagram-plan-move]'),day=event.target.closest('[data-instagram-plan-day]'),type=event.target.closest('[data-instagram-plan-type]')
        if(!p.zone){p.error='Configurá la zona del comercio en Ajustes.';return instagramMediaPlanRender()}
        if(day){p.day=p.day===day.dataset.instagramPlanDay?null:day.dataset.instagramPlanDay;return instagramMediaPlanRender()}
        if(!view&&!move&&!type)return
        if(p.loading){p.controller.abort();p.controller=new AbortController();p.loading=false;++p.sequence}
        if(type)p.publicationType=type.dataset.instagramPlanType
        if(view)p.view=view.dataset.instagramPlanView
        if(move){const amount=Number(move.dataset.instagramPlanMove);p.anchor=amount===0?instagramMediaPlanDate(new Date(),p.zone):instagramMediaPlanShift(instagramMediaPlanPeriod(p).first,p.view==='week'?amount*7:0,p.view==='week'?0:amount)}
        p.day=null;instagramMediaPlanLoad()
      })
      document.getElementById('instagram-reel-resolve-time').addEventListener('click',instagramMediaPlanResolve)
    }
`
