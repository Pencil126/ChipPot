import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getWorkspace, getActivePlans } from "../../src/core/db";

describe("db getters", () => {
  it("getWorkspace returns the seeded workspace", async () => {
    const ws = await getWorkspace(env.DB, 1);
    expect(ws?.name).toBe("社團 AI 訂閱");
    expect(ws?.channel_type).toBe("discord");
  });

  it("getWorkspace returns null for unknown id", async () => {
    expect(await getWorkspace(env.DB, 9999)).toBeNull();
  });

  it("getActivePlans returns the three seeded plans", async () => {
    const plans = await getActivePlans(env.DB, 1);
    expect(plans.map((p) => p.name)).toEqual([
      "ChatGPT", "Claude Standard", "Claude Premium",
    ]);
  });
});
