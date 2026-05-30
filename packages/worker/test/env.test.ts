import { describe, expect, it } from "vitest";
import { parseSettings, DEFAULT_SETTINGS } from "../src/env";

describe("parseSettings", () => {
  it("fills defaults for missing keys", () => {
    const s = parseSettings("{}");
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("overrides provided keys and coerces types", () => {
    const s = parseSettings(JSON.stringify({
      overdue_days: 5,
      proof_retention_months: 12,
      delete_discord_original_message: true,
      discord_guild_id: "123",
    }));
    expect(s.overdue_days).toBe(5);
    expect(s.proof_retention_months).toBe(12);
    expect(s.delete_discord_original_message).toBe(true);
    expect(s.discord_guild_id).toBe("123");
    expect(s.timezone).toBe("Asia/Taipei");
  });

  it("rejects out-of-range numbers", () => {
    expect(() => parseSettings(JSON.stringify({ overdue_days: -1 }))).toThrow();
    expect(() => parseSettings(JSON.stringify({ proof_retention_months: 0 }))).toThrow();
  });
});
