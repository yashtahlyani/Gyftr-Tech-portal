require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { requireAuth } = require("./middleware/auth");
const { initDbWithRetry, isDbReady, dbLastError } = require("./db");
const { asyncHandler } = require("./asyncHandler");

const app = express();

// Explicit origin allowlist, never "*" — "*" is invalid together with
// credentials: true. FRONTEND_URL is the real deployed origin; localhost
// ports are only added outside production so local dev never needs a
// separate CORS config.
const allowedOrigins = [process.env.FRONTEND_URL].filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173", "http://localhost:4173");
}
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// Liveness — never touches the DB. This is what the ALB/target-group polls,
// so a transient RDS blip doesn't deregister every task at once.
app.get("/health", (_req, res) => res.json({ ok: true }));

// Readiness — actually checks the DB. Use this to verify a deploy actually
// came up healthy, not just that the process is running.
app.get("/health/deep", (_req, res) => {
  if (!isDbReady()) return res.status(503).json({ ok: false, error: dbLastError() || "database not ready" });
  res.json({ ok: true });
});

// Every /api/* route needs a working DB — fail fast with a clear reason
// instead of routes individually throwing "pool not initialized".
app.use("/api", (_req, res, next) => {
  if (!isDbReady()) return res.status(503).json({ error: "Service starting up, database not ready yet" });
  next();
});
app.use("/api", requireAuth);

// The signed-in caller's own directory row — replaces Supabase's claim_person() RPC.
app.get("/api/me", asyncHandler("GET /api/me", async (req, res) => res.json(req.person)));
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
// Listen immediately; the DB connects (and retries forever) in the
// background. A container that can answer /health right away, even before
// RDS is reachable, never gets killed by an orchestrator mistaking startup
// lag for a crash.
app.listen(port, () => console.log(`gyftr-tech-portal API listening on :${port}`));
initDbWithRetry();
