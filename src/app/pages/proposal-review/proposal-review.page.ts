import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { Proposal } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { CallerService, ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

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
 * The human approval boundary. An AI tool can prepare a proposal and link here, but only a
 * signed-in coordinator ticking the confirmation and clicking Approve records approval.
 */
@Component({
  selector: 'ab-proposal-review-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <ab-waking [attempt]="waking()" />
    <ab-error [error]="loadError()" (retry)="load()" />

    @if (proposal(); as p) {
      <p><a [routerLink]="['/authorizations', p.authorizationId]">← {{ p.authorizationId }}</a></p>
      <header class="title-row">
        <h1>Review submission</h1>
        <span class="status" [attr.data-status]="state()">{{ stateLabel() }}</span>
      </header>

      <section class="card">
        <dl class="facts">
          <dt>Request</dt><dd>{{ p.authorizationId }} <ab-status [status]="p.requestStatus" /></dd>
          <dt>Member</dt><dd>{{ p.memberLabel }} (synthetic)</dd>
          <dt>Payer</dt><dd>{{ p.payerCode }} (simulated)</dd>
          <dt>Service</dt><dd>{{ p.serviceCode }} · rule version {{ p.ruleVersion }}</dd>
          <dt>Action</dt><dd>{{ p.simulatedAction }}</dd>
          <dt>Summary</dt><dd>{{ p.summary }}</dd>
          <dt>Expires</dt>
          <dd>
            {{ p.expiresAtUtc | date: 'mediumTime' }}
            @if (state() === 'PendingApproval' || state() === 'Approved') {
              <span class="countdown">({{ remaining() }} left)</span>
            }
          </dd>
        </dl>
      </section>

      <ab-error [error]="actionError()" />

      @switch (state()) {
        @case ('PendingApproval') {
          @if (!canWrite() || !p.isOwnedByCaller) {
            <div class="panel info">Only the coordinator who prepared this proposal can approve it.</div>
          } @else {
            <form class="card" [class.guide-focus]="guide.isCurrent('approve')" [formGroup]="confirm" (ngSubmit)="approve()">
              <label class="checkbox">
                <input type="checkbox" formControlName="reviewed" />
                I have reviewed this request, payer, simulated action and expiry.
              </label>
              <button type="submit" [disabled]="confirm.invalid || busy()">Approve</button>
            </form>
          }
        }
        @case ('Approved') {
          <section class="card">
            <p>Approved at {{ p.approvedAtUtc | date: 'mediumTime' }}. It can now be submitted from here or by the AI host.</p>
            @if (canWrite() && p.isOwnedByCaller) {
              <button type="button" [class.guide-focus]="guide.isCurrent('submit')" (click)="submit()" [disabled]="busy()">Submit to simulated payer</button>
            }
          </section>
        }
        @case ('Expired') {
          <div class="panel error" role="alert">
            This proposal expired five minutes after it was prepared. Prepare a new one from the request page.
          </div>
        }
        @case ('Stale') {
          <div class="panel error" role="alert">The request changed after this proposal was prepared. Prepare a new one.</div>
        }
        @case ('Consumed') {
          <div class="panel info">This proposal has already been submitted.</div>
        }
      }
    }
  `,
})
export class ProposalReviewPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly guide = inject(GuideService);
  protected readonly canWrite = inject(CallerService).canWrite;

  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly busy = signal(false);
  protected readonly waking = signal(0);
  private readonly now = signal(Date.now());

  protected readonly confirm = inject(FormBuilder).nonNullable.group({ reviewed: [false, Validators.requiredTrue] });

  private readonly expiresAt = computed(() => (this.proposal() ? Date.parse(this.proposal()!.expiresAtUtc) : 0));
  /** The server's state, overridden to Expired locally once the clock passes expiry. */
  protected readonly state = computed(() => {
    const p = this.proposal();
    if (!p) return '';
    if ((p.state === 'PendingApproval' || p.state === 'Approved') && this.now() >= this.expiresAt()) return 'Expired';
    return p.state;
  });
  protected readonly stateLabel = computed(() => this.state().replace(/([a-z])([A-Z])/g, '$1 $2'));
  protected readonly remaining = computed(() => {
    const ms = Math.max(0, this.expiresAt() - this.now());
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
}
