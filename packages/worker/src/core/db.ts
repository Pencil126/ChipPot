export interface WorkspaceRow {
  id: number;
  name: string;
  owner_id: string;
  channel_type: string;
  billing_day: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface PlanRow {
  id: number;
  workspace_id: number;
  name: string;
  provider: string;
  monthly_amount: number;
  currency: string;
  billing_cycle: string;
  split_count: number | null;
  discord_role_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export async function getWorkspace(
  db: D1Database,
  id: number
): Promise<WorkspaceRow | null> {
  return db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .bind(id)
    .first<WorkspaceRow>();
}

export async function getActivePlans(
  db: D1Database,
  workspaceId: number
): Promise<PlanRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM plans WHERE workspace_id = ? AND active = 1 ORDER BY id"
    )
    .bind(workspaceId)
    .all<PlanRow>();
  return results;
}

export interface SubscriptionChoice {
  id: number;
  plan_id: number;
  plan_name: string;
  amount: number;
}

/** Active subscriptions for a user (for the upload page's plan picker). */
export async function listActiveSubscriptions(
  db: D1Database,
  workspaceId: number,
  userId: number
): Promise<SubscriptionChoice[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id AS id, s.plan_id AS plan_id, pl.name AS plan_name, pl.monthly_amount AS amount
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
       WHERE s.workspace_id = ? AND s.user_id = ? AND s.status = 'active'
       ORDER BY s.id`
    )
    .bind(workspaceId, userId)
    .all<SubscriptionChoice>();
  return results;
}
