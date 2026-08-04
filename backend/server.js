require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// No auth required — used by the ALB target group health check.
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", requireAuth);
// The signed-in caller's own directory row — replaces Supabase's claim_person() RPC.
app.get("/api/me", (req, res) => res.json(req.person));
app.use("/api/people", require("./routes/people"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/subtasks", require("./routes/subtasks"));
app.use("/api/stage-targets", require("./routes/stageTargets"));
app.use("/api/comments", require("./routes/comments"));
app.use("/api/attachments", require("./routes/attachments"));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`gyftr-tech-portal API listening on :${port}`));
