import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findCustomSiteProfileBinding } from '../src/services/custom-site-profile-binding.js'

const [route, authGuard, server, rootPackage, sitePackage, plateService, plateLookup] = await Promise.all([
  readFile('src/routes/lubricentro-site.ts', 'utf8'),
  readFile('src/plugins/auth-guard.ts', 'utf8'),
  readFile('src/server.ts', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('sites/lubricentro-albarellos/package.json', 'utf8'),
  readFile('sites/lubricentro-albarellos/src/services/plateService.js', 'utf8'),
  readFile('sites/lubricentro-albarellos/src/components/PlateLookup.jsx', 'utf8')
])

assert.deepEqual(findCustomSiteProfileBinding('lubricentro.weex.com.ar'), {
  hostname: 'lubricentro.weex.com.ar',
  businessCustomerCode: 'WX-8Y4HHG',
  serviceCatalogMode: 'ALL'
})

assert.match(route, /const lubricentroHost = 'lubricentro\.weex\.com\.ar'/)
assert.match(route, /findPublicByCustomerCode\(lubricentroBinding\.businessCustomerCode\)/)
assert.match(route, /sites['"], ['"]lubricentro-albarellos['"], ['"]dist/)
assert.match(route, /constraints: \{ host: lubricentroHost \}/)
assert.match(route, /Cache-Control/)
assert.match(authGuard, /isLubricentroSitePublicRoute\(request, path\)/)
assert.match(server, /app\.register\(lubricentroSiteRoutes\)/)
assert.match(rootPackage, /"build:lubricentro"/)
assert.match(rootPackage, /"test:lubricentro-site"/)
assert.match(sitePackage, /"build": "vite build"/)
assert.match(plateService, /VITE_WORKSHOP_CUSTOMER_CODE \|\| 'WX-8Y4HHG'/)
assert.match(plateService, /\/public\/workshops\//)
assert.doesNotMatch(plateService, /mockVehicles/)
assert.match(plateLookup, /fetchVehicleHistoryPage/)
assert.doesNotMatch(plateLookup, /PATENTES DE PRUEBA|demoPlates|demoQuick/i)

console.log('Lubricentro custom site contract: OK')
