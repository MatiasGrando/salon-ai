export type ChannelId = "manychat" | "telegram" | "twilio" | "messenger" | "instagram" | "whatsapp" | "web";

// El proveedor mandó un update que NO es un mensaje procesable (Telegram:
// edited_message, callback_query, my_chat_member…). NO es un error de infra:
// hay que responder 200 para que el canal no lo reintente en loop. parseIncoming
// la lanza; routeToAgent la traduce a un 200 "ignorado".
export class IgnoredUpdate extends Error {
  constructor(reason = "update ignorado") {
    super(reason);
    this.name = "IgnoredUpdate";
  }
}

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
  receivedAt: number;
  rawPayload: unknown;
  /** id del mensaje en el proveedor (Meta mid / WhatsApp id) — dedup de
   *  reenvíos del webhook. Opcional: canales sin id no deduplican. */
  providerMessageId?: string;
}

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  chunks: string[];
  interChunkDelayMs?: number;
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
}
