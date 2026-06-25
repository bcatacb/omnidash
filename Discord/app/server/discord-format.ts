/**
 * Format a Discord MESSAGE_CREATE payload's content + sticker + attachment
 * fields into a display-ready string for the unibox.
 *
 * Attachment encoding convention (parsed by ChatPane):
 *   [img:URL]   — image attachment (appended after caption if present)
 *   [voice:URL] — Discord voice message (flags & 8192, or audio/* content-type)
 *   [file:NAME:URL] — any other attachment
 */
// Type 0 = DEFAULT, 3 = CALL (critical), 19 = REPLY, 20 = SLASH_COMMAND, 23 = CONTEXT_MENU.
// Everything else is a system event (join, pin, boost, etc.) and should be hidden.
export function isSystemMessage(raw: any): boolean {
  if (raw?.author?.system === true) return true;
  const t = Number(raw?.type ?? 0);
  return t !== 0 && t !== 3 && t !== 19 && t !== 20 && t !== 23;
}

export function formatDiscordContent(raw: any): string {
  const content = String(raw?.content || "");
  const mentions: any[] = Array.isArray(raw?.mentions) ? raw.mentions : [];
  const mentionById = new Map<string, string>();
  for (const m of mentions) {
    const id = String(m?.id || "");
    const name = m?.global_name || m?.username || id;
    if (id) mentionById.set(id, String(name));
  }

  let body = content
    .replace(/<@!?(\d+)>/g, (_match: string, id: string) => `@${mentionById.get(id) || id}`)
    .replace(/<#(\d+)>/g, "#$1")
    .replace(/<@&(\d+)>/g, "@role")
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ":$1:");

  const attachments: any[] = Array.isArray(raw?.attachments) ? raw.attachments : [];

  if (!body.trim()) {
    const stickers: any[] = Array.isArray(raw?.sticker_items) ? raw.sticker_items : [];
    if (stickers.length > 0) {
      body = `[${stickers[0]?.name || "sticker"}]`;
    } else if (attachments.length > 0) {
      body = encodeAttachment(raw, attachments[0]);
      for (let i = 1; i < attachments.length; i++) {
        body += "\n" + encodeAttachment(raw, attachments[i]);
      }
    }
  } else if (attachments.length > 0) {
    // Caption + attachment — append the tag after the caption text.
    body += "\n" + encodeAttachment(raw, attachments[0]);
    for (let i = 1; i < attachments.length; i++) {
      body += "\n" + encodeAttachment(raw, attachments[i]);
    }
  }

  return body;
}

function encodeAttachment(raw: any, a: any): string {
  const url = String(a?.url || "");
  if (!url) return `[attachment: ${a?.filename || "file"}]`;
  const ct = String(a?.content_type || "");
  const isVoice = !!(Number(raw?.flags) & 8192) || ct.startsWith("audio/");
  if (isVoice) return `[voice:${url}]`;
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return `[img:${url}]`;
  return `[file:${a?.filename || "file"}:${url}]`;
}
