import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { Proposal } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { Icon } from '../../shared/icon';
import {
  CallerService, CodeChip, ErrorAlert, LoadError, PageService, Skeleton, StatusPill, WakingCard, payerLabel, retryWhileWaking,
  serviceLabel, versionCode,
} from '../../shared/ui';

const LIFETIME_MS = 5 * 60_000;
const R = 42;
const RING = 2 * Math.PI * R;

/** Idempotency keys survive a reload of this tab so a retried submit replays, not duplicates. */
function idempotencyKeyFor(proposalId: string): string {
  const storageKey = `authbridge.submitKey.${proposalId}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = `ui-${crypto.randomUUID()}`;
    sessionStorage.setItem(storageKey, key);
  }
  return key;
}

/**
 * The human approval boundary. An AI tool can prepare a proposal and link here, but only the
 * signed-in coordinator who prepared it, ticking the confirmation and clicking Approve, records
 * approval. Approving and submitting are two separate actions.
 */
@Component({
  selector: 'ab-proposal-review-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, Icon, StatusPill, ErrorAlert, LoadError, WakingCard, Skeleton, CodeChip],
  template: `
    <div class="page narrow">
      <ab-waking [attempt]="waking()" />
      <ab-load-error [error]="loadError()" subject="This review" (retry)="load()" />
      @if (!proposal() && !loadError()) { <ab-skeleton [rows]="4" /> }

      @if (proposal(); as p) {
        <section class="card" style="display: flex; align-items: center; gap: 24px; justify-content: space-between">
          <div style="min-width: 0">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
              <h2 class="h2" style="font-size: 20px">Review submission</h2>
              <ab-status [status]="state()" />
            </div>
            <p class="body muted" style="margin-top: 8px">This review expires automatically. After that a new one has to be prepared — nothing is sent in the meantime.</p>
          </div>
          @if (live()) {
            <div class="ring-wrap" role="timer" [attr.aria-label]="remaining() + ' remaining'">
              <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
                <circle cx="48" cy="48" [attr.r]="r" fill="none" stroke="var(--border)" stroke-width="6" />
                <circle class="ring-bar" cx="48" cy="48" [attr.r]="r" fill="none" [attr.stroke]="ringColor()" stroke-width="6" stroke-linecap="round"
                        [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ringOffset()" />
              </svg>
              <div class="ring-txt"><b [style.color]="ringColor()">{{ remaining() }}</b><span>remaining</span></div>
            </div>
          }
        </section>

        <section class="card">
          <div class="card-h">
            <h2 class="card-t">What you are approving</h2>
            <span class="pill p-primary"><ab-icon [name]="p.isOwnedByCaller ? 'shield-check' : 'user-x'" [size]="12" />
              <span>{{ p.isOwnedByCaller ? 'Prepared by you (UI or AI assistant via MCP)' : 'Prepared by another coordinator' }}</span></span>
          </div>
          <div class="dl-row"><span class="k">Request</span><span class="v"><a class="mono" [routerLink]="['/authorizations', p.authorizationId]">{{ p.authorizationId }}</a></span></div>
          <div class="dl-row"><span class="k">Member</span><span class="v"><span class="mono">{{ p.memberLabel }}</span><span class="cap">(synthetic)</span></span></div>
          <div class="dl-row"><span class="k">Payer</span><span class="v">{{ payer(p.payerCode) }}<span class="cap">(simulated)</span></span></div>
          <div class="dl-row"><span class="k">Service</span><span class="v">{{ service(p.serviceCode) }}</span></div>
          <div class="dl-row"><span class="k">Rule version</span><span class="v">v{{ p.ruleVersion }} · <ab-code [value]="code()" /></span></div>
          <div class="dl-row" style="align-items: flex-start"><span class="k">Action</span>
            <span class="v" style="flex-direction: column; align-items: flex-end; gap: 2px"><span>Send a simulated prior-authorization submission.</span><span class="cap">No real payer is contacted.</span></span></div>
          <div class="divider" style="margin: 8px 0 16px"></div>
          <p class="cap" style="display: flex; gap: 8px; align-items: center"><ab-icon name="shield" [size]="14" />No real payer is contacted. The response is generated by the demo simulator.</p>
        </section>

        <ab-error [error]="actionError()" (retry)="load()" />

        @switch (state()) {
          @case ('PendingApproval') {
            @if (!canWrite() || !p.isOwnedByCaller) {
              <section class="card outcome">
                <div class="outcome-h"><ab-icon name="user-x" [size]="24" class="icon-info" /><h3 class="h3">Not yours to approve</h3></div>
                <p class="body muted">Only the coordinator who prepared it can approve. This review belongs to another coordinator at {{ tenant() }}.</p>
                <button type="button" class="btn btn-sec btn-block" disabled>Approve</button>
              </section>
            } @else {
              <form class="card" [formGroup]="confirm" (ngSubmit)="approve()" [class.guide-focus]="guide.isCurrent('approve')">
                <label class="cbx">
                  <input type="checkbox" formControlName="reviewed" />
                  <span>I have reviewed this request, payer, simulated action and expiry.</span>
                </label>
                <button type="submit" class="btn btn-pri btn-block" style="margin-top: 20px" [disabled]="confirm.invalid || busy()">
                  @if (busy()) { <span class="spin"></span> } @else { <ab-icon name="shield-check" /> }<span>Approve</span>
                </button>
                <button type="button" class="btn btn-ghost btn-block" style="margin-top: 8px" (click)="cancel(p)">Cancel</button>
                <p class="cap" style="text-align: center; margin-top: 16px">Approving is recorded against <b style="color: var(--text)">{{ signer() }}</b> at {{ tenant() }}.</p>
              </form>
            }
          }
          @case ('Approved') {
            <section class="card outcome tintin" style="background: var(--success-soft); border-color: var(--success-border)">
              <div class="outcome-h">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                  <circle cx="20" cy="20" r="18" stroke="var(--success-border)" stroke-width="2" />
                  <path class="draw" d="M12 20.5l5.5 5.5L28 15" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3 class="h3" style="color: var(--success-ink); font-size: 18px">Approved</h3>
              </div>
              <p class="body" style="color: var(--text-2)">Approved at <b style="color: var(--text)">{{ p.approvedAtUtc | date: 'h:mm a' }}</b> by {{ signer() }}. Nothing has been sent yet — the submission is the next, separate step.</p>
              @if (canWrite() && p.isOwnedByCaller) {
                <button type="button" class="btn btn-pri btn-block" [class.guide-focus]="guide.isCurrent('submit')" (click)="submit()" [disabled]="busy()">
                  @if (busy()) { <span class="spin"></span> } @else { <ab-icon name="send" /> }<span>Submit to simulated payer</span>
                </button>
              }
            </section>
          }
          @case ('Expired') {
            <section class="card outcome" style="background: var(--danger-soft); border-color: var(--danger-border)">
              <div class="outcome-h"><ab-icon name="alert-circle" [size]="24" class="icon-bad" /><h3 class="h3" style="color: var(--danger-ink)">Expired</h3></div>
              <p class="body" style="color: var(--danger-ink)">This review passed its 5-minute window at {{ p.expiresAtUtc | date: 'h:mm a' }}{{ p.approvedAtUtc ? '' : ' without an approval' }}. It can no longer be used.</p>
              <button type="button" class="btn btn-sec btn-block" (click)="prepareAgain(p)" [disabled]="busy() || !canWrite()">Prepare a new one</button>
            </section>
          }
          @case ('Stale') {
            <section class="card outcome">
              <div class="outcome-h"><ab-icon name="refresh" [size]="24" /><h3 class="h3">Stale</h3></div>
              <p class="body muted">{{ p.authorizationId }} changed after this review was prepared. Approving it would send an out-of-date submission.</p>
              <button type="button" class="btn btn-sec btn-block" (click)="prepareAgain(p)" [disabled]="busy() || !canWrite()">Prepare from current version</button>
            </section>
          }
          @case ('Consumed') {
            <section class="card outcome">
              <div class="outcome-h"><ab-icon name="send" [size]="24" class="icon-info" /><h3 class="h3">Already submitted</h3></div>
              <p class="body muted">This approval was used at {{ p.consumedAtUtc | date: 'h:mm a' }}. Approvals cannot be reused.</p>
              <button type="button" class="btn btn-sec btn-block" (click)="viewSubmission(p)">View submission</button>
            </section>
          }
        }
      }
    </div>
  `,
})
export class ProposalReviewPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly callers = inject(CallerService);
  private readonly pageHeader = inject(PageService);
  protected readonly guide = inject(GuideService);
  protected readonly canWrite = this.callers.canWrite;
  protected readonly service = serviceLabel;
  protected readonly payer = payerLabel;

  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly busy = signal(false);
  protected readonly waking = signal(0);
  protected readonly now = signal(Date.now());
  protected readonly ring = RING;
  protected readonly r = R;

  protected readonly confirm = inject(FormBuilder).nonNullable.group({ reviewed: [false, Validators.requiredTrue] });

  private readonly expiresAt = computed(() => (this.proposal() ? Date.parse(this.proposal()!.expiresAtUtc) : 0));
  /** The server's state, overridden to Expired locally once the clock passes expiry. */
  protected readonly state = computed(() => {
    const p = this.proposal();
    if (!p) return 'PendingApproval';
    if ((p.state === 'PendingApproval' || p.state === 'Approved') && this.now() >= this.expiresAt()) return 'Expired';
    return p.state;
  });
  protected readonly live = computed(() => this.state() === 'PendingApproval' || this.state() === 'Approved');
  protected readonly remainingMs = computed(() => Math.max(0, this.expiresAt() - this.now()));
  protected readonly remaining = computed(() => {
    const s = Math.floor(this.remainingMs() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  protected readonly ringOffset = computed(() => RING * (1 - this.remainingMs() / LIFETIME_MS));
  /** Primary, then amber under a minute, then red under thirty seconds. */
  protected readonly ringColor = computed(() =>
    this.remainingMs() < 30_000 ? 'var(--danger)' : this.remainingMs() < 60_000 ? 'var(--warning)' : 'var(--primary)',
  );
  protected readonly code = computed(() => {
    const p = this.proposal();
    return p ? versionCode(p.authorizationId, p.ruleVersion, p.expectedRequestVersion) : '';
  });
  protected readonly signer = computed(() => this.callers.caller()?.displayLabel ?? 'you');
  protected readonly tenant = computed(() => this.callers.caller()?.tenantId ?? 'your tenant');

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    // The same instance is reused when navigating from one review to a newly prepared one.
    effect(() => {
      this.id();
      untracked(() => {
        this.proposal.set(null);
        this.load();
      });
    });
  }

  ngOnInit(): void {
    this.pageHeader.set('Review and approve', [{ label: 'Workspace' }, { label: 'Submissions', link: '/submissions' }, { label: 'Review' }]);
  }

  load(): void {
    this.loadError.set(null);
    this.api
      .proposal(this.id())
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (p) => this.proposal.set(p),
        error: (e: unknown) => {
          this.waking.set(0);
          this.loadError.set(toUiError(e));
        },
      });
  }

  protected cancel(p: Proposal): void {
    void this.router.navigate(['/authorizations', p.authorizationId]);
  }

  protected approve(): void {
    if (this.confirm.invalid) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.approve(this.id()).subscribe({
      next: (p) => {
        this.busy.set(false);
        this.proposal.set(p);
        this.guide.complete('approve');
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
        this.load();
      },
    });
  }

  protected submit(): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.submit(this.id(), idempotencyKeyFor(this.id())).subscribe({
      next: (s) => {
        this.guide.complete('submit');
        void this.router.navigate(['/submissions', s.attemptId]);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
        this.load();
      },
    });
  }

  /** Expired or stale: prepare a fresh review against the request's current version. */
  protected prepareAgain(p: Proposal): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .status(p.authorizationId)
      .pipe(switchMap((d) => this.api.prepare(d.authorizationId, d.version)))
      .subscribe({
        next: (fresh) => {
          this.busy.set(false);
          this.confirm.reset();
          void this.router.navigate(['/proposals', fresh.proposalId]);
        },
        error: (e: unknown) => {
          this.busy.set(false);
          this.actionError.set(toUiError(e));
        },
      });
  }

  protected viewSubmission(p: Proposal): void {
    this.api.status(p.authorizationId).subscribe({
      next: (d) => void this.router.navigate(d.submissionAttemptId ? ['/submissions', d.submissionAttemptId] : ['/authorizations', p.authorizationId]),
      error: (e: unknown) => this.actionError.set(toUiError(e)),
    });
  }
}
