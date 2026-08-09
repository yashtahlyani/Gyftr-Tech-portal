/* ─── Verifies the Cognito ID token on every request, then resolves it to a
   row in `people` — this replaces Supabase's claim_person() RPC. A verified
   session with no matching people row is authenticated but has zero access,
   same "no_access" state the frontend already handles (see auth.ts). ─── */
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const { query } = require("../db");

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID,
});

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  let payload;
  try {
    payload = await verifier.verify(token);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const { rows } = await query(
    "select id, name, team, role, email from people where cognito_sub = $1",
    [payload.sub]
  );
  if (rows.length === 0) {
    return res.status(403).json({ error: "no_access", email: payload.email || "" });
  }
  req.person = rows[0];
  next();
}

module.exports = { requireAuth };
