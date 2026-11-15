export const instagramStoriesStyles = `
    .instagram-stories {padding:18px;background:#fff;border:1px solid #dce3ef;border-radius:14px;display:grid;gap:12px;min-width:0}
    .instagram-stories-header {display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .instagram-stories h4,.instagram-stories p {margin:0;overflow-wrap:anywhere}
    .instagram-stories button,.instagram-story-editor button {min-height:40px;padding:10px 14px;border:1px solid #bfcee2;border-radius:8px;background:#fff;color:#243b63;cursor:pointer}
    .instagram-stories-header > div:last-child {display:flex;gap:8px;flex-wrap:wrap}
    .instagram-stories #instagram-story-new {background:#1664e9;border-color:#1664e9;color:#fff;font-weight:750}
    .instagram-story-filter {display:flex;align-items:center;gap:8px;color:#405176;font-size:13px;font-weight:650}
    .instagram-story-filter select {padding:9px;border:1px solid #bfcee2;border-radius:8px;background:#fff;color:#243b63;font:inherit}
    .instagram-story-status {display:inline-block;padding:4px 8px;border-radius:20px;background:#edf2f7;color:#405176;font-weight:700}
    .instagram-story-status:is([data-status=PUBLISHED],[data-status=MANUALLY_COMPLETED]) {background:#e2f5ea;color:#146244}
    .instagram-story-status[data-status=SCHEDULED] {background:#e6eeff;color:#244ab4}
    .instagram-story-status:is([data-status=FAILED],[data-status=UNKNOWN]) {background:#fbe9e5;color:#a23a30}
    .instagram-story-detail-frame {width:min(100%,200px);aspect-ratio:9/16;display:grid;place-items:center;margin-inline:auto;background:#e9eef7;border-radius:12px;overflow:hidden;text-align:center;color:#405176}
    .instagram-story-detail-frame :is(img,video) {width:100%;height:100%;max-height:none;object-fit:contain}
    .instagram-story-editor {box-sizing:border-box;width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:#fff;border-radius:16px;overflow:hidden;resize:none}
    .instagram-story-editor header,.instagram-story-editor footer {padding:16px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;flex-shrink:0}
    .instagram-story-editor footer {border-top:1px solid #e2e8f0;border-bottom:0;background:#f8fafc}
    .instagram-story-editor form {min-height:0;display:flex;flex-direction:column;overflow:hidden}
    .instagram-story-fields {overflow-y:auto;min-height:0;padding:20px;display:grid;gap:16px}
    .instagram-story-fields label {display:grid;gap:6px;font-weight:650;min-width:0}
    .instagram-story-fields :is(input,textarea,select) {box-sizing:border-box;width:100%;min-width:0;padding:10px;border:1px solid #bfcfe4;border-radius:8px;font:inherit}
    .instagram-story-fields select {height:auto;min-height:44px;line-height:1.5}
    .instagram-story-fields .instagram-story-check {display:flex;align-items:flex-start;gap:10px;font-weight:400}
    .instagram-story-check input[type=checkbox] {width:18px!important;flex:0 0 18px;max-width:18px;margin-top:3px}
    .instagram-story-preview {display:flex;align-items:center;justify-content:center;max-height:280px;overflow:hidden;background:#f1f5f9;border-radius:10px}
    .instagram-story-preview:has(img:not([hidden]),video:not([hidden])) {height:280px;min-height:280px}
    .instagram-story-preview :is(img,video) {object-fit:contain;max-width:100%;height:100%;max-height:280px}
    .instagram-story-time {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .instagram-story-feedback {overflow-wrap:anywhere;min-height:20px;margin:0;color:#314b70}
    .instagram-story-feedback[data-error=true] {color:#b42318}
    .instagram-stories :focus-visible,.instagram-story-editor :focus-visible {outline:3px solid #a5c7ff;outline-offset:2px}
    @media(max-width:720px){.instagram-stories{padding:12px}.instagram-story-fields{padding:14px}.instagram-story-editor header,.instagram-story-editor footer{padding:12px}.instagram-story-time{grid-template-columns:minmax(0,1fr)}.instagram-stories button,.instagram-story-editor button{min-height:44px}.instagram-story-editor footer button{flex:1 1 120px}}
`
export const instagramStoriesMarkup = `
          <section class="instagram-stories" aria-labelledby="instagram-stories-title">
            <div class="instagram-stories-header"><h4 id="instagram-stories-title">Historias de Instagram</h4><div><button id="instagram-story-refresh" type="button">Actualizar</button><button id="instagram-story-new" type="button">+ Nueva historia</button></div></div>
            <label class="instagram-story-filter">Estado<select id="instagram-story-status-filter"><option value="">Todos los estados</option></select></label>
            <p id="instagram-stories-feedback" role="status" aria-live="polite"></p>
            <div class="instagram-media-detail-layout">
              <div class="instagram-media-table-wrap"><table class="instagram-media-table instagram-media-primary-table"><thead><tr><th>Historia</th><th>Estado</th><th>Fecha y hora</th><th>Acciones</th></tr></thead><tbody id="instagram-stories-body"><tr><td colspan="4">Cargando historias&hellip;</td></tr></tbody></table></div>
              <aside class="instagram-media-detail" id="instagram-story-detail" aria-labelledby="instagram-story-detail-title" hidden></aside>
            </div>
          </section>
          <div class="dialog-backdrop" id="instagram-story-dialog" hidden>
            <div class="instagram-story-editor" role="dialog" aria-modal="true" aria-labelledby="instagram-story-title">
              <header><h3 id="instagram-story-title">Nueva historia</h3><button id="instagram-story-close" type="button" aria-label="Cerrar historia">Cerrar</button></header>
              <form id="instagram-story-form" novalidate><div class="instagram-story-fields">
                <label>Foto o video<input id="instagram-story-file" type="file" accept="image/jpeg,video/mp4,video/quicktime,.jpg,.jpeg,.mp4,.mov"></label>
                <small>Fotos JPEG hasta 8 MB y 20 megap&iacute;xeles (pol&iacute;tica del CRM). El formato y la compatibilidad final del video se comprueban al publicar.</small>
                <div class="instagram-story-preview"><img id="instagram-story-image" alt="Vista previa de la historia" hidden><video id="instagram-story-video" controls hidden></video></div>
                <label>Nota interna<textarea id="instagram-story-note" rows="3" maxlength="2200"></textarea></label><small>La nota ayuda a organizarte; no se agrega como texto dentro de la historia.</small>
                <label>Modalidad<select id="instagram-story-mode"><option value="MANUAL">Preparar y completar en Instagram</option><option value="AUTO">Publicaci&oacute;n autom&aacute;tica</option></select></label>
                <p id="instagram-story-capability"></p><label class="instagram-story-check"><input id="instagram-story-declaration" type="checkbox"><span>Como administrador, declaro que esta cuenta puede publicar historias y concedi&oacute; el permiso correspondiente. Instagram lo comprobar&aacute; al publicar.</span></label><button id="instagram-story-declare" type="button">Guardar habilitaci&oacute;n declarada</button>
                <label>Acci&oacute;n al guardar<select id="instagram-story-destination"><option value="draft">Guardar borrador</option><option value="now">Preparar o publicar ahora</option><option value="schedule">Programar horario</option></select></label>
                <div class="instagram-story-time"><label>Fecha del comercio<input id="instagram-story-date" type="date"></label><label>Hora del comercio<input id="instagram-story-time" type="time"></label></div>
                <button id="instagram-story-resolve" type="button">Verificar horario</button><label>Opci&oacute;n horaria<select id="instagram-story-time-options"><option value="">Eleg&iacute; un horario y verificalo</option></select></label>
                <label class="instagram-story-check"><input id="instagram-story-manual-confirm" type="checkbox"><span>Confirmo que complet&eacute; esta historia manualmente en Instagram. Se registrar&aacute; mi confirmaci&oacute;n, sin afirmar una verificaci&oacute;n de Instagram.</span></label>
                <label class="instagram-story-check" id="instagram-story-recover-label" hidden><input id="instagram-story-recover-confirm" type="checkbox"><span>Quiero preparar manualmente esta historia tras el rechazo de la publicaci&oacute;n autom&aacute;tica.</span></label><button id="instagram-story-recover" type="button" hidden>Pasar a preparaci&oacute;n manual</button><p class="instagram-story-feedback" id="instagram-story-feedback" role="status" aria-live="polite"></p>
              </div><footer><button type="button" id="instagram-story-cancel">Cerrar</button><button type="button" id="instagram-story-manual-complete" hidden>Registrar finalizaci&oacute;n manual</button><button type="submit" id="instagram-story-save">Guardar historia</button></footer></form>
            </div>
          </div>
`
export const instagramStoriesScript = String.raw`
    function instagramStoryNode(name) {
      return document.getElementById('instagram-story-'+name)
    }
    function instagramStoryContext() {
      if(state.instagramStories && (state.instagramStories.businessId!==state.businessId || state.instagramStories.zone!==state.business?.timezone))instagramStoriesReset()
      return state.instagramStories ||= {businessId:state.businessId,zone:state.business?.timezone,controller:new AbortController(),rows:[],sequence:0,loading:false,capability:null,editor:null}
    }
    function instagramStoryActive(p) {
      return state.instagramStories===p && state.businessId===p.businessId && state.marketingView==='instagram-reels' && els.appShell.dataset.section==='campaigns'
    }
    function instagramStoryFeedback(message,error=false) {
      const node=instagramStoryNode('feedback');node.textContent=message;node.dataset.error=String(error)
    }
    function instagramStoryClose() {
      const p=state.instagramStories,editor=p?.editor
      if(editor){editor.controller.abort();if(editor.preview)URL.revokeObjectURL(editor.preview);p.editor=null}
      instagramStoryNode('dialog')?.setAttribute('hidden','')
      if(editor?.origin?.isConnected)editor.origin.focus()
    }
    function instagramStoriesReset() {
      instagramStoryClose();state.instagramStories?.controller.abort();state.instagramStories=null
      instagramStoryNode('detail')?.setAttribute('hidden','')
      instagramStoryNode('status-filter').value=''
      document.getElementById('instagram-stories-body').innerHTML='<tr><td colspan="4">Cargando historias&hellip;</td></tr>'
      document.getElementById('instagram-stories-feedback').textContent=''
    }
    function instagramStoryCurrent(p,editor) {
      return instagramStoryActive(p) && p.editor===editor && !editor.controller.signal.aborted
    }
    async function instagramStoriesLoad() {
      const p=instagramStoryContext()
      if(p.loading)return
      const sequence=++p.sequence
      p.loading=true
      try{
        const base='/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories'
        const [rows,capability]=await Promise.all([getJson(base,{signal:p.controller.signal}),getJson(base+'/capability',{signal:p.controller.signal})])
        if(!instagramStoryActive(p)||sequence!==p.sequence)return
        if(!Array.isArray(rows))throw new Error('Respuesta inválida')
        if(p.capability && p.capability.accountId!==capability.accountId){instagramStoryClose();p.detailId=null}
        p.rows=rows;p.capability=capability;p.loaded=true;instagramStoriesRender()
      }catch{if(instagramStoryActive(p)){instagramStoriesRender();document.getElementById('instagram-stories-feedback').textContent='No se pudieron leer las historias guardadas.'}}
      finally{p.loading=false}
    }
    function instagramStoriesRender() {
      const p=instagramStoryContext(),filter=instagramStoryNode('status-filter'),statuses=[...new Set(p.rows.map(row=>row.status))]
      const status=statuses.includes(filter.value)?filter.value:''
      filter.innerHTML='<option value="">Todos los estados</option>'+statuses.map(item=>'<option value="'+instagramMediaHtml(item)+'">'+instagramMediaHtml(instagramStoryStatus(item))+'</option>').join('')
      filter.value=status
      const rows=status?p.rows.filter(row=>row.status===status):p.rows
      const selected=rows.find(row=>row.id===p.detailId)
      p.detailId=selected?.id
      document.getElementById('instagram-stories-feedback').textContent=p.zone?'Zona horaria: '+p.zone:''
      document.getElementById('instagram-stories-body').innerHTML=rows.map(row=>{
        const date=instagramStoryDate(row.publishedAt||row.manuallyCompletedAt||row.scheduledAt,p.zone)
        const status=instagramStoryStatus(row.status)
        const name=row.note||row.caption||'Historia sin nota'
        return '<tr data-selected="'+(row===selected)+'"><td><strong>'+instagramMediaHtml(name)+'</strong><small>'+ (row.mediaKind==='IMAGE'?'Foto':'Video')+'</small></td><td><span class="instagram-story-status" data-status="'+instagramMediaHtml(row.status)+'">'+instagramMediaHtml(status)+'</span></td><td>'+instagramMediaHtml(date)+'</td><td><button type="button" data-instagram-story-detail="'+instagramMediaHtml(row.id)+'" aria-pressed="'+(row===selected)+'">Ver detalle</button></td></tr>'
      }).join('')||'<tr><td colspan="4">Todav&iacute;a no hay historias preparadas.</td></tr>'
      instagramStoryRenderDetail(p,selected)
    }
    function instagramStoryDate(value,zone) {
      return value&&zone?new Intl.DateTimeFormat('es-AR',{timeZone:zone,dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Sin fecha'
    }
    function instagramStoryRenderDetail(p,row) {
      const panel=instagramStoryNode('detail')
      panel.hidden=!row
      if(!row){panel.innerHTML='';return}
      const name=row.note||row.caption||'Historia sin nota'
      const button=(action,label)=>'<button type="button" data-instagram-story-action="'+action+'" data-id="'+instagramMediaHtml(row.id)+'">'+label+'</button>'
      const detail=(label,value)=>'<div><dt>'+label+'</dt><dd>'+instagramMediaHtml(value)+'</dd></div>'
      panel.innerHTML='<h4 id="instagram-story-detail-title" tabindex="-1">'+instagramMediaHtml(name)+'</h4>'
        +'<div class="instagram-story-detail-frame" id="instagram-story-detail-frame">'+(row.videoAvailable?button('preview','Cargar vista previa'):'<p>Vista previa no disponible</p>')+'</div>'
        +'<dl class="instagram-media-secondary">'
        +detail('Estado',instagramStoryStatus(row.status))+detail('Modalidad',row.deliveryMode==='MANUAL'?'Manual':'Automática')
        +detail('Horario deseado',instagramStoryDate(row.scheduledAt,p.zone))+detail('Publicaci&oacute;n confirmada',instagramStoryDate(row.publishedAt,p.zone))
        +detail('Finalizaci&oacute;n manual',instagramStoryDate(row.manuallyCompletedAt,p.zone))+'</dl>'
        +'<div class="instagram-media-detail-actions">'+button('open','Abrir')
        +(row.status==='SCHEDULED'?button('cancel','Cancelar horario'):'')
        +(row.videoAvailable?button('download','Descargar archivo'):'')
        +(row.videoAvailable&&['DRAFT','CANCELLED','PUBLISHED','MANUALLY_COMPLETED','FAILED'].includes(row.status)?button('duplicate','Duplicar'):'')+'</div>'
    }
    async function instagramStoryLoadDetailMedia(p,id,button) {
      const row=p.rows.find(item=>item.id===id)
      if(!row?.videoAvailable||button.disabled)return
      button.disabled=true
      const current=()=>instagramStoryActive(p)&&p.detailId===id&&button.isConnected
      try{
        const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(id)+'/download',{signal:p.controller.signal})
        if(!current())return
        const url=new URL(result.url)
        if(url.protocol!=='https:'||url.username||url.password)throw new Error('Vista previa inválida')
        const photo=row.mediaKind==='IMAGE'
        const media=document.createElement(photo?'img':'video')
        if(photo)media.alt='Vista previa de la historia'
        else{media.controls=true;media.preload='metadata';media.playsInline=true}
        media.referrerPolicy='no-referrer'
        media.addEventListener('error',()=>{
          const frame=instagramStoryNode('detail-frame')
          if(frame?.contains(media))frame.textContent='No se pudo reproducir la vista previa.'
        },{once:true})
        media.src=url.href
        instagramStoryNode('detail-frame').replaceChildren(media)
      }catch{if(current())document.getElementById('instagram-stories-feedback').textContent='No se pudo cargar la vista previa.'}
      finally{button.disabled=false}
    }
    function instagramStoryStatus(status) {
      return ({DRAFT:'Borrador',READY:'Preparada / en cola',SCHEDULED:'Programada',CANCELLED:'Cancelada',PUBLISHED:'Publicada por Instagram',MANUALLY_COMPLETED:'Finalizada manualmente',UNKNOWN:'Resultado incierto: no reenviar',FAILED:'Fallo al publicar',PROCESSING:'Procesando',CREATING_CONTAINER:'Enviando archivo',PUBLISHING:'Publicando'})[status]||status
    }
    async function instagramStoryOpen(row=null,origin=null) {
      const p=instagramStoryContext();instagramStoryClose()
      const editor=p.editor={controller:new AbortController(),origin:origin||instagramStoryNode('new'),row:null,verified:null,file:null,preview:null,saving:false,loading:!!row,sequence:0}
      instagramStoryNode('form').reset();for(const name of ['file','note','mode','destination'])instagramStoryNode(name).disabled=false;instagramStoryNode('mode').value='MANUAL';instagramStoryNode('destination').value='draft';instagramStoryNode('note').value='';instagramStoryNode('file').value=''
      instagramStoryNode('image').hidden=true;instagramStoryNode('video').hidden=true;instagramStoryNode('dialog').removeAttribute('hidden');instagramStoryFeedback('')
      instagramStoryNode('capability').textContent=p.capability?.automatic?p.capability.message:'Automatización sin habilitación declarada. Podés preparar la historia manualmente.'
      instagramStoryNode('save').disabled=!!row;instagramStoryNode('manual-complete').hidden=true;instagramStoryNode('manual-confirm').checked=false;instagramStoryNode('recover').hidden=true;instagramStoryNode('recover-label').hidden=true;instagramStoryNode('recover-confirm').checked=false
      instagramStoryNode('title').textContent=row?'Historia guardada':'Nueva historia'
      instagramStoryNode('file').focus()
      if(!row)return
      try{
        const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(row.id),{signal:editor.controller.signal})
        if(!instagramStoryCurrent(p,editor))return
        if(result.businessId!==p.businessId || result.publicationType!=='STORY' || result.id!==row.id)throw new Error('Contexto cambiado')
        editor.row=result;instagramStoryNode('recover').hidden=!(result.status==='FAILED'&&result.deliveryMode==='AUTO');instagramStoryNode('recover-label').hidden=instagramStoryNode('recover').hidden;instagramStoryNode('note').value=result.note??result.caption;instagramStoryNode('mode').value=result.deliveryMode
        const editable=['DRAFT','CANCELLED'].includes(result.status);editor.reprogram=result.status==='SCHEDULED';if(editor.reprogram)instagramStoryNode('destination').value='schedule'
        for(const name of ['file','note','mode','destination'])instagramStoryNode(name).disabled=!editable
        instagramStoryNode('save').disabled=!(editable||editor.reprogram);instagramStoryNode('manual-complete').hidden=!(result.deliveryMode==='MANUAL'&&['DRAFT','CANCELLED','READY','SCHEDULED'].includes(result.status))
        instagramStoryFeedback(instagramStoryStatus(result.status)+(result.status==='UNKNOWN'?'. No se reenvía ni se marca como confirmada.':''))
      }catch{if(instagramStoryCurrent(p,editor))instagramStoryFeedback('No se pudo abrir esta historia. Cerrá y actualizá el listado.',true)}
      finally{if(instagramStoryCurrent(p,editor))editor.loading=false}
    }
    function instagramStoryPreview() {
      const p=instagramStoryContext(),editor=p.editor,file=instagramStoryNode('file').files?.[0]
      if(!editor)return
      if(editor.preview)URL.revokeObjectURL(editor.preview)
      editor.preview=null;editor.verified=null;editor.file=null
      for(const type of ['image','video']){instagramStoryNode(type).hidden=true;instagramStoryNode(type).removeAttribute('src')}
      if(!file)return
      if(!['image/jpeg','video/mp4','video/quicktime'].includes(file.type)||(file.type==='image/jpeg'&&file.size>8*1024*1024)){instagramStoryFeedback('Elegí una foto JPEG de hasta 8 MB o un video MP4/MOV.',true);return}
      editor.preview=URL.createObjectURL(file)
      const node=instagramStoryNode(file.type==='image/jpeg'?'image':'video');node.src=editor.preview;node.hidden=false
    }
    async function instagramStoryResolve() {
      const p=instagramStoryContext(),editor=p.editor,select=instagramStoryNode('time-options')
      if(!editor)return
      const date=instagramStoryNode('date').value,time=instagramStoryNode('time').value,sequence=++editor.sequence
      select.value='';select.innerHTML='<option value="">Verificando...</option>'
      try{
        if(!/^\d{2}:\d{2}$/.test(time))throw new Error('Horario incompleto')
        const [h,m]=time.split(':').map(Number),result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-calendar/time-options?'+new URLSearchParams({date,minute:String(h*60+m)}),{signal:editor.controller.signal})
        if(!instagramStoryCurrent(p,editor)||sequence!==editor.sequence)return
        if(result.timezone!==p.zone)throw new Error('Zona modificada')
        editor.wall=date+'T'+time
        select.innerHTML='<option value="">Eleg&iacute; un horario</option>'+result.candidates.map(item=>'<option value="'+instagramMediaHtml(item.instant)+'">'+instagramMediaHtml(time+' · '+item.offset+' · '+result.timezone)+'</option>').join('')
        if(!result.requiresChoice&&result.candidates.length===1)select.value=result.candidates[0].instant
        instagramStoryFeedback(result.requiresChoice?'Ese horario ocurre dos veces. Elegí el desfase explícitamente.':'Horario comprobado en '+result.timezone+'.')
      }catch{if(instagramStoryCurrent(p,editor)){select.innerHTML='<option value="">Horario no v&aacute;lido</option>';instagramStoryFeedback('El horario no existe o no pudo comprobarse. Elegí otra opción.',true);select.focus()}}
    }
    async function instagramStorySubmit(event) {
      event.preventDefault()
      const p=instagramStoryContext(),editor=p.editor
      if(!editor||editor.saving||editor.loading||!instagramStoryCurrent(p,editor))return
      const file=instagramStoryNode('file').files?.[0],mode=instagramStoryNode('mode').value,destination=instagramStoryNode('destination').value
      const fail=(message,name)=>{instagramStoryFeedback(message,true);instagramStoryNode(name).focus()}
      if(!editor.row&&!editor.verified&&(!file||!['image/jpeg','video/mp4','video/quicktime'].includes(file.type)))return fail('Seleccioná una foto JPEG o un video MP4/MOV.','file')
      if(mode==='AUTO'&&!p.capability?.automatic)return fail('Un administrador debe guardar la habilitación declarada antes de elegir publicación automática.','mode')
      const scheduledAt=instagramStoryNode('time-options').value
      if(destination==='schedule'&&(!scheduledAt||editor.wall!==instagramStoryNode('date').value+'T'+instagramStoryNode('time').value))return fail('Verificá y elegí la opción horaria del comercio.','time-options')
      editor.saving=true;instagramStoryNode('save').disabled=true
      const base='/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories',request=(url,method,body)=>getJson(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:editor.controller.signal})
      try{
        if(!editor.reprogram&&file&&editor.file!==file){
          const upload=await request(base+'/uploads','POST',{mimeType:file.type,sizeBytes:file.size})
          if(!instagramStoryCurrent(p,editor))return
          if(!upload.uploadUrl||new URL(upload.uploadUrl).protocol!=='https:'||!upload.objectPath)throw new Error('Carga inválida')
          await uploadInstagramReelFile(upload,file,editor.controller.signal,{progress:()=>{},feedback:message=>{if(instagramStoryCurrent(p,editor))instagramStoryFeedback(message)}})
          if(!instagramStoryCurrent(p,editor))return
          const verified=await request(base+'/uploads/verify','POST',{objectPath:upload.objectPath,mimeType:file.type,sizeBytes:file.size})
          if(!verified.verified||verified.objectPath!==upload.objectPath||verified.mimeType!==file.type||verified.sizeBytes!==file.size)throw new Error('Archivo no verificado')
          editor.verified=verified;editor.file=file
        }
        if(!instagramStoryCurrent(p,editor))return
        if(editor.row){const current=await getJson(base+'/'+encodeURIComponent(editor.row.id),{signal:editor.controller.signal});if(!instagramStoryCurrent(p,editor))return;if(!(editor.reprogram?current.status==='SCHEDULED':['DRAFT','CANCELLED'].includes(current.status))||current.revision!==editor.row.revision)throw new Error('La revisión cambió')}
        const payload={note:instagramStoryNode('note').value.trim(),deliveryMode:mode,...(editor.verified?{objectPath:editor.verified.objectPath,mimeType:editor.verified.mimeType,sizeBytes:editor.verified.sizeBytes,mediaKind:editor.verified.mimeType==='image/jpeg'?'IMAGE':'VIDEO'}:{})}
        const saved=editor.reprogram?editor.row:await request(editor.row?base+'/'+encodeURIComponent(editor.row.id):base,editor.row?'PATCH':'POST',{...payload,...(editor.row?{expectedRevision:editor.row.revision}:{})})
        if(!instagramStoryCurrent(p,editor))return
        if(saved.businessId!==p.businessId||saved.publicationType!=='STORY')throw new Error('Respuesta fuera de contexto')
        editor.row=saved
        if(destination!=='draft')editor.row=await request(base+'/'+encodeURIComponent(saved.id)+(destination==='schedule'?'/schedule':'/publish'),'POST',{expectedRevision:saved.revision,...(destination==='schedule'?{scheduledAt}:{})})
        if(!instagramStoryCurrent(p,editor))return
        instagramStoryFeedback(destination==='draft'?'Borrador guardado.':destination==='schedule'?'Horario guardado. Las historias manuales requieren completar el paso en Instagram.':mode==='MANUAL'?'Historia preparada. Descargala y completala en Instagram.':'Historia en cola: todavía no confirma una publicación real.')
        instagramStoryNode('manual-complete').hidden=mode!=='MANUAL';await instagramStoriesLoad();await instagramMediaPlanLoad()
      }catch{if(instagramStoryCurrent(p,editor))instagramStoryFeedback(editor.row?'El borrador sigue guardado. No se confirmó el último paso. Actualizá el estado antes de reintentar.':'No se pudo guardar. Conservamos el archivo y tus cambios.',true)}
      finally{if(instagramStoryCurrent(p,editor)){editor.saving=false;instagramStoryNode('save').disabled=false}}
    }
    async function instagramStoryDeclare() {
      const p=instagramStoryContext(),editor=p.editor
      if(!editor||editor.saving)return
      if(!instagramStoryNode('declaration').checked){instagramStoryFeedback('Marcá la declaración explícita del administrador.',true);return}
      editor.saving=true
      try{const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/capability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,acknowledged:true}),signal:editor.controller.signal});if(instagramStoryCurrent(p,editor)){p.capability=result;instagramStoryNode('capability').textContent=result.message;instagramStoryFeedback('Habilitación declarada guardada. Elegí modalidad y acción; todavía no se publicó nada.')}}
      catch{if(instagramStoryCurrent(p,editor))instagramStoryFeedback('No se pudo guardar la habilitación. Sólo un administrador puede declararla.',true)}
      finally{if(instagramStoryCurrent(p,editor))editor.saving=false}
    }
    async function instagramStoryAction(event) {
      const button=event.target.closest('[data-instagram-story-action]')
      if(!button)return
      const p=instagramStoryContext(),id=button.dataset.id,action=button.dataset.instagramStoryAction
      if(action==='open')return instagramStoryOpen({id},button)
      if(action==='preview')return instagramStoryLoadDetailMedia(p,id,button)
      if(p.action)return
      p.action=true
      try{
        const row=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(id),{signal:p.controller.signal})
        if(!instagramStoryActive(p))return
        if(action==='download'){const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(id)+'/download',{signal:p.controller.signal});if(!instagramStoryActive(p))return;const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.download='historia';link.click()}
        if(action==='duplicate'){const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(id)+'/duplicate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:row.revision}),signal:p.controller.signal});if(!instagramStoryActive(p))return;await instagramStoryOpen(result.publication,button);if(result.requiresFile){instagramStoryNode('note').value=result.content.caption||'';instagramStoryNode('mode').value=result.content.deliveryMode||'MANUAL';instagramStoryFeedback('La copia necesita su propio archivo. Seleccionalo antes de guardar.')}}
        if(action==='cancel'){await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:row.revision}),signal:p.controller.signal});if(instagramStoryActive(p)){await instagramStoriesLoad();await instagramMediaPlanLoad()}}
      }catch{if(instagramStoryActive(p))document.getElementById('instagram-stories-feedback').textContent='No se confirmó la acción. Actualizá el estado antes de reintentar.'}
      finally{if(instagramStoryActive(p))p.action=false}
    }
    async function instagramStoryComplete() {
      const p=instagramStoryContext(),editor=p.editor
      if(!editor?.row||editor.saving)return
      if(!instagramStoryNode('manual-confirm').checked){instagramStoryFeedback('Confirmá que completaste la historia en Instagram.',true);instagramStoryNode('manual-confirm').focus();return}
      editor.saving=true
      try{const result=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(editor.row.id)+'/complete-manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:editor.row.revision,confirmed:true}),signal:editor.controller.signal});if(instagramStoryCurrent(p,editor)){editor.row=result;instagramStoryFeedback('Finalización manual registrada. No equivale a una verificación de Instagram.');instagramStoryNode('manual-complete').hidden=true;instagramStoryNode('save').disabled=true;await instagramStoriesLoad();await instagramMediaPlanLoad()}}
      catch{if(instagramStoryCurrent(p,editor))instagramStoryFeedback('No se pudo registrar la finalización. Conservamos la historia y su estado anterior.',true)}
      finally{if(instagramStoryCurrent(p,editor))editor.saving=false}
    }
    async function instagramStoryRecover() {
      const p=instagramStoryContext(),editor=p.editor
      if(!editor?.row||editor.saving)return
      if(!instagramStoryNode('recover-confirm').checked){instagramStoryFeedback('Confirmá que querés preparar la historia manualmente.',true);return}
      editor.saving=true
      try{const row=await getJson('/businesses/'+encodeURIComponent(p.businessId)+'/instagram-stories/'+encodeURIComponent(editor.row.id)+'/prepare-manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:editor.row.revision,confirmed:true}),signal:editor.controller.signal});if(instagramStoryCurrent(p,editor))await instagramStoryOpen(row,editor.origin)}
      catch{if(instagramStoryCurrent(p,editor))instagramStoryFeedback('No se confirmó el cambio. Un resultado incierto no puede convertirse automáticamente.',true)}
      finally{if(instagramStoryCurrent(p,editor))editor.saving=false}
    }
    function bindInstagramStoriesControls() {
      instagramStoryNode('new').addEventListener('click',event=>instagramStoryOpen(null,event.currentTarget))
      instagramStoryNode('refresh').addEventListener('click',instagramStoriesLoad)
      for(const name of ['close','cancel'])instagramStoryNode(name).addEventListener('click',instagramStoryClose)
      instagramStoryNode('file').addEventListener('change',instagramStoryPreview)
      instagramStoryNode('form').addEventListener('submit',instagramStorySubmit)
      instagramStoryNode('declare').addEventListener('click',instagramStoryDeclare)
      instagramStoryNode('recover').addEventListener('click',instagramStoryRecover)
      instagramStoryNode('resolve').addEventListener('click',instagramStoryResolve)
      instagramStoryNode('manual-complete').addEventListener('click',instagramStoryComplete)
      instagramStoryNode('status-filter').addEventListener('change',instagramStoriesRender)
      instagramStoryNode('detail').addEventListener('click',instagramStoryAction)
      document.getElementById('instagram-stories-body').addEventListener('click',event=>{
        const button=event.target.closest('[data-instagram-story-detail]')
        if(!button)return
        const p=instagramStoryContext()
        p.detailId=button.dataset.instagramStoryDetail
        instagramStoriesRender()
        instagramStoryNode('detail-title')?.focus()
      })
      instagramStoryNode('dialog').addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();instagramStoryClose();return}
        if(event.key!=='Tab')return
        const controls=[...instagramStoryNode('dialog').querySelectorAll('button,input,select,textarea')].filter(node=>!node.disabled&&!node.hidden&&node.getClientRects().length)
        if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus()}
        else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus()}
      })
    }
`
