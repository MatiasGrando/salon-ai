import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const demoRoute = await readFile('src/routes/demo-profile.ts', 'utf8')
const authGuard = await readFile('src/plugins/auth-guard.ts', 'utf8')
const authRoute = await readFile('src/routes/auth.ts', 'utf8')
const businessRoute = await readFile('src/routes/business.ts', 'utf8')
const crmUi = await readFile('src/routes/crm-ui.ts', 'utf8')
const landingUi = await readFile('src/routes/landing-ui.ts', 'utf8')

assert.match(demoRoute, /SHARED_SALES_DEMO_TYPES = \['NAILS', 'HAIR_SALON', 'BARBERSHOP', 'PILATES'\]/)
assert.match(demoRoute, /PILATES: \{[\s\S]*?Clase de Pilates Reformer[\s\S]*?Clase individual[\s\S]*?Evaluacion postural/)
assert.match(demoRoute, /BARBERSHOP: \{[\s\S]*?professionals: \['Lucas'\]/)
assert.match(demoRoute, /function canUseCommercialDemos/)
assert.match(demoRoute, /user\.canCreateBusinesses/)
assert.match(demoRoute, /demoType: \{ in: \[\.\.\.SHARED_SALES_DEMO_TYPES\] \}/)
assert.match(demoRoute, /demoType: 'QA_SANDBOX'/)
assert.match(demoRoute, /createdByUserId: user\.id/)
assert.match(
  demoRoute,
  /user\.role === 'SUPER_ADMIN'[\s\S]*?demoType: 'QA_SANDBOX'/,
  'Los sandbox QA deben estar disponibles para superadmin.'
)
assert.doesNotMatch(
  demoRoute,
  /demoType: 'QA_SANDBOX'[\s\S]{0,200}?accountAdminId: user\.id/,
  'Los administradores de cuenta no deben recibir sandbox QA.'
)
assert.match(demoRoute, /app\.get\('\/admin\/demo-profiles\/:id\/preview'/)
assert.match(demoRoute, /app\.get\('\/admin\/demo-profiles\/:id\/access'/)
assert.match(demoRoute, /renderLanding\(publicBusiness/)
assert.match(demoRoute, /app\.post\('\/admin\/demo-profiles\/:id\/chat'/)
assert.match(demoRoute, /request\.auth\?\.user\.role !== 'SUPER_ADMIN'/, 'Crear y eliminar demos debe continuar reservado al superadmin.')

assert.match(authGuard, /path === '\/admin\/demo-profiles'/)
assert.match(authGuard, /demo-profiles\\\/\[\^\/\]\+\\\/preview/)
assert.match(authGuard, /demo-profiles\\\/\[\^\/\]\+\\\/chat/)
assert.match(authGuard, /isAccountAdminDemoWorkspaceRoute/)
assert.match(authGuard, /auth\.user\.role === 'ACCOUNT_ADMIN' \|\| auth\.user\.canCreateBusinesses/)
assert.match(authGuard, /collectEntityBusinessId/)
assert.match(authGuard, /demoType: \{ in: \['NAILS', 'HAIR_SALON', 'BARBERSHOP', 'PILATES'\] \}/)
assert.doesNotMatch(authGuard, /demoType: 'QA_SANDBOX'/)
assert.match(authGuard, /path === '\/professionals'/)
assert.match(authGuard, /path === '\/services'/)
assert.match(authGuard, /path === '\/crm\/ai-settings'/)

assert.match(businessRoute, /auth\.user\.role === 'ACCOUNT_ADMIN' \|\| auth\.user\.canCreateBusinesses/)

assert.match(authRoute, /app\.post\('\/admin\/account-admins\/assign'[\s\S]*?auth\.user\.role !== 'SUPER_ADMIN'/)
assert.match(authRoute, /app\.patch\('\/admin\/account-admins\/:id'[\s\S]*?auth\.user\.role !== 'SUPER_ADMIN'/)
assert.match(authRoute, /app\.delete\('\/admin\/account-admins\/:id'[\s\S]*?auth\.user\.role !== 'SUPER_ADMIN'/)

assert.match(crmUi, /id="commercial-demo-management"/)
assert.match(crmUi, /id="commercial-demo-list"/)
assert.match(crmUi, /Ver landing/)
assert.match(crmUi, /Simular conversaci&oacute;n/)
assert.match(crmUi, /Entrar al perfil/)
assert.match(crmUi, /const allowedTypes = \['NAILS', 'HAIR_SALON', 'BARBERSHOP', 'PILATES'\]/)
assert.match(crmUi, /<option value="PILATES">Pilates<\/option>/)
assert.match(crmUi, /function enterCommercialDemo/)
assert.match(crmUi, /Volver a mi cuenta/)
assert.match(crmUi, /function returnToAccountAdminBusiness/)
assert.match(crmUi, /state\.currentSessionBusiness/)
assert.match(crmUi, /function canSeeSalesAdministration/)
assert.match(crmUi, /state\.currentUser\?\.canCreateBusinesses === true/)
assert.match(crmUi, /const isSalesAdminDemo = isSalesAccountAdministrator\(\) && state\.business\?\.isDemo === true/)
assert.match(crmUi, /isSalesAdmin && state\.business\?\.isDemo/)
assert.match(crmUi, /els\.accountAdminManagement\.hidden = state\.currentUser\?\.role !== 'SUPER_ADMIN'/, 'La gestión de administradores de cuentas debe permanecer oculta para cualquier usuario que no sea superadmin.')
assert.match(crmUi, /state\.currentUser\?\.role !== 'SUPER_ADMIN'/, 'La creación de perfiles demo debe permanecer oculta para administradores de cuentas.')

assert.match(landingUi, /export function renderLanding/)

console.log('Demo profile access contract: OK')
