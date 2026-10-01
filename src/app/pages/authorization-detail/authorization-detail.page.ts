import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AuthorizationStatusDetail, DocumentFixture, HistoryEntry, MissingDocuments } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { Icon } from '../../shared/icon';
import {
  CallerService, CodeChip, ErrorAlert, LoadError, PageService, Skeleton, StatusPill, ToastService, WakingCard,
  caseStory, docLabel, payerLabel, relativeTime, retryWhileWaking, serviceLabel, statusLabel, versionCode,
} from '../../shared/ui';

const PRE_SUBMISSION = ['Draft', 'AwaitingDocuments', 'ReadyToSubmit'];
const STEPS = ['Draft', 'Awaiting documents', 'Ready to submit', 'Submitted', 'Under review', 'Decision'];
const STEP_INDEX: Record<string, number> = { Draft: 0, AwaitingDocuments: 1, ReadyToSubmit: 2, Submitted: 3, UnderReview: 4, Approved: 6, Denied: 6 };

@Component({
  selector: 'ab-authorization-detail-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, Icon, StatusPill, ErrorAlert, LoadError, WakingCard, Skeleton, CodeChip],
  template: `
    <div class="page">
      <ab-waking [attempt]="waking()" />
      <ab-load-error [error]="loadError()" [subject]="id()" (retry)="load()" />
      @if (!detail() && !loadError()) {
        <ab-skeleton [rows]="4" />
      }

      @if (detail(); as d) {
        @if (!d.rule.isActive) {
          <div class="alert a-warn" role="alert">
            <ab-icon name="alert-triangle" [size]="18" />
            <div><p class="at">Rule inactive — configuration missing</p>
              <p class="ad">Rule v{{ d.rule.ruleVersion }} for {{ service(d.serviceCode) }} is not active for {{ payer(d.payerCode) }}. Validation and submission are blocked until an administrator activates it.</p></div>
          </div>
        }
        <ab-error [error]="actionError()" (retry)="reload()" />
        @if (!isPreSubmission()) {
          <div class="alert a-neutral">
            <ab-icon name="lock" [size]="18" />
            <div><p class="at">Submitted — documents locked</p>
              <p class="ad">Once a request is submitted its checklist is frozen. Documents and validation can no longer change.</p></div>
          </div>
        }

        <section class="card">
          <div class="card-h" style="margin-bottom: 0">
            <div style="min-width: 0">
              <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
                <h2 class="h1 mono">{{ d.authorizationId }}</h2>
                <ab-status [status]="d.status" [large]="true" />
              </div>
              <p class="body muted" style="margin-top: 8px">{{ service(d.serviceCode) }} · {{ payer(d.payerCode) }} · Member <span class="mono">{{ d.memberLabel }}</span></p>
            </div>
            <button type="button" class="btn btn-sec btn-sm" (click)="copyLink()"><ab-icon [name]="copied() ? 'check' : 'copy'" [size]="14" /><span>{{ copied() ? 'Copied' : 'Copy link' }}</span></button>
          </div>
          <div class="divider" style="margin: 24px 0"></div>
          <div class="stp" aria-label="Request progress">
            @for (s of steps; track s; let i = $index) {
              @if (i > 0) { <div class="stp-l">@if (i <= stepIndex()) { <i></i> }</div> }
              <div class="stp-i">
                <span class="stp-d" [class.done]="i < stepIndex()" [class.cur]="i === stepIndex()" [class.pulse]="i === stepIndex()">
                  @if (i < stepIndex()) { <ab-icon name="check" [size]="14" /> } @else { {{ i + 1 }} }
                </span>
                <span class="stp-t" [class.done]="i < stepIndex()" [class.cur]="i === stepIndex()">{{ i === 5 && decided() ? label(d.status) : s }}</span>
              </div>
            }
          </div>
          @if (story(); as st) {
            <div class="alert a-info" role="status" style="margin-top: 24px">
              <ab-icon name="info" [size]="18" />
              <div><p class="at">What's happening: {{ st.title }}</p>
                <p class="ad">{{ st.text }} <strong>Next:</strong> {{ st.next }}</p></div>
            </div>
          }
        </section>

        <div class="detail-grid">
          <div>
            <section class="card">
              <div class="card-h">
                <div><h2 class="card-t">Required documents</h2><p class="card-s">Checklist evaluated against rule version {{ d.rule.ruleVersion }}</p></div>
                @if (missing(); as m) {
                  <span class="pill" [class.p-success]="m.isComplete" [class.p-warn]="!m.isComplete">
                    <ab-icon [name]="m.isComplete ? 'check-circle' : 'clock'" [size]="12" /><span>{{ m.present.length }} of {{ m.required.length }} valid</span>
                  </span>
                }
              </div>
              @if (missingError(); as e) {
                <ab-error [error]="e" />
              }
              @if (missing(); as m) {
                <div>
                  @for (type of m.required; track type) {
                    <div class="doc-i">
                      @if (m.present.includes(type)) {
                        <ab-icon name="check-circle" [size]="20" class="icon-ok" />
                      } @else if (m.invalid.includes(type)) {
                        <ab-icon name="alert-triangle" [size]="20" class="icon-warn" />
                      } @else {
                        <ab-icon name="x-circle" [size]="20" class="icon-bad" />
                      }
                      <div style="flex: 1; min-width: 0">
                        <p class="t">{{ doc(type) }}</p>
                        @if (m.present.includes(type)) {
                          <p class="s">Attached {{ ago(attachedAt(type)) }} · matched rule v{{ d.rule.ruleVersion }} · fixture <span class="mono">{{ fixtureOf(type) }}</span></p>
                        } @else if (m.invalid.includes(type)) {
                          <p class="s">Fixture is invalid · replace it to clear · fixture <span class="mono">{{ fixtureOf(type) }}</span></p>
                        } @else {
                          <p class="s">Required by rule v{{ d.rule.ruleVersion }} · not attached · fixture –</p>
                        }
                      </div>
                      @if (m.present.includes(type)) {
                        <span class="pill p-success"><ab-icon name="check-circle" [size]="12" /><span>Valid</span></span>
                      } @else if (m.invalid.includes(type)) {
                        <span class="pill p-warn"><ab-icon name="alert-triangle" [size]="12" /><span>Attached but invalid</span></span>
                      } @else {
                        <span class="pill p-danger"><ab-icon name="x-circle" [size]="12" /><span>Missing</span></span>
                      }
                    </div>
                  }
                </div>
              }
              <p class="cap" style="display: flex; align-items: center; gap: 6px; margin-top: 16px"><ab-icon name="info" [size]="14" />Fixtures are synthetic metadata, not uploaded files.</p>
            </section>

            @if (canEdit()) {
              <section class="card" [class.guide-focus]="guide.isCurrent('attach')">
                <div class="card-h"><div><h2 class="card-t">Attach document</h2><p class="card-s">Pick a synthetic fixture to stand in for a file</p></div></div>
                <form class="attach-form" [formGroup]="attachForm" (ngSubmit)="attach()" novalidate>
                  <div class="field">
                    <label class="lbl" for="doc-type">Document type</label>
                    <span class="sel">
                      <select class="inp" id="doc-type" formControlName="documentType">
                        <option value="" disabled>Choose…</option>
                        @for (type of documentTypes(); track type) { <option [value]="type">{{ doc(type) }}</option> }
                      </select>
                      <ab-icon name="chevron-down" />
                    </span>
                  </div>
                  <div class="field">
                    <label class="lbl" for="doc-fixture">Fixture</label>
                    <span class="sel">
                      <select class="inp" id="doc-fixture" formControlName="fixtureKey">
                        <option value="" disabled>Choose…</option>
                        @for (f of fixturesForType(); track f.key) { <option [value]="f.key">{{ f.key }} — {{ f.isValid ? 'valid' : 'invalid' }}</option> }
                      </select>
                      <ab-icon name="chevron-down" />
                    </span>
                  </div>
                  <button type="submit" class="btn btn-pri" [disabled]="attachForm.invalid || busy()">
                    @if (busy() && pending() === 'attach') { <span class="spin"></span> } @else { <ab-icon name="paperclip" /> }<span>Attach</span>
                  </button>
                </form>
                <p class="hint" style="margin-top: 12px">The attached row appears in the checklist above once the fixture is accepted.</p>
              </section>
            }

            <section class="card">
              <div class="card-h"><div><h2 class="card-t">Timeline</h2><p class="card-s">Every status change on this request</p></div></div>
              <div class="tl">
                @for (h of timeline(); track h.id) {
                  <div class="tl-i" [class.past]="!$first">
                    <div class="tl-card">
                      <div class="tl-trans">
                        @if (h.previousStatus) { <ab-status [status]="h.previousStatus" /><ab-icon name="arrow-right" [size]="14" /> }
                        <ab-status [status]="h.newStatus" />
                      </div>
                      <div class="tl-meta"><span>{{ actor(h.actorId) }}</span><span class="mono">{{ h.occurredAtUtc | date: 'yyyy-MM-dd HH:mm' }}</span></div>
                      <p class="body" style="margin-top: 8px; color: var(--text)">{{ h.reason }}</p>
                    </div>
                  </div>
                }
              </div>
            </section>
          </div>

          <div class="sticky-col">
            <section class="card">
              <div class="card-h"><div><h2 class="card-t">Details</h2><p class="card-s">Synthetic record</p></div></div>
              <div>
                <div class="dl-row"><span class="k">Member</span><span class="v"><span class="mono">{{ d.memberLabel }}</span><span class="cap">(synthetic)</span></span></div>
                <div class="dl-row"><span class="k">Payer</span><span class="v">{{ payer(d.payerCode) }}<span class="cap">(simulated)</span></span></div>
                <div class="dl-row"><span class="k">Service</span><span class="v">{{ service(d.serviceCode) }}<span class="cap mono">{{ d.serviceCode }}</span></span></div>
                <div class="dl-row"><span class="k">Tenant</span><span class="v"><span class="tenant">{{ d.tenantId }}</span></span></div>
                <div class="dl-row"><span class="k">Rule version</span><span class="v">v{{ d.rule.ruleVersion }}
                  @if (!d.rule.isActive) { <span class="pill p-warn"><ab-icon name="alert-circle" [size]="12" /><span>inactive</span></span> }</span></div>
                <div class="dl-row"><span class="k">Version code</span><span class="v"><ab-code [value]="code()" /></span></div>
                <div class="dl-row"><span class="k">Updated</span><span class="v">{{ d.updatedAtUtc | date: 'd MMM y, HH:mm' }} <span class="cap">({{ ago(d.updatedAtUtc) }})</span></span></div>
              </div>
            </section>

            <section class="card desktop-actions">
              <div class="card-h"><div><h2 class="card-t">Actions</h2><p class="card-s">{{ roleLine() }}</p></div></div>
              @if (canWrite()) {
                <div style="display: flex; flex-direction: column; gap: 12px">
                  <button type="button" class="btn btn-sec btn-block" [class.guide-focus]="guide.isCurrent('validate')" (click)="validate()"
                          [disabled]="busy() || !isPreSubmission() || !d.rule.isActive">
                    @if (busy() && pending() === 'validate') { <span class="spin"></span> } @else { <ab-icon name="shield-check" /> }<span>Validate</span>
                  </button>
                  <span class="tip" style="display: block">
                    <button type="button" class="btn btn-pri btn-block" [class.guide-focus]="guide.isCurrent('prepare')" (click)="prepare()"
                            [disabled]="busy() || d.status !== 'ReadyToSubmit'" [attr.aria-describedby]="d.status !== 'ReadyToSubmit' ? 'prep-tip' : null"
                            (mouseenter)="tip.set(true)" (mouseleave)="tip.set(false)" (focus)="tip.set(true)" (blur)="tip.set(false)">
                      @if (busy() && pending() === 'prepare') { <span class="spin"></span> } @else { <ab-icon name="zap" /> }<span>Prepare submission for review</span>
                    </button>
                    @if (d.status !== 'ReadyToSubmit' && isPreSubmission()) {
                      <span id="prep-tip" class="tipbox" [style.display]="tip() ? 'block' : 'none'" role="tooltip">Available once the request is Ready to submit</span>
                    }
                  </span>
                  @if (d.submissionAttemptId) {
                    <a class="btn btn-sec btn-block" [routerLink]="['/submissions', d.submissionAttemptId]"><ab-icon name="send" /><span>View submission progress</span></a>
                  }
                </div>
                <p class="cap" style="display: flex; gap: 8px; margin-top: 16px"><ab-icon name="lock" [size]="14" />Preparing only creates a review. A human still has to approve before anything is sent.</p>
              } @else {
                <p class="body muted">You have read-only access. Coordinators in your tenant can attach, validate and prepare.</p>
                @if (d.submissionAttemptId) {
                  <a class="btn btn-sec btn-block" style="margin-top: 12px" [routerLink]="['/submissions', d.submissionAttemptId]"><ab-icon name="send" /><span>View submission progress</span></a>
                }
              }
            </section>
          </div>
        </div>

        @if (canWrite()) {
          <div class="mobile-bar">
            <button type="button" class="btn btn-sec btn-icon" aria-label="Validate" (click)="validate()" [disabled]="busy() || !isPreSubmission() || !d.rule.isActive"><ab-icon name="shield-check" [size]="18" /></button>
            @if (d.submissionAttemptId) {
              <a class="btn btn-pri" [routerLink]="['/submissions', d.submissionAttemptId]">View submission</a>
            } @else {
              <button type="button" class="btn btn-pri" (click)="prepare()" [disabled]="busy() || d.status !== 'ReadyToSubmit'">Prepare for review</button>
            }
          </div>
        }
      }
    </div>
  `,
})
export class AuthorizationDetailPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly callers = inject(CallerService);
  private readonly toasts = inject(ToastService);
  private readonly pageHeader = inject(PageService);
  protected readonly guide = inject(GuideService);

  protected readonly detail = signal<AuthorizationStatusDetail | null>(null);
  protected readonly missing = signal<MissingDocuments | null>(null);
  protected readonly missingError = signal<UiError | null>(null);
  protected readonly history = signal<HistoryEntry[]>([]);
  protected readonly fixtures = signal<DocumentFixture[]>([]);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly busy = signal(false);
  protected readonly pending = signal<'attach' | 'validate' | 'prepare' | null>(null);
  protected readonly waking = signal(0);
  protected readonly copied = signal(false);
  protected readonly tip = signal(false);

  protected readonly steps = STEPS;
  protected readonly label = statusLabel;
  protected readonly doc = docLabel;
  protected readonly service = serviceLabel;
  protected readonly payer = payerLabel;
  protected readonly story = computed(() => {
    const d = this.detail();
    return d ? caseStory(d.status, this.missing()) : null;
  });
  protected readonly ago = (iso: string | null) => relativeTime(iso);

  protected readonly canWrite = this.callers.canWrite;
  protected readonly isPreSubmission = computed(() => PRE_SUBMISSION.includes(this.detail()?.status ?? ''));
  protected readonly canEdit = computed(() => this.canWrite() && this.isPreSubmission());
  protected readonly stepIndex = computed(() => STEP_INDEX[this.detail()?.status ?? 'Draft'] ?? 0);
  protected readonly decided = computed(() => ['Approved', 'Denied'].includes(this.detail()?.status ?? ''));
  protected readonly timeline = computed(() => [...this.history()].reverse());
  protected readonly code = computed(() => {
    const d = this.detail();
    return d ? versionCode(d.authorizationId, d.rule.ruleVersion, d.version) : '';
  });
  protected readonly roleLine = computed(() => {
    const c = this.callers.caller();
    return c ? `${c.role} · ${c.tenantId}` : '';
  });

  protected readonly attachForm = inject(FormBuilder).nonNullable.group({
    documentType: ['', Validators.required],
    fixtureKey: ['', Validators.required],
  });
  private readonly selectedType = toSignal(this.attachForm.controls.documentType.valueChanges, { initialValue: '' });
  protected readonly documentTypes = computed(() => [...new Set(this.fixtures().map((f) => f.documentType))]);
  protected readonly fixturesForType = computed(() => this.fixtures().filter((f) => f.documentType === this.selectedType()));

  constructor() {
    this.attachForm.controls.documentType.valueChanges.subscribe(() =>
      this.attachForm.controls.fixtureKey.setValue('', { emitEvent: false }),
    );
    // The same instance is reused when global search jumps from one request to another.
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.pageHeader.set(id, [{ label: 'Workspace' }, { label: 'Requests', link: '/authorizations' }, { label: id }], true);
        this.detail.set(null);
        this.actionError.set(null);
        this.load();
      });
    });
  }

  ngOnInit(): void {
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
          this.missingError.set(missing.ok || !detail.rule.isActive ? null : missing.error);
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.loadError.set(toUiError(e));
        },
      });
  }

  protected reload(): void {
    this.actionError.set(null);
    this.load();
  }

  protected actor(actorId: string): string {
    const me = this.callers.caller();
    if (me && actorId === me.actorId) return `${me.displayLabel} · ${me.tenantId}`;
    if (actorId === 'system:payer-simulator') return 'Simulated payer';
    if (actorId === 'system:seed') return 'Seed data';
    return `Coordinator · ${this.detail()?.tenantId ?? ''}`;
  }

  protected fixtureOf(type: string): string {
    return this.detail()?.documents.find((d) => d.documentType === type)?.fixtureKey ?? '';
  }

  protected attachedAt(type: string): string | null {
    return this.detail()?.documents.find((d) => d.documentType === type)?.createdAtUtc ?? null;
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard unavailable; the URL is still in the address bar.
    }
  }

  protected attach(): void {
    const d = this.detail();
    if (!d || this.attachForm.invalid) return;
    const { documentType, fixtureKey } = this.attachForm.getRawValue();
    this.act('attach', this.api.attachFixture(d.authorizationId, documentType, fixtureKey, d.version), (r) => {
      this.attachForm.reset();
      this.guide.complete('attach');
      this.toasts.show(`${r.replaced ? 'Replaced' : 'Attached'} ${docLabel(r.documentType).toLowerCase()}`,
        `${r.fixtureKey} is ${r.isValid ? 'valid' : 'invalid'}. Status: ${statusLabel(r.status)}.`, r.isValid ? 'success' : 'danger');
    });
  }

  protected validate(): void {
    const d = this.detail();
    if (!d) return;
    this.act('validate', this.api.validate(d.authorizationId, d.version), (r) => {
      if (r.status === 'ReadyToSubmit') this.guide.complete('validate');
      this.toasts.show(r.statusChanged ? 'Validated' : 'Validated — no change',
        r.statusChanged ? `${statusLabel(r.previousStatus)} → ${statusLabel(r.status)}.`
          : `Still ${statusLabel(r.status).toLowerCase()}${r.completeness.isComplete ? '' : ` — missing ${[...r.completeness.missing, ...r.completeness.invalid].map(docLabel).join(', ').toLowerCase()}`}.`,
        r.completeness.isComplete ? 'success' : 'info');
    });
  }

  protected prepare(): void {
    const d = this.detail();
    if (!d) return;
    this.busy.set(true);
    this.pending.set('prepare');
    this.actionError.set(null);
    this.api.prepare(d.authorizationId, d.version).subscribe({
      next: (proposal) => {
        this.guide.complete('prepare');
        void this.router.navigate(['/proposals', proposal.proposalId]);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.pending.set(null);
        this.actionError.set(toUiError(e));
      },
    });
  }

  private act<T>(kind: 'attach' | 'validate', request: Observable<T>, done: (result: T) => void): void {
    this.busy.set(true);
    this.pending.set(kind);
    this.actionError.set(null);
    request.subscribe({
      next: (result) => {
        this.busy.set(false);
        this.pending.set(null);
        done(result);
        this.load();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.pending.set(null);
        this.actionError.set(toUiError(e));
      },
    });
  }
}
