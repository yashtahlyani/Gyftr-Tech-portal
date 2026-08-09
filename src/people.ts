/* ─── People directory — static seed in local demo mode, live AWS API
   `/api/people` in cloud mode. Components read these as plain bindings;
   ES module live-bindings mean they pick up loadPeople()'s update on
   the next render without any extra plumbing. ─── */
import type { Person } from "./types";
import { PEOPLE as SEED_PEOPLE, PEOPLE_BY_ID as SEED_PEOPLE_BY_ID } from "./seed";
import { isCloud } from "./lib";
import { get } from "./api";

export let PEOPLE: Person[] = isCloud ? [] : SEED_PEOPLE;
export let PEOPLE_BY_ID: Record<string, Person> = isCloud ? {} : SEED_PEOPLE_BY_ID;
export let peopleLoaded = !isCloud;

let loadPromise: Promise<void> | null = null;

async function fetchPeople(): Promise<void> {
  try {
    PEOPLE = await get<Person[]>("/api/people");
    PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
    peopleLoaded = true;
  } catch (err) {
    console.error("Failed to load people directory:", err);
  }
}

/** Fetch the org directory once; safe to call repeatedly (memoised). No-op in local mode. */
export function loadPeople(): Promise<void> {
  if (!isCloud) return Promise.resolve();
  if (!loadPromise) loadPromise = fetchPeople();
  return loadPromise;
}
