const API = "https://discord.com/api/v10";

/** Edit the original (deferred) interaction response via the interaction webhook token. */
export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  body: unknown
): Promise<boolean> {
  const res = await fetch(
    `${API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  return res.ok;
}

/** Create a message in a channel (bot token). Returns the message id, or null on failure. */
export async function createChannelMessage(
  botToken: string,
  channelId: string,
  body: unknown
): Promise<string | null> {
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const msg = (await res.json()) as { id?: string };
  return msg.id ?? null;
}

/** Edit an existing channel message (bot token). */
export async function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  body: unknown
): Promise<boolean> {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Overwrite a guild's application commands (bot token). */
export async function registerGuildCommands(
  botToken: string,
  applicationId: string,
  guildId: string,
  commands: unknown[]
): Promise<Response> {
  return fetch(`${API}/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: "PUT",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
}
