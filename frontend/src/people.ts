/* ─── People directory — static seed in local demo mode, live GET /api/people
   in cloud mode. Components read these as plain bindings; ES module live-
   bindings mean they pick up loadPeople()'s update on the next render
   without any extra plumbing. ─── */
import type { Person } from "./types";
import { PEOPLE as SEED_PEOPLE, PEOPLE_BY_ID as SEED_PEOPLE_BY_ID } from "./seed";
import { isCloud } from "./lib";
import { fetchPeople as apiFetchPeople, type Row } from "./api";

export let PEOPLE: Person[] = isCloud ? [] : SEED_PEOPLE;
export let PEOPLE_BY_ID: Record<string, Person> = isCloud ? {} : SEED_PEOPLE_BY_ID;
export let peopleLoaded = !isCloud;

function fromRow(r: Row): Person {
  return {
    id: r.id, name: r.name, team: r.team, role: r.role, email: r.email,
    managerId: r.manager_id ?? undefined, department: r.department ?? undefined,
    seesAllProjects: r.sees_all_projects ?? false, active: r.active ?? true,
  };
}

let loadPromise: Promise<void> | null = null;

async function fetchPeopleDirectory(): Promise<void> {
  try {
    const rows = await apiFetchPeople();
    PEOPLE = rows.map(fromRow);
    PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
    peopleLoaded = true;
  } catch (err) {
    console.error("Failed to load people directory:", (err as Error).message);
  }
}

/** Fetch the org directory once; safe to call repeatedly (memoised). No-op in local mode. */
export function loadPeople(): Promise<void> {
  if (!isCloud) return Promise.resolve();
  if (!loadPromise) loadPromise = fetchPeopleDirectory();
  return loadPromise;
}

/** Force the next loadPeople() call to refetch — used after sign-in, since a
 *  memoised empty/stale directory from a previous session must not linger. */
export function resetPeopleCache() {
  loadPromise = null;
}
