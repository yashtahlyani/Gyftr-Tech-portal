const express = require("express");
const { query } = require("../db");
const { person } = require("../serialize");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

// Everyone signed in can read the org directory — matches the old people_sel
// policy (auth.role() = 'authenticated'), which had no team/role restriction.
router.get("/", asyncHandler("GET /api/people", async (_req, res) => {
  const { rows } = await query("select id, name, team, role, email from people order by name");
  res.json(rows.map(person));
}));

module.exports = router;
