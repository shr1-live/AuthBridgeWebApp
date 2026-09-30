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
      <p><a [routerLink]="['/authorizations', s.authorizationId]">← {{ s.authorizationId }}</a></p>
      <h1>Submission progress</h1>

      <ol class="steps">
        <li [class.done]="true">Queued with the simulated payer · {{ s.createdAtUtc | date: 'mediumTime' }}</li>
        <li [class.done]="reviewing()" [class.current]="s.state === 'Processing' || (s.state === 'Failed' && !decided())">
          Under review
          @if (s.state === 'Failed' && !decided()) {
            <span class="warn">— {{ s.lastError }} (attempt {{ s.failureCount }})</span>
          }
        </li>
        <li [class.done]="decided()">
          Decision
          @if (decided()) {
            : <ab-status [status]="s.requestStatus" /> · reference <code>{{ s.payerReference }}</code> ·
            {{ s.completedAtUtc | date: 'mediumTime' }}
          } @else {
            <span class="muted">— pending</span>
          }
        </li>
      </ol>

      @if (!decided()) {
        <p class="muted">
          Checking every few seconds. Decisions are simulated from the fixture scenario and can pause while the free
          backend is asleep.
        </p>
      } @else {
        <p class="muted">Simulated outcome — no real payer was contacted.</p>
      }
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
