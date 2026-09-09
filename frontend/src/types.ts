/* ─── Core domain types ─── */

export type TeamId =
  | "business"
  | "product"
  | "tech_spoc"
  | "development"
  | "design"
  | "qa"
  | "partner"
  | "leadership";

export type Role = "member" | "lead" | "pmo" | "leadership" | "svp";

export interface Person {
  id: string;
  name: string;
  team: TeamId;
  role: Role;
  email: string;
  /** Direct manager's person id — the org reporting chain. Null for people
   *  outside the Tech hierarchy (Business/Leadership/Partner) and for the
   *  CTO (root of the tree). Drives SVP-level project visibility. */
  managerId?: string;
  /** Real-world department/function (E-Pay, Infra, Testing, etc.) — purely
   *  descriptive, shown in the UI. NOT used for authorization; that's `team`. */
  department?: string;
  /** Explicit, named "sees every project" grant — data-driven (a DB column),
   *  not a hierarchy derivation. Visibility only; doesn't imply write access
   *  the way PMO/leadership's overseer status does. */
  seesAllProjects?: boolean;
  /** false = retired from the directory (e.g. the 2026-09-07 hierarchy import,
   *  superseded the next day). Row stays for FK/history integrity — old
   *  projects still resolve their name — but they must never appear as an
   *  assignment/owner *candidate*. Defaults to true (undefined = active). */
  active?: boolean;
}

/** Pipeline lane a project sits in (drives the board columns + who owns the ball). */
export type StageId =
  | "intake"
  | "scoping"
  | "to_be_picked"
  | "development"
  | "pm_review"
  | "qa"
  | "uat"
  | "pre_prod"
  | "live";

/** Fine-grained status (the deck's status list). Determines the pill + blocked flag. */
export type StatusId =
  | "business_clarification"
  | "scoping"
  | "to_be_picked"
  | "dev"
  | "ready_to_test"
  | "qa"
  | "need_bug_fixing"
  | "bug_fixing_initiated"
  | "tech_clarification_pending"
  | "qa_clarification_pending"
  | "uat"
  | "pending_prod_deployment"
  | "live"
  | "business_dependency"
  | "partner_dependency"
  | "on_hold"
  | "deferred"
  | "pm_review";

export type Priority = "P0" | "P1" | "P2";

export interface SubTask {
  id: string;
  title: string;
  team: TeamId;
  assigneeId?: string;   // specific person, not just the team
  done: boolean;
  createdAt?: number;
  expectedDate?: string;  // set by assigner — target completion date
  promisedDate?: string;  // set by assignee — their committed date
  effortDays?: number;    // set by assignee — estimated effort in man-days
}

export interface HistoryEntry {
  id: string;
  at: number;                 // epoch ms
  byId: string;               // who made the move
  fromStage: StageId | null;
  toStage: StageId;
  fromStatus: StatusId | null;
  toStatus: StatusId;
  note?: string;
}

export interface Comment {
  id: string;
  at: number;
  byId: string;
  text: string;
  pinned?: boolean;       // leadership/PMO priority note — surfaces to the top
  resolved?: boolean;     // owner marked the note as actioned
}

export type DocKind = "BRD" | "PRD" | "Figma" | "HTML" | "Doc" | "Link";
export interface Attachment {
  id: string;
  name: string;
  kind: DocKind;
  url?: string;           // clickable file / link
  byId: string;
  at: number;
}

export interface Project {
  id: string;
  code: string;               // TP-001
  title: string;
  brd: string;                // business requirement / description
  partner: string;            // partner company
  brand: string | null;       // specific brand under that partner
  lob: string;                // line of business
  priority: Priority;
  bifurcation: "B2B" | "B2C";

  stage: StageId;
  status: StatusId;
  ownerId: string;            // who currently holds the ball
  businessOwnerId: string;    // who raised it

  blocked: boolean;
  blockReason?: string;

  /** "Mark as Hold" — an explicit pause, separate from `blocked` (which
   *  already means an in-flow blocked status like Business Clarification).
   *  A held project keeps its stage/status untouched; un-holding just
   *  returns it to wherever it already was. */
  onHold: boolean;
  holdReason?: string;
  heldById?: string;
  heldByTeam?: TeamId;
  heldAt?: number;

  stageEnteredAt: number;     // for aging / SLA
  createdAt: number;
  targetGoLive: string | null;      // biz target (ISO)
  sacrosanctGoLive: string | null;  // committed date (ISO)

  /* PM Activity List sheet parity — every column the Excel tracked */
  priorityMonth: string | null;     // planning bucket, e.g. "Jan'26"
  timelineEta: string | null;       // tech's ETA (ISO date)
  devEffortDays: number | null;     // estimated dev effort
  reasonForDelay: string | null;
  productSpocId: string | null;
  techLeadId: string | null;
  finalGoLive: string | null;       // stamped automatically on go-live

  subtasks: SubTask[];
  history: HistoryEntry[];
  comments: Comment[];
  attachments: Attachment[];
  /** Expected date per pipeline stage — e.g. "expected pickup date", "expected
   *  dev-done date" — so project details show a full timeline, not just the
   *  one overall status. Keyed by StageId; absent stage = no target set yet. */
  stageTargets: Partial<Record<StageId, string>>;
}

export type ViewKey = "overview" | "board" | "list" | "escalations" | "queue" | "team";
