import { Injectable, computed, signal } from '@angular/core';

export type GuideStepId =
  | 'signIn'
  | 'browse'
  | 'open'
  | 'attach'
  | 'validate'
  | 'prepare'
  | 'approve'
  | 'submit'
  | 'decision';

export interface GuideStep {
  id: GuideStepId;
  title: string;
  /** What the user does, in plain words. */
  doing: string;
  /** What the system does in response. */
  behind: string;
  /** The API call the UI makes. */
  api?: string;
  /** The MCP tool an AI assistant would use for the same thing. */
  mcp?: string;
  /** Plain-language note when no MCP tool exists for this step, and why. */
  mcpNote?: string;
  /** Where "Take me there" navigates, when it makes sense. */
  link?: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'signIn',
    title: 'Sign in',
    doing: 'Pick a demo user. Start with "Demo Coordinator (Tenant A)", who is allowed to make changes.',
    behind:
      'You receive an access token. The backend checks it, then looks up your tenant and role in its own table. The browser never decides what you may do.',
    api: 'POST /dev/token (Supabase Auth when deployed)',
    mcpNote: 'Not a tool. An AI assistant uses your token, so it sees exactly what you see.',
  },
  {
    id: 'browse',
    title: 'See your requests',
    doing: 'Requests shows your tenant only. Click a KPI card or pick a Status to filter; results update instantly.',
    behind: 'Tenant B has 8 more requests that you cannot see. They are excluded on the server, not hidden in the page.',
    api: 'GET /api/v1/authorizations',
    link: '/authorizations',
  },
  {
    id: 'open',
    title: 'Open AUTH-104',
    doing: 'AUTH-104 is an MRI request with an imaging report but no referral letter. Open it.',
    behind: 'The page loads its status, compares its documents with the payer rule (version 1), and loads its timeline. Reading changes nothing.',
    api: 'GET /authorizations/AUTH-104, /missing-documents, /history',
    mcp: 'get_authorization_status, get_missing_documents, get_authorization_history',
    link: '/authorizations/AUTH-104',
  },
  {
    id: 'attach',
    title: 'Attach the missing referral',
    doing: 'In "Attach document", choose Referral letter, then FX-REFERRAL-SIGNED, then click "Attach".',
    behind:
      'A fixture is a synthetic document record, not a real file. Attaching one gives the request a new version, which invalidates any proposal prepared against the old one.',
    api: 'POST /authorizations/{id}/documents',
    mcpNote: 'Deliberately not a tool: an AI cannot attach documents.',
  },
  {
    id: 'validate',
    title: 'Validate',
    doing: 'Click "Validate".',
    behind: 'The server checks the pinned rule again. With every required document present and valid, the status moves to Ready to Submit and the timeline records it.',
    api: 'POST /authorizations/{id}/validate',
    mcp: 'validate_authorization_request',
  },
  {
    id: 'prepare',
    title: 'Prepare for review',
    doing: 'Click "Prepare submission for review".',
    behind:
      'This creates a proposal tied to you and to this exact version of the request. It expires in 5 minutes. An AI assistant can do this step and send you the review link.',
    api: 'POST /authorizations/{id}/submission-proposals',
    mcp: 'prepare_authorization_submission (returns reviewUrl)',
  },
  {
    id: 'approve',
    title: 'Approve (humans only)',
    doing: 'Read "What you are approving", tick the confirmation, then click "Approve".',
    behind:
      'This is the safety boundary. No MCP tool can approve, so a person must click here. Only the coordinator who prepared the proposal can approve it.',
    api: 'POST /submission-proposals/{id}/approve',
    mcpNote: 'No tool, by design. An AI can never approve.',
  },
  {
    id: 'submit',
    title: 'Submit to the simulated payer',
    doing: 'Click "Submit to simulated payer".',
    behind:
      'In one database transaction the server creates the attempt, marks the request Submitted and uses up the proposal. An idempotency key makes a retry return the same attempt instead of creating a duplicate.',
    api: 'POST /api/v1/submissions',
    mcp: 'submit_authorization_request',
  },
  {
    id: 'decision',
    title: 'Watch the decision arrive',
    doing: 'Stay on the progress page. It checks for updates every few seconds.',
    behind:
      'A background worker plays the payer: Queued, then Under review, then a decision from the fixture scenario (AUTH-104 approves). Nothing is shown until the database records it.',
    api: 'GET /api/v1/submissions/{id}',
    mcp: 'get_submission_status',
  },
];

const STORAGE_KEY = 'authbridge.guide';

interface Stored {
  done: GuideStepId[];
  open: boolean;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    // Storage can be unavailable (private mode); the guide still works for this visit.
  }
  return { done: [], open: true };
}

/** Walkthrough progress. Steps complete themselves as the user performs the real actions. */
@Injectable({ providedIn: 'root' })
export class GuideService {
  private readonly stored = load();
  private readonly done = signal<Set<GuideStepId>>(new Set(this.stored.done));
  readonly open = signal(this.stored.open);

  readonly steps = GUIDE_STEPS;
  readonly completedCount = computed(() => this.done().size);
  readonly current = computed<GuideStep | null>(() => this.steps.find((s) => !this.done().has(s.id)) ?? null);
  readonly finished = computed(() => this.current() === null);

  isDone(id: GuideStepId): boolean {
    return this.done().has(id);
  }

  /** True when this step is the one to do next; pages use it to highlight the control. */
  isCurrent(id: GuideStepId): boolean {
    return this.open() && this.current()?.id === id;
  }

  complete(id: GuideStepId): void {
    if (this.done().has(id)) return;
    // Doing a later step implies the earlier ones, so jumping ahead never leaves gaps.
    const index = this.steps.findIndex((s) => s.id === id);
    const next = new Set(this.done());
    for (const step of this.steps.slice(0, index + 1)) next.add(step.id);
    this.done.set(next);
    this.save();
  }

  toggle(): void {
    this.open.update((v) => !v);
    this.save();
  }

  restart(): void {
    this.done.set(new Set());
    this.open.set(true);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ done: [...this.done()], open: this.open() }));
    } catch {
      // Non-essential.
    }
  }
}
