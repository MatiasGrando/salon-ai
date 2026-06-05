import 'dotenv/config'

export const openAiConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  enabled: process.env.OPENAI_ENABLED !== 'false',
  orchestratorEnabled: process.env.OPENAI_ORCHESTRATOR_ENABLED === 'true',
  copyEnabled: process.env.OPENAI_COPY_ENABLED !== 'false'
}
