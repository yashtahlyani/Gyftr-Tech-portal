# Demo

**Local:** `npm run docker:up` then open the frontend URL (`http://localhost:8979`)

---

## Accounts

Every seeded demo account signs in with the `DEMO_PASSWORD` set in your
`.env` — pick your own value locally; there is no shared value hard-coded
anywhere in this repository (a password literal in a public repo is the
first thing anyone tries against a login page).

```bash
cd scripts && npm install
DEMO_PASSWORD='choose-one' node seed.mjs
```

This **resets first** (clears demo projects and `@demo.gyftr.net` accounts),
so it is deterministic and safe to re-run.

### Who is in the demo roster

Fifteen people, first-name-only, covering every team and most roles — enough
to demo hierarchy-based visibility without needing the real org:

| Team | People | Notes |
|---|---|---|
| Business | Neha (lead) → Anjali (member) → Priya (member) | a real three-level chain for subtree tests |
| Product | Saurabh (lead) → Siddharth (member) | |
| Tech SPOC | Rajneesh (PMO, `sees_all_projects`) → Anandita (lead, `department: "Project mgmt"`) → Harshita (member) | Rajneesh is the CTO-equivalent overseer |
| Development | Raj, Anmol — both report to Anandita | so Tech SPOC's subtree spans into Development |
| Design | Rajkumar (member) | |
| QA | Pooja (member), Karan (lead) | |
| Leadership | PMO Office (pmo, sees all), Leadership (leadership, sees all) | |

Ten demo projects are spread across every pipeline stage, each with 1–3
sub-tasks and most with a comment, so the board, table view and dashboard
are populated on first load.

---

## The walkthrough

### 1 · See the whole board as an overseer

Sign in as **Rajneesh** (`rajneesh@demo.gyftr.net`, PMO) or **PMO Office** /
**Leadership**. Every project is visible — `sees_all_projects` and the `pmo`/
`leadership` roles both grant this in `canSee()` (see `backend/authz.js`).

### 2 · See only your own team's court

Sign in as **Pooja** (`pooja@demo.gyftr.net`, QA member). Only projects
where `qa` is in `involved_teams`, or that are in `to_be_picked` (if she
could dispatch — she can't, she's not a manager), are visible. This is the
plain-team-involvement path in `canSee()`, with no hierarchy involved.

### 3 · See a hierarchy manager's subtree

Sign in as **Rajneesh** again and open a project whose `tech_lead_id` is
**Raj** (development) — Raj reports to Anandita, who reports to Rajneesh.
Even if the project is never tagged `tech_spoc` in `involved_teams`, it's
visible to Rajneesh via `orgSubtreeIds()` — the manager-chain visibility
path that has no equivalent in a plain team-based system. This is the
scenario `tests/logic.test.mjs`'s `canSee: hierarchy visibility via subtree`
case asserts directly against `authz.js`.

### 4 · The Business-hold carve-out

Sign in as **Neha** (business lead) and open a project Anjali or Priya owns
(their subtree). Edit the title — allowed. Try to toggle **On Hold** — the
API refuses it (`FORBIDDEN: Business may not change hold status`), even
though Neha otherwise has full control of her branch's work. This is
`enforceProjectUpdateScope()`'s Business-hierarchy carve-out in
`backend/projectScope.js`.

### 5 · A Product lead's narrow, off-court reach

Sign in as **Saurabh** (product lead) and open a project currently owned by
Development, where Product isn't in court. He can edit **Expected** /
**Timeline ETA** — nothing else. Attempting to edit the title is refused
with `FORBIDDEN: Product leads may only edit go-live dates ... outside their
own court`.

### 6 · A project's full lifecycle

As Rajneesh (or PMO), open any project's **history** tab in the drawer — the
append-only `stage_history` ledger, written atomically with every stage
transition (see ARCHITECTURE.md's walkthrough of `PATCH /api/projects/:id`).

### 7 · Sub-tasks and the assignee's own-row carve-out

As **Anandita** (tech_spoc lead), create a sub-task on a project and assign
it to **Raj**. Sign in as Raj: he cannot reassign or delete it (not
Product/Tech SPOC/PMO), but he **can** set his own `promised_date` and
`effort_days` — the assignee-own-row carve-out in `canManageSubtask()`.

---

## Proving the boundaries

The interesting claims aren't visual — they're in the API. To see them
enforced directly against the ported authorization logic, with no server or
browser needed:

```bash
node --test tests/logic.test.mjs
```

29 tests exercising `backend/authz.js` and `backend/projectScope.js`
directly: subtree computation, the coarse-team-leak flag (and the specific
teams it does — and does not — apply to), the broad/narrow
`subtreeOwns`/`subtreeLeads` split, the Business-hold carve-out, the
Product-lead date-only carve-out, stage-target ordering, and more. See
[SECURITY.md](SECURITY.md) for why testing these functions directly is
equivalent to testing enforcement in this app's design.
