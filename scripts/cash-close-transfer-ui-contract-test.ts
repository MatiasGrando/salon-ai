import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
assert.match(source, /id="cash-close-leave-change"/)
assert.match(source, /id="cash-close-cash-to-leave"/)
assert.match(source, /id="cash-close-transfer-amount"/)
assert.match(source, /cashUi\.closeLeaveChange\.checked/)
assert.match(source, /payload\.cashToLeave = cashToLeave/)
assert.match(source, /state\.currentUser\?\.role === 'STAFF'/)
console.log('OK UI cierre con cambio y traspaso de Tesoreria')
