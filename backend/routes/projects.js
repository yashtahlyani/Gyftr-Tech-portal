/* ─── Projects: list/create/transition/status/block/reassign/details/delete.
   Every write that touches stage/owner also writes stage_history in the same
   transaction — replacing the old two-independent-requests pattern in
   cloudStore.ts's transition() (project UPDATE + history INSERT fired
   separately), which is exactly what the schema.sql h_ins comment documents
   working around a race for. One transaction removes the race entirely. ─── */
const express = require("express");
const { withTransaction, query, getPool } = require("../db");
const authz = require("../authz");
const { syncProjectScope } = require("../projectScope");
const { STATUS_META, findTransition } = require("../workflow");
const { loadAllProjects, loadProject, loadProjectRow } = require("../projectLoader");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

router.get("/", asyncHandler("GET /api/projects", async (req, res) => {
  const all = await loadAllProjects(getPool());
  const visible = all.filter((p) => authz.canSeeProject(req.person, p));
  res.json(visible);
}));

router.post("/", asyncHandler("POST /api/projects", async (req, res) => {
  if (!authz.canCreateProject(req.person)) return res.status(403).json({ error: "forbidden" });
  const b = req.body;
  const proj = await withTransaction(async (client) => {
    const ownerTeam = authz.STAGE_OWNER[b.stage];
    const involvedTeams = Array.from(new Set([ownerTeam, "business", req.person.team]));
    const { rows } = await client.query(
      `insert into projects
        (title, brd, partner, brand, lob, priority, bifurcation, stage, status,
         owner_id, business_owner_id, blocked, block_reason,
         target_go_live, sacrosanct_go_live, priority_month, timeline_eta,
         dev_effort_days, reason_for_delay, product_spoc_id, tech_lead_id,
         owner_team, involved_teams)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       returning id`,
      [b.title, b.brd, b.partner, b.brand ?? null, b.lob, b.priority, b.bifurcation, b.stage, b.status,
        b.ownerId, b.businessOwnerId, b.blocked ?? false, b.blockReason ?? null,
        b.targetGoLive ?? null, b.sacrosanctGoLive ?? null, b.priorityMonth ?? null, b.timelineEta ?? null,
        b.devEffortDays ?? null, b.reasonForDelay ?? null, b.productSpocId ?? null, b.techLeadId ?? null,
        ownerTeam, involvedTeams]
    );
    const id = rows[0].id;
    if (Array.isArray(b.subtasks) && b.subtasks.length) {
      for (const s of b.subtasks) {
        await client.query(
          "insert into subtasks (project_id, title, team, assignee_id, done) values ($1,$2,$3,$4,$5)",
          [id, s.title, s.team, s.assigneeId ?? null, s.done ?? false]
        );
      }
    }
    await client.query(
      `insert into stage_history (project_id, by_id, from_stage, to_stage, from_status, to_status, note)
       values ($1,$2,null,$3,null,$4,'Project created')`,
      [id, b.businessOwnerId, b.stage, b.status]
    );
    return loadProject(client, id);
  });
  res.status(201).json(proj);
}));

/** Shared mover: updates stage/status/owner and logs history in one transaction. */
async function applyMove(client, projectRow, { toStage, toStatus, ownerId, blocked, blockReason, note, byId }) {
  const scope = syncProjectScope({
    oldInvolvedTeams: projectRow.involvedTeams, newStage: toStage,
    actingTeam: byId.team, oldFinalGoLive: projectRow.finalGoLive,
  });
  await client.query(
    `update projects set stage=$1, status=$2, owner_id=$3, blocked=$4, block_reason=$5,
       stage_entered_at=now(), owner_team=$6, involved_teams=$7, final_go_live=$8
     where id=$9`,
    [toStage, toStatus, ownerId, blocked, blockReason ?? null, scope.ownerTeam, scope.involvedTeams, scope.finalGoLive, projectRow.id]
  );
  await client.query(
    `insert into stage_history (project_id, by_id, from_stage, to_stage, from_status, to_status, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [projectRow.id, byId.id, projectRow.stage, toStage, projectRow.status, toStatus, note ?? null]
  );
}

router.post("/:id/transition", asyncHandler("POST /api/projects/:id/transition", async (req, res) => {
  const { toStage, ownerId, note } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    const spec = findTransition(projectRow.stage, toStage);
    if (!spec) return { status: 400, error: "Not a legal transition from this stage" };
    if (!authz.canPerformTransition(req.person, projectRow, spec)) return { status: 403, error: "forbidden" };
    const blocked = STATUS_META[spec.toStatus].kind === "blocked";
    await applyMove(client, projectRow, {
      toStage: spec.to, toStatus: spec.toStatus, ownerId, blocked,
      blockReason: blocked ? projectRow.blockReason : null, note, byId: req.person,
    });
    return { status: 200, project: await loadProject(client, req.params.id) };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result.project);
}));

router.post("/:id/pickup", asyncHandler("POST /api/projects/:id/pickup", async (req, res) => {
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (projectRow.stage !== "to_be_picked") return { status: 400, error: "Not in the pickup stage" };
    if (!authz.canPickup(req.person, projectRow)) return { status: 403, error: "forbidden" };
    await applyMove(client, projectRow, {
      toStage: "development", toStatus: "dev", ownerId: req.person.id, blocked: false,
      note: "Picked up", byId: req.person,
    });
    return { status: 200, project: await loadProject(client, req.params.id) };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result.project);
}));

router.post("/:id/clarify", asyncHandler("POST /api/projects/:id/clarify", async (req, res) => {
  const { toStage, toStatus, note, ownerId } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (!authz.canActOnProject(req.person, projectRow)) return { status: 403, error: "forbidden" };
    await applyMove(client, projectRow, {
      toStage, toStatus, ownerId, blocked: true, blockReason: note,
      note: `Clarification requested: ${note}`, byId: req.person,
    });
    return { status: 200, project: await loadProject(client, req.params.id) };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result.project);
}));

router.post("/:id/reopen", asyncHandler("POST /api/projects/:id/reopen", async (req, res) => {
  const { note, ownerId } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (!authz.canActOnProject(req.person, projectRow)) return { status: 403, error: "forbidden" };
    await applyMove(client, projectRow, {
      toStage: "development", toStatus: "need_bug_fixing", ownerId, blocked: false,
      note: `Reopened: ${note}`, byId: req.person,
    });
    return { status: 200, project: await loadProject(client, req.params.id) };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result.project);
}));

router.post("/:id/status", asyncHandler("POST /api/projects/:id/status", async (req, res) => {
  const { toStatus } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (!authz.canActOnProject(req.person, projectRow)) return { status: 403, error: "forbidden" };
    if (projectRow.status === toStatus) return { status: 200, project: await loadProject(client, req.params.id) };
    const meta = STATUS_META[toStatus];
    const stageChanged = meta.stage !== projectRow.stage && meta.kind !== "blocked";
    const toStage = stageChanged ? meta.stage : projectRow.stage;
    await applyMove(client, projectRow, {
      toStage, toStatus, ownerId: projectRow.ownerId ?? null, blocked: meta.kind === "blocked",
      blockReason: meta.kind === "blocked" ? projectRow.blockReason : null, byId: req.person,
    });
    return { status: 200, project: await loadProject(client, req.params.id) };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result.project);
}));

router.post("/:id/block", asyncHandler("POST /api/projects/:id/block", async (req, res) => {
  const { blocked, reason } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (!authz.canActOnProject(req.person, projectRow)) return { status: 403, error: "forbidden" };
    await client.query("update projects set blocked=$1, block_reason=$2 where id=$3", [blocked, blocked ? reason ?? null : null, projectRow.id]);
    return { status: 200 };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(await loadProject(getPool(), req.params.id));
}));

router.post("/:id/reassign", asyncHandler("POST /api/projects/:id/reassign", async (req, res) => {
  const { ownerId } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    if (!authz.canActOnProject(req.person, projectRow)) return { status: 403, error: "forbidden" };
    await client.query("update projects set owner_id=$1 where id=$2", [ownerId, projectRow.id]);
    return { status: 200 };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(await loadProject(getPool(), req.params.id));
}));

// Sheet-parity planning fields — editable from the project page's Details rail.
// Mirrors enforce_project_update_scope()'s column guard: in-court/pmo may edit
// anything here; a product lead acting outside their own court may ONLY touch
// targetGoLive/timelineEta; sacrosanctGoLive (the committed date) is PMO-only.
const DATE_ONLY_KEYS = ["targetGoLive", "timelineEta"];
router.patch("/:id/details", asyncHandler("PATCH /api/projects/:id/details", async (req, res) => {
  const patch = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, req.params.id);
    if (!projectRow) return { status: 404 };
    const inCourt = authz.canActOnProject(req.person, projectRow);
    const leadAnywhere = !inCourt && authz.isProductLeadAnywhere(req.person);
    if (!inCourt && !leadAnywhere) return { status: 403, error: "forbidden" };
    const keys = Object.keys(patch);
    if (leadAnywhere && keys.some((k) => !DATE_ONLY_KEYS.includes(k))) {
      return { status: 403, error: "Product leads may only edit go-live dates outside their own court" };
    }
    if ("sacrosanctGoLive" in patch && !authz.isPmo(req.person)) {
      return { status: 403, error: "Only PMO may set the promised (sacrosanct) go-live date" };
    }
    const colMap = {
      priorityMonth: "priority_month", timelineEta: "timeline_eta", devEffortDays: "dev_effort_days",
      reasonForDelay: "reason_for_delay", productSpocId: "product_spoc_id", techLeadId: "tech_lead_id",
      targetGoLive: "target_go_live", sacrosanctGoLive: "sacrosanct_go_live", brand: "brand",
    };
    const sets = [];
    const values = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (!colMap[k]) continue;
      sets.push(`${colMap[k]} = $${i++}`);
      values.push(v ?? null);
    }
    if (sets.length) {
      values.push(projectRow.id);
      await client.query(`update projects set ${sets.join(", ")} where id = $${i}`, values);
    }
    return { status: 200 };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(await loadProject(getPool(), req.params.id));
}));

router.delete("/:id", asyncHandler("DELETE /api/projects/:id", async (req, res) => {
  if (!authz.canDeleteProject(req.person)) return res.status(403).json({ error: "forbidden" });
  await query("delete from projects where id = $1", [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
