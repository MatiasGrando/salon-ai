import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH='__instagram_bot_effects_no_env__'
process.env.DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline'
const { assertManagementScope }=await import('../src/conversational-bot/appointment-management.js')
const { runtimeBookingRequestHash }=await import('../src/conversational-bot/prisma-conversational-booking.js')
const subject={channel:'INSTAGRAM' as const,instagramLeadId:'lead',instagramAccountId:'ig-account',externalUserId:'5491112345678'}
assert.doesNotThrow(()=>assertManagementScope({businessId:'business',customerId:'ig-customer',sessionId:'ig-session',subject} as never),'Instagram appointment ownership must accept an exact persisted channel identity without a fake phone')
assert.throws(()=>assertManagementScope({businessId:'business',customerId:'ig-customer',sessionId:'ig-session',subject,normalizedPhone:'5491112345678'} as never),'A mixed IG/phone authority is invalid')
assert.doesNotThrow(()=>assertManagementScope({businessId:'business',customerId:'wa-customer',sessionId:'wa-session',normalizedPhone:'5491112345678'}))
const origin={kind:'RUNTIME' as const,businessId:'business',sessionId:'ig-session',subject,revision:1n,deploymentId:'deployment',generation:1,configurationId:'configuration',dispatchFenceEpoch:1,handoffFenceEpoch:0,operationKey:'effect',newBookingAllowed:true}
const presented={scope:{},version:1} as never
assert.notEqual(runtimeBookingRequestHash(origin as never,presented),runtimeBookingRequestHash({...origin,subject:{...subject,instagramAccountId:'other-account'}} as never,presented),'IG booking receipts must bind the account and channel identity, not omit it as a missing phone')
console.log('OK: shared appointment/booking authority discriminates Instagram from WhatsApp and binds receipts')
