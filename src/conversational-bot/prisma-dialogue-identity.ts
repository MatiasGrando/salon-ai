import { normalizeAssistantPersonality } from '../services/assistant-personality-config.js'
import { validateDialogueIdentity, type DialogueIdentity } from './dialogue-identity.js'

export type DialogueIdentityClient = {
  business: { findFirst(args: { where: { id: string }; select: { id: true; name: true } }): Promise<{ id: string; name: string } | null> }
  businessFeatureSettings: { findUnique(args: { where: { businessId: string }; select: { businessId: true; assistantPersonality: true } }): Promise<{ businessId: string; assistantPersonality: unknown } | null> }
}
/** Inject a scoped client; read only on first introduction, never cache personality or access global Prisma. */
export async function loadDialogueIdentity(client: DialogueIdentityClient, businessId: string,
  publicBusiness?: { businessId: string; businessName: string }): Promise<DialogueIdentity> {
  if (!businessId || businessId.length > 128 || /[\u0000-\u001f]/.test(businessId) || publicBusiness && publicBusiness.businessId !== businessId) throw new Error('invalid identity scope')
  const row = publicBusiness ? { id: publicBusiness.businessId, name: publicBusiness.businessName }
    : await client.business.findFirst({ where: { id: businessId }, select: { id: true, name: true } })
  if (!row || row.id !== businessId) throw new Error('invalid identity scope')
  const settings = await client.businessFeatureSettings.findUnique({ where: { businessId }, select: { businessId: true, assistantPersonality: true } })
  if (settings && settings.businessId !== businessId) throw new Error('invalid identity scope')
  const profile = normalizeAssistantPersonality(settings?.assistantPersonality)
  return validateDialogueIdentity({ businessId, businessName: (publicBusiness ? row.name : profile.commercialName ?? row.name).trim().replace(/\s+/g, ' '), assistantName: profile.name, treatment: profile.treatment, greetingEmoji: profile.emojiLevel === 'none' ? null : profile.preferredEmojis[0] ?? null })
}
