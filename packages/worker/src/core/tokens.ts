function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as 64 lowercase hex chars. Raw token goes in the URL. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** sha256(raw) as 64 lowercase hex chars. Only this is stored in D1. */
export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export interface UploadTokenRow {
  id: number;
  token_hash: string;
  workspace_id: number;
  user_id: number;
  period: string;
  subscription_id: number | null;
  used_at: string | null;
  used_by_source: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface IssuedToken {
  raw: string;
  expiresAt: string;
}

/** Mint a one-time upload token (default 30-min TTL), storing only its hash. */
export async function issueUploadToken(
  db: D1Database,
  opts: { workspaceId: number; userId: number; period: string; subscriptionId?: number | null; ttlMs?: number }
): Promise<IssuedToken> {
  const raw = generateToken();
  const hash = await hashToken(raw);
  const now = Date.now();
  const expiresAt = new Date(now + (opts.ttlMs ?? 30 * 60 * 1000)).toISOString();
  await db
    .prepare(
      `INSERT INTO upload_tokens (token_hash, workspace_id, user_id, period, subscription_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(hash, opts.workspaceId, opts.userId, opts.period, opts.subscriptionId ?? null, expiresAt, new Date(now).toISOString())
    .run();
  return { raw, expiresAt };
}

/** Look up a token by its hash that is unused, unrevoked, and unexpired (at nowIso). */
export async function findValidUploadToken(
  db: D1Database,
  tokenHash: string,
  nowIso: string
): Promise<UploadTokenRow | null> {
  return db
    .prepare(
      `SELECT * FROM upload_tokens
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`
    )
    .bind(tokenHash, nowIso)
    .first<UploadTokenRow>();
}
