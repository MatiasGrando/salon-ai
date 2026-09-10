import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findCustomSiteProfileBinding } from '../src/services/custom-site-profile-binding.js'
import Fastify from 'fastify'
import { BusinessService } from '../src/services/business-service.js'
import { yamilaSiteRoutes } from '../src/routes/yamila-site.js'
import { authGuard } from '../src/plugins/auth-guard.js'
assert.equal(findCustomSiteProfileBinding('yamila-sacco.weex.com.ar')?.businessCustomerCode, 'WX-J82QB3')
const html = await readFile('src/assets/yamila-site/index.html', 'utf8')
assert.ok((html.match(/href="\/reservar"/g) || []).length >= 7)
assert.ok(!html.includes('https://weex.com/yamila-sacco'))
const server = await readFile('src/server.ts', 'utf8')
assert.ok(server.includes('app.register(yamilaSiteRoutes)'))
const original = BusinessService.prototype.findPublicByCustomerCode
let available = true
BusinessService.prototype.findPublicByCustomerCode = async (code: string) => {
  assert.equal(code, 'WX-J82QB3')
  return (available ? { landingEnabled: true, accountStatus: 'ACTIVE' } : null) as any
}
const app = Fastify()
try {
  await app.register(yamilaSiteRoutes)
  await authGuard(app)
  for (const url of ['/', '/styles.css', '/main.js', '/images/hero.jpg']) {
    const response = await app.inject({url, headers: {host:'yamila-sacco.weex.com.ar'}})
    assert.equal(response.statusCode, 200, url)
  }
  assert.notEqual((await app.inject({url:'/images/hero.jpg',headers:{host:'otro.weex.com.ar'}})).statusCode,200)
  available = false
  assert.equal((await app.inject({url:'/',headers:{host:'yamila-sacco.weex.com.ar'}})).statusCode,503)
} finally {
  BusinessService.prototype.findPublicByCustomerCode = original
  await app.close()
}
console.log('Yamila site contract: OK')
