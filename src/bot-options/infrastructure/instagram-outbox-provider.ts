import type { Prisma } from '../../generated/prisma/client.js'
import { InstagramApi,InstagramApiRequestError } from '../../integrations/instagram-api.js'
import { isInstagramSubject } from '../../conversational-bot/conversation-subject.js'
import { resolveInstagramSendTargetTx } from '../../conversational-bot/instagram-runtime-channel.js'
import type { OutboxProvider } from './whatsapp-outbox-sender.js'

/** Uses the established Instagram transport; no WhatsApp credentials or fallback. */
export class InstagramOutboxProvider implements OutboxProvider {
  private readonly api:Pick<InstagramApi,'sendTextMessage'>
  constructor(private readonly dependencies:{client:Pick<Prisma.TransactionClient,'$queryRaw'>;api?:Pick<InstagramApi,'sendTextMessage'>}){this.api=dependencies.api??new InstagramApi()}
  async send(input:Parameters<OutboxProvider['send']>[0],signal:AbortSignal){
    const value=input.payload as {channel?:unknown;subject?:unknown;revision?:unknown;to?:unknown;item?:{type?:unknown;body?:unknown}}|null
    if(value?.channel!=='INSTAGRAM'||!isInstagramSubject(value.subject)||value.to!==value.subject.externalUserId||typeof value.revision!=='string'||!/^\d+$/.test(value.revision)||value.item?.type!=='informative_text'||typeof value.item.body!=='string'||!value.item.body.trim()||value.item.body.length>900||!input.context){
      return {kind:'clear_failure' as const,code:'invalid_instagram_outbox',retryable:false}
    }
    let target:Awaited<ReturnType<typeof resolveInstagramSendTargetTx>>
    try {target=await resolveInstagramSendTargetTx(this.dependencies.client,{businessId:input.businessId,...input.context,expectedRevision:BigInt(value.revision),subject:value.subject})}
    catch {return {kind:'clear_failure' as const,code:'instagram_send_scope_unavailable',retryable:true}}
    if(!target)return {kind:'clear_failure' as const,code:'instagram_window_or_scope_closed',retryable:false}
    if(signal.aborted)return {kind:'clear_failure' as const,code:'instagram_send_aborted_before_post',retryable:true}
    try {
      const response=await this.api.sendTextMessage({instagramAccountId:target.apiAccountId??target.instagramAccountId,accessToken:target.accessToken,recipientId:value.subject.externalUserId,text:value.item.body,signal})
      if(!response.messageId)throw new Error('instagram_accepted_without_id')
      return {kind:'accepted' as const,providerMessageId:response.messageId}
    } catch(error){
      if(error instanceof InstagramApiRequestError&&!error.ambiguous)return {kind:'clear_failure' as const,code:'instagram_http_'+(error.metaCode??error.httpStatus??'rejected'),retryable:error.transient}
      // A timeout, aborted/uncertain POST or malformed success is UNKNOWN upstream.
      throw error
    }
  }
}
