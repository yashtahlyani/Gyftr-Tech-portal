// middleware/identity.js — resolves the verified Cognito token to a
// `people` row (req.profile). Split from middleware/auth.js (JWT
// verification) the way gyftr-ceo-portal splits auth.js/identity.js —
// naming kept for consistency across the sibling portals even though this
// app enforces authorization in authz.js rather than Postgres RLS, so
// req.profile here feeds authz.js's checks instead of becoming a
// set_config()'d auth.uid().
//
// Every RLS policy in the old Supabase schema keyed off `(select ... from
// people where auth_id = auth.uid())`; this is the server-side equivalent,
// run once per request and reused by every authz.js check instead of
// re-querying per call.
//
// Also replaces the old claim_person() RPC: the first successful login for
// a given email auto-links people.cognito_sub, exactly like claim_person()
// did against auth.uid() — driven only by the verified JWT, never by
// client-supplied input.

import { query } from '../db.js';

const PROFILE_COLUMNS = 'id, cognito_sub, name, email, team, role, manager_id, department, sees_all_projects, active';

export async function loadIdentity(req, res, next) {
  try {
    // ── Fast path: this Cognito identity is already linked ───────────────
    const linked = await query(
      `select ${PROFILE_COLUMNS} from people where cognito_sub = $1`,
      [req.user.sub]
    );
    if (linked.rows[0]) {
      req.profile = linked.rows[0];
      return next();
    }

    // ── First sign-in: claim the people row an admin/migration created ───
    // No profile linked to this exact Cognito identity yet — the normal
    // shape of a first-ever login for someone whose `people` row was
    // seeded (by scripts/aws-migration/create-cognito-users.mjs,
    // scripts/onboard.mjs, or an admin) without cognito_sub, or whose
    // account was re-created. Fall back to matching by email, but only
    // when Cognito has verified it — never trust an unverified email claim
    // to attach a session to someone else's row.
    if (req.user.email && req.user.email_verified) {
      const byEmail = await query(
        `select ${PROFILE_COLUMNS} from people where lower(email) = lower($1)`,
        [req.user.email]
      );
      const candidate = byEmail.rows[0];

      if (candidate && !candidate.cognito_sub) {
        await query('update people set cognito_sub = $1 where id = $2', [req.user.sub, candidate.id]);
        req.profile = { ...candidate, cognito_sub: req.user.sub };
        return next();
      }
      if (candidate && candidate.cognito_sub) {
        console.warn(
          `[identity] ${req.user.email} is already linked to a different Cognito identity ` +
          `(person ${candidate.id}). Refusing to relink.`
        );
        return res.status(403).json({
          error: 'This email is already linked to a different sign-in. Contact an admin.',
        });
      }
    }

    // ── No profile ─────────────────────────────────────────────────────
    // Deliberately NO auto-create: unlike Supabase's open self-serve auth,
    // a `people` row here carries a team/role/reporting position that
    // drives real authorization decisions and must come from a real HR/org
    // source, not be invented for whoever happens to sign in first.
    return res.status(403).json({ error: 'No profile linked to this account. Contact an admin.' });
  } catch (err) {
    console.error('[identity]', err.message);
    res.status(500).json({ error: 'Failed to resolve your profile' });
  }
}
