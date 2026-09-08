-- ══════════════════════════════════════════════════════════════
-- Retire the original demo roster (2026-09-08) — the placeholder people
-- (single first names, no spreadsheet origin) seeded before either real
-- hierarchy existed. Not part of the Tech hierarchy (tech-hierarchy-
-- reactivate.sql), the Business hierarchy (hierarchy-seed.sql), the 5
-- named Product "sees every project" grantees, or the Leadership team —
-- so per instruction they're active=false: rows stay for FK/history
-- integrity, just excluded from every assignment/owner picker.
--
-- Idempotent. Deliberately does NOT touch auth_id — active is a UI-
-- candidate-list rule only (see people.active's comment in schema.sql),
-- not a login/RLS gate.
--
-- NOTE: this includes yash.tahlyani@gyftr.net (Product) — the operator's
-- own seed account. Flagged explicitly since deactivating it means this
-- account stops appearing as an assignable candidate anywhere (login is
-- unaffected). Re-run with that email removed from the list below to
-- keep it active if that wasn't intended.
-- ══════════════════════════════════════════════════════════════

update people set active = false
where email in (
  'priya.sharma@gyftr.net', 'rahul.joshi@gyftr.net',       -- business (not in either hierarchy)
  'yash.tahlyani@gyftr.net',                                -- product (not one of the 5 named grantees)
  'deepak@gyftr.net', 'harshita@gyftr.net', 'pankaj@gyftr.net', 'sameer@gyftr.net', -- tech_spoc demo
  'anmol@gyftr.net', 'raj@gyftr.net', 'vikas@gyftr.net',    -- development demo
  'rajkumar@gyftr.net',                                     -- design demo
  'karan@gyftr.net'                                         -- qa demo
);
