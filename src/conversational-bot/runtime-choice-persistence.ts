import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { renderWhatsAppScreen, truncateLabelWordSafe } from '../bot-options/infrastructure/whatsapp-renderer.js'
import { generatePromptToken } from '../bot-options/domain/prompt-tokens.js'
import { recordProducedOutbox } from '../bot-options/observability/queue-milestones.js'
import { parseChoiceQuestion, preferredChoiceMode, publicChoiceQuestion, resolveChoice, type ChoiceQuestion, type ChoiceScope } from './choices.js'
import type { ConsolidationEnvelope } from './inbound-consolidation.js'
export const CONVERSATION_CHOICE_ACTION = 'conversation.choice' as const
export type ConversationChoicePayload = { question: ChoiceQuestion; choiceId: string }
/** Resolve only the stored finite operation; transport text and labels are never compiled into actions. */
export function resolveConversationChoicePayload(value: unknown, scope: ChoiceScope, draft: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'choiceId,question') throw new Error('invalid conversation choice payload')
  const payload = value as Record<string, unknown>
  if (typeof payload.choiceId !== 'string') throw new Error('invalid conversation choice payload')
  return resolveChoice(parseChoiceQuestion(payload.question), scope, draft, payload.choiceId)
}
/** The neutral renderer action exists only in memory for layout. EVERY persisted row is explicitly remapped. */
export function planConversationChoiceView(input: { question: ChoiceQuestion; reply: string; transitionId: string; promptToken?: string; idFactory?: () => string }) {
  const question = parseChoiceQuestion(input.question)
  const id = input.idFactory ?? randomUUID, promptToken = input.promptToken ?? generatePromptToken()
  const body = question.choices.every(choice => input.reply.includes(choice.label)) ? input.reply : input.reply + '\n\n' + question.choices.map(choice => choice.label).join(' · ')
  const rendered = renderWhatsAppScreen({ bodyKind: 'menu', informativeTexts: [], interactiveBody: body,
    choices: question.choices.map(choice => ({ label: choice.label, actionType: 'input.unsupported' })) }, { promptToken })
  if (preferredChoiceMode(question.choices.map(choice => choice.label)) === 'list') {
    rendered.items = rendered.items.map(item => item.type === 'interactive' && item.mode === 'buttons' ? {
      type: 'interactive' as const, mode: 'list' as const, body: item.body, actionIds: item.actionIds,
      rows: question.choices.map((choice, index) => ({ id: item.actionIds[index]!, title: truncateLabelWordSafe(choice.label,24).label,
        ...(choice.label.length > 24 ? {description:truncateLabelWordSafe(choice.label,72).label} : {}) })), buttonText:'Elegí una opción', sectionTitle:'Opciones'
    } : item)
  }
  const promptId = id(), publicChoices = publicChoiceQuestion(question).choices
  const choiceRows = rendered.choiceMappings.map(choice => {
    const selected = publicChoices[choice.sortOrder]
    if (!selected) throw new Error('conversation choice mapping lost')
    return { id:id(), promptId, choiceToken:choice.choiceToken, actionType:CONVERSATION_CHOICE_ACTION, entityType:null, entityId:null,
      payload:{question,choiceId:selected.id} satisfies ConversationChoicePayload, labelSnapshot:choice.labelSnapshot, sortOrder:choice.sortOrder }
  })
  if (choiceRows.length !== question.choices.length || choiceRows.some(choice => choice.actionType !== CONVERSATION_CHOICE_ACTION)) throw new Error('invalid conversation choice plan')
  const deliveryGroupId = id()
  const outboxRows = rendered.items.flatMap((item,index) => item.type === 'none' ? [] : [{ id:id(),deliveryGroupId,sequence:index,kind:item.type,item,
    idempotencyKey:input.transitionId + ':' + index,dependsOnSequence:index > 0 && rendered.interactiveDependsOnPrevious ? index-1 : null }])
  const interactiveOutboxId = outboxRows.find(row => row.kind === 'interactive')?.id
  if (!interactiveOutboxId) throw new Error('conversation prompt requires interactive outbox')
  return {promptId,promptToken,choiceRows,outboxRows,interactiveOutboxId}
}
/** Ordered statements reuse the current prompt tables inside the caller's already guarded final transaction. */
export async function persistConversationChoiceViewTx(tx: Pick<Prisma.TransactionClient,'$executeRaw'|'$queryRaw'>, input: {
  scope: ChoiceScope; draft: unknown; question: ChoiceQuestion; reply: string; transitionId: string; toPhone: string; dbNow: Date
  consolidation?: ConsolidationEnvelope | undefined
}) {
  if (!input.toPhone || !Number.isFinite(input.dbNow.getTime())) throw new Error('invalid conversation choice destination')
  const question = parseChoiceQuestion(input.question)
  const firstId = publicChoiceQuestion(question).choices[0]!.id
  resolveChoice(question,input.scope,input.draft,firstId)
  const revision = BigInt(input.scope.revision), scope = input.scope
  const plan = planConversationChoiceView({question,reply:input.reply,transitionId:input.transitionId})
  await tx.$executeRaw(Prisma.sql`
    /* conversation-choice-invalidate */
    UPDATE "BotPrompt" p SET "status"='INVALIDATED'::"BotPromptStatus", "resolvedAt"=clock_timestamp()
    FROM "BotSession" s WHERE p."sessionId"=s."id" AND s."id"=${scope.conversationKey} AND s."businessId"=${scope.businessId}
      AND s."revision"=${revision} AND s."deploymentGeneration"=${scope.policyGeneration}
      AND s."status"='ACTIVE'::"BotSessionStatus" AND s."handoffClaimsPausedAt" IS NULL
      AND p."status" IN ('OPEN'::"BotPromptStatus",'STABILIZING'::"BotPromptStatus")
  `)
  const promptCount = await tx.$executeRaw(Prisma.sql`
    /* conversation-choice-prompt */
    INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","mode","status","openedAt","outboxMessageId")
    SELECT ${plan.promptId},s."id",${plan.promptToken},${revision},'FUNCTIONAL'::"BotPromptMode",'OPEN'::"BotPromptStatus",${input.dbNow},${plan.interactiveOutboxId}
    FROM "BotSession" s WHERE s."id"=${scope.conversationKey} AND s."businessId"=${scope.businessId} AND s."revision"=${revision}
      AND s."deploymentGeneration"=${scope.policyGeneration} AND s."status"='ACTIVE'::"BotSessionStatus" AND s."handoffClaimsPausedAt" IS NULL
  `)
  if (promptCount !== 1) throw new Error('conversation choice scope or revision lost')
  const counts = await tx.$queryRaw<Array<{choiceCount:bigint;outboxCount:bigint}>>(Prisma.sql`
    /* conversation-choice-persist */
    WITH choices AS (
      INSERT INTO "BotPromptChoice" ("id","promptId","choiceToken","actionType","entityType","entityId","payload","labelSnapshot","sortOrder")
      VALUES ${Prisma.join(plan.choiceRows.map(choice => Prisma.sql`(${choice.id},${plan.promptId},${choice.choiceToken},${CONVERSATION_CHOICE_ACTION},NULL,NULL,${JSON.stringify(choice.payload)}::jsonb,${choice.labelSnapshot},${choice.sortOrder})`))}
      RETURNING "id"
    ), outbox AS (
      INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","dependsOnSequence","availableAt","updatedAt")
      SELECT planned.*,clock_timestamp() FROM (VALUES ${Prisma.join(plan.outboxRows.map(row => Prisma.sql`(${row.id},${scope.businessId},${scope.conversationKey},${input.transitionId},${row.deliveryGroupId},${row.sequence}::integer,${row.kind},${JSON.stringify({to:input.toPhone,item:row.item,...(input.consolidation?{consolidation:input.consolidation}:{})})}::jsonb,${row.idempotencyKey},'PENDING'::"BotOutboxStatus",${row.dependsOnSequence}::integer,${input.dbNow}::timestamptz)`))}) planned
      WHERE (SELECT count(*) FROM choices)=${plan.choiceRows.length} RETURNING "id"
    ) SELECT (SELECT count(*) FROM choices)::bigint AS "choiceCount",(SELECT count(*) FROM outbox)::bigint AS "outboxCount"
  `)
  if (counts[0]?.choiceCount !== BigInt(plan.choiceRows.length) || counts[0].outboxCount !== BigInt(plan.outboxRows.length)) throw new Error('conversation choice persistence count mismatch')
  for (const row of plan.outboxRows) recordProducedOutbox(tx,{businessId:scope.businessId,id:row.id})
}
