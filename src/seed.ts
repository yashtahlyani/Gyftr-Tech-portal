/* ─── Demo data — mirrors the real PM Activity List sheet rows (Jan–Jul 2026)
   so the portal demos with the numbers the org already knows. ─── */
import type { Person, Project } from "./types";
import { DAY } from "./lib";

export const PEOPLE: Person[] = [
  // ── Business ──
  { id: "u_neha",     name: "Neha",          team: "business",    role: "lead",       email: "neha@gyftr.net" },         // Business Head
  { id: "u_anjali",   name: "Anjali Gupta",  team: "business",    role: "lead",       email: "anjali.gupta@gyftr.net" }, // Business SPOC
  { id: "u_biz1",     name: "Priya Sharma",  team: "business",    role: "member",     email: "priya.sharma@gyftr.net" },
  { id: "u_biz2",     name: "Rahul Joshi",   team: "business",    role: "member",     email: "rahul.joshi@gyftr.net" },
  // ── Product ──
  { id: "u_saurabh",  name: "Saurabh",       team: "product",     role: "lead",       email: "saurabh@gyftr.net" },      // Product Lead
  { id: "u_sid",      name: "Siddharth",     team: "product",     role: "member",     email: "siddharth@gyftr.net" },
  { id: "u_yash",     name: "Yash Tahlyani", team: "product",     role: "member",     email: "yash.tahlyani@gyftr.net" },
  // ── Tech SPOC (managers) ──
  { id: "u_rajneesh", name: "Rajneesh",      team: "tech_spoc",   role: "pmo",        email: "rajneesh@gyftr.net" },     // CTO — sees everything
  { id: "u_anandita", name: "Anandita",      team: "tech_spoc",   role: "lead",       email: "anandita@gyftr.net", department: "Project mgmt" },     // Tech SPOC — default recipient, assigns to everyone else below (department mirrors the cloud dispatcher signal — see roles.ts's isProjectMgmtDispatcher)
  { id: "u_harshita", name: "Harshita",      team: "tech_spoc",   role: "member",     email: "harshita@gyftr.net" },
  { id: "u_mgr2",     name: "Deepak",        team: "tech_spoc",   role: "member",     email: "deepak@gyftr.net" },
  { id: "u_mgr3",     name: "Sameer",        team: "tech_spoc",   role: "member",     email: "sameer@gyftr.net" },
  { id: "u_mgr4",     name: "Pankaj",        team: "tech_spoc",   role: "member",     email: "pankaj@gyftr.net" },
  // ── Development ──
  { id: "u_raj",      name: "Raj",           team: "development", role: "member",     email: "raj@gyftr.net" },
  { id: "u_anmol",    name: "Anmol",         team: "development", role: "member",     email: "anmol@gyftr.net" },
  { id: "u_vikas",    name: "Vikas",         team: "development", role: "member",     email: "vikas@gyftr.net" },
  // ── Design / QA ──
  { id: "u_rajkumar", name: "Rajkumar",      team: "design",      role: "member",     email: "rajkumar@gyftr.net" },
  { id: "u_pooja",    name: "Pooja",         team: "qa",          role: "member",     email: "pooja@gyftr.net" },
  { id: "u_karan",    name: "Karan",         team: "qa",          role: "lead",       email: "karan@gyftr.net" },
  // ── Overseers ──
  { id: "u_pmo",      name: "PMO Office",    team: "leadership",  role: "pmo",        email: "pmo@gyftr.net" },
  { id: "u_ceo",      name: "Leadership",    team: "leadership",  role: "leadership", email: "leadership@gyftr.net" },
];

export const PEOPLE_BY_ID: Record<string, Person> =
  Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

const ago = (d: number) => Date.now() - d * DAY;

function base(
  code: string, title: string, partner: string, lob: string,
  extra: Partial<Project>
): Project {
  return {
    id: code.toLowerCase(),
    code,
    title,
    brd: extra.brd ?? "",
    partner,
    brand: extra.brand ?? null,
    lob,
    priority: extra.priority ?? "P1",
    bifurcation: extra.bifurcation ?? "B2C",
    stage: extra.stage!,
    status: extra.status!,
    ownerId: extra.ownerId!,
    businessOwnerId: extra.businessOwnerId ?? "u_anjali",
    blocked: extra.blocked ?? false,
    blockReason: extra.blockReason,
    onHold: extra.onHold ?? false,
    holdReason: extra.holdReason,
    heldById: extra.heldById,
    heldByTeam: extra.heldByTeam,
    heldAt: extra.heldAt,
    stageEnteredAt: extra.stageEnteredAt ?? ago(2),
    createdAt: extra.createdAt ?? ago(20),
    targetGoLive: extra.targetGoLive ?? null,
    sacrosanctGoLive: extra.sacrosanctGoLive ?? null,
    priorityMonth: extra.priorityMonth ?? null,
    timelineEta: extra.timelineEta ?? null,
    devEffortDays: extra.devEffortDays ?? null,
    reasonForDelay: extra.reasonForDelay ?? null,
    productSpocId: extra.productSpocId ?? null,
    techLeadId: extra.techLeadId ?? null,
    finalGoLive: extra.finalGoLive ?? null,
    subtasks: extra.subtasks ?? [],
    history: extra.history ?? [],
    comments: extra.comments ?? [],
    attachments: extra.attachments ?? [],
    stageTargets: extra.stageTargets ?? {},
  };
}

export const SEED_PROJECTS: Project[] = [
  // ── Real sheet rows ──
  base("TP-001", "Addition of Bill Payments, Flights & Hotels", "Godrej", "LLC", {
    brd: "Extend the Godrej loyalty catalogue with Bill Payments, Flights and Hotels. Wallet round-up logic and guidelines to be finalised with partner.",
    priority: "P0", bifurcation: "B2B", stage: "uat", status: "qa_clarification_pending",
    ownerId: "u_saurabh", businessOwnerId: "u_anjali", blocked: true,
    blockReason: "Cleartrip staging API not working — Bills & Utilities API failing frequently.",
    stageEnteredAt: ago(9), createdAt: ago(48),
    targetGoLive: null, sacrosanctGoLive: "2026-04-30",
    priorityMonth: "June'26", devEffortDays: 30,
    reasonForDelay: "Guidelines changed · Wallet update changes · Round-up logic change · Testing · Changes suggested by the partner",
    productSpocId: "u_harshita", techLeadId: "u_raj",
    subtasks: [
      { id: "s1", title: "Bill payment integration", team: "development", done: true },
      { id: "s2", title: "Flights (Cleartrip) integration", team: "development", done: false },
      { id: "s3", title: "Hotels flow + UI", team: "design", done: true },
      { id: "s4", title: "Round-up wallet logic", team: "development", done: false },
    ],
    comments: [
      { id: "c1", at: ago(3), byId: "u_pooja", text: "Cleartrip staging keeps timing out on Bills API. Blocked on partner infra." },
      { id: "c2", at: ago(1), byId: "u_anjali", text: "Escalated to Godrej. Awaiting stable staging endpoint." },
    ],
    attachments: [
      { id: "a1", name: "Godrej_BillPay_BRD.pdf", kind: "BRD", url: "https://drive.google.com/file/d/godrej-billpay-brd", byId: "u_anjali", at: ago(48) },
      { id: "a2", name: "Godrej_Solution_PRD.docx", kind: "PRD", url: "https://docs.google.com/document/d/godrej-solution-prd", byId: "u_sid", at: ago(40) },
      { id: "a3", name: "Hotels Booking — Figma", kind: "Figma", url: "https://figma.com/file/godrej-hotels-flow", byId: "u_rajkumar", at: ago(30) },
    ],
  }),
  base("TP-002", "Adding pay element as payment instrument", "IOCL P+C", "Channel Program", {
    brd: "Introduce a new pay element usable as a payment instrument at checkout.",
    priority: "P0", bifurcation: "B2B", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(178), createdAt: ago(220),
    targetGoLive: "2026-01-18", sacrosanctGoLive: "2026-01-16", finalGoLive: "2026-01-16",
    priorityMonth: "Jan'26", devEffortDays: 15, productSpocId: "u_harshita", techLeadId: "u_vikas",
    subtasks: [{ id: "s1", title: "Payment element", team: "development", done: true }],
  }),
  base("TP-003", "UI Revamp — Wonder Influencer, Dealer & Retailer", "Wonder Cement", "Channel Program", {
    brd: "Full UI revamp across influencer, dealer and retailer programs.",
    priority: "P0", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(84), createdAt: ago(150),
    targetGoLive: "2026-04-20", sacrosanctGoLive: "2026-04-20", finalGoLive: "2026-04-20",
    priorityMonth: "March'26", devEffortDays: 12, productSpocId: "u_sid", techLeadId: "u_raj",
    subtasks: [
      { id: "s1", title: "Influencer screens", team: "design", done: true },
      { id: "s2", title: "Dealer dashboard", team: "development", done: true },
      { id: "s3", title: "Retailer flows", team: "development", done: true },
    ],
    comments: [
      { id: "c1", at: ago(90), byId: "u_karan", text: "3 bugs on retailer redemption raised. Sending back to dev." },
      { id: "c2", at: ago(88), byId: "u_ceo", text: "This is committed to Wonder Cement's leadership for month-end. Please treat as P0 and clear the retailer bugs by Friday.", pinned: true, resolved: true },
    ],
    attachments: [
      { id: "a1", name: "Wonder_UI_Revamp_BRD.pdf", kind: "BRD", url: "https://drive.google.com/file/d/wonder-ui-brd", byId: "u_anjali", at: ago(148) },
      { id: "a2", name: "Retailer Screens — Figma", kind: "Figma", url: "https://figma.com/file/wonder-retailer", byId: "u_rajkumar", at: ago(120) },
    ],
  }),
  base("TP-004", "Variable denomination — Luminous", "Luminous", "Channel Program", {
    brd: "Support variable denomination vouchers for Luminous channel partners.",
    priority: "P0", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(167), createdAt: ago(200),
    targetGoLive: "2026-01-29", finalGoLive: "2026-01-27",
    priorityMonth: "Jan'26", devEffortDays: 10, productSpocId: "u_harshita", techLeadId: "u_raj",
    subtasks: [{ id: "s1", title: "Denomination config", team: "development", done: true }],
  }),
  base("TP-005", "Onboarding of Sterlite Electric (Copy of Cera)", "Evolve Brands", "Channel Program", {
    brd: "Onboard Sterlite Electric (copy of Cera program setup).",
    priority: "P0", bifurcation: "B2B", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(90), createdAt: ago(130),
    targetGoLive: "2026-04-14", finalGoLive: "2026-04-14",
    priorityMonth: "March'26", devEffortDays: 10, productSpocId: "u_sid", techLeadId: "u_anmol",
    subtasks: [
      { id: "s1", title: "Clone Cera config", team: "development", done: true },
      { id: "s2", title: "Brand theming", team: "design", done: true },
    ],
  }),
  base("TP-006", "Bosch UI revamp", "Bosch", "Channel Program", {
    brd: "Refresh the Bosch program UI to the new design system.",
    priority: "P0", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(157), createdAt: ago(190),
    targetGoLive: "2026-02-08", finalGoLive: "2026-02-06",
    priorityMonth: "Jan'26", devEffortDays: 5, productSpocId: "u_harshita", techLeadId: "u_anmol",
    subtasks: [],
  }),
  base("TP-010", "Variable denomination — Godrej", "Godrej", "Channel Program", {
    brand: "Club One",
    brd: "Variable denomination vouchers for Godrej Club One.",
    priority: "P0", stage: "live", status: "live",
    ownerId: "u_ceo", stageEnteredAt: ago(174), createdAt: ago(210),
    targetGoLive: "2026-01-17", finalGoLive: "2026-01-20",
    priorityMonth: "Jan'26", devEffortDays: 10, productSpocId: "u_harshita", techLeadId: "u_anmol",
    subtasks: [{ id: "s1", title: "Denomination config", team: "development", done: true }],
  }),
  // ── In-flight pipeline ──
  base("TP-007", "Reward round-up wallet — DBS", "DBS", "Banking", {
    brd: "New round-up-to-reward wallet mechanic for DBS cardholders.",
    priority: "P1", stage: "scoping", status: "scoping",
    ownerId: "u_sid", stageEnteredAt: ago(7), createdAt: ago(10),
    targetGoLive: "2026-08-15",
    priorityMonth: "Aug'26", devEffortDays: 20, productSpocId: "u_sid", techLeadId: "u_vikas",
    subtasks: [],
    comments: [{ id: "c1", at: ago(2), byId: "u_sid", text: "Drafting PRD. Need clarity on interest treatment from business." }],
  }),
  base("TP-008", "Amex catalogue expansion", "Amex", "Banking", {
    brd: "Add 40+ new brands to the Amex rewards catalogue with tiered pricing.",
    priority: "P2", stage: "intake", status: "business_clarification",
    ownerId: "u_anjali", stageEnteredAt: ago(5), createdAt: ago(6), blocked: true,
    blockReason: "Awaiting final brand list + commercials from business.",
    targetGoLive: "2026-09-01",
    priorityMonth: "Sep'26", devEffortDays: 8, productSpocId: "u_sid", techLeadId: "u_raj",
    subtasks: [],
  }),
  base("TP-009", "AU Rewardz hotel booking flow", "AU Bank", "Banking", {
    brd: "Seamless hotel booking flow inside AU Rewardz (per AU_Hotel PRD).",
    priority: "P0", stage: "development", status: "bug_fixing_initiated",
    ownerId: "u_vikas", stageEnteredAt: ago(8), createdAt: ago(35),
    targetGoLive: "2026-07-25", sacrosanctGoLive: "2026-07-25", timelineEta: "2026-07-20",
    priorityMonth: "July'26", devEffortDays: 18, productSpocId: "u_harshita", techLeadId: "u_vikas",
    subtasks: [
      { id: "s1", title: "Search + results UX", team: "design", done: true },
      { id: "s2", title: "Booking + payment", team: "development", done: true },
      { id: "s3", title: "Cancellation flow", team: "development", done: false },
    ],
  }),
];
