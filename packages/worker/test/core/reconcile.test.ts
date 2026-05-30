import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { reconcilePeriod } from "../../src/core/reconcile";

const TS = "2026-05-01T00:00:00.000Z";
const WS = 9004;
const PLAN_GPT = 90041, PLAN_CLAUDE = 90042;
const SUB_GPT = 90041, SUB_CLAUDE = 90042;
const TAG_LINEPAY = 90043;

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO workspaces (id,name,owner_id,channel_type,billing_day,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(WS, "W", "o", "discord", 5, "{}", TS, TS),
    env.DB.prepare(`INSERT INTO users (id,workspace_id,display_name,created_at,updated_at) VALUES (?,?,?,?,?)`).bind(WS, WS, "U", TS, TS),
    env.DB.prepare(`INSERT INTO plans (id,workspace_id,name,provider,monthly_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(PLAN_GPT, WS, "ChatGPT", "openai", 315, TS, TS),
    env.DB.prepare(`INSERT INTO plans (id,workspace_id,name,provider,monthly_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(PLAN_CLAUDE, WS, "Claude Standard", "anthropic", 251, TS, TS),
    env.DB.prepare(`INSERT INTO subscriptions (id,workspace_id,user_id,plan_id,start_date,billing_day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(SUB_GPT, WS, WS, PLAN_GPT, "2026-06-01", 5, TS, TS),
    env.DB.prepare(`INSERT INTO subscriptions (id,workspace_id,user_id,plan_id,start_date,billing_day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(SUB_CLAUDE, WS, WS, PLAN_CLAUDE, "2026-06-01", 5, TS, TS),
    env.DB.prepare(`INSERT INTO channel_tags (id,workspace_id,name,type,sort_order,created_at) VALUES (?,?,?,?,?,?)`).bind(TAG_LINEPAY, WS, "LINE Pay", "linepay", 1, TS),
    // verified, with proof, via LINE Pay
    env.DB.prepare(`INSERT INTO payments (workspace_id,subscription_id,period,period_start,period_end,due_date,amount,status,has_proof,verified_channel_tag_id,source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(WS, SUB_GPT, "2026-06", "2026-06-01", "2026-06-30", "2026-06-05", 315, "verified", 1, TAG_LINEPAY, "user_web", TS, TS),
    // paid, NO proof
    env.DB.prepare(`INSERT INTO payments (workspace_id,subscription_id,period,period_start,period_end,due_date,amount,status,has_proof,source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(WS, SUB_CLAUDE, "2026-06", "2026-06-01", "2026-06-30", "2026-06-05", 251, "paid", 0, "user_slash", TS, TS),
  ]);
});

describe("reconcilePeriod", () => {
  it("aggregates status counts, totals, and no-proof count", async () => {
    const r = await reconcilePeriod(env.DB, WS, "2026-06");
    expect(r.status_counts).toEqual({ pending: 0, paid: 1, verified: 1, rejected: 0 });
    expect(r.total_amount_due).toBe(566);
    expect(r.verified_amount).toBe(315);
    expect(r.no_proof_count).toBe(1);
  });

  it("breaks down by plan", async () => {
    const r = await reconcilePeriod(env.DB, WS, "2026-06");
    const gpt = r.by_plan.find((p) => p.plan_id === PLAN_GPT)!;
    const claude = r.by_plan.find((p) => p.plan_id === PLAN_CLAUDE)!;
    expect(gpt).toMatchObject({ plan_name: "ChatGPT", total: 1, verified: 1, amount_verified: 315 });
    expect(claude).toMatchObject({ plan_name: "Claude Standard", total: 1, paid: 1, amount_verified: 0 });
  });

  it("groups verified payments by channel tag", async () => {
    const r = await reconcilePeriod(env.DB, WS, "2026-06");
    expect(r.by_channel_tag).toEqual([
      { channel_tag_id: TAG_LINEPAY, channel_tag_name: "LINE Pay", count: 1, amount: 315 },
    ]);
  });

  it("returns zeros for an empty period", async () => {
    const r = await reconcilePeriod(env.DB, WS, "2099-01");
    expect(r.status_counts).toEqual({ pending: 0, paid: 0, verified: 0, rejected: 0 });
    expect(r.total_amount_due).toBe(0);
    expect(r.by_plan).toEqual([]);
    expect(r.by_channel_tag).toEqual([]);
  });
});
