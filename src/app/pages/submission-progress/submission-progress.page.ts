import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { Submission } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const POLL_MS = 4_000;
const MAX_POLL_MS = 15 * 60_000;

/**
 * Shows only what the backend has persisted. A decision appears when the simulator records
 * it, never before; while the free backend sleeps, progress simply pauses.
 */
@Component({
  selector: 'ab-submission-progress-page',
  imports: [RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <ab-waking [attempt]="waking()" />
    <ab-error [error]="error()" (retry)="poll()" />

    @if (submission(); as s) {
      <nav class="crumbs" aria-label="Breadcrumb">
        <a routerLink="/authorizations">Request Queue</a>
        <img src="icons/chevron-right.svg" width="12" height="12" alt="" />
        <a [routerLink]="['/authorizations', s.authorizationId]">{{ s.authorizationId }}</a>
        <img src="icons/chevron-right.svg" width="12" height="12" alt="" />
        <strong>Submission</strong>
      </nav>

      <div class="center-page">
        <section class="card dialog">
          <div class="dialog-head">
            <span class="dialog-icon"><img src="icons/shield-check-teal.svg" width="24" height="24" alt="" /></span>
            <div style="flex: 1">
              <h1>Submission Progress</h1>
              <p class="muted">{{ s.authorizationId }} with the simulated payer</p>
            </div>
            <ab-status [status]="s.state" />
          </div>

          <div class="timeline">
            <div class="tl">
              <img src="icons/dot-done.svg" width="16" height="16" alt="" />
              <div><div class="h">Queued with the simulated payer</div><div class="d"><time>{{ s.createdAtUtc | date: 'h:mm:ss a' }}</time></div></div>
            </div>
            <div class="tl">
              <img [src]="'icons/dot-' + (decided() ? 'done' : reviewing() ? 'current' : 'future') + '.svg'" width="16" height="16" alt="" />
              <div>
                <div class="h" [class.current]="reviewing() && !decided()" [class.future]="!reviewing()">Under review</div>
                @if (s.state === 'Failed' && !decided()) {
                  <div class="d" style="color: var(--warning)">{{ s.lastError }} (attempt {{ s.failureCount }})</div>
                } @else {
                  <div class="d">The payer simulator checks the request</div>
                }
              </div>
            </div>
            <div class="tl">
              <img [src]="'icons/dot-' + (decided() ? 'current' : 'future') + '.svg'" width="16" height="16" alt="" />
              <div><div class="h" [class.current]="decided()" [class.future]="!decided()">Decision</div>
                <div class="d">{{ decided() ? 'Recorded ' : 'Pending' }}@if (s.completedAtUtc) { · <time>{{ s.completedAtUtc | date: 'h:mm:ss a' }}</time> }</div></div>
            </div>
          </div>

          @if (decided()) {
            <div class="summary" [style.background]="s.requestStatus === 'Approved' ? 'var(--success-soft)' : 'var(--danger-soft)'">
              <div class="dialog-head">
                <ab-status [status]="s.requestStatus" />
                <span class="muted">Payer reference</span><code>{{ s.payerReference }}</code>
              </div>
              <p class="muted">Simulated outcome — no real payer was contacted.</p>
            </div>
          } @else {
            <p class="muted">Checking every few seconds. Decisions come from the fixture scenario and can pause while the free backend is asleep.</p>
          }
        </section>
      </div>
    }
  `,
})
export class SubmissionProgressPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly guide = inject(GuideService);
  protected readonly submission = signal<Submission | null>(null);
  protected readonly error = signal<UiError | null>(null);
  protected readonly waking = signal(0);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly started = Date.now();

  protected readonly decided = computed(() => {
    const s = this.submission();
    return !!s && s.state === 'Completed' && (s.requestStatus === 'Approved' || s.requestStatus === 'Denied');
  });
  protected readonly reviewing = computed(() => {
    const s = this.submission();
    return !!s && s.state !== 'Queued';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  ngOnInit(): void {
    this.poll();
  }

  poll(): void {
    this.error.set(null);
    this.api
      .submission(this.id())
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (s) => {
          this.submission.set(s);
          if (this.decided()) this.guide.complete('decision');
          if (!this.decided() && Date.now() - this.started < MAX_POLL_MS) this.timer = setTimeout(() => this.poll(), POLL_MS);
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.error.set(toUiError(e));
        },
      });
  }
}
