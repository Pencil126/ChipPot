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
