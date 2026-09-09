// server.js — Gyftr Tech Portal API
// Express backend that replaces direct Supabase calls from the browser.
// Runs on ECS behind an ALB. Auth via AWS Cognito JWT + a people lookup
// (see middleware/auth.js, middleware/loadProfile.js, authz.js).

import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import { initDbWithRetry, isDbReady, dbLastError, query } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { loadIdentity } from './middleware/identity.js';
import { handle } from './errors.js';

import peopleRoutes       from './routes/people.js';
import projectsRoutes     from './routes/projects.js';
import subtasksRoutes     from './routes/subtasks.js';
import commentsRoutes     from './routes/comments.js';
import attachmentsRoutes  from './routes/attachments.js';
import stageTargetsRoutes from './routes/stageTargets.js';

const app  = express();
const PORT = process.env.PORT || 8978;

// ── Middleware ─────────────────────────────────────────────────────────────
// Explicit origin allowlist — never '*'. '*' both defeats the point and is
// invalid alongside credentials: true anyway.
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  ...(process.env.NODE_ENV === 'production' ? [] : [
    'http://localhost:8979',
    'http://localhost:5173',
    'http://localhost:4173',
  ]),
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// ── Health check (no auth needed — used by the ALB target group) ───────────
// Liveness — is the process up? Deliberately does NOT touch the database:
// a brief RDS blip would otherwise deregister every instance at once and
// turn a degraded service into a total outage.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gyftr-tech-portal-api' }));

// Readiness — can it actually serve? Verifies the database round-trips.
// Use this one when diagnosing, and from scripts/smoke-test.js.
app.get('/health/deep', async (_req, res) => {
  const started = Date.now();
  if (!isDbReady()) {
    return res.status(503).json({
      ok: false,
      database: 'not ready',
      error: dbLastError() || 'still connecting',
      hint: 'The API is running but cannot reach RDS. Check the DB_* / AWS_SECRET_NAME values and the RDS security group.',
    });
  }
  try {
    await query('select 1');
    res.json({ ok: true, database: 'reachable', latencyMs: Date.now() - started });
  } catch (err) {
    console.error('[health/deep] database unreachable:', err.message);
    res.status(503).json({
      ok: false,
      database: 'unreachable',
      error: err.message,
      latencyMs: Date.now() - started,
    });
  }
});

// Without the database there is nothing to serve.
app.use('/api', (req, res, next) => {
  if (isDbReady()) return next();
  res.status(503).json({
    error: 'The portal is starting up or cannot reach its database. ' +
           (dbLastError() || 'Retrying.') +
           ' Check GET /health/deep for the current status.',
  });
});

// ── Everything under /api requires a valid Cognito token + a linked people row ─
app.use('/api', requireAuth, loadIdentity);

// GET /api/me — the caller's own linked people row, resolved by
// loadIdentity above. The frontend calls this on load/refresh to recover
// who's signed in without re-parsing the Cognito token client-side.
app.get('/api/me', handle(async (req, res) => {
  res.json(req.profile);
}));

app.use('/api/people', peopleRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api', subtasksRoutes);
app.use('/api', commentsRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api', stageTargetsRoutes);

// ── Start ──────────────────────────────────────────────────────────────────
// Listen FIRST, connect second. If the database is unreachable the API still
// answers /health (so the load balancer keeps a target and the box stays
// reachable) and /health/deep reports exactly why.
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initDbWithRetry().catch(err => {
    console.error('[server] Database retry loop stopped unexpectedly:', err);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled rejection:', err);
});
