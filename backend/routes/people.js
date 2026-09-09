// routes/people.js — replaces supabase.from('people').select(...) calls
// (src/people.ts's fetchPeople). RLS was: "people_sel" for select using
// (auth.role() = 'authenticated') — any authenticated request may read the
// whole directory; enforced simply by this router sitting behind
// requireAuth + loadProfile in server.js.

import { Router } from 'express';
import { fetchAllPeople } from '../serialize.js';
import { query } from '../db.js';
import { handle } from '../errors.js';

const router = Router();

// GET /api/people
router.get('/', handle(async (_req, res) => {
  const people = await fetchAllPeople(query);
  res.json(people);
}));

export default router;
