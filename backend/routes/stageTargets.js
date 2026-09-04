/* ─── Per-stage expected dates — only the team that owns a given stage (or
   PMO) may set it, and only once every earlier stage already has one.
   Mirrors the old st_wr policy + trg_stage_target_order trigger exactly. ─── */
const express = require("express");
const { withTransaction } = require("../db");
const authz = require("../authz");
const { checkStageTargetOrder } = require("../projectScope");
const { stageTargets } = require("../serialize");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

router.put("/:projectId/:stage", asyncHandler("PUT /api/stage-targets/:projectId/:stage", async (req, res) => {
  const { projectId, stage } = req.params;
  const { expectedDate } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: targetRows } = await client.query(
      "select stage, expected_date from stage_targets where project_id = $1", [projectId]
    );
    const existing = {};
    for (const r of targetRows) existing[r.stage] = r.expected_date;

    if (!authz.canEditStageTarget(req.person, stage, existing)) {
      return { status: 403, error: "forbidden" };
    }
    const orderError = checkStageTargetOrder(existing, stage, expectedDate);
    if (orderError) return { status: 400, error: orderError };

    await client.query(
      `insert into stage_targets (project_id, stage, expected_date, updated_by, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (project_id, stage) do update set expected_date = $3, updated_by = $4, updated_at = now()`,
      [projectId, stage, expectedDate ?? null, req.person.id]
    );
    const { rows } = await client.query("select * from stage_targets where project_id = $1", [projectId]);
    return { status: 200, rows };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(stageTargets(result.rows));
}));

module.exports = router;
