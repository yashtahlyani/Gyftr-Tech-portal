/* ─── Wraps an async route handler so a rejected promise becomes a proper
   500 response instead of an unhandled rejection that leaves the request
   hanging forever (Express 4 doesn't catch async errors on its own). Same
   [METHOD /path] log-prefix convention as the sibling gyftr-portal/
   gyftr-legal backends' route error handling. ─── */
function asyncHandler(label, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[${label}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { asyncHandler };
