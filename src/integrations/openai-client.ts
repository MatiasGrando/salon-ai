import OpenAI from 'openai'
import { openAiConfig } from '../config/openai.js'

let client: OpenAI | null = null

export function getOpenAiClient() {
  if (!openAiConfig.enabled || !openAiConfig.apiKey) {
    return null
  }

  client ??= new OpenAI({
    apiKey: openAiConfig.apiKey
  })

  return client
}
