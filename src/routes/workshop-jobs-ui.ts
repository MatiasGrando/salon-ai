export const workshopJobsMarkup = `
<style>
#wj-backdrop{z-index:95;background:#14213988;backdrop-filter:blur(3px)}
#wj-backdrop .wj-dialog{width:min(1000px,100%);max-width:calc(100vw - 36px);max-height:calc(100dvh - 36px);min-width:min(650px,90vw);resize:both;overflow:hidden;border:1px solid #ccd5e3;border-radius:14px;display:flex;flex-direction:column;background:white;color:#17213a}
.wj-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #dce3ee;flex-shrink:0}.wj-header h2{margin:0;font-size:19px}.wj-header p{margin:5px 0 0;font-size:13px;color:#607089}
#wj-close{width:40px;height:40px;border:2px solid #aebccd;border-radius:8px;background:#f1f5f9;color:#23324b;font-size:25px}#wj-close:hover{background:#fee2e2;color:#b91c1c;border-color:#dc2626}
#wj-form{min-height:0;display:flex;flex-direction:column;overflow:hidden}.wj-body{padding:20px;overflow:auto;min-height:0;display:grid;gap:18px}.wj-fields{display:grid;grid-template-columns:1fr 1fr 1.5fr;gap:14px}.wj-fields label,.wj-note{display:grid;gap:6px;font-size:12px;font-weight:700;color:#52617a}.wj-body input,.wj-body select{height:40px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;min-width:0;width:100%;background:white;color:#17213a}.wj-body input:focus{outline:2px solid #93c5fd}.wj-body h3{font-size:14px;margin:0 0 10px}.wj-shortcuts{display:flex;flex-wrap:wrap;gap:8px}.wj-shortcuts button{padding:9px 12px;border:1px solid #b9ccef;border-radius:8px;background:#eff6ff;color:#17499a;font-weight:650;cursor:pointer}.wj-table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:8px}.wj-lines{width:100%;min-width:900px;border-collapse:collapse}.wj-lines th{padding:10px;background:#f1f5f9;font-size:12px;text-align:left}.wj-lines td{padding:7px;border-top:1px solid #e2e8f0}.wj-lines th:first-child{width:75px}.wj-lines th:nth-child(3),.wj-lines th:nth-child(4){width:145px}.wj-lines th:nth-child(5),.wj-lines th:nth-child(6){width:150px}.wj-lines button{border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:7px;padding:7px 10px}.wj-note textarea{padding:10px;border:1px solid #cbd5e1;border-radius:8px;min-height:65px;width:100%;resize:vertical}.wj-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 22px;border-top:1px solid #dce3ee;background:#f8fafc;flex-shrink:0}.wj-footer strong{font-size:18px}.wj-feedback{color:#b91c1c;margin:0;font-size:13px}.wj-help{font-size:12px;color:#64748b;margin:6px 0}.wj-config{padding:14px;background:#f8fafc;border:1px solid #dbe3ef;border-radius:9px}.wj-config[hidden]{display:none}.wj-config-list{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.wj-config-list button{padding:6px 9px}.wj-config-editor{display:grid;grid-template-columns:1fr 2fr 70px 70px;gap:10px}.wj-config-editor label{font-size:12px;display:grid;gap:5px}.wj-record{margin-top:20px}.wj-record h2{font-size:19px}.wj-record .workshop-toolbar{margin:12px 0}.wj-readonly .wj-remove{display:none}
#wj-backdrop .wj-dialog{--wj-scale:1;height:min(680px,calc(100dvh - 36px));min-height:min(400px,calc(100dvh - 36px))}
#wj-form{flex:1}.wj-body{flex:1;align-content:start;padding:calc(20px * var(--wj-scale));gap:calc(18px * var(--wj-scale))}
.wj-body input,.wj-body select{height:var(--wj-field-height,40px);font-size:var(--wj-font-size,14px);padding:calc(8px * var(--wj-scale))}.wj-body textarea{font-size:var(--wj-font-size,14px);min-height:calc(65px * var(--wj-scale))}
.wj-header{padding:calc(16px * var(--wj-scale)) calc(20px * var(--wj-scale))}.wj-header h2{font-size:calc(19px * var(--wj-scale))}.wj-header p,.wj-feedback{font-size:calc(13px * var(--wj-scale))}
.wj-fields{gap:calc(14px * var(--wj-scale))}.wj-fields label,.wj-note,.wj-help,.wj-lines th,.wj-config-editor label,.wj-config>label{font-size:calc(12px * var(--wj-scale))}
.wj-body h3{font-size:calc(14px * var(--wj-scale))}.wj-shortcuts{gap:calc(8px * var(--wj-scale))}
#wj-backdrop button{font-size:calc(13px * var(--wj-scale));padding:calc(9px * var(--wj-scale)) calc(12px * var(--wj-scale))}
#wj-backdrop #wj-close{width:calc(40px * var(--wj-scale));height:calc(40px * var(--wj-scale));font-size:calc(25px * var(--wj-scale));padding:0;flex-shrink:0}
.wj-lines td{padding:calc(7px * var(--wj-scale))}.wj-lines th{padding:calc(10px * var(--wj-scale))}.wj-lines th:first-child{width:calc(75px * var(--wj-scale))}.wj-lines th:nth-child(3),.wj-lines th:nth-child(4){width:calc(145px * var(--wj-scale))}.wj-lines th:nth-child(5),.wj-lines th:nth-child(6){width:calc(150px * var(--wj-scale))}
.wj-config{padding:calc(14px * var(--wj-scale))}.wj-footer{font-size:calc(14px * var(--wj-scale));padding:calc(14px * var(--wj-scale)) calc(22px * var(--wj-scale))}.wj-footer strong{font-size:calc(18px * var(--wj-scale))}
@media(max-width:650px){.wj-fields,.wj-config-editor{grid-template-columns:1fr}.wj-body{padding:14px}#wj-backdrop .wj-dialog{resize:none;min-width:0;width:100%!important;height:auto!important;--wj-field-height:40px!important;--wj-font-size:14px!important}.wj-header{padding:12px}.wj-footer{padding:12px}}
#wp-backdrop,#ws-backdrop{z-index:97;background:#14213988;backdrop-filter:blur(3px)}#wp-backdrop .wp-dialog,#ws-backdrop .wp-dialog{width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #ccd5e3;border-radius:14px;background:#fff;color:#17213a;box-shadow:0 24px 64px #0f172a38}#wp-backdrop .wj-header,#ws-backdrop .wj-header{padding:22px 26px 18px}#wp-backdrop .wj-header p,#ws-backdrop .wj-header p{margin-top:7px}#wp-close,#ws-close{width:40px;height:40px;padding:0;border:2px solid #aebccd;border-radius:8px;background:#f1f5f9;color:#23324b;font-size:25px}#wp-close:hover,#ws-close:hover{background:#fee2e2;color:#b91c1c;border-color:#dc2626}.wp-body{min-height:0;padding:26px;display:grid;gap:20px;overflow:auto}.wp-editor{display:grid;gap:22px}.wp-editor label{display:grid;gap:9px;color:#52617a;font-size:12px;font-weight:750}.wp-editor input{height:48px;padding:10px 13px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}.wp-editor input:focus{outline:2px solid #93c5fd}.wp-form-actions{display:flex;justify-content:flex-end;gap:12px;padding-top:2px}.wp-table{width:100%;border-collapse:collapse}.wp-table th,.wp-table td{padding:14px 16px;text-align:left;border-bottom:2px solid #d3dbe7}.wp-table th{color:#52617a;background:#eef2f7;font-size:11px;text-transform:uppercase}.wp-actions{display:flex;justify-content:flex-end;gap:8px}.wp-actions button{min-height:38px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-weight:700}.wp-actions .danger{color:#b91c1c;border-color:#fecaca}.wp-actions .success{color:#166534;border-color:#bbf7d0}.wp-status{display:inline-flex;padding:5px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:750}.wp-status.inactive{background:#f1f5f9;color:#64748b}.wp-empty{padding:32px;text-align:center;color:#64748b}
.ws-dialog{width:min(720px,calc(100vw - 32px))!important}.ws-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ws-check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:10px!important}.ws-check input{width:18px;height:18px}.ws-editor textarea{min-height:86px;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical}.ws-return{padding:16px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc;display:grid;gap:14px}.ws-return[hidden]{display:none}
@media(max-width:650px){.wp-editor,.ws-grid{grid-template-columns:1fr}.wp-body{padding:14px}}
</style>
<div class="dialog-backdrop" id="wj-backdrop" hidden>
 <section class="wj-dialog" role="dialog" aria-modal="true" aria-labelledby="wj-title">
  <header class="wj-header"><div><h2 id="wj-title">Nuevo trabajo</h2><p id="wj-vehicle"></p></div><button id="wj-close" type="button" aria-label="Cerrar ficha">&times;</button></header>
  <form id="wj-form"><div class="wj-body">
   <div class="wj-fields"><label>Fecha<input id="wj-date" type="date" required></label><label>Kilometraje<input id="wj-mileage" type="number" min="0" max="10000000" required></label><label>Realizado por<select id="wj-responsible" required><option value="">Seleccion&aacute; un trabajador</option></select></label></div>
   <div id="wj-tools"><h3>Agregar servicios o tareas</h3><div class="wj-shortcuts" id="wj-shortcuts"></div><p class="wj-help">Los servicios se administran desde la secci&oacute;n Servicios. Otra tarea no genera seguimiento autom&aacute;tico.</p></div>
   <div><div class="wj-table-wrap"><table class="wj-lines"><thead><tr><th>Cant.</th><th>Descripci&oacute;n</th><th>Repuestos / unidad</th><th>Mano de obra / unidad</th><th>Pr&oacute;xima fecha</th><th>Pr&oacute;ximos KM</th><th></th></tr></thead><tbody id="wj-lines"></tbody></table></div><p class="wj-help">Importes opcionales en pesos. El total multiplica cada importe por su cantidad; vac&iacute;o significa sin cotizar.</p></div>
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
</div>
<div class="dialog-backdrop" id="ws-backdrop" hidden>
 <section class="wp-dialog ws-dialog" role="dialog" aria-modal="true" aria-labelledby="ws-title">
  <header class="wj-header"><div><h2 id="ws-title">Agregar servicio</h2><p>Configur&aacute; la tarea y cu&aacute;ndo deber&iacute;a volver el veh&iacute;culo.</p></div><button id="ws-close" type="button" aria-label="Cerrar formulario">&times;</button></header>
  <div class="wp-body">
   <form id="ws-form" class="wp-editor ws-editor"><input id="ws-id" type="hidden">
    <label>Nombre del servicio<input id="ws-name" maxlength="60" required></label>
    <label>Texto que agrega al trabajo<input id="ws-description" maxlength="300" required></label>
    <div class="ws-grid"><label>Cantidad predeterminada<input id="ws-quantity" type="number" min="1" max="999" value="1" required></label><label>Orden<input id="ws-position" type="number" min="0" max="10000" value="0" required></label></div>
    <label class="ws-check"><input id="ws-recurrenceEnabled" type="checkbox">Controlar el pr&oacute;ximo vencimiento</label>
    <div class="ws-return" id="ws-return-fields" hidden><div class="ws-grid"><label>Volver en meses<input id="ws-returnMonths" type="number" min="1" max="240" placeholder="Opcional"></label><label>Volver en kil&oacute;metros<input id="ws-returnKilometers" type="number" min="1" max="1000000" placeholder="Opcional"></label></div><label>Consideraciones para el cliente<textarea id="ws-customerInstructions" maxlength="1000" placeholder="Ej: Verificar el manual y las condiciones de uso."></textarea></label></div>
    <p class="wj-feedback" id="ws-feedback" role="status"></p>
    <div class="wp-form-actions"><button class="secondary" id="ws-cancel" type="button">Cancelar</button><button class="primary" id="ws-save" type="submit">Guardar servicio</button></div>
   </form>
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
    function wjAddMonths(date,months){
      if(!date||!months)return ''
      const parts=date.split('-').map(Number),target=new Date(Date.UTC(parts[0],parts[1]-1+Number(months),1)),lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
      return target.getUTCFullYear()+'-'+String(target.getUTCMonth()+1).padStart(2,'0')+'-'+String(Math.min(parts[2],lastDay)).padStart(2,'0')
    }
    function wjAddLine(description='', quantity=1, parts='', labor='', service=null, nextDueDate='', nextDueMileage='') {
      const row = document.createElement('tr'),serviceId=service?.id||'',tracking=Boolean(service?.recurrenceEnabled)
      const automaticDate=tracking&&service.returnMonths?wjAddMonths(wj('date').value,service.returnMonths):''
      const automaticMileage=tracking&&service.returnKilometers&&wj('mileage').value!==''?String(Number(wj('mileage').value)+Number(service.returnKilometers)):''
      row.dataset.serviceId=serviceId;row.dataset.returnMonths=String(service?.returnMonths||'');row.dataset.returnKilometers=String(service?.returnKilometers||'');row.dataset.autoDueDate=automaticDate;row.dataset.autoDueMileage=automaticMileage
      row.innerHTML = '<td><input aria-label="Cantidad" data-wj-field="quantity" type="number" min="1" max="999" required></td><td><input aria-label="Descripcion" data-wj-field="description" maxlength="300" required></td><td><input aria-label="Repuestos por unidad" data-wj-field="parts" inputmode="decimal" placeholder="Opcional"></td><td><input aria-label="Mano de obra por unidad" data-wj-field="labor" inputmode="decimal" placeholder="Opcional"></td><td><input aria-label="Próxima fecha" data-wj-field="nextDueDate" type="date" '+(tracking?'':'disabled title="Este servicio no tiene seguimiento"')+'></td><td><input aria-label="Próximo kilometraje" data-wj-field="nextDueMileage" type="number" min="1" max="20000000" '+(tracking?'':'disabled title="Este servicio no tiene seguimiento"')+'></td><td><button type="button" class="wj-remove" aria-label="Quitar tarea">&times;</button></td>'
      for(const [field,value] of Object.entries({description,quantity,parts,labor,nextDueDate:nextDueDate||automaticDate,nextDueMileage:nextDueMileage||automaticMileage})) row.querySelector('[data-wj-field="'+field+'"]').value = value??''
      wj('lines').appendChild(row); wjTotal()
    }
    function wjRefreshDueSuggestions(){
      for(const row of wj('lines').rows){
        if(!row.dataset.serviceId)continue
        const dateInput=row.querySelector('[data-wj-field="nextDueDate"]'),mileageInput=row.querySelector('[data-wj-field="nextDueMileage"]')
        const date=wjAddMonths(wj('date').value,row.dataset.returnMonths),mileage=row.dataset.returnKilometers&&wj('mileage').value!==''?String(Number(wj('mileage').value)+Number(row.dataset.returnKilometers)):''
        if(!dateInput.disabled&&(!dateInput.value||dateInput.value===row.dataset.autoDueDate))dateInput.value=date
        if(!mileageInput.disabled&&(!mileageInput.value||mileageInput.value===row.dataset.autoDueMileage))mileageInput.value=mileage
        row.dataset.autoDueDate=date;row.dataset.autoDueMileage=mileage
      }
    }
    function wjLines() { return Array.from(wj('lines').rows).map(row => ({...Object.fromEntries(Array.from(row.querySelectorAll('input')).map(input => [input.dataset.wjField,input.value])),...(row.dataset.serviceId?{serviceId:row.dataset.serviceId}:{})})) }
    function wjTotal() { let total=0; for(const line of wjLines()) total += Number(line.quantity||0)*(Math.round(Number(String(line.parts||0).replace(',','.'))*100)+Math.round(Number(String(line.labor||0).replace(',','.'))*100)); wj('total').textContent = Number.isFinite(total) ? wjMoney(total) : 'Revisar importes' }
    function wjRenderCatalog() {
      wj('shortcuts').innerHTML = wjCatalog.filter(x=>x.active).map(x=>'<button type="button" data-wj-custom="'+escapeHtml(x.id)+'">+ '+escapeHtml(x.name)+'</button>').join('') + '<button type="button" data-wj-blank>+ Otra tarea</button>'
    }
    function wjSetPerformerOptions(items, selectedId='', readOnly=false) {
      if(readOnly&&!selectedId){wj('responsible').innerHTML='<option value="">Sin registro</option>';return}
      wj('responsible').innerHTML=(readOnly?'':'<option value="">Seleccion&aacute; un trabajador</option>')+items.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+(x.active===false?' (inactivo)':'')+'</option>').join('')
      wj('responsible').value=selectedId
    }
    async function openWorkshopJobForm(vehicle, record=null) {
      wjBusinessId = state.businessId; wjVehicleId=vehicle.id; wjReadOnly=Boolean(record)
      wjCatalog=[];wjRenderCatalog();wjSetPerformerOptions([])
      wj('form').reset();wj('lines').innerHTML='';wj('error').textContent=''
      wj('title').textContent=record?'Trabajo realizado':'Nuevo trabajo';wj('vehicle').textContent=vehicle.plate+' · '+vehicle.model
      wj('date').value=record?.date||wjDateToday();wj('mileage').value=record?.mileage??vehicle.currentMileage??'';wj('notes').value=record?.notes||''
      wj('tools').hidden=wjReadOnly;wj('save').hidden=wjReadOnly;wj('form').classList.toggle('wj-readonly',wjReadOnly)
      for(const field of ['date','mileage','responsible','notes']) wj(field).disabled=wjReadOnly
      wj('backdrop').hidden=false
      wjRestoreSize();wj('close').focus()
      if(record) { wjSetPerformerOptions(record.performerId?[{id:record.performerId,name:record.responsible||'Sin registro'}]:[],record.performerId||'',true);for(const line of record.lines) wjAddLine(line.description,line.quantity,line.partsCents==null?'':(line.partsCents/100).toFixed(2),line.laborCents==null?'':(line.laborCents/100).toFixed(2),line.serviceId?{id:line.serviceId,recurrenceEnabled:line.recurrenceEnabled,returnMonths:line.returnMonths,returnKilometers:line.returnKilometers}:null,line.nextDueDate||'',line.nextDueMileage||''); for(const el of wj('lines').querySelectorAll('input')) el.disabled=true; return }
      wjTotal()
      try {
        const business=wjBusinessId
        const [performers,catalog]=await Promise.all([getJson('/workshop/performers'+wjQuery()),getJson('/workshop/shortcuts'+wjQuery())])
        if(business!==state.businessId||wj('backdrop').hidden)return
        wjCatalog=catalog;wjRenderCatalog();wjSetPerformerOptions(performers)
      } catch(e) {wj('error').textContent=e.message}
    }
    const wjVehicleHistory={vehicleId:null,records:[],nextOffset:0,hasMore:false,loading:false}
    const wjAllHistory={offset:0,pageSize:20,hasMore:false,loading:false,requestId:0}
    function wjRenderAllPagination(itemCount){
      const controls=document.getElementById('wj-page-controls'),previous=document.getElementById('wj-page-prev'),next=document.getElementById('wj-page-next'),status=document.getElementById('wj-page-status')
      if(!controls||!previous||!next||!status)return
      controls.hidden=itemCount===0&&wjAllHistory.offset===0
      previous.disabled=wjAllHistory.loading||wjAllHistory.offset===0
      next.disabled=wjAllHistory.loading||!wjAllHistory.hasMore
      const first=itemCount?wjAllHistory.offset+1:0,last=wjAllHistory.offset+itemCount
      status.textContent=itemCount?'Mostrando '+first+' a '+last:'Sin trabajos para mostrar'
    }
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
      const requestId=++wjAllHistory.requestId,offset=wjAllHistory.offset
      wjAllHistory.loading=true
      host.textContent='Cargando trabajos...'
      wjRenderAllPagination(0)
      try {
        const date=document.getElementById('wj-filter-date').value
        const performerId=document.getElementById('wj-filter-performer').value
        const page=await getJson('/workshop/jobs'+wjQuery()+(date?'&date='+encodeURIComponent(date):'')+(performerId?'&performerId='+encodeURIComponent(performerId):'')+'&limit='+wjAllHistory.pageSize+'&offset='+offset)
        if(business!==state.businessId||!host.isConnected||requestId!==wjAllHistory.requestId)return
        wjAllHistory.hasMore=page.hasMore
        wjRenderHistory(host,page.items)
        wjRenderAllPagination(page.items.length)
      } catch(e){if(host.isConnected&&requestId===wjAllHistory.requestId){host.textContent=e.message;wjAllHistory.hasMore=false;wjRenderAllPagination(0)}}finally{if(requestId===wjAllHistory.requestId){wjAllHistory.loading=false;const rows=host.querySelectorAll('tbody tr').length;wjRenderAllPagination(rows)}}
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
    wj('shortcuts').addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-wj-custom')){const x=wjCatalog.find(x=>x.id===b.dataset.wjCustom);if(!x)return;if(Array.from(wj('lines').rows).some(row=>row.dataset.serviceId===x.id)){wj('error').textContent='Ese servicio ya fue agregado al trabajo.';return}wj('error').textContent='';wjAddLine(x.description,x.quantity,'','',x)}else wjAddLine()})
    wj('lines').addEventListener('input',wjTotal)
    wj('date').addEventListener('change',wjRefreshDueSuggestions)
    wj('mileage').addEventListener('input',wjRefreshDueSuggestions)
    wj('lines').addEventListener('click',event=>{if(event.target.closest('.wj-remove')&&!wjReadOnly){event.target.closest('tr').remove();wjTotal()}})
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
    let wsItems=[],wsSaving=false
    const ws=(id)=>document.getElementById('ws-'+id)
    function wsReturnLabel(item){const parts=[];if(item.returnMonths)parts.push(item.returnMonths+' meses');if(item.returnKilometers)parts.push(new Intl.NumberFormat('es-AR').format(item.returnKilometers)+' km');return item.recurrenceEnabled&&parts.length?parts.join(' o '):'Sin seguimiento'}
    function wsRender(){
      const host=ws('page-list');if(!host)return
      if(!wsItems.length){host.innerHTML='<div class="workshop-empty"><strong>Todav&iacute;a no hay servicios cargados</strong><p>Agreg&aacute; el primero para usarlo al registrar trabajos.</p></div>';return}
      host.innerHTML='<div class="workshop-table-shell"><table class="wp-table"><thead><tr><th>Servicio</th><th>Pr&oacute;ximo control</th><th>Estado</th><th></th></tr></thead><tbody>'+wsItems.map(x=>'<tr><td><strong>'+escapeHtml(x.name)+'</strong><div class="wj-help">'+escapeHtml(x.description)+'</div></td><td>'+escapeHtml(wsReturnLabel(x))+'</td><td><span class="wp-status'+(x.active?'':' inactive')+'">'+(x.active?'Activo':'Inactivo')+'</span></td><td><div class="wp-actions"><button type="button" data-ws-edit="'+escapeHtml(x.id)+'">Editar</button><button class="'+(x.active?'danger':'success')+'" type="button" data-ws-toggle="'+escapeHtml(x.id)+'">'+(x.active?'Dar de baja':'Reactivar')+'</button></div></td></tr>').join('')+'</tbody></table></div>'
    }
    async function wsLoad(){
      const business=state.businessId,host=ws('page-list')
      if(host)host.innerHTML='<div class="wp-empty">Cargando servicios...</div>'
      const [items,settings]=await Promise.all([
        getJson('/workshop/shortcuts?businessId='+encodeURIComponent(business)),
        getJson('/workshop/settings?businessId='+encodeURIComponent(business))
      ])
      if(business!==state.businessId)return
      wsItems=items
      ws('public-url').value=settings.publicSiteUrl||''
      ws('public-feedback').textContent=settings.publicSiteUrl?'Enlace listo para generar QR.':'Configurá este enlace antes de imprimir QR.'
      ws('public-feedback').className=settings.publicSiteUrl?'success':''
      wsRender();wjCatalog=wsItems;wjRenderCatalog()
    }
    function wsSyncReturnFields(){ws('return-fields').hidden=!ws('recurrenceEnabled').checked}
    function wsOpen(item=null){ws('form').reset();ws('id').value='';ws('quantity').value='1';ws('position').value=String(Math.min(10000,Math.max(0,...wsItems.map(x=>x.position))+1));ws('feedback').textContent='';ws('title').textContent=item?'Editar servicio':'Agregar servicio';ws('save').textContent=item?'Guardar cambios':'Guardar servicio';if(item){for(const field of ['id','name','description','quantity','position','returnMonths','returnKilometers','customerInstructions'])ws(field).value=item[field]??'';ws('recurrenceEnabled').checked=Boolean(item.recurrenceEnabled)}wsSyncReturnFields();ws('backdrop').hidden=false;ws('name').focus()}
    ws('recurrenceEnabled').addEventListener('change',wsSyncReturnFields)
    ws('close').addEventListener('click',()=>{if(!wsSaving)ws('backdrop').hidden=true})
    ws('cancel').addEventListener('click',()=>{if(!wsSaving)ws('backdrop').hidden=true})
    ws('form').addEventListener('submit',async event=>{event.preventDefault();if(wsSaving)return;wsSaving=true;if(!setButtonLoading(ws('save'),true,'Guardando...')){wsSaving=false;return}try{const id=ws('id').value;const data={businessId:state.businessId,name:ws('name').value,description:ws('description').value,quantity:ws('quantity').value,position:ws('position').value,active:id?(wsItems.find(x=>x.id===id)?.active!==false):true,recurrenceEnabled:ws('recurrenceEnabled').checked,returnMonths:ws('returnMonths').value,returnKilometers:ws('returnKilometers').value,customerInstructions:ws('customerInstructions').value};await getJson('/workshop/shortcuts'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});ws('backdrop').hidden=true;await wsLoad();showCrmToast(id?'Servicio actualizado':'Servicio agregado','success')}catch(error){ws('feedback').textContent=error.message}finally{wsSaving=false;setButtonLoading(ws('save'),false)}})
    ws('page-list').addEventListener('click',async event=>{const edit=event.target.closest('[data-ws-edit]'),toggle=event.target.closest('[data-ws-toggle]');if(edit){const item=wsItems.find(x=>x.id===edit.dataset.wsEdit);if(item)wsOpen(item);return}if(!toggle||wsSaving)return;const item=wsItems.find(x=>x.id===toggle.dataset.wsToggle);if(!item)return;wsSaving=true;toggle.disabled=true;try{await getJson('/workshop/shortcuts/'+encodeURIComponent(item.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,businessId:state.businessId,active:!item.active})});await wsLoad();showCrmToast(item.active?'Servicio dado de baja':'Servicio reactivado','success')}catch(error){showCrmToast(error.message,'error')}finally{wsSaving=false}})
    ws('add').addEventListener('click',()=>wsOpen())
    ws('public-save').addEventListener('click',async()=>{
      const button=ws('public-save'),feedback=ws('public-feedback')
      if(!setButtonLoading(button,true,'Guardando...'))return
      feedback.textContent=''
      feedback.className=''
      try{
        const settings=await getJson('/workshop/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:state.businessId,publicSiteUrl:ws('public-url').value})})
        ws('public-url').value=settings.publicSiteUrl||''
        feedback.textContent=settings.publicSiteUrl?'Enlace público guardado. Ya podés imprimir QR.':'Enlace público eliminado.'
        feedback.className='success'
      }catch(error){
        feedback.textContent=error.message
        feedback.className='error'
      }finally{setButtonLoading(button,false)}
    })
    document.querySelector('.workshop-autos-view').addEventListener('scroll',event=>{
      if(!wjVehicleHistory.vehicleId||wjVehicleHistory.loading||!wjVehicleHistory.hasMore)return
      const view=event.currentTarget
      if(view.scrollTop+view.clientHeight>=view.scrollHeight-120)loadWorkshopJobHistory(wjVehicleHistory.vehicleId,{append:true})
    })
    document.getElementById('wj-filter-date').addEventListener('change',()=>{wjAllHistory.offset=0;loadWorkshopJobHistory()})
    document.getElementById('wj-filter-performer').addEventListener('change',()=>{wjAllHistory.offset=0;loadWorkshopJobHistory()})
    document.getElementById('wj-filter-clear').addEventListener('click',()=>{document.getElementById('wj-filter-date').value='';wjAllHistory.offset=0;loadWorkshopJobHistory()})
    document.getElementById('wj-page-prev').addEventListener('click',()=>{if(wjAllHistory.loading||wjAllHistory.offset===0)return;wjAllHistory.offset=Math.max(0,wjAllHistory.offset-wjAllHistory.pageSize);loadWorkshopJobHistory()})
    document.getElementById('wj-page-next').addEventListener('click',()=>{if(wjAllHistory.loading||!wjAllHistory.hasMore)return;wjAllHistory.offset+=wjAllHistory.pageSize;loadWorkshopJobHistory()})
`
