import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findCustomSiteProfileBinding } from '../src/services/custom-site-profile-binding.js'

const [landingUi, businessService, tamaraSite, naturaFlowRoute, authGuard, server] = await Promise.all([
  readFile('src/routes/landing-ui.ts', 'utf8'),
  readFile('src/services/business-service.ts', 'utf8'),
  readFile('src/assets/tamara-site/index.html', 'utf8'),
  readFile('src/routes/natura-flow-site.ts', 'utf8'),
  readFile('src/plugins/auth-guard.ts', 'utf8'),
  readFile('src/server.ts', 'utf8')
])

const naturaFlowSite = await readFile('src/assets/natura-flow-site/index.html', 'utf8')

assert.deepEqual(findCustomSiteProfileBinding('tamaragrando.weex.com.ar'), {
  hostname: 'tamaragrando.weex.com.ar',
  businessCustomerCode: 'WX-RWCEDG',
  serviceCatalogMode: 'ALL'
})
assert.equal(
  findCustomSiteProfileBinding('TAMARAGRANDO.WEEX.COM.AR:443')?.businessCustomerCode,
  'WX-RWCEDG'
)
assert.equal(findCustomSiteProfileBinding('otro.weex.com.ar'), null)
assert.deepEqual(findCustomSiteProfileBinding('naturaflow.weex.com.ar'), {
  hostname: 'naturaflow.weex.com.ar',
  businessCustomerCode: 'WX-TFN89J',
  serviceCatalogMode: 'ALL'
})

assert.match(landingUi, /findPublicBusinessFromHost\(request\)/)
assert.match(landingUi, /findPublicByCustomerCode\(customSiteBinding\.businessCustomerCode\)/)
assert.match(businessService, /async findPublicByCustomerCode\(customerCode: string\)/)

assert.match(
  tamaraSite,
  /<button class="btn btn-primary" type="button" data-open-consultation>Quiero mi consulta<\/button>/
)
assert.match(tamaraSite, /id="consultation-whatsapp-form"/)
assert.match(tamaraSite, /name="name" type="text"/)
assert.match(tamaraSite, /name="description" maxlength="1200"/)
assert.match(tamaraSite, /mi nombre es \$\{name\}\. Solicito agendar la Consulta Web con Tamara Grando\./)
assert.match(tamaraSite, /Motivo de la consulta: \$\{description\}/)
assert.match(tamaraSite, /https:\/\/wa\.me\/5491168255528\?text=\$\{encodeURIComponent\(message\)\}/)
assert.match(tamaraSite, /href="https:\/\/wa\.me\/5491168255528"[^>]*>WhatsApp: \+54 9 11 6825-5528<\/a>/)
assert.match(tamaraSite, /href="\/reservar" class="btn btn-outline">Agendar una consulta →<\/a>/)
assert.match(tamaraSite, /href="\/reservar" class="btn btn-outline" style="width:100%;">Agendar consulta directa<\/a>/)
assert.match(tamaraSite, /<a class="radio-opt" href="\/reservar">Agendar consulta<\/a>/)

assert.match(naturaFlowSite, /<title>Natura Flow \| Natalia Baez Riquelme<\/title>/)
assert.match(naturaFlowSite, /storage\/v1\/object\/public\/custom-sites\/natura-flow\/hero\.mp4/)
assert.match(naturaFlowSite, /href="\/reservar"/)
assert.doesNotMatch(naturaFlowSite, /5491112345678|contacto@nataliabaez\.com|Pedro de Valdivia/)
assert.match(naturaFlowRoute, /const naturaFlowHost = 'naturaflow\.weex\.com\.ar'/)
assert.match(naturaFlowRoute, /findPublicByCustomerCode\(naturaFlowBinding\.businessCustomerCode\)/)
assert.match(authGuard, /isNaturaFlowSitePublicRoute\(request, path\)/)
assert.match(server, /app\.register\(naturaFlowSiteRoutes\)/)

console.log('Custom site profile binding contract: OK (Tamara y Natura Flow conectadas a sus comercios)')
