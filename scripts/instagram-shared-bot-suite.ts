import { spawnSync } from 'node:child_process'
const scripts=[
  'instagram-shared-bot-test.ts','instagram-shared-bot-effects-test.ts','instagram-shared-bot-media-test.ts',
  'instagram-shared-bot-crm-test.ts','instagram-shared-bot-routing-test.ts','instagram-shared-bot-runtime-test.ts',
  'conversational-bot-appointment-management-test.ts','conversational-bot-appointment-management-context-test.ts',
  'conversational-bot-booking-runtime-pglite-test.ts','conversational-bot-coordinated-deposit-pglite-test.ts',
  'instagram-whatsapp-routing-isolation-test.ts'
]
for(const script of scripts){
  const result=spawnSync(process.execPath,['--import','tsx','scripts/'+script],{stdio:'inherit',env:{...process.env,DOTENV_CONFIG_PATH:'__instagram_shared_bot_offline_no_env__',DATABASE_URL:'postgresql://offline:offline@127.0.0.1:1/offline'}})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status??1)
}
console.log('Instagram shared conversational bot offline suite: PASS')
