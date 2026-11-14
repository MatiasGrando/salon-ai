import type { BotWorkerScope } from '../bot-options/infrastructure/tenant-scope.js'
export type InstagramBotConfig = { enabled: boolean; businessIds?: readonly string[] }
export const INSTAGRAM_DEFAULT_BOT_KEY = 'commercial-instagram-conversational-v1'

export function resolveInstagramBotConfig(env: Record<string,string|undefined>): InstagramBotConfig {
  const value=env.INSTAGRAM_CONVERSATIONAL_BOT_ENABLED
  if(value!==undefined && value!=='true' && value!=='false') throw new Error('INSTAGRAM_CONVERSATIONAL_BOT_ENABLED must be true or false')
  const businessIds=[...new Set((env.INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS??'').split(',').map(item=>item.trim()).filter(Boolean))]
  return {enabled:value!=='false',...(businessIds.length?{businessIds}:{})}
}

export function instagramBotSelected(config: InstagramBotConfig, businessId: string): boolean {
  return config.enabled && (config.businessIds === undefined || config.businessIds.includes(businessId))
}

export function instagramBotAiReady(env: Record<string,string|undefined>): boolean {
  return env.CONVERSATIONAL_INSTAGRAM_AI_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY?.trim())
}

export function instagramBotScopeIncludes(scope: BotWorkerScope | undefined, businessId: string): boolean {
  return !!scope && (!scope.businessId || (scope.mode === 'exclude' ? scope.businessId !== businessId : scope.businessId === businessId)) &&
    (scope.businessIds === undefined || scope.businessIds.includes(businessId))
}

/** Intersection with an existing process scope; selecting Instagram never consumes WA. */
export function instagramBotWorkerScope(config:InstagramBotConfig,current?:BotWorkerScope):BotWorkerScope|undefined {
  if (!config.enabled || current?.channels && !current.channels.includes('INSTAGRAM')) return undefined
  if (config.businessIds === undefined) return { ...current, channels: ['INSTAGRAM'] }
  const businessIds=config.businessIds.filter(businessId=>instagramBotScopeIncludes(current ?? {},businessId))
  return businessIds.length?{businessIds,channels:['INSTAGRAM']}:undefined
}
