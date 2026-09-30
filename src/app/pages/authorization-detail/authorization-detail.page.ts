import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AuthorizationStatusDetail, DocumentFixture, HistoryEntry, MissingDocuments } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { CallerService, ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const PRE_SUBMISSION = ['Draft', 'AwaitingDocuments', 'ReadyToSubmit'];
const FLOW = ['Draft', 'AwaitingDocuments', 'ReadyToSubmit', 'Submitted', 'UnderReview', 'Decision'];
const FUTURE_TEXT: Record<string, string> = {
  AwaitingDocuments: 'Attach every required document',
  ReadyToSubmit: 'Validate against the payer rule',
  Submitted: 'Human approval, then submit',
  UnderReview: 'Simulated payer picks it up',
  Decision: 'Approved or Denied by the simulated payer',
};

interface TimelineRow {
  title: string;
  detail: string;
  at?: string;
  kind: 'done' | 'current' | 'future';
}

@Component({
  selector: 'ab-authorization-detail-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a routerLink="/authorizations">Request Queue</a>
      <img src="icons/chevron-right.svg" width="12" height="12" alt="" />
      <strong>{{ id() }}</strong>
    </nav>

    <ab-waking [attempt]="waking()" />
    <ab-error [error]="loadError()" (retry)="load()" />

    @if (detail(); as d) {
      <header class="page-head">
        <h1>Prior Auth Details</h1>
        <div class="page-actions">
          @if (d.submissionAttemptId) {
            <a class="button-link" [routerLink]="['/submissions', d.submissionAttemptId]">View submission progress</a>
          }
          @if (canWrite()) {
            <button type="button" class="secondary" [class.guide-focus]="guide.isCurrent('validate')" (click)="validate()"
                    [disabled]="busy() || !isPreSubmission()">Validate</button>
            <button type="button" [class.guide-focus]="guide.isCurrent('prepare')" (click)="prepare()"
                    [disabled]="busy() || d.status !== 'ReadyToSubmit'"
                    [title]="d.status !== 'ReadyToSubmit' ? 'Available once the request is Ready to Submit' : ''">
              Prepare submission for review
            </button>
          }
        </div>
      </header>

      <ab-error [error]="actionError()" />
      @if (notice(); as n) {
        <div class="panel ok" role="status"><img src="icons/check-circle-16.svg" width="16" height="16" alt="" /><p>{{ n }}</p></div>
      }
      @if (!canWrite()) {
        <div class="panel info"><img src="icons/info-16.svg" width="16" height="16" alt="" /><p>Read-only access. Coordinators in your tenant can change this request.</p></div>
      } @else if (!isPreSubmission()) {
        <div class="panel info"><img src="icons/info-16.svg" width="16" height="16" alt="" /><p>This request has been submitted; documents and validation are locked.</p></div>
      }

      <div class="grid-2">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <h2>Request Information</h2>
              <ab-status [status]="d.status" />
            </div>
            <div class="facts">
              <div class="fact"><span class="k">Request ID</span><span class="v mono b">{{ d.authorizationId }}</span></div>
              <div class="fact"><span class="k">Member</span><span class="v b">{{ d.memberLabel }}</span></div>
              <div class="fact"><span class="k">Tenant</span><span class="v mono">{{ d.tenantId }}</span></div>
              <div class="fact"><span class="k">Payer</span><span class="v">{{ d.payerCode }} (simulated)</span></div>
              <div class="fact"><span class="k">Service</span><span class="v mono">{{ d.serviceCode }}</span></div>
              <div class="fact">
                <span class="k">Rule version</span>
                <span class="v">v{{ d.rule.ruleVersion }}@if (!d.rule.isActive) { <span class="field-error"> · inactive</span> }</span>
              </div>
            </div>
            <div class="fact">
              <span class="k">Version (sent with every change so edits never overwrite each other)</span>
              <span class="v"><code>{{ d.version }}</code></span>
            </div>
          </section>

          <section class="card">
            <h2>Required Documents Checklist</h2>
            @if (missingError(); as e) {
              <ab-error [error]="e" />
            }
            @if (missing(); as m) {
              <div class="stack" style="gap: 12px">
                @for (type of m.required; track type) {
                  <div class="doc-row">
                    <span class="l">
                      <img [src]="m.present.includes(type) ? 'icons/check-circle-16.svg' : m.invalid.includes(type) ? 'icons/alert-triangle-amber.svg' : 'icons/clock-16.svg'" width="16" height="16" alt="" />
                      {{ label(type) }}
                    </span>
                    @if (m.present.includes(type)) {
                      <span class="r">Attached {{ attachedAt(type) | date: 'MMM d, y' }} · <code>{{ fixtureOf(type) }}</code></span>
                    } @else if (m.invalid.includes(type)) {
                      <span class="r bad">Attached but invalid · <code>{{ fixtureOf(type) }}</code></span>
                    } @else {
                      <span class="r warn">Missing</span>
                    }
                  </div>
                }
              </div>
            }
            @if (canEdit()) {
              <div class="dropzone" [class.guide-focus]="guide.isCurrent('attach')">
                <img src="icons/upload-cloud.svg" width="24" height="24" alt="" />
                <span class="t">Attach a synthetic document</span>
                <span class="s">Fixtures are allowlisted metadata records. Nothing is uploaded.</span>
                <form [formGroup]="attachForm" (ngSubmit)="attach()" novalidate>
                  <label class="field">
                    Document type
                    <select formControlName="documentType">
                      <option value="" disabled>Choose…</option>
                      @for (type of documentTypes(); track type) {
                        <option [value]="type">{{ type }}</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    Fixture
                    <select formControlName="fixtureKey">
                      <option value="" disabled>Choose…</option>
                      @for (f of fixturesForType(); track f.key) {
                        <option [value]="f.key">{{ f.key }} — {{ f.isValid ? 'valid' : 'invalid' }}</option>
                      }
                    </select>
                  </label>
                  <button type="submit" [disabled]="attachForm.invalid || busy()">Attach fixture</button>
                </form>
              </div>
            }
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2>AI Assistant — MCP Tools</h2>
                <p class="sub">What an AI host connected to AuthBridge can do with this request</p>
              </div>
            </div>
            <div class="ai-box">
              <span class="t"><img src="icons/sparkles.svg" width="16" height="16" alt="" />Try asking your assistant</span>
              <ul>
                <li>"What's missing on {{ d.authorizationId }}?" <code>get_missing_documents</code></li>
                <li>"Validate {{ d.authorizationId }}." <code>validate_authorization_request</code></li>
                <li>"Prepare {{ d.authorizationId }} for submission." <code>prepare_authorization_submission</code></li>
                <li>"Has it been decided?" <code>get_submission_status</code></li>
              </ul>
              <p>The assistant can prepare a submission and send you the review link, but it can never approve. Approval is your click.</p>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <h2>Prior Auth Timeline</h2>
            <div class="timeline">
              @for (t of timeline(); track $index) {
                <div class="tl">
                  <img [src]="'icons/dot-' + t.kind + '.svg'" width="16" height="16" alt="" />
                  <div>
                    <div class="h" [class.current]="t.kind === 'current'" [class.future]="t.kind === 'future'">{{ t.title }}</div>
                    <div class="d">{{ t.detail }}@if (t.at) { · <time>{{ t.at | date: 'MMM d, h:mm a' }}</time> }</div>
                  </div>
                </div>
              }
            </div>
          </section>

          <section class="card">
            <h2>Payer Requirements Checklist</h2>
            <div class="checks">
              <div><img [src]="d.rule.isActive ? 'icons/check-green.svg' : 'icons/info-16.svg'" width="16" height="16" alt="" />
                Rule {{ d.payerCode }} / {{ d.serviceCode }} v{{ d.rule.ruleVersion }} {{ d.rule.isActive ? 'is active' : 'is inactive — configuration missing' }}</div>
              @if (missing(); as m) {
                @for (type of m.required; track type) {
                  <div><img [src]="m.present.includes(type) ? 'icons/check-green.svg' : 'icons/info-16.svg'" width="16" height="16" alt="" />
                    {{ label(type) }} {{ m.present.includes(type) ? 'provided and valid' : 'still required' }}</div>
                }
              }
              <div><img src="icons/check-green.svg" width="16" height="16" alt="" />Access verified for {{ d.tenantId }}</div>
            </div>
          </section>
        </div>
      </div>
    }
  `,
})
export class AuthorizationDetailPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly callers = inject(CallerService);
  protected readonly guide = inject(GuideService);

  protected readonly detail = signal<AuthorizationStatusDetail | null>(null);
  protected readonly missing = signal<MissingDocuments | null>(null);
  protected readonly missingError = signal<UiError | null>(null);
  protected readonly history = signal<HistoryEntry[]>([]);
  protected readonly fixtures = signal<DocumentFixture[]>([]);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly waking = signal(0);

  protected readonly canWrite = this.callers.canWrite;
  protected readonly isPreSubmission = computed(() => PRE_SUBMISSION.includes(this.detail()?.status ?? ''));
  protected readonly canEdit = computed(() => this.canWrite() && this.isPreSubmission());

  protected readonly attachForm = inject(FormBuilder).nonNullable.group({
    documentType: ['', Validators.required],
    fixtureKey: ['', Validators.required],
  });
  private readonly selectedType = toSignal(this.attachForm.controls.documentType.valueChanges, { initialValue: '' });
  protected readonly documentTypes = computed(() => [...new Set(this.fixtures().map((f) => f.documentType))]);
  protected readonly fixturesForType = computed(() => this.fixtures().filter((f) => f.documentType === this.selectedType()));

  /** Recorded history, the current step highlighted, then the steps still to come. */
  protected readonly timeline = computed<TimelineRow[]>(() => {
    const entries = this.history();
    const rows: TimelineRow[] = entries.map((h, i) => ({
      title: this.label(h.newStatus),
      detail: `${h.reason} · ${h.actorId.startsWith('system:') ? h.actorId.slice(7) : 'coordinator'}`,
      at: h.occurredAtUtc,
      kind: i === entries.length - 1 ? 'current' : 'done',
    }));
    const status = this.detail()?.status ?? '';
    if (status === 'Approved' || status === 'Denied') {
      if (rows.length) rows[rows.length - 1].kind = 'done';
      return rows;
    }
    const index = FLOW.indexOf(status);
    for (const step of FLOW.slice(index + 1)) {
      rows.push({ title: this.label(step), detail: FUTURE_TEXT[step] ?? '', kind: 'future' });
    }
    return rows;
  });

  constructor() {
    this.attachForm.controls.documentType.valueChanges.subscribe(() =>
      this.attachForm.controls.fixtureKey.setValue('', { emitEvent: false }),
    );
  }

  ngOnInit(): void {
    this.load();
    this.api.fixtures().subscribe({ next: (f) => this.fixtures.set(f), error: () => this.fixtures.set([]) });
  }

  load(): void {
    this.loadError.set(null);
    const id = this.id();
    forkJoin({
      detail: this.api.status(id),
      history: this.api.history(id).pipe(map((h) => h.items)),
      missing: this.api.missingDocuments(id).pipe(
        map((m) => ({ ok: m, error: null as UiError | null })),
        catchError((e: unknown) => of({ ok: null, error: toUiError(e) })),
      ),
    })
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: ({ detail, history, missing }) => {
          this.detail.set(detail);
          this.guide.complete('open');
          this.history.set(history);
          this.missing.set(missing.ok);
          this.missingError.set(missing.error);
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.loadError.set(toUiError(e));
        },
      });
  }

  protected label(value: string): string {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  protected fixtureOf(type: string): string {
    return this.detail()?.documents.find((d) => d.documentType === type)?.fixtureKey ?? '';
  }

  protected attachedAt(type: string): string | null {
    return this.detail()?.documents.find((d) => d.documentType === type)?.createdAtUtc ?? null;
  }

  protected attach(): void {
    const d = this.detail();
    if (!d || this.attachForm.invalid) return;
    const { documentType, fixtureKey } = this.attachForm.getRawValue();
    this.act(this.api.attachFixture(d.authorizationId, documentType, fixtureKey, d.version), (r) => {
      this.attachForm.reset();
      this.guide.complete('attach');
      return `${r.replaced ? 'Replaced' : 'Attached'} ${r.documentType} (${r.isValid ? 'valid' : 'invalid'}). Status: ${this.label(r.status)}.`;
    });
  }

  protected validate(): void {
    const d = this.detail();
    if (!d) return;
    this.act(this.api.validate(d.authorizationId, d.version), (r) => {
      if (r.status === 'ReadyToSubmit') this.guide.complete('validate');
      return r.statusChanged
        ? `Validated: ${this.label(r.previousStatus)} → ${this.label(r.status)}.`
        : `Validated: still ${this.label(r.status)}${r.completeness.isComplete ? '' : ` (missing ${[...r.completeness.missing, ...r.completeness.invalid].join(', ')})`}.`;
    });
  }

  protected prepare(): void {
    const d = this.detail();
    if (!d) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.prepare(d.authorizationId, d.version).subscribe({
      next: (proposal) => {
        this.guide.complete('prepare');
        void this.router.navigate(['/proposals', proposal.proposalId]);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
      },
    });
  }

  private act<T>(request: Observable<T>, describe: (result: T) => string): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (result) => {
        this.busy.set(false);
        this.notice.set(describe(result));
        this.load();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
        // A version conflict means someone else changed it: show the current state.
        this.load();
      },
    });
  }
}
