import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../../src/core/tokens";

describe("tokens", () => {
  it("generates a 64-char lowercase hex token (32 bytes)", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashToken matches a known SHA-256 vector", async () => {
    // SHA-256("abc")
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashToken is deterministic", async () => {
    const t = generateToken();
    expect(await hashToken(t)).toBe(await hashToken(t));
  });
});
