/* ─── Loads projects with all their children in one round trip (json_agg
   subqueries), matching the shape src/cloudStore.ts used to get for free
   from Supabase's nested `select("*, subtasks(*), stage_history(*), ...")`.
   ─── */
const { project } = require("./serialize");

const CHILDREN_SQL = `
  (select coalesce(json_agg(s.* order by s.created_at), '[]') from subtasks s where s.project_id = p.id) as subtasks,
  (select coalesce(json_agg(h.* order by h.at), '[]') from stage_history h where h.project_id = p.id) as stage_history,
  (select coalesce(json_agg(c.* order by c.at), '[]') from comments c where c.project_id = p.id) as comments,
  (select coalesce(json_agg(a.* order by a.at), '[]') from attachments a where a.project_id = p.id) as attachments,
  (select coalesce(json_agg(t.*), '[]') from stage_targets t where t.project_id = p.id) as stage_targets
`;

async function loadAllProjects(client) {
  const { rows } = await client.query(
    `select p.*, ${CHILDREN_SQL} from projects p order by p.created_at desc`
  );
  return rows.map((r) => project(r, {
    subtasks: r.subtasks, history: r.stage_history, comments: r.comments,
    attachments: r.attachments, stageTargets: r.stage_targets,
  }));
}

async function loadProject(client, id) {
  const { rows } = await client.query(
    `select p.*, ${CHILDREN_SQL} from projects p where p.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return project(r, {
    subtasks: r.subtasks, history: r.stage_history, comments: r.comments,
    attachments: r.attachments, stageTargets: r.stage_targets,
  });
}

/** Raw projects row (no children) — enough for authz checks (stage, involved_teams, owner_team). */
async function loadProjectRow(client, id) {
  const { rows } = await client.query("select * from projects where id = $1", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, stage: r.stage, ownerTeam: r.owner_team, involvedTeams: r.involved_teams, finalGoLive: r.final_go_live, status: r.status, blocked: r.blocked, blockReason: r.block_reason };
}

module.exports = { loadAllProjects, loadProject, loadProjectRow };
