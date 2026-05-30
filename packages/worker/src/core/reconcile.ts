export interface StatusCounts {
  pending: number;
  paid: number;
  verified: number;
  rejected: number;
}

export interface PlanReconcile {
  plan_id: number;
  plan_name: string;
  total: number;
  pending: number;
  paid: number;
  verified: number;
  rejected: number;
  amount_due: number;
  amount_verified: number;
}

export interface ChannelTagReconcile {
  channel_tag_id: number | null;
  channel_tag_name: string | null;
  count: number;
  amount: number;
}

export interface PeriodReconcile {
  period: string;
  status_counts: StatusCounts;
  total_amount_due: number;
  verified_amount: number;
  no_proof_count: number;
  by_plan: PlanReconcile[];
  by_channel_tag: ChannelTagReconcile[];
}

const n = (v: unknown): number => Number(v ?? 0);

/** Reconciliation summary for one workspace + period (admin dashboard, spec §10.1). */
export async function reconcilePeriod(
  db: D1Database,
  workspaceId: number,
  period: string
): Promise<PeriodReconcile> {
  const totals = await db
    .prepare(
      `SELECT
         SUM(status = 'pending')  AS pending,
         SUM(status = 'paid')     AS paid,
         SUM(status = 'verified') AS verified,
         SUM(status = 'rejected') AS rejected,
         SUM(amount)              AS total_amount_due,
         SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END) AS verified_amount,
         SUM(CASE WHEN status IN ('paid','verified') AND has_proof = 0 THEN 1 ELSE 0 END) AS no_proof_count
       FROM payments WHERE workspace_id = ? AND period = ?`
    )
    .bind(workspaceId, period)
    .first<Record<string, number | null>>();

  const planRows = await db
    .prepare(
      `SELECT pl.id AS plan_id, pl.name AS plan_name,
         COUNT(*) AS total,
         SUM(p.status = 'pending')  AS pending,
         SUM(p.status = 'paid')     AS paid,
         SUM(p.status = 'verified') AS verified,
         SUM(p.status = 'rejected') AS rejected,
         SUM(p.amount) AS amount_due,
         SUM(CASE WHEN p.status = 'verified' THEN p.amount ELSE 0 END) AS amount_verified
       FROM payments p
       JOIN subscriptions s ON s.id = p.subscription_id
       JOIN plans pl ON pl.id = s.plan_id
       WHERE p.workspace_id = ? AND p.period = ?
       GROUP BY pl.id, pl.name
       ORDER BY pl.id`
    )
    .bind(workspaceId, period)
    .all<Record<string, number | string | null>>();

  const tagRows = await db
    .prepare(
      `SELECT ct.id AS channel_tag_id, ct.name AS channel_tag_name,
         COUNT(*) AS count, SUM(p.amount) AS amount
       FROM payments p
       LEFT JOIN channel_tags ct ON ct.id = p.verified_channel_tag_id
       WHERE p.workspace_id = ? AND p.period = ? AND p.status = 'verified'
       GROUP BY p.verified_channel_tag_id
       ORDER BY ct.id`
    )
    .bind(workspaceId, period)
    .all<Record<string, number | string | null>>();

  return {
    period,
    status_counts: {
      pending: n(totals?.pending),
      paid: n(totals?.paid),
      verified: n(totals?.verified),
      rejected: n(totals?.rejected),
    },
    total_amount_due: n(totals?.total_amount_due),
    verified_amount: n(totals?.verified_amount),
    no_proof_count: n(totals?.no_proof_count),
    by_plan: planRows.results.map((r) => ({
      plan_id: n(r.plan_id),
      plan_name: String(r.plan_name),
      total: n(r.total),
      pending: n(r.pending),
      paid: n(r.paid),
      verified: n(r.verified),
      rejected: n(r.rejected),
      amount_due: n(r.amount_due),
      amount_verified: n(r.amount_verified),
    })),
    by_channel_tag: tagRows.results.map((r) => ({
      channel_tag_id: r.channel_tag_id === null ? null : n(r.channel_tag_id),
      channel_tag_name: r.channel_tag_name === null ? null : String(r.channel_tag_name),
      count: n(r.count),
      amount: n(r.amount),
    })),
  };
}
