// serialize.js — builds the same nested project shape the old PostgREST
// query `*, subtasks(*), stage_history(*), comments(*), attachments(*),
// stage_targets(*)` returned, using jsonb_agg subqueries (Postgres has no
// PostgREST-style embedding). Field names stay snake_case end to end —
// frontend/src/cloudStore.ts's mapProject()/mapSubtask()/etc keep reading
// exactly the same keys they read from Supabase, so the rewritten
// cloudStore.ts only needs to swap its transport (api.ts) not its shapes.

export const PROJECT_NESTED_SELECT = `
  select
    p.*,
    coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at asc)
      from subtasks s where s.project_id = p.id
    ), '[]') as subtasks,
    coalesce((
      select jsonb_agg(to_jsonb(h) order by h.at asc)
      from stage_history h where h.project_id = p.id
    ), '[]') as stage_history,
    coalesce((
      select jsonb_agg(to_jsonb(c) order by c.at asc)
      from comments c where c.project_id = p.id
    ), '[]') as comments,
    coalesce((
      select jsonb_agg(to_jsonb(a) order by a.at asc)
      from attachments a where a.project_id = p.id
    ), '[]') as attachments,
    coalesce((
      select jsonb_agg(to_jsonb(st))
      from stage_targets st where st.project_id = p.id
    ), '[]') as stage_targets
  from projects p
`;

/** Fetch every project, nested, newest first — mirrors cloudStore.ts's
 *  fetchAll() query. `authzFilter(project) => boolean` is applied in JS
 *  (equivalent to what p_sel/can_see used to filter at the row level). */
export async function fetchProjectsNested(queryFn, authzFilter) {
  const { rows } = await queryFn(`${PROJECT_NESTED_SELECT} order by p.created_at desc`);
  return authzFilter ? rows.filter(authzFilter) : rows;
}

/** Fetch a single project, nested, or undefined if it doesn't exist. */
export async function fetchProjectNestedById(queryFn, id) {
  const { rows } = await queryFn(`${PROJECT_NESTED_SELECT} where p.id = $1`, [id]);
  return rows[0];
}

/** Fetch every `people` row — used to build the allPeople array authz.js's
 *  hierarchy/subtree functions need. Small org, no pagination. */
export async function fetchAllPeople(queryFn) {
  const { rows } = await queryFn(
    'select id, cognito_sub, name, email, team, role, manager_id, department, sees_all_projects, active from people'
  );
  return rows;
}

/** Fetch a bare (non-nested) project row plus its subtasks (id, team,
 *  assignee_id only) — enough for every authz.js check, which only ever
 *  reads project.subtasks[].assignee_id / .team, never the full nested
 *  shape. Cheaper than fetchProjectNestedById for a route that's about to
 *  write, not render. */
export async function fetchProjectForAuthz(queryFn, id) {
  const { rows } = await queryFn('select * from projects where id = $1', [id]);
  const project = rows[0];
  if (!project) return undefined;
  const { rows: subtasks } = await queryFn(
    'select id, team, assignee_id from subtasks where project_id = $1',
    [id]
  );
  project.subtasks = subtasks;
  return project;
}
