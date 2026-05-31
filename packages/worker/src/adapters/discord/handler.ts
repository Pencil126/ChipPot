import type { Env } from "../../env";
import { parseSettings } from "../../env";
import { json } from "../../http";
import { taipeiPeriod } from "../../core/time";
import {
  getWorkspaceIdByGuild, getUserByDiscordId, listActiveSubscriptions,
  listActiveChannelTags, listSettleablePayments,
} from "../../core/db";
import { ensurePeriodPayment, initiateBillingOpened } from "../../core/billing";
import { settleUserPeriod, assertImageOk, extForContentType, InvalidImage } from "../../core/storage";
import { discordNotifier } from "./notify";
import { editOriginalResponse } from "./api";
import {
  IT_COMMAND, IT_COMPONENT, IT_AUTOCOMPLETE, IT_MODAL_SUBMIT,
  RT_MESSAGE, RT_DEFERRED, RT_UPDATE_MESSAGE, RT_AUTOCOMPLETE, FLAG_EPHEMERAL,
  PAY_BUTTON_PREFIX, PAY_SELECT_PREFIX, INITIATE_MODAL_PREFIX,
  channelSelectRow, initiateModal,
} from "./commands";

export interface DiscordAttachment {
  url: string;
  content_type?: string;
  size?: number;
  filename?: string;
}
export interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  guild_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: { name: string; value?: string; focused?: boolean }[];
    resolved?: { attachments?: Record<string, DiscordAttachment> };
    components?: { components: { custom_id: string; value: string }[] }[];
  };
}

const ephemeral = (content: string) =>
  json({ type: RT_MESSAGE, data: { content, flags: FLAG_EPHEMERAL } });

function discordUserId(i: DiscordInteraction): string | null {
  return i.member?.user?.id ?? i.user?.id ?? null;
}
function getOption(i: DiscordInteraction, name: string) {
  return i.data?.options?.find((o) => o.name === name);
}

/** Entry point: dispatch a (signature-verified) interaction. `ctx` enables waitUntil. */
export function routeInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Response | Promise<Response> {
  switch (interaction.type) {
    case IT_AUTOCOMPLETE:
      return handleAutocomplete(interaction, env);
    case IT_COMMAND:
      return handleCommand(interaction, env, ctx);
    case IT_COMPONENT:
      return handleComponent(interaction, env);
    case IT_MODAL_SUBMIT:
      return handleModalSubmit(interaction, env, ctx);
    default:
      return ephemeral("未支援的互動。");
  }
}

// ── Autocomplete: 渠道 → active channel tags ─────────────────────────────────

async function handleAutocomplete(i: DiscordInteraction, env: Env): Promise<Response> {
  const choices: { name: string; value: string }[] = [];
  if (i.guild_id) {
    const ws = await getWorkspaceIdByGuild(env.DB, i.guild_id);
    if (ws) {
      const tags = await listActiveChannelTags(env.DB, ws);
      for (const t of tags.slice(0, 25)) choices.push({ name: t.name, value: String(t.id) });
    }
  }
  return json({ type: RT_AUTOCOMPLETE, data: { choices } });
}

// ── Shared member resolution ─────────────────────────────────────────────────

/** Returns { ws, userId } or an ephemeral error Response. */
async function resolveMember(
  i: DiscordInteraction, env: Env
): Promise<{ ws: number; userId: number } | Response> {
  if (!i.guild_id) return ephemeral("此互動需在伺服器內使用。");
  const ws = await getWorkspaceIdByGuild(env.DB, i.guild_id);
  if (!ws) return ephemeral("此伺服器尚未設定繳費系統。");
  const did = discordUserId(i);
  if (!did) return ephemeral("無法辨識你的 Discord 帳號。");
  const user = await getUserByDiscordId(env.DB, ws, did);
  if (!user) return ephemeral("你還不是登記的成員，請聯絡管理員新增。");
  return { ws, userId: user.id };
}

// ── Commands ─────────────────────────────────────────────────────────────────

function handleCommand(i: DiscordInteraction, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
  if (i.data?.name === "繳費") {
    // Defer immediately (ephemeral); do all work in the background, then edit the reply.
    ctx.waitUntil(deferredReply(i, env));
    return json({ type: RT_DEFERRED, data: { flags: FLAG_EPHEMERAL } });
  }
  if (i.data?.name === "發起繳費") return handleInitiateCommand(i, env);
  return ephemeral("未知指令。");
}

/** Guarantees exactly one followup edit — never leaves the deferred reply hanging. */
async function deferredReply(i: DiscordInteraction, env: Env): Promise<void> {
  let content: string;
  try {
    content = await computePayResult(i, env);
  } catch (err) {
    console.error("pay command failed", err);
    content = "處理失敗，請稍後再試。";
  }
  await editOriginalResponse(env.DISCORD_APPLICATION_ID ?? "", i.token, { content }).catch(() => {});
}

function isDiscordCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      (u.hostname === "cdn.discordapp.com" || u.hostname === "media.discordapp.net");
  } catch {
    return false;
  }
}

/** `/繳費`: settle ALL of the user's period subs. 渠道 / 截圖 / 備註 — at least one. */
async function computePayResult(i: DiscordInteraction, env: Env): Promise<string> {
  const m = await resolveMember(i, env);
  if (m instanceof Response) return ((await m.json()) as any).data.content;
  const { ws, userId } = m;

  const subs = await listActiveSubscriptions(env.DB, ws, userId);
  if (subs.length === 0) return "你目前沒有有效訂閱。";

  const period = taipeiPeriod();
  const note = getOption(i, "備註")?.value?.trim() || null;

  // Resolve declared channel (autocomplete value is a channel_tag id).
  let declaredChannelTagId: number | null = null;
  const chanOpt = getOption(i, "渠道")?.value;
  if (chanOpt) {
    const tagId = Number(chanOpt);
    const tags = await listActiveChannelTags(env.DB, ws);
    if (!tags.some((t) => t.id === tagId)) return "選擇的渠道無效，請重新選擇。";
    declaredChannelTagId = tagId;
  }

  // Optional screenshot.
  let proof: { body: ArrayBuffer; ext: string; contentType: string } | null = null;
  const attachOpt = getOption(i, "截圖");
  const attachment = attachOpt?.value ? i.data?.resolved?.attachments?.[attachOpt.value] : undefined;
  if (attachment) {
    const ct = attachment.content_type ?? "";
    try { assertImageOk(ct, attachment.size ?? 0); }
    catch (e) { if (e instanceof InvalidImage) return "截圖格式不支援或檔案過大，請改用備註或渠道。"; throw e; }
    if (!isDiscordCdnUrl(attachment.url)) return "截圖來源無效。";
    const res = await fetch(attachment.url);
    if (!res.ok) return "下載截圖失敗，請稍後再試。";
    const body = await res.arrayBuffer();
    try { assertImageOk(ct, body.byteLength); } catch { return "截圖檔案過大。"; }
    proof = { body, ext: extForContentType(ct), contentType: ct };
  }

  // At-least-one rule (slash): 渠道 / 截圖 / 備註.
  if (!declaredChannelTagId && !proof && !note) {
    return "請至少選擇「渠道」、附上「截圖」或填寫「備註」其中一項。";
  }

  const r = await settleUserPeriod(env, {
    workspaceId: ws, userId, period, source: "user_slash",
    declaredChannelTagId, paymentNote: note, proof,
  });
  if (r.paidCount === 0) return `本期（${period}）已登記繳費，無需重複操作。`;
  return `✅ 已登記本期（${period}）繳費 NT$${r.totalAmount.toLocaleString()}（共 ${r.paidCount} 筆）。管理員確認收款後完成。`;
}

// ── 發起繳費 (admin): modal open + modal submit ──────────────────────────────

async function isAdmin(env: Env, ws: number, discordId: string | null): Promise<boolean> {
  if (!discordId) return false;
  const row = await env.DB.prepare("SELECT settings FROM workspaces WHERE id = ?").bind(ws).first<{ settings: string }>();
  if (!row) return false;
  return parseSettings(row.settings).admin_discord_ids.includes(discordId);
}

async function handleInitiateCommand(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!i.guild_id) return ephemeral("此互動需在伺服器內使用。");
  const ws = await getWorkspaceIdByGuild(env.DB, i.guild_id);
  if (!ws) return ephemeral("此伺服器尚未設定繳費系統。");
  if (!(await isAdmin(env, ws, discordUserId(i)))) return ephemeral("你沒有發起繳費的權限。");

  const plans = await env.DB
    .prepare("SELECT id, name, monthly_amount FROM plans WHERE workspace_id = ? AND active = 1 ORDER BY id")
    .bind(ws)
    .all<{ id: number; name: string; monthly_amount: number }>();
  if (plans.results.length === 0) return ephemeral("沒有啟用中的方案。");

  const period = taipeiPeriod();
  return json(initiateModal(ws, period, plans.results.slice(0, 5)));
}

async function handleModalSubmit(i: DiscordInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!i.data?.custom_id?.startsWith(INITIATE_MODAL_PREFIX)) return ephemeral("未支援的表單。");
  ctx.waitUntil(deferredInitiate(i, env));
  return json({ type: RT_DEFERRED, data: { flags: FLAG_EPHEMERAL } });
}

async function deferredInitiate(i: DiscordInteraction, env: Env): Promise<void> {
  let content: string;
  try {
    const parts = (i.data!.custom_id ?? "").split(":"); // chippot:initiate:<ws>:<period>
    const ws = Number(parts[2]);
    const period = parts[3]!;
    if (!(await isAdmin(env, ws, discordUserId(i)))) {
      content = "你沒有發起繳費的權限。";
    } else {
      const amounts: { plan_id: number; amount: number }[] = [];
      for (const row of i.data!.components ?? []) {
        for (const c of row.components) {
          if (c.custom_id.startsWith("amt:")) {
            const plan_id = Number(c.custom_id.slice(4));
            const amount = Number(String(c.value).trim());
            if (Number.isInteger(plan_id) && Number.isInteger(amount) && amount >= 0) {
              amounts.push({ plan_id, amount });
            }
          }
        }
      }
      const r = await initiateBillingOpened(env, ws, period, { amounts }, `discord:${discordUserId(i)}`, discordNotifier);
      content = r.sent
        ? `✅ 已發起 ${period} 繳費並發出通知（更新 ${r.updatedPlans} 個方案定價、${r.updatedPayments} 筆待繳金額）。`
        : `✅ 已更新本期金額（更新 ${r.updatedPlans} 個方案、${r.updatedPayments} 筆待繳）。本期通知先前已發送，未重複發送。`;
    }
  } catch (err) {
    console.error("initiate modal failed", err);
    content = "發起繳費失敗，請稍後再試。";
  }
  await editOriginalResponse(env.DISCORD_APPLICATION_ID ?? "", i.token, { content }).catch(() => {});
}

// ── Components: persistent button → channel select → settle ──────────────────

function handleComponent(i: DiscordInteraction, env: Env): Promise<Response> {
  const cid = i.data?.custom_id ?? "";
  if (cid.startsWith(PAY_SELECT_PREFIX)) return handlePaySelect(i, env);
  if (cid.startsWith(PAY_BUTTON_PREFIX)) return handlePayButton(i, env);
  return Promise.resolve(ephemeral("未支援的按鈕。"));
}

async function handlePayButton(i: DiscordInteraction, env: Env): Promise<Response> {
  const m = await resolveMember(i, env);
  if (m instanceof Response) return m;
  const { ws, userId } = m;

  const subs = await listActiveSubscriptions(env.DB, ws, userId);
  if (subs.length === 0) return ephemeral("你目前沒有有效訂閱。");

  const period = taipeiPeriod();
  // Ensure rows exist so settleable vs already-paid is accurate.
  for (const s of subs) await ensurePeriodPayment(env.DB, s.id, period);
  const settleable = await listSettleablePayments(env.DB, ws, userId, period);
  if (settleable.length === 0) return ephemeral("✅ 你本期已登記繳費，無需重複操作。");

  const tags = await listActiveChannelTags(env.DB, ws);
  if (tags.length === 0) {
    return ephemeral("管理員尚未設定繳費渠道，請改用 `/繳費` 指令（可附截圖或備註）。");
  }
  const total = settleable.reduce((s, r) => s + r.amount, 0);
  const lines = settleable.map((r) => `・${r.plan_name}：NT$${r.amount.toLocaleString()}`).join("\n");
  return json({
    type: RT_MESSAGE,
    data: {
      flags: FLAG_EPHEMERAL,
      content: `本期（${period}）應繳：\n${lines}\n**合計 NT$${total.toLocaleString()}**\n\n請選擇繳費渠道送出。想附截圖／備註？改用 \`/繳費\`。`,
      components: [channelSelectRow(ws, period, tags)],
    },
  });
}

async function handlePaySelect(i: DiscordInteraction, env: Env): Promise<Response> {
  const m = await resolveMember(i, env);
  if (m instanceof Response) return m;
  const { ws, userId } = m;

  const parts = (i.data?.custom_id ?? "").split(":"); // chippot:paysel:<ws>:<period>
  const period = parts[3] ?? taipeiPeriod();
  const tagId = Number(i.data?.values?.[0]);
  if (!Number.isInteger(tagId)) return ephemeral("渠道無效，請重試。");

  try {
    const r = await settleUserPeriod(env, {
      workspaceId: ws, userId, period, declaredChannelTagId: tagId, source: "user_slash",
    });
    if (r.paidCount === 0) {
      return json({ type: RT_UPDATE_MESSAGE, data: { content: "✅ 你本期已登記繳費，無需重複操作。", components: [] } });
    }
    return json({
      type: RT_UPDATE_MESSAGE,
      data: { content: `✅ 已登記 NT$${r.totalAmount.toLocaleString()}（共 ${r.paidCount} 筆）。管理員確認收款後完成。`, components: [] },
    });
  } catch (err) {
    console.error("pay select failed", err);
    return json({ type: RT_UPDATE_MESSAGE, data: { content: "處理失敗，請稍後再試或改用 `/繳費`。", components: [] } });
  }
}
