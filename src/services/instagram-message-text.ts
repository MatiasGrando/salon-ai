const INSTAGRAM_MESSAGE_MAX_LENGTH = 900
export function splitInstagramReply(
  reply: string,
  maxLength = INSTAGRAM_MESSAGE_MAX_LENGTH
) {
  const paragraphs = reply.trim().split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const messages: string[] = []
  let current = ''
  const push = () => {
    if (current) messages.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= maxLength) {
      current = candidate
      continue
    }
    push()
    let remaining = paragraph
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf(' ', maxLength)
      if (splitAt < Math.floor(maxLength * 0.6)) splitAt = maxLength
      messages.push(remaining.slice(0, splitAt).trim())
      remaining = remaining.slice(splitAt).trim()
    }
    current = remaining
  }
  push()
  return messages
}
