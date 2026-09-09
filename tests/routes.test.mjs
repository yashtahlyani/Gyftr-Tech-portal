// ════════════════════════════════════════════════════════════════════════════
//  ROUTE SAFETY TESTS — static analysis of backend/routes/
//
//  ── Why this file exists ────────────────────────────────────────────────────
//
//  This app has no Postgres RLS (unlike gyftr-ceo-portal's sibling — see
//  DATABASE.md): backend/authz.js is the ONLY security boundary, and it only
//  works if every route handler actually calls into it. tests/logic.test.mjs
//  proves those functions return the right answer; it cannot prove a route
//  remembered to call one at all. A handler that imports canSee/canAct/etc.
//  and then never calls it (or a new route that forgets the import entirely)
//  would pass every other test in this repo — nothing red anywhere, because
//  the bug isn't in the function under test, it's in the code that was
//  supposed to call it.
//
//  This runs statically — no database, no network, milliseconds — on every
//  CI run (see .github/workflows/ci.yml's `test` job).
//
//  If you're adding a route that genuinely needs no per-request authz check
//  beyond requireAuth + loadIdentity (e.g. a blanket "any signed-in user" read,
//  matching the DB's old people_sel policy), add it to ALLOWED below WITH a
//  justification. Making that deliberate and reviewable is the point.
// ════════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, '..', 'backend', 'routes');
const serverPath = join(here, '..', 'backend', 'server.js');

const routeFiles = readdirSync(routesDir).filter((f) => f.endsWith('.js'));

// Route files permitted to define handlers with no authz.js check, and why.
const ALLOWED = {
  // GET /api/people has no extra check by design — every /api route already
  // sits behind requireAuth + loadIdentity, matching the original schema's
  // blanket `people_sel using (auth.role() = 'authenticated')` policy. See
  // authz.js's header comment on people_sel.
  'people.js': "GET /api/people intentionally has no per-row check — matches the DB's blanket people_sel policy",
};

test('every route file exists and is non-trivial', () => {
  assert.ok(routeFiles.length >= 6, `expected the six route modules, found ${routeFiles.length}`);
});

test('every route file that touches project-scoped data imports AND calls an authz.js check', () => {
  const offenders = [];

  for (const file of routeFiles) {
    if (ALLOWED[file]) continue;
    const src = readFileSync(join(routesDir, file), 'utf8');

    const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/authz\.js['"]/);
    if (!importMatch) {
      offenders.push(`${file}: imports nothing from authz.js — add a check, or add this file to ALLOWED with a justification`);
      continue;
    }

    // Every named import must actually be referenced somewhere past its own
    // import statement — an import with zero further uses means the check
    // was pulled in and then never wired to a handler.
    const names = importMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    const bodyAfterImports = src.slice(src.indexOf(importMatch[0]) + importMatch[0].length);
    for (const name of names) {
      const usedInBody = new RegExp(`\\b${name}\\b`).test(bodyAfterImports);
      if (!usedInBody) {
        offenders.push(`${file}: imports '${name}' from authz.js but never calls it — dead import or a handler that forgot to use it`);
      }
    }
  }

  assert.deepEqual(offenders, [], '\n' + offenders.join('\n'));
});

test('every mutating route handler (POST/PATCH/PUT/DELETE) is actor-scoped', () => {
  // Every authz.js check is keyed off `me` (req.profile, set by
  // middleware/identity.js). A mutating handler must either read req.profile
  // itself, or be gated by a named middleware (e.g. requireCanCreateSubtask)
  // that does — either way, something between the request and the database
  // write has to consult who's calling. A handler with neither cannot
  // possibly be deciding anything based on the caller — the same class of
  // "the guard exists but nothing wires it in" bug as the previous test,
  // seen from the handler's side instead of the import's side.
  const offenders = [];

  for (const file of routeFiles) {
    if (ALLOWED[file]) continue;
    const src = readFileSync(join(routesDir, file), 'utf8');

    // Split the file into one chunk per router.<verb>(...) call so each
    // handler is checked independently, not just "somewhere in this file".
    const handlerRe = /router\.(post|patch|put|delete)\(/g;
    const starts = [...src.matchAll(handlerRe)].map((m) => m.index);
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : src.length;
      const chunk = src.slice(start, end);
      const verbMatch = chunk.match(/router\.(post|patch|put|delete)\(\s*'([^']+)'/);
      const label = verbMatch ? `${verbMatch[1].toUpperCase()} ${verbMatch[2]}` : chunk.slice(0, 40);

      // A middleware function named require* sitting between the path and
      // handle(...) counts as actor-scoping the whole handler — it runs
      // first and 403s before the handler body ever executes (see
      // requireCanCreateProject / requireCanCreateSubtask in authz.js).
      const gatedByMiddleware = /,\s*require[A-Za-z]+\s*,\s*handle\(/.test(chunk);

      if (!gatedByMiddleware && !/req\.profile/.test(chunk)) {
        offenders.push(`${file}: ${label} never reads req.profile and has no require*() middleware — nothing here can be actor-scoped`);
      }
    }
  }

  assert.deepEqual(offenders, [], '\n' + offenders.join('\n'));
});

test('the server mounts authentication before every route module', () => {
  const src = readFileSync(serverPath, 'utf8');

  const authAt = src.search(/app\.use\(\s*['"]\/api['"]\s*,\s*requireAuth\s*,\s*loadIdentity\s*\)/);
  assert.ok(authAt > -1, "server.js must mount app.use('/api', requireAuth, loadIdentity)");

  // Every imported route module (peopleRoutes, projectsRoutes, ...) must be
  // mounted after that line — not just any app.use('/api', ...) call, which
  // also legitimately covers pre-auth middleware like the DB-readiness gate
  // above requireAuth.
  const routeVarNames = [...src.matchAll(/^import\s+(\w+)\s+from\s+'\.\/routes\//gm)].map((m) => m[1]);
  assert.ok(routeVarNames.length >= 6, `expected 6 imported route modules, found ${routeVarNames.length}`);

  for (const varName of routeVarNames) {
    const mountRe = new RegExp(`app\\.use\\([^)]*\\b${varName}\\b`, 'g');
    for (const m of src.matchAll(mountRe)) {
      assert.ok(
        m.index > authAt,
        `server.js mounts ${varName} before requireAuth/loadIdentity — those requests would run with no req.profile`
      );
    }
  }
});
