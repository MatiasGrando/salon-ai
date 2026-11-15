export function hasStoryConnection(config: any) {
  return !!(config?.enabled && config.accessToken && config.instagramAccountId &&
    (!config.tokenExpiresAt || new Date(config.tokenExpiresAt).getTime() > Date.now()))
}

export function instagramPublicationWorkerScope(businessIds: readonly string[] | undefined, storiesEnabled: boolean) {
  const reels = { publicationType: 'REEL', ...(businessIds ? { businessId: { in: businessIds } } : {}) }
  return storiesEnabled ? { OR: [reels, { publicationType: 'STORY' }] } : reels
}
