-- ════════════════════════════════════════════════════════════════════════════
--  GYFTR TECH PORTAL · dba-setup.sql
--
--  RUN THIS ONCE, AS THE RDS MASTER USER, BEFORE THE BACKEND FIRST STARTS.
--
--  ── Why this file is much shorter than gyftr-ceo-portal's sibling ──────────
--
--  gyftr-ceo-portal enforces authorization with real Postgres Row-Level
--  Security: ~19 `create policy` statements, a dedicated `authenticated`
--  role nothing ever logs in as, and a schema-ownership handover so the app
--  user can run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every boot.
--  That is real, DBA-only machinery.
--
--  This app has NONE of that. Authorization lives entirely in Express
--  middleware (backend/authz.js) — see DATABASE.md and backend/sql/
--  01_schema.sql's header for the full explanation. Consequences, in order:
--
--    · No `authenticated` role.       Nothing ever does SET LOCAL ROLE here.
--    · No `create policy` statements. RLS is never enabled on any table.
--    · No schema-ownership handover.  The app's own DB user creating tables
--      it will also own is the NORMAL case, not a special one — there is no
--      later step that requires owning something it doesn't already own.
--    · No pgcrypto.                   gen_random_uuid() is core in
--      PostgreSQL 13+ (see backend/sql/01_schema.sql's own comment), so
--      there is no extension to install as a superuser.
--
--  What is left: make sure the app's own database user can CREATE tables,
--  indexes, sequences and enum types in its own database. On RDS, a
--  non-master user created through the normal `CREATE USER ... PASSWORD`
--  path already has this by default in a database it also owns — so on a
--  freshly created RDS instance where the app user IS the database owner,
--  this file has literally nothing to do. It exists for the one case where
--  that isn't true: a shared RDS instance, or a database created by the
--  master user on the app's behalf, where CREATE has not been granted yet.
--
--  ── How to run ──────────────────────────────────────────────────────────────
--
--    psql "host=<rds-endpoint> dbname=<tech-db> user=<master> sslmode=require" \
--         -v app_user=gyftr_admin \
--         -f infra/dba-setup.sql
--
--  Replace `gyftr_admin` with the user the BACKEND connects as — the one in
--  Secrets Manager, or DB_USER on the ECS task. If you omit -v it defaults
--  to gyftr_admin.
--
--  Safe to re-run. Every statement is idempotent.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Default the app user if -v was not supplied.
select coalesce(:'app_user', 'gyftr_admin') as app_user \gset

\echo ''
\echo '=== Gyftr Tech Portal — DBA setup ==='
\echo 'Database :' :DBNAME
\echo 'App user :' :app_user
\echo ''

-- ── 1. Let the app user create objects in this database ────────────────────
-- CREATE on the database (tables/sequences/enum types), CONNECT so it can
-- actually reach it, and ownership of the `public` schema so
-- backend/db.js's applyMigrations() can create tables there on first boot
-- without a separate grants step. No RLS, no policies, no extra role.
do $$
begin
  execute format('grant create, connect on database %I to %I', current_database(), :'app_user');
  execute format('alter schema public owner to %I', :'app_user');
exception
  when others then
    raise notice 'Could not fully grant schema rights: %', sqlerrm;
    raise notice 'If the backend later fails to create a table, this is why.';
end $$;
\echo '  [1/2] schema rights granted'

-- ── 2. Hand over any objects created earlier by someone else ────────────────
-- If the tables were created by hand, or by a different user during an
-- earlier attempt, the app user is not their owner and a future
-- backend/sql/*.sql migration that alters one of them could fail. Reassign
-- the ones this product owns.
--
-- Deliberately NOT `REASSIGN OWNED BY`: on a shared instance that would move
-- every object the old role owns, including other portals'. This names only
-- this product's tables.
do $$
declare
  obj record;
  n int := 0;
begin
  for obj in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind in ('r','S')          -- tables, sequences
       and c.relname in (
             'people','projects','subtasks','stage_targets','stage_history',
             'comments','attachments','projects_code_seq'
           )
       and pg_get_userbyid(c.relowner) <> :'app_user'
  loop
    execute format('alter %s public.%I owner to %I',
                   case obj.relkind when 'S' then 'sequence' else 'table' end,
                   obj.relname, :'app_user');
    n := n + 1;
  end loop;

  if n > 0 then
    raise notice 'Reassigned % existing object(s) to %', n, :'app_user';
  else
    raise notice 'No existing objects needed reassigning.';
  end if;
end $$;
\echo '  [2/2] existing objects reassigned'

\echo ''
\echo 'Done. Restart the Tech Portal API service — it applies backend/sql/*.sql'
\echo 'itself on boot (see backend/db.js). Then verify with:'
\echo '  cd scripts && node doctor.mjs'
\echo ''
