/* ─── People directory — static seed in local demo mode, live Supabase
   `people` table in cloud mode. Components read these as plain bindings;
   ES module live-bindings mean they pick up loadPeople()'s update on
   the next render without any extra plumbing. ─── */
import type { Person } from "./types";
import { PEOPLE as SEED_PEOPLE, PEOPLE_BY_ID as SEED_PEOPLE_BY_ID } from "./seed";
import { isCloud, supabase } from "./lib";

export let PEOPLE: Person[] = isCloud ? [] : SEED_PEOPLE;
export let PEOPLE_BY_ID: Record<string, Person> = isCloud ? {} : SEED_PEOPLE_BY_ID;
export let peopleLoaded = !isCloud;

function fromRow(r: { id: string; name: string; team: Person["team"]; role: Person["role"]; email: string }): Person {
  return { id: r.id, name: r.name, team: r.team, role: r.role, email: r.email };
}

let loadPromise: Promise<void> | null = null;

async function fetchPeople(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from("people").select("id,name,team,role,email");
  if (error) { console.error("Failed to load people directory:", error.message); return; }
  PEOPLE = (data ?? []).map(fromRow);
  PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
  peopleLoaded = true;
}

/** Fetch the org directory once; safe to call repeatedly (memoised). No-op in local mode. */
export function loadPeople(): Promise<void> {
  if (!isCloud || !supabase) return Promise.resolve();
  if (!loadPromise) loadPromise = fetchPeople();
  return loadPromise;
}
