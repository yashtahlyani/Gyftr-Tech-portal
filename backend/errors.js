// errors.js — turns a thrown error into an HTTP response.
// Pattern taken from gyftr-ceo-portal/backend/errors.js (adapted: that
// sibling's business rules live in Postgres and raise SQLSTATE-tagged
// exceptions; this app's rules live in authz.js/projectScope.js and throw
// plain JS Errors, so the mapping here is by message-prefix tag instead of
// Postgres error code, but the shape — a tag-to-status table plus a
// handle() wrapper — is the same).
//
// Tags used by this backend (see authz.js/projectScope.js for where each
// is thrown):
//   FORBIDDEN: ...      — an authz.js/projectScope.js permission check failed
//   NOT_FOUND: ...       — route target doesn't exist
//   INVALID: ...          — bad input / stage-target ordering violation
//   (a plain Error with no tag is treated as a genuine 500)

const STATUS_BY_TAG = [
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['INVALID', 400],
];

/** Throw from a route to refuse with a specific status and message. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function statusFor(err) {
  if (err instanceof HttpError) return err.status;
  if (typeof err?.status === 'number') return err.status; // e.g. Object.assign(new Error(...), { status: 404 })
  const msg = (err?.message || '').toUpperCase();
  for (const [tag, status] of STATUS_BY_TAG) {
    if (msg.includes(tag)) return status;
  }
  return 500;
}

/**
 * Wrap an async route handler so thrown/rejected errors become correct HTTP
 * responses instead of an unhandled rejection the client just times out on.
 *
 *   router.post('/x', handle(async (req, res) => { ... }));
 */
export function handle(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      const status = statusFor(err);
      if (status >= 500) {
        console.error(`[${req.method} ${req.originalUrl}]`, err);
      } else {
        console.warn(`[${req.method} ${req.originalUrl}] ${status}: ${err.message}`);
      }
      res.status(status).json({
        // Never leak an internal Postgres message on a 500 — those can
        // carry column/constraint names and query fragments.
        error: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
      });
    });
  };
}
