export const workshopJobsMarkup = `
<style>
#wj-backdrop{z-index:95;background:#14213988;backdrop-filter:blur(3px)}
#wj-backdrop .wj-dialog{width:min(1000px,100%);max-width:calc(100vw - 36px);max-height:calc(100dvh - 36px);min-width:min(650px,90vw);resize:both;overflow:hidden;border:1px solid #ccd5e3;border-radius:14px;display:flex;flex-direction:column;background:white;color:#17213a}
.wj-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #dce3ee;flex-shrink:0}.wj-header h2{margin:0;font-size:19px}.wj-header p{margin:5px 0 0;font-size:13px;color:#607089}
#wj-close{width:40px;height:40px;border:2px solid #aebccd;border-radius:8px;background:#f1f5f9;color:#23324b;font-size:25px}#wj-close:hover{background:#fee2e2;color:#b91c1c;border-color:#dc2626}
#wj-form{min-height:0;display:flex;flex-direction:column;overflow:hidden}.wj-body{padding:20px;overflow:auto;min-height:0;display:grid;gap:18px}.wj-fields{display:grid;grid-template-columns:1fr 1fr 1.5fr;gap:14px}.wj-fields label,.wj-note{display:grid;gap:6px;font-size:12px;font-weight:700;color:#52617a}.wj-body input,.wj-body select{height:40px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;min-width:0;width:100%;background:white;color:#17213a}.wj-body input:focus{outline:2px solid #93c5fd}.wj-body h3{font-size:14px;margin:0 0 10px}.wj-shortcuts{display:flex;flex-wrap:wrap;gap:8px}.wj-shortcuts button{padding:9px 12px;border:1px solid #b9ccef;border-radius:8px;background:#eff6ff;color:#17499a;font-weight:650;cursor:pointer}.wj-table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:8px}.wj-lines{width:100%;min-width:650px;border-collapse:collapse}.wj-lines th{padding:10px;background:#f1f5f9;font-size:12px;text-align:left}.wj-lines td{padding:7px;border-top:1px solid #e2e8f0}.wj-lines th:first-child{width:75px}.wj-lines th:nth-child(3),.wj-lines th:nth-child(4){width:145px}.wj-lines button{border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:7px;padding:7px 10px}.wj-note textarea{padding:10px;border:1px solid #cbd5e1;border-radius:8px;min-height:65px;width:100%;resize:vertical}.wj-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 22px;border-top:1px solid #dce3ee;background:#f8fafc;flex-shrink:0}.wj-footer strong{font-size:18px}.wj-feedback{color:#b91c1c;margin:0;font-size:13px}.wj-help{font-size:12px;color:#64748b;margin:6px 0}.wj-config{padding:14px;background:#f8fafc;border:1px solid #dbe3ef;border-radius:9px}.wj-config[hidden]{display:none}.wj-config-list{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.wj-config-list button{padding:6px 9px}.wj-config-editor{display:grid;grid-template-columns:1fr 2fr 70px 70px;gap:10px}.wj-config-editor label{font-size:12px;display:grid;gap:5px}.wj-record{margin-top:20px}.wj-record h2{font-size:19px}.wj-record .workshop-toolbar{margin:12px 0}.wj-readonly .wj-remove{display:none}
#wj-backdrop .wj-dialog{--wj-scale:1;height:min(680px,calc(100dvh - 36px));min-height:min(400px,calc(100dvh - 36px))}
#wj-form{flex:1}.wj-body{flex:1;align-content:start;padding:calc(20px * var(--wj-scale));gap:calc(18px * var(--wj-scale))}
.wj-body input,.wj-body select{height:var(--wj-field-height,40px);font-size:var(--wj-font-size,14px);padding:calc(8px * var(--wj-scale))}.wj-body textarea{font-size:var(--wj-font-size,14px);min-height:calc(65px * var(--wj-scale))}
.wj-header{padding:calc(16px * var(--wj-scale)) calc(20px * var(--wj-scale))}.wj-header h2{font-size:calc(19px * var(--wj-scale))}.wj-header p,.wj-feedback{font-size:calc(13px * var(--wj-scale))}
.wj-fields{gap:calc(14px * var(--wj-scale))}.wj-fields label,.wj-note,.wj-help,.wj-lines th,.wj-config-editor label,.wj-config>label{font-size:calc(12px * var(--wj-scale))}
.wj-body h3{font-size:calc(14px * var(--wj-scale))}.wj-shortcuts{gap:calc(8px * var(--wj-scale))}
#wj-backdrop button{font-size:calc(13px * var(--wj-scale));padding:calc(9px * var(--wj-scale)) calc(12px * var(--wj-scale))}
#wj-backdrop #wj-close{width:calc(40px * var(--wj-scale));height:calc(40px * var(--wj-scale));font-size:calc(25px * var(--wj-scale));padding:0;flex-shrink:0}
.wj-lines td{padding:calc(7px * var(--wj-scale))}.wj-lines th{padding:calc(10px * var(--wj-scale))}.wj-lines th:first-child{width:calc(75px * var(--wj-scale))}.wj-lines th:nth-child(3),.wj-lines th:nth-child(4){width:calc(145px * var(--wj-scale))}
.wj-config{padding:calc(14px * var(--wj-scale))}.wj-footer{font-size:calc(14px * var(--wj-scale));padding:calc(14px * var(--wj-scale)) calc(22px * var(--wj-scale))}.wj-footer strong{font-size:calc(18px * var(--wj-scale))}
@media(max-width:650px){.wj-fields,.wj-config-editor{grid-template-columns:1fr}.wj-body{padding:14px}#wj-backdrop .wj-dialog{resize:none;min-width:0;width:100%!important;height:auto!important;--wj-field-height:40px!important;--wj-font-size:14px!important}.wj-header{padding:12px}.wj-footer{padding:12px}}
#wp-backdrop{z-index:97;background:#14213988;backdrop-filter:blur(3px)}#wp-backdrop .wp-dialog{width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #ccd5e3;border-radius:14px;background:#fff;color:#17213a;box-shadow:0 24px 64px #0f172a38}#wp-backdrop .wj-header{padding:22px 26px 18px}#wp-backdrop .wj-header p{margin-top:7px}#wp-close{width:40px;height:40px;padding:0;border:2px solid #aebccd;border-radius:8px;background:#f1f5f9;color:#23324b;font-size:25px}#wp-close:hover{background:#fee2e2;color:#b91c1c;border-color:#dc2626}.wp-body{min-height:0;padding:26px;display:grid;gap:20px;overflow:auto}.wp-editor{display:grid;gap:22px}.wp-editor label{display:grid;gap:9px;color:#52617a;font-size:12px;font-weight:750}.wp-editor input{height:48px;padding:10px 13px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}.wp-editor input:focus{outline:2px solid #93c5fd}.wp-form-actions{display:flex;justify-content:flex-end;gap:12px;padding-top:2px}.wp-table{width:100%;border-collapse:collapse}.wp-table th,.wp-table td{padding:14px 16px;text-align:left;border-bottom:2px solid #d3dbe7}.wp-table th{color:#52617a;background:#eef2f7;font-size:11px;text-transform:uppercase}.wp-actions{display:flex;justify-content:flex-end;gap:8px}.wp-actions button{min-height:38px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-weight:700}.wp-actions .danger{color:#b91c1c;border-color:#fecaca}.wp-actions .success{color:#166534;border-color:#bbf7d0}.wp-status{display:inline-flex;padding:5px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:750}.wp-status.inactive{background:#f1f5f9;color:#64748b}.wp-empty{padding:32px;text-align:center;color:#64748b}
@media(max-width:650px){.wp-editor{grid-template-columns:1fr}.wp-body{padding:14px}}
</style>
<div class="dialog-backdrop" id="wj-backdrop" hidden>
 <section class="wj-dialog" role="dialog" aria-modal="true" aria-labelledby="wj-title">
  <header class="wj-header"><div><h2 id="wj-title">Nuevo trabajo</h2><p id="wj-vehicle"></p></div><button id="wj-close" type="button" aria-label="Cerrar ficha">&times;</button></header>
  <form id="wj-form"><div class="wj-body">
   <div class="wj-fields"><label>Fecha<input id="wj-date" type="date" required></label><label>Kilometraje<input id="wj-mileage" type="number" min="0" max="10000000" required></label><label>Realizado por<select id="wj-responsible" required><option value="">Seleccion&aacute; un trabajador</option></select></label></div>
   <div id="wj-tools"><h3>Agregar tareas r&aacute;pidas</h3><div class="wj-shortcuts" id="wj-shortcuts"></div><p class="wj-help">Cada clic agrega una fila editable. El responsable se elige desde Personal.</p><button class="secondary" id="wj-config-toggle" type="button">Configurar botones</button>
   <div class="wj-config" id="wj-config" hidden>
    <h3>Botones de este taller</h3><p class="wj-help">Seleccion&aacute; cualquier bot&oacute;n para editarlo o quitarlo, incluidos los iniciales. No se modifican las fichas anteriores.</p>
    <div id="wj-config-list" class="wj-config-list"></div>
    <p id="wj-sc-status" class="wj-help" role="status"></p><input id="wj-shortcut-id" type="hidden">
    <div class="wj-config-editor"><label>Nombre del bot&oacute;n<input id="wj-sc-name" maxlength="60"></label><label>Texto que agrega a la ficha<input id="wj-sc-description" maxlength="300"></label><label>Cantidad<input id="wj-sc-quantity" type="number" value="1" min="1" max="999"></label><label>Orden<input id="wj-sc-position" type="number" value="0" min="0"></label></div>
    <input id="wj-sc-active" type="hidden" value="true">
    <div class="wj-shortcuts"><button type="button" id="wj-sc-save">Guardar bot&oacute;n</button><button type="button" id="wj-sc-remove" hidden>Quitar bot&oacute;n</button></div>
   </div></div>
   <div><div class="wj-table-wrap"><table class="wj-lines"><thead><tr><th>Cant.</th><th>Descripci&oacute;n</th><th>Repuestos / unidad</th><th>Mano de obra / unidad</th><th></th></tr></thead><tbody id="wj-lines"></tbody></table></div><p class="wj-help">Importes opcionales en pesos. El total multiplica cada importe por su cantidad; vac&iacute;o significa sin cotizar.</p></div>
   <label class="wj-note">Observaciones<textarea id="wj-notes" maxlength="4000"></textarea></label><p class="wj-feedback" id="wj-error" role="status"></p>
  </div><footer class="wj-footer"><div>Total cargado: <strong id="wj-total">$ 0</strong></div><button class="primary" id="wj-save" type="submit">Guardar trabajo</button></footer></form>
 </section>
</div>
<div class="dialog-backdrop" id="wp-backdrop" hidden>
 <section class="wp-dialog" role="dialog" aria-modal="true" aria-labelledby="wp-title">
  <header class="wj-header"><div><h2 id="wp-title">Agregar trabajador</h2><p>Este nombre aparecer&aacute; al elegir qui&eacute;n realiz&oacute; un trabajo.</p></div><button id="wp-close" type="button" aria-label="Cerrar formulario">&times;</button></header>
  <div class="wp-body">
   <form id="wp-form" class="wp-editor"><input id="wp-id" type="hidden"><label>Nombre del trabajador<input id="wp-name" maxlength="100" autocomplete="off" required></label><div class="wp-form-actions"><button class="secondary" id="wp-cancel" type="button">Cancelar</button><button class="primary" id="wp-save" type="submit">Agregar trabajador</button></div></form>
   <p class="wj-feedback" id="wp-feedback" role="status"></p>
  </div>
 </section>
</div>`

export const workshopJobsScript = String.raw`
    const wj = (id) => document.getElementById('wj-' + id)
    const wjDialog = wj('backdrop').querySelector('.wj-dialog')
    function wjRestoreSize() {
      try { const size=JSON.parse(localStorage.getItem('workshop-job-dialog-size')||'null');if(size&&Number.isFinite(size.width)&&Number.isFinite(size.height)){wjDialog.style.width=Math.min(Math.max(650,size.width),innerWidth-36)+'px';wjDialog.style.height=Math.min(Math.max(400,size.height),innerHeight-36)+'px'} } catch {}
    }
    new ResizeObserver(()=>{
      if(wj('backdrop').hidden)return
      if(innerWidth<=650){wjDialog.style.setProperty('--wj-scale','1');return}
      const {width,height}=wjDialog.getBoundingClientRect()
      const baseWidth=Math.min(1000,innerWidth-36),baseHeight=Math.min(680,innerHeight-36)
      const scale=Math.max(1,Math.min(1.6,Math.max(width/baseWidth,height/baseHeight)))
      wjDialog.style.setProperty('--wj-scale',String(scale))
      wjDialog.style.setProperty('--wj-field-height',Math.round(40*scale)+'px')
      wjDialog.style.setProperty('--wj-font-size',Math.round(14*scale)+'px')
      try{localStorage.setItem('workshop-job-dialog-size',JSON.stringify({width,height}))}catch{}
    }).observe(wjDialog)
    let wjVehicleId = null, wjCatalog = [], wjSaving = false, wjReadOnly = false, wjBusinessId = null
    function wjMoney(cents) { return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(cents/100) }
    function wjQuery() { return '?businessId=' + encodeURIComponent(state.businessId) }
    function wjDateToday() { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
    if(!wj('filter-date').value) wj('filter-date').value=wjDateToday()
    function wjAddLine(description='', quantity=1, parts='', labor='') {
      const row = document.createElement('tr')
      row.innerHTML = '<td><input aria-label="Cantidad" data-wj-field="quantity" type="number" min="1" max="999" required></td><td><input aria-label="Descripcion" data-wj-field="description" maxlength="300" required></td><td><input aria-label="Repuestos por unidad" data-wj-field="parts" inputmode="decimal" placeholder="Opcional"></td><td><input aria-label="Mano de obra por unidad" data-wj-field="labor" inputmode="decimal" placeholder="Opcional"></td><td><button type="button" class="wj-remove" aria-label="Quitar tarea">&times;</button></td>'
      for(const [field,value] of Object.entries({description,quantity,parts,labor})) row.querySelector('[data-wj-field="'+field+'"]').value = value
      wj('lines').appendChild(row); wjTotal()
    }
    function wjLines() { return Array.from(wj('lines').rows).map(row => Object.fromEntries(Array.from(row.querySelectorAll('input')).map(input => [input.dataset.wjField,input.value]))) }
    function wjTotal() { let total=0; for(const line of wjLines()) total += Number(line.quantity||0)*(Math.round(Number(String(line.parts||0).replace(',','.'))*100)+Math.round(Number(String(line.labor||0).replace(',','.'))*100)); wj('total').textContent = Number.isFinite(total) ? wjMoney(total) : 'Revisar importes' }
    function wjRenderCatalog() {
      wj('shortcuts').innerHTML = wjCatalog.filter(x=>x.active).map(x=>'<button type="button" data-wj-custom="'+escapeHtml(x.id)+'">+ '+escapeHtml(x.name)+'</button>').join('') + '<button type="button" data-wj-blank>+ Otra tarea</button>'
      wj('config-list').innerHTML = wjCatalog.filter(x=>x.active).map(x=>'<button class="secondary" type="button" data-wj-edit="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+'</button>').join('')
    }
    function wjNewShortcut() { wj('shortcut-id').value='';wj('sc-name').value='';wj('sc-description').value='';wj('sc-quantity').value='1';wj('sc-position').value=String(Math.min(10000,Math.max(0,...wjCatalog.map(x=>x.position))+1));wj('sc-active').checked=true;wj('sc-remove').hidden=true;wj('sc-status').textContent='Nuevo bot\u00f3n: complet\u00e1 el nombre y el texto, y presion\u00e1 Guardar bot\u00f3n.' }
    function wjSetPerformerOptions(items, selectedId='', readOnly=false) {
      if(readOnly&&!selectedId){wj('responsible').innerHTML='<option value="">Sin registro</option>';return}
      wj('responsible').innerHTML=(readOnly?'':'<option value="">Seleccion&aacute; un trabajador</option>')+items.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+(x.active===false?' (inactivo)':'')+'</option>').join('')
      wj('responsible').value=selectedId
    }
    async function openWorkshopJobForm(vehicle, record=null) {
      wjBusinessId = state.businessId; wjVehicleId=vehicle.id; wjReadOnly=Boolean(record)
      wjCatalog=[];wjRenderCatalog();wjSetPerformerOptions([])
      wj('form').reset();wj('lines').innerHTML='';wj('error').textContent='';wj('config').hidden=true
      wj('title').textContent=record?'Trabajo realizado':'Nuevo trabajo';wj('vehicle').textContent=vehicle.plate+' · '+vehicle.model
      wj('date').value=record?.date||wjDateToday();wj('mileage').value=record?.mileage??vehicle.currentMileage??'';wj('notes').value=record?.notes||''
      wj('tools').hidden=wjReadOnly;wj('save').hidden=wjReadOnly;wj('form').classList.toggle('wj-readonly',wjReadOnly)
      for(const field of ['date','mileage','responsible','notes']) wj(field).disabled=wjReadOnly
      wj('backdrop').hidden=false
      wjRestoreSize();wj('close').focus()
      if(record) { wjSetPerformerOptions(record.performerId?[{id:record.performerId,name:record.responsible||'Sin registro'}]:[],record.performerId||'',true);for(const line of record.lines) wjAddLine(line.description,line.quantity,line.partsCents==null?'':(line.partsCents/100).toFixed(2),line.laborCents==null?'':(line.laborCents/100).toFixed(2)); for(const el of wj('lines').querySelectorAll('input')) el.disabled=true; return }
      wjTotal();wjNewShortcut()
      try {
        const business=wjBusinessId
        const [performers,catalog]=await Promise.all([getJson('/workshop/performers'+wjQuery()),getJson('/workshop/shortcuts'+wjQuery())])
        if(business!==state.businessId||wj('backdrop').hidden)return
        wjCatalog=catalog;wjRenderCatalog();wjSetPerformerOptions(performers)
      } catch(e) {wj('error').textContent=e.message}
    }
    const wjVehicleHistory={vehicleId:null,records:[],nextOffset:0,hasMore:false,loading:false}
    function wjRenderHistory(host,records,isVehicleHistory=false){
        if(!records.length){host.innerHTML='<div class="workshop-empty"><p>No hay trabajos registrados para esta consulta.</p></div>';return}
        host.innerHTML='<div class="workshop-table-shell"><table class="workshop-vehicle-table"><thead><tr><th>Fecha</th><th>Patente</th><th>KM</th><th>Realizado por</th><th>Tareas</th><th>Total cargado</th><th></th></tr></thead><tbody>'+records.map((r,i)=>'<tr><td>'+escapeHtml(r.date.split('-').reverse().join('/'))+'</td><td><button class="secondary" type="button" data-wj-auto="'+i+'">'+escapeHtml(r.vehicle.plate)+'</button></td><td>'+new Intl.NumberFormat('es-AR').format(r.mileage)+'</td><td>'+escapeHtml(r.responsible||'Sin registro')+'</td><td>'+escapeHtml(r.lines.map(x=>x.description).join(', '))+'</td><td>'+wjMoney(r.totalCents)+'</td><td><button class="secondary" type="button" data-wj-record="'+i+'">Ver ficha</button></td></tr>').join('')+'</tbody></table></div>'+(isVehicleHistory?'<div class="wp-empty" id="wj-history-status" role="status">'+(wjVehicleHistory.hasMore?'':'No hay m&aacute;s trabajos anteriores.')+'</div>':'')
        host.querySelectorAll('tbody tr').forEach((row,index)=>{row.dataset.wjRow=String(index);row.tabIndex=0;row.setAttribute('aria-label','Ver ficha '+records[index].vehicle.plate+' '+records[index].date)})
        host.onclick=async(event)=>{
          const auto=event.target.closest('[data-wj-auto]')
          if(auto){setSection('autos');await openWorkshopVehicle(records[Number(auto.dataset.wjAuto)].vehicleId);return}
          const row=event.target.closest('[data-wj-row]')
          if(row){const record=records[Number(row.dataset.wjRow)];await openWorkshopJobForm(record.vehicle,record)}
        }
        host.onkeydown=async(event)=>{
          if(event.target.matches('[data-wj-row]')&&(event.key==='Enter'||event.key===' ')){
            event.preventDefault();const record=records[Number(event.target.dataset.wjRow)];await openWorkshopJobForm(record.vehicle,record)
          }
        }
    }
    async function loadWorkshopJobHistory(vehicleId=null,options={}) {
      const business=state.businessId
      const host=vehicleId?document.getElementById('wj-history'):document.getElementById('wj-all-list')
      if(!host)return
      if(vehicleId){
        const append=Boolean(options.append)
        if(wjVehicleHistory.loading||(append&&!wjVehicleHistory.hasMore))return
        if(!append||wjVehicleHistory.vehicleId!==vehicleId){Object.assign(wjVehicleHistory,{vehicleId,records:[],nextOffset:0,hasMore:false})}
        wjVehicleHistory.loading=true
        const status=document.getElementById('wj-history-status')
        if(append&&status)status.innerHTML='<span class="spinner" aria-hidden="true"></span> Cargando trabajos anteriores...';else host.textContent='Cargando trabajos...'
        try{
          const page=await getJson('/workshop/jobs'+wjQuery()+'&vehicleId='+encodeURIComponent(vehicleId)+'&limit=10&offset='+wjVehicleHistory.nextOffset)
          if(business!==state.businessId||vehicleId!==wjVehicleHistory.vehicleId||!host.isConnected)return
          const known=new Set(wjVehicleHistory.records.map(x=>x.id))
          wjVehicleHistory.records=append?wjVehicleHistory.records.concat(page.items.filter(x=>!known.has(x.id))):page.items
          wjVehicleHistory.nextOffset=page.nextOffset??wjVehicleHistory.records.length
          wjVehicleHistory.hasMore=page.hasMore
          wjRenderHistory(host,wjVehicleHistory.records,true)
        }catch(e){if(host.isConnected)host.textContent=e.message}finally{wjVehicleHistory.loading=false}
        return
      }
      host.textContent='Cargando trabajos...'
      try {
        const date=document.getElementById('wj-filter-date').value
        const performerId=document.getElementById('wj-filter-performer').value
        const records=await getJson('/workshop/jobs'+wjQuery()+(date?'&date='+encodeURIComponent(date):'')+(performerId?'&performerId='+encodeURIComponent(performerId):''))
        if(business!==state.businessId||!host.isConnected)return
        wjRenderHistory(host,records)
      } catch(e){if(host.isConnected)host.textContent=e.message}
    }
    async function wjLoadHistoryFilters() {
      const select=document.getElementById('wj-filter-performer');if(!select||!state.businessId)return
      const selected=select.value,business=state.businessId
      const performers=await getJson('/workshop/performers?businessId='+encodeURIComponent(business)+'&includeInactive=1')
      if(business!==state.businessId)return
      select.innerHTML='<option value="">Todos los responsables</option><option value="none">Sin registro</option>'+performers.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+(x.active?'':' (inactivo)')+'</option>').join('')
      select.value=selected
    }
    wj('close').addEventListener('click',()=>{if(!wjSaving)wj('backdrop').hidden=true})
    wj('shortcuts').addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-wj-custom')){const x=wjCatalog.find(x=>x.id===b.dataset.wjCustom);if(x)wjAddLine(x.description,x.quantity)}else wjAddLine()})
    wj('lines').addEventListener('input',wjTotal)
    wj('lines').addEventListener('click',event=>{if(event.target.closest('.wj-remove')&&!wjReadOnly){event.target.closest('tr').remove();wjTotal()}})
    wj('config-toggle').addEventListener('click',()=>{wj('config').hidden=!wj('config').hidden;if(!wj('config').hidden)wjNewShortcut()})
    wj('config-list').addEventListener('click',event=>{const b=event.target.closest('[data-wj-edit]');const x=wjCatalog.find(x=>x.id===b?.dataset.wjEdit);if(!x)return;wj('shortcut-id').value=x.id;for(const field of ['name','description','quantity','position'])wj('sc-'+field).value=x[field];wj('sc-active').checked=x.active;wj('sc-remove').hidden=!x.active;wj('sc-status').textContent='Editando: '+x.name;wj('sc-name').focus()})
    async function wjSaveShortcut(remove=false) {
      if(wjSaving||wjBusinessId!==state.businessId)return
      if(!setButtonLoading(wj('sc-save'),true,'Guardando...'))return
      const business=wjBusinessId
      wj('sc-remove').disabled=true
      try{
        const id=wj('shortcut-id').value
        const data=remove?wjCatalog.find(x=>x.id===id):{name:wj('sc-name').value,description:wj('sc-description').value,quantity:wj('sc-quantity').value,position:wj('sc-position').value,active:wj('sc-active').checked}
        if(!data)throw new Error('Seleccion\u00e1 un bot\u00f3n primero.')
        await getJson('/workshop/shortcuts'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,businessId:business,active:remove?false:data.active})})
        const catalog=await getJson('/workshop/shortcuts?businessId='+encodeURIComponent(business))
        if(business!==state.businessId||business!==wjBusinessId)return
        wjCatalog=catalog;wjRenderCatalog();wjNewShortcut();wj('error').textContent=''
        wj('sc-status').textContent=remove?'Bot\u00f3n quitado. Ya no aparece en las listas.':'Bot\u00f3n guardado. Pod\u00e9s completar los campos para agregar otro.'
      }catch(e){wj('sc-status').textContent=e.message}finally{setButtonLoading(wj('sc-save'),false);wj('sc-remove').disabled=false}
    }
    wj('sc-save').addEventListener('click',()=>wjSaveShortcut())
    wj('sc-remove').addEventListener('click',()=>wjSaveShortcut(true))
    wj('form').addEventListener('submit',async event=>{
      event.preventDefault();if(wjSaving||wjReadOnly)return
      if(wjBusinessId!==state.businessId){wj('error').textContent='El comercio cambio. Cerra y abri la ficha nuevamente.';return}
      wjSaving=true;setButtonLoading(wj('save'),true,'Guardando...');wj('close').disabled=true
      try{
        await getJson('/workshop/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:wjBusinessId,vehicleId:wjVehicleId,date:wj('date').value,mileage:wj('mileage').value,performerId:wj('responsible').value,notes:wj('notes').value,lines:wjLines()})})
        wj('backdrop').hidden=true;if(wjBusinessId!==state.businessId)return;showCrmToast('Trabajo guardado','success');await loadWorkshopVehicles({force:true});await openWorkshopVehicle(wjVehicleId)
      }catch(e){wj('error').textContent=e.message}finally{wjSaving=false;setButtonLoading(wj('save'),false);wj('close').disabled=false}
    })
    let wpItems=[],wpSaving=false
    const wp=(id)=>document.getElementById('wp-'+id)
    function wpSuggestions(items=wpItems.filter(x=>x.active)){wjSetPerformerOptions(items)}
    function wpReset(){wp('id').value='';wp('name').value='';wp('title').textContent='Agregar trabajador';wp('save').textContent='Agregar trabajador';wp('feedback').textContent=''}
    function wpRender(){
      const host=wp('page-list');if(!host)return
      if(!wpItems.length){host.innerHTML='<div class="workshop-empty wp-empty"><strong>Todav&iacute;a no hay trabajadores cargados</strong><p>Agreg&aacute; el primero para poder elegirlo al cargar un trabajo.</p></div>';return}
      host.innerHTML='<div class="workshop-table-shell"><table class="wp-table"><thead><tr><th>Nombre</th><th>Estado</th><th></th></tr></thead><tbody>'+wpItems.map(x=>'<tr><td><strong>'+escapeHtml(x.name)+'</strong></td><td><span class="wp-status'+(x.active?'':' inactive')+'">'+(x.active?'Activo':'Inactivo')+'</span></td><td><div class="wp-actions"><button type="button" data-wp-edit="'+escapeHtml(x.id)+'">Editar</button><button class="'+(x.active?'danger':'success')+'" type="button" data-wp-toggle="'+escapeHtml(x.id)+'">'+(x.active?'Dar de baja':'Reactivar')+'</button></div></td></tr>').join('')+'</tbody></table></div>'
    }
    async function wpLoad(){
      const business=state.businessId
      const host=wp('page-list');if(host)host.innerHTML='<div class="wp-empty">Cargando personal...</div>'
      wpItems=await getJson('/workshop/performers?businessId='+encodeURIComponent(business)+'&includeInactive=1')
      if(business!==state.businessId)return
      wpRender();wpSuggestions()
    }
    function wpOpen(item=null){
      wpReset()
      if(item){wp('id').value=item.id;wp('name').value=item.name;wp('title').textContent='Editar trabajador';wp('save').textContent='Guardar cambios'}
      wp('backdrop').hidden=false;wp('name').focus()
    }
    wp('close').addEventListener('click',()=>{if(!wpSaving)wp('backdrop').hidden=true})
    wp('cancel').addEventListener('click',()=>{if(!wpSaving)wp('backdrop').hidden=true})
    wp('form').addEventListener('submit',async event=>{
      event.preventDefault();if(wpSaving)return
      wpSaving=true;if(!setButtonLoading(wp('save'),true,'Guardando...')){wpSaving=false;return}
      try{
        const id=wp('id').value
        await getJson('/workshop/performers'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:state.businessId,name:wp('name').value})})
        wp('backdrop').hidden=true;await wpLoad();showCrmToast(id?'Trabajador actualizado':'Trabajador agregado','success')
      }catch(error){wp('feedback').textContent=error.message}finally{wpSaving=false;setButtonLoading(wp('save'),false)}
    })
    wp('page-list').addEventListener('click',async event=>{
      const edit=event.target.closest('[data-wp-edit]'),toggle=event.target.closest('[data-wp-toggle]')
      if(edit){const item=wpItems.find(x=>x.id===edit.dataset.wpEdit);if(item)wpOpen(item);return}
      if(!toggle||wpSaving)return
      const item=wpItems.find(x=>x.id===toggle.dataset.wpToggle);if(!item)return
      wpSaving=true;toggle.disabled=true
      try{
        await getJson('/workshop/performers/'+encodeURIComponent(item.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:state.businessId,name:item.name,active:!item.active})})
        await wpLoad();showCrmToast(item.active?'Trabajador dado de baja':'Trabajador reactivado','success')
      }catch(error){showCrmToast(error.message,'error')}finally{wpSaving=false}
    })
    wp('add').addEventListener('click',()=>wpOpen())
    document.querySelector('.workshop-autos-view').addEventListener('scroll',event=>{
      if(!wjVehicleHistory.vehicleId||wjVehicleHistory.loading||!wjVehicleHistory.hasMore)return
      const view=event.currentTarget
      if(view.scrollTop+view.clientHeight>=view.scrollHeight-120)loadWorkshopJobHistory(wjVehicleHistory.vehicleId,{append:true})
    })
    document.getElementById('wj-filter-date').addEventListener('change',()=>loadWorkshopJobHistory())
    document.getElementById('wj-filter-performer').addEventListener('change',()=>loadWorkshopJobHistory())
    document.getElementById('wj-filter-clear').addEventListener('click',()=>{document.getElementById('wj-filter-date').value='';loadWorkshopJobHistory()})
`
