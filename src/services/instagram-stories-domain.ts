import { createHash, timingSafeEqual } from 'node:crypto'
export function storyCredentialFingerprint(config: any) {
  return createHash('sha256').update(JSON.stringify([config.businessId, config.instagramAccountId, config.apiAccountId || config.instagramAccountId, config.accessToken])).digest('hex')
}
export function hasStoryDeclaration(config: any) {
  if ((config?.tokenExpiresAt && new Date(config.tokenExpiresAt).getTime() <= Date.now()) || !config?.enabled || !config.accessToken || !config.instagramAccountId || !config.storiesDeclaredAt || !config.storiesDeclaredBy || !config.storiesDeclarationFingerprint) return false
  const expected = Buffer.from(storyCredentialFingerprint(config)), actual = Buffer.from(config.storiesDeclarationFingerprint)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
