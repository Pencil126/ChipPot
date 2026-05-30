import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker fetch", () => {
  it("serves a health check", async () => {
    const res = await SELF.fetch("https://x/health");
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toMatchObject({ ok: true, service: "chippot" });
  });

  it("404s an unknown path", async () => {
    const res = await SELF.fetch("https://x/nope");
    expect(res.status).toBe(404);
  });

  it("403s admin endpoints without Access", async () => {
    const res = await SELF.fetch("https://x/admin/users");
    expect(res.status).toBe(403);
  });
});
