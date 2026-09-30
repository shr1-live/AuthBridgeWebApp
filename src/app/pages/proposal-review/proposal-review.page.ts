import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { Proposal } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { CallerService, ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const LIFETIME_MS = 5 * 60_000;
const RING = 2 * Math.PI * 16;

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
 * signed-in coordinator who prepared it, ticking every assurance and clicking Approve, records
 * approval. Submitting is a separate, second click.
 */
@Component({
  selector: 'ab-proposal-review-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <ab-waking [attempt]="waking()" />
    <ab-error [error]="loadError()" (retry)="load()" />

    @if (proposal(); as p) {
      <nav class="crumbs" aria-label="Breadcrumb">
        <a routerLink="/authorizations">Request Queue</a>
        <img src="icons/chevron-right.svg" width="12" height="12" alt="" />
        <a [routerLink]="['/authorizations', p.authorizationId]">{{ p.authorizationId }}</a>
        <img src="icons/chevron-right.svg" width="12" height="12" alt="" />
        <strong>Review</strong>
      </nav>

      <div class="center-page">
        <section class="card dialog">
          <div class="dialog-head">
            <span class="dialog-icon"><img src="icons/shield-check-teal.svg" width="24" height="24" alt="" /></span>
            <div style="flex: 1">
              <h1>Confirm Submission Package</h1>
              <p class="muted">You are about to send a simulated prior-authorization request</p>
            </div>
            @if (live()) {
              <span class="countdown" [class.low]="remainingMs() < 60_000" [class.crit]="remainingMs() < 30_000"
                    [attr.aria-label]="remaining() + ' remaining'">
                <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle class="track" cx="20" cy="20" r="16" />
                  <circle class="bar" cx="20" cy="20" r="16" [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ringOffset()" />
                </svg>
                {{ remaining() }}
              </span>
            } @else {
              <ab-status [status]="state()" />
            }
          </div>

          <div class="summary">
            <span class="section-title">Submission Package Summary</span>
            <div class="facts two">
              <div class="fact"><span class="k">Member</span><span class="v b">{{ p.memberLabel }} (synthetic)</span></div>
              <div class="fact"><span class="k">Payer</span><span class="v b">{{ p.payerCode }} (simulated)</span></div>
              <div class="fact"><span class="k">Service / Rule</span><span class="v">{{ p.serviceCode }} · rule v{{ p.ruleVersion }}</span></div>
              <div class="fact"><span class="k">Request Reference ID</span><span class="v mono b">{{ p.authorizationId }}</span></div>
            </div>
            <p class="muted">{{ p.simulatedAction }}</p>
          </div>

          <ab-error [error]="actionError()" />

          @switch (state()) {
            @case ('PendingApproval') {
              @if (!canWrite() || !p.isOwnedByCaller) {
                <div class="panel info"><img src="icons/info-16.svg" width="16" height="16" alt="" />
                  <p>Only the coordinator who prepared this proposal can approve it.</p></div>
              } @else {
                <form class="stack" style="gap: 16px" [formGroup]="assurances" (ngSubmit)="approve()"
                      [class.guide-focus]="guide.isCurrent('approve')">
                  <span class="section-title">Required Coordinator Assurances</span>
                  <label class="check-row">
                    <input type="checkbox" formControlName="reviewed" />
                    <span class="box"><img src="icons/check-teal.svg" width="12" height="12" alt="" /></span>
                    <span>I have reviewed the request, its attached document fixtures and the payer rule it was validated against.</span>
                  </label>
                  <label class="check-row">
                    <input type="checkbox" formControlName="accurate" />
                    <span class="box"><img src="icons/check-teal.svg" width="12" height="12" alt="" /></span>
                    <span>I confirm the details above are correct for this synthetic demo request.</span>
                  </label>
                  <label class="check-row">
                    <input type="checkbox" formControlName="authorize" />
                    <span class="box"><img src="icons/check-teal.svg" width="12" height="12" alt="" /></span>
                    <span>I authorize submission of this request to {{ p.payerCode }} (simulated).</span>
                  </label>
                  <div class="panel warn">
                    <img src="icons/alert-triangle-18.svg" width="18" height="18" alt="" />
                    <p>Approval is valid until {{ p.expiresAtUtc | date: 'h:mm:ss a' }}. Once submitted, a request cannot be recalled. No real payer is contacted.</p>
                  </div>
                  <div class="signature">
                    <div><span class="subtle">Electronic Signature</span><div><strong>{{ signer() }}</strong></div></div>
                    <span class="ts">{{ now() | date: 'MM/dd/yyyy - HH:mm:ss' }}</span>
                  </div>
                  <div class="actions-end">
                    <button type="button" class="secondary" (click)="cancel(p)">Cancel</button>
                    <button type="submit" [disabled]="assurances.invalid || busy()">
                      <img src="icons/lock.svg" width="14" height="14" alt="" />Approve Submission
                    </button>
                  </div>
                </form>
              }
            }
            @case ('Approved') {
              <div class="panel ok"><img src="icons/check-circle-16.svg" width="16" height="16" alt="" />
                <p>Approved at {{ p.approvedAtUtc | date: 'h:mm:ss a' }}. Submit it now, or let the AI assistant submit it before it expires.</p></div>
              <div class="signature">
                <div><span class="subtle">Electronic Signature</span><div><strong>{{ signer() }}</strong></div></div>
                <span class="ts">{{ p.approvedAtUtc | date: 'MM/dd/yyyy - HH:mm:ss' }}</span>
              </div>
              @if (canWrite() && p.isOwnedByCaller) {
                <div class="actions-end">
                  <button type="button" class="secondary" (click)="cancel(p)">Cancel</button>
                  <button type="button" [class.guide-focus]="guide.isCurrent('submit')" (click)="submit()" [disabled]="busy()">
                    <img src="icons/lock.svg" width="14" height="14" alt="" />Submit Authorization Request
                  </button>
                </div>
              }
            }
            @case ('Expired') {
              <div class="panel error" role="alert"><img src="icons/alert-circle.svg" width="16" height="16" alt="" />
                <p>This proposal expired five minutes after it was prepared. Prepare a new one from the request page.</p></div>
            }
            @case ('Stale') {
              <div class="panel error" role="alert"><img src="icons/alert-circle.svg" width="16" height="16" alt="" />
                <p>The request changed after this proposal was prepared. Prepare a new one.</p></div>
            }
            @case ('Consumed') {
              <div class="panel info"><img src="icons/info-16.svg" width="16" height="16" alt="" />
                <p>This proposal has already been submitted.</p></div>
            }
          }
        </section>
      </div>
    }
  `,
})
export class ProposalReviewPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly callers = inject(CallerService);
  protected readonly guide = inject(GuideService);
  protected readonly canWrite = this.callers.canWrite;

  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly busy = signal(false);
  protected readonly waking = signal(0);
  protected readonly now = signal(Date.now());
  protected readonly ring = RING;

  protected readonly assurances = inject(FormBuilder).nonNullable.group({
    reviewed: [false, Validators.requiredTrue],
    accurate: [false, Validators.requiredTrue],
    authorize: [false, Validators.requiredTrue],
  });

  private readonly expiresAt = computed(() => (this.proposal() ? Date.parse(this.proposal()!.expiresAtUtc) : 0));
  /** The server's state, overridden to Expired locally once the clock passes expiry. */
  protected readonly state = computed(() => {
    const p = this.proposal();
    if (!p) return '';
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
  protected readonly signer = computed(() => {
    const c = this.callers.caller();
    return c ? `${c.displayLabel}, ${c.role}` : 'Signed-in coordinator';
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    this.load();
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
    if (this.assurances.invalid) return;
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
}
