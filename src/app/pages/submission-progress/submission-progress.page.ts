import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AuthorizationStatusDetail, Submission } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { Icon } from '../../shared/icon';
import { CodeChip, LoadError, PageService, Skeleton, StatusPill, WakingCard, payerLabel, retryWhileWaking, serviceLabel } from '../../shared/ui';

const POLL_MS = 4_000;
const MAX_POLL_MS = 15 * 60_000;

/**
 * Shows only what the backend has persisted. A decision appears when the simulator records
 * it, never before; while the free backend sleeps, progress simply pauses.
 */
@Component({
  selector: 'ab-submission-progress-page',
  imports: [RouterLink, DatePipe, Icon, StatusPill, LoadError, WakingCard, Skeleton, CodeChip],
  template: `
    <div class="page narrow">
      <ab-waking [attempt]="waking()" />
      <ab-load-error [error]="error()" subject="This submission" (retry)="poll()" />
      @if (!submission() && !error()) { <ab-skeleton [rows]="4" /> }

      @if (submission(); as s) {
        <section class="card">
          <div class="card-h">
            <div>
              <h2 class="card-t">Submission progress</h2>
              <p class="card-s">{{ s.authorizationId }}@if (request(); as r) { · {{ service(r.serviceCode) }} · {{ payer(r.payerCode) }} }</p>
            </div>
            <ab-status [status]="decided() ? s.requestStatus : s.state === 'Queued' ? 'Submitted' : 'UnderReview'" />
          </div>
          <div class="vtrk" style="margin-top: 8px">
            <div class="vtrk-i done">
              <span class="vtrk-d done"><ab-icon name="check" [size]="14" /></span>
              <p class="body" style="font-weight: 600; color: var(--text)">Queued with simulated payer</p>
              <p class="cap" style="margin-top: 2px">{{ s.createdAtUtc | date: 'h:mm a' }} · attempt <span class="mono">{{ s.attemptId.slice(0, 8) }}</span> created</p>
            </div>
            <div class="vtrk-i" [class.done]="decided()">
              <span class="vtrk-d" [class.done]="decided()" [class.cur]="!decided() && reviewing()" [class.pulse]="!decided() && reviewing()">
                @if (decided()) { <ab-icon name="check" [size]="14" /> } @else { 2 }
              </span>
              <p class="body" style="font-weight: 600" [style.color]="reviewing() ? 'var(--text)' : 'var(--text-3)'">Under review</p>
              <p class="cap" style="margin-top: 2px">{{ reviewing() ? (decided() ? 'Review finished' : 'The simulator is composing a decision') : 'Waiting for the simulator to pick it up' }}</p>
            </div>
            <div class="vtrk-i">
              <span class="vtrk-d" [class.done]="decided()">@if (decided()) { <ab-icon name="check" [size]="14" /> } @else { 3 }</span>
              <p class="body" style="font-weight: 600" [style.color]="decided() ? 'var(--text)' : 'var(--text-3)'">Decision</p>
              <p class="cap" style="margin-top: 2px">{{ decided() ? ('Recorded ' + (s.completedAtUtc | date: 'h:mm a')) : 'Appears here as soon as it is recorded' }}</p>
            </div>
          </div>
        </section>

        @if (decided()) {
          @let approved = s.requestStatus === 'Approved';
          <section class="card tintin" [style.background]="approved ? 'var(--success-soft)' : 'var(--danger-soft)'"
                   [style.border-color]="approved ? 'var(--success-border)' : 'var(--danger-border)'">
            <div style="display: flex; gap: 20px; align-items: center">
              <svg width="52" height="52" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                <circle cx="20" cy="20" r="18" [attr.stroke]="approved ? 'var(--success-border)' : 'var(--danger-border)'" stroke-width="2" />
                @if (approved) {
                  <path class="draw" d="M12 20.5l5.5 5.5L28 15" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                } @else {
                  <path class="draw" d="M14 14l12 12M26 14L14 26" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
                }
              </svg>
              <div>
                <p class="display" [style.color]="approved ? 'var(--success-ink)' : 'var(--danger-ink)'">{{ approved ? 'Approved' : 'Denied' }}</p>
                <p class="body" style="margin-top: 4px" [style.color]="approved ? 'var(--success-ink)' : 'var(--danger-ink)'">
                  The simulated payer {{ approved ? 'approved' : 'denied' }} {{ s.authorizationId }} on {{ s.completedAtUtc | date: 'd MMM y' }} at {{ s.completedAtUtc | date: 'h:mm a' }}.
                </p>
              </div>
            </div>
            <div class="divider" style="margin: 20px 0" [style.background]="approved ? 'var(--success-border)' : 'var(--danger-border)'"></div>
            <div class="between" style="align-items: flex-end">
              <div>
                <p class="cap" [style.color]="approved ? 'var(--success-ink)' : 'var(--danger-ink)'" style="margin-bottom: 6px">Payer reference</p>
                <ab-code [value]="s.payerReference ?? ''" />
              </div>
              <a class="btn btn-sec" [routerLink]="['/authorizations', s.authorizationId]">Open request</a>
            </div>
          </section>
        } @else if (s.state === 'Failed') {
          <section class="alert a-warn" style="padding: 20px 24px">
            <ab-icon name="alert-triangle" [size]="18" />
            <div style="flex: 1">
              <p class="at" style="font-size: 16px">Simulated payer error — retrying (attempt {{ s.failureCount }})</p>
              <p class="ad">{{ s.lastError }} The next attempt runs automatically. No action is needed.</p>
              <div class="bar warn" style="margin-top: 14px; max-width: 420px"><i [style.width.%]="retryPct()"></i></div>
            </div>
            <button type="button" class="btn btn-sec btn-sm" (click)="poll()"><ab-icon name="rotate-ccw" /><span>Check now</span></button>
          </section>
        }

        <p class="cap" style="text-align: center">Simulated outcome — no real payer was contacted.</p>
      }
    </div>
  `,
})
export class SubmissionProgressPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly guide = inject(GuideService);
  private readonly pageHeader = inject(PageService);
  protected readonly submission = signal<Submission | null>(null);
  protected readonly request = signal<AuthorizationStatusDetail | null>(null);
  protected readonly service = serviceLabel;
  protected readonly payer = payerLabel;
  protected readonly error = signal<UiError | null>(null);
  protected readonly waking = signal(0);
  private readonly failedAt = signal(0);
  private readonly now = signal(Date.now());
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
  /** The simulator retries after about ten seconds; the bar fills over that window. */
  protected readonly retryPct = computed(() => Math.min(100, ((this.now() - this.failedAt()) / 10_000) * 100));

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 500);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      clearInterval(tick);
    });
  }

  ngOnInit(): void {
    this.pageHeader.set('Submission', [{ label: 'Workspace' }, { label: 'Submissions', link: '/submissions' }, { label: 'Progress' }]);
    this.poll();
  }

  poll(): void {
    clearTimeout(this.timer);
    this.error.set(null);
    this.api
      .submission(this.id())
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (s) => {
          if (s.state === 'Failed' && this.submission()?.state !== 'Failed') this.failedAt.set(Date.now());
          this.submission.set(s);
          this.pageHeader.set('Submission', [{ label: 'Workspace' }, { label: 'Submissions', link: '/submissions' }, { label: s.authorizationId }]);
          if (!this.request()) this.api.status(s.authorizationId).subscribe({ next: (r) => this.request.set(r), error: () => undefined });
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
