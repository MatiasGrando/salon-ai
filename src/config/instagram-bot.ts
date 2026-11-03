import type { BotWorkerScope } from '../bot-options/infrastructure/tenant-scope.js'
export type InstagramBotConfig = { enabled: boolean; businessIds: readonly string[] }
/** Independent opt-in: never enables WhatsApp or publishes a bot configuration. */
export function resolveInstagramBotConfig(env: Record<string,string|undefined>): InstagramBotConfig {
  const value=env.INSTAGRAM_CONVERSATIONAL_BOT_ENABLED
  if(value!==undefined && value!=='true' && value!=='false') throw new Error('INSTAGRAM_CONVERSATIONAL_BOT_ENABLED must be true or false')
  const businessIds=[...new Set((env.INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS??'').split(',').map(item=>item.trim()).filter(Boolean))]
  if(value==='true'&&!businessIds.length)throw new Error('Instagram conversational rollout requires an explicit business allowlist')
  return {enabled:value==='true',businessIds}
}

/** Intersection with an existing process scope; selecting a rollout never consumes WA. */
export function instagramBotWorkerScope(config:InstagramBotConfig,current?:BotWorkerScope):BotWorkerScope|undefined {
  if(!config.enabled)return undefined
  const businessIds=config.businessIds.filter(businessId=>!current?.businessId||(current.mode==='exclude'?businessId!==current.businessId:businessId===current.businessId))
    .filter(businessId=>current?.businessIds===undefined||current.businessIds.includes(businessId))
  return businessIds.length?{businessIds,channels:['INSTAGRAM']}:undefined
}
