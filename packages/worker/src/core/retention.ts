import type { Env } from "../env";
import { nowUtcIso, taipeiDate } from "./time";
import { writeAudit } from "./audit";

/**
 * Delete screenshots whose proof is older than `retentionMonths` (by verified_at, else
 * paid_at). Reconciliation data (amount/period/tag) is kept — only the image is removed
 * (spec §13). Returns the number of proofs deleted.
 */
export async function runRetention(
  env: Env,
  workspaceId: number,
  retentionMonths: number,
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  const cutoffIso = cutoff.toISOString();

  const { results } = await env.DB
    .prepare(
      `SELECT id, screenshot_key FROM payments
       WHERE workspace_id = ? AND screenshot_key IS NOT NULL
         AND COALESCE(verified_at, paid_at) IS NOT NULL
         AND COALESCE(verified_at, paid_at) < ?`
    )
    .bind(workspaceId, cutoffIso)
    .all<{ id: number; screenshot_key: string }>();

  let deleted = 0;
  for (const row of results) {
    await env.BUCKET.delete(row.screenshot_key);
    await env.DB
      .prepare("UPDATE payments SET screenshot_key = NULL, proof_deleted_at = ?, updated_at = ? WHERE id = ?")
      .bind(taipeiDate(now), nowUtcIso(), row.id)
      .run();
    await writeAudit(env.DB, {
      workspaceId, actor: "system", action: "proof.auto_delete",
      entityType: "payment", entityId: row.id, before: { screenshot_key: row.screenshot_key },
    });
    deleted++;
  }
  return deleted;
}
