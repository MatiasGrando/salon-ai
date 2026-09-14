import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  channelConversationId,
  channelMessageId,
  parseChannelResourceId
} from '../src/services/conversation-channel-service.js'

assert.equal(channelConversationId('INSTAGRAM', 'lead-1'), 'instagram:lead-1')
assert.equal(channelMessageId('INSTAGRAM', 'message-1'), 'instagram-message:message-1')
assert.deepEqual(parseChannelResourceId('instagram:lead-1'), { channel: 'INSTAGRAM', resourceId: 'lead-1', resourceType: 'conversation' })
assert.deepEqual(parseChannelResourceId('instagram-message:message-1'), { channel: 'INSTAGRAM', resourceId: 'message-1', resourceType: 'message' })
assert.equal(parseChannelResourceId('whatsapp-conversation'), null)

const crm = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const webhook = readFileSync(new URL('../src/services/instagram-webhook-service.ts', import.meta.url), 'utf8')

assert.match(crm, /listChannelConversations[\s\S]*?channelConversations/,
  'la bandeja debe agregar proyecciones normalizadas de canales externos')
assert.match(crm, /parseChannelResourceId\(params\.id\)[\s\S]*?loadChannelConversationMessages/,
  'los mensajes deben resolverse según el canal sin reutilizar tablas de WhatsApp')
assert.match(crm, /sendChannelConversationReply/,
  'la respuesta manual debe despacharse mediante el adaptador del canal')
assert.match(ui, /conversationChannelLabel\(conversation\.channel\)/,
  'cada conversación debe identificar visualmente su canal')
assert.match(ui, /selected\.channel !== 'WHATSAPP'/,
  'los detalles específicos de WhatsApp no deben mostrarse en otros canales')
assert.match(webhook, /channelConversationId\('INSTAGRAM', lead\.id\)/,
  'el webhook de Instagram debe emitir eventos con el id normalizado de la bandeja')

console.log('Instagram channel inbox contract: OK')
