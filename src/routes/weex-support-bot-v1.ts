import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import {
  WEEX_SUPPORT_BOT_V1_DEFINITION,
  WeexSupportBotV1,
  type WeexSupportBotState
} from '../services/weex-support-bot-v1.js'

const bot = new WeexSupportBotV1()
const simulatorPath = new URL('../assets/weex-bot-v1/simulator.html', import.meta.url)

export async function weexSupportBotV1Routes(app: FastifyInstance) {
  app.get('/weex/bot-v1', async (_request, reply) => {
    const html = await readFile(simulatorPath, 'utf8')
    return reply.type('text/html; charset=utf-8').send(html)
  })

  app.get('/public/weex/bot-v1/start', async () => bot.start())

  app.get('/public/weex/bot-v1/definition', async () => WEEX_SUPPORT_BOT_V1_DEFINITION)

  app.post('/public/weex/bot-v1/message', async (request, reply) => {
    const body = request.body as {
      input?: unknown
      state?: Partial<WeexSupportBotState> | null
    }
    if (typeof body?.input !== 'string') {
      return reply.status(400).send({ message: 'Falta la respuesta del usuario' })
    }
    if (body.input.length > 500) {
      return reply.status(400).send({ message: 'La respuesta no puede superar los 500 caracteres' })
    }
    return bot.handle(body.input, body.state)
  })
}
