import { Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, catchError, of, retry, tap, throwError, timer } from 'rxjs';
import { ApiService } from '../core/api/api.service';
import { UiError, toUiError } from '../core/api/api-error';
import { Caller } from '../core/api/models';

const WAKE_RETRIES = 8;
const WAKE_DELAY_MS = 8_000;

function isWaking(error: unknown): boolean {
  return error instanceof HttpErrorResponse && [0, 502, 503, 504].includes(error.status);
}

/**
 * Retries reads while the backend is cold-starting, reporting each attempt so the page can
 * say so instead of showing a generic failure. Writes are not retried automatically.
 */
export function retryWhileWaking<T>(onAttempt: (attempt: number) => void): MonoTypeOperatorFunction<T> {
  return (source: Observable<T>) =>
    source.pipe(
      retry({
        count: WAKE_RETRIES,
        delay: (error, attempt) => {
          if (!isWaking(error)) return throwError(() => error);
          onAttempt(attempt);
          return timer(WAKE_DELAY_MS);
        },
      }),
      tap(() => onAttempt(0)),
    );
}

/** The signed-in caller as the server sees it (tenant and role come from UserAccess). */
@Injectable({ providedIn: 'root' })
export class CallerService {
  private readonly api = inject(ApiService);
  private readonly state = signal<Caller | null>(null);
  private readonly failure = signal<UiError | null>(null);
  readonly caller = this.state.asReadonly();
  readonly canWrite = computed(() => this.state()?.canWrite ?? false);
  /** Signed in, but the server refused access (inactive or unmapped user). */
  readonly accessError = computed(() => (this.failure()?.kind === 'denied' ? this.failure() : null));

  load(): Observable<Caller | null> {
    return this.api.me().pipe(
      tap((caller) => {
        this.state.set(caller);
        this.failure.set(null);
      }),
      catchError((e: unknown) => {
        this.state.set(null);
        this.failure.set(toUiError(e));
        return of(null);
      }),
    );
  }

  clear(): void {
    this.state.set(null);
    this.failure.set(null);
  }
}

export function initials(label: string | null | undefined): string {
  const words = (label ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? 'A') + (words[1]?.[0] ?? '')).toUpperCase();
}

type Tone = 'neutral' | 'warning' | 'info' | 'success' | 'danger' | 'teal';

const STATUS_STYLE: Record<string, { tone: Tone; icon: string; label: string }> = {
  Draft: { tone: 'neutral', icon: 'pencil', label: 'Draft' },
  AwaitingDocuments: { tone: 'warning', icon: 'clock', label: 'Awaiting Documents' },
  ReadyToSubmit: { tone: 'teal', icon: 'check-circle', label: 'Ready to Submit' },
  Submitted: { tone: 'info', icon: 'arrow-up-right', label: 'Submitted' },
  UnderReview: { tone: 'info', icon: 'arrow-up-right', label: 'Under Review' },
  Approved: { tone: 'success', icon: 'check-circle', label: 'Approved' },
  Denied: { tone: 'danger', icon: 'x-circle', label: 'Denied' },
  PendingApproval: { tone: 'warning', icon: 'clock', label: 'Pending Approval' },
  Expired: { tone: 'danger', icon: 'x-circle', label: 'Expired' },
  Stale: { tone: 'danger', icon: 'alert-triangle-red', label: 'Stale' },
  Consumed: { tone: 'info', icon: 'arrow-up-right', label: 'Submitted' },
  Queued: { tone: 'neutral', icon: 'clock', label: 'Queued' },
  Processing: { tone: 'info', icon: 'arrow-up-right', label: 'Processing' },
  Completed: { tone: 'success', icon: 'check-circle', label: 'Completed' },
  Failed: { tone: 'warning', icon: 'alert-triangle-amber', label: 'Retrying' },
};

/** Status pill: always icon + label, so status is never shown by colour alone. */
@Component({
  selector: 'ab-status',
  template: `<span [class]="'pill pulse tone-' + style().tone" [attr.data-status]="status()">
    <img [src]="'icons/' + style().icon + '.svg'" width="12" height="12" alt="" />{{ style().label }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<string>();
  protected readonly style = computed(
    () => STATUS_STYLE[this.status()] ?? { tone: 'neutral' as Tone, icon: 'minus', label: this.status() },
  );
}

@Component({
  selector: 'ab-error',
  template: `
    @if (error(); as e) {
      <div class="panel" [class.error]="e.kind !== 'waking'" [class.warn]="e.kind === 'waking'" role="alert" [attr.data-kind]="e.kind">
        <img src="icons/alert-circle.svg" width="16" height="16" alt="" />
        <div>
          <p><strong>{{ title() }}</strong></p>
          <p>{{ e.message }}</p>
          <p class="meta">Code {{ e.code }}@if (e.correlationId) { · correlation {{ e.correlationId }} }</p>
          @if (e.retryable) {
            <button type="button" class="secondary small" (click)="retry.emit()">Try again</button>
          }
        </div>
      </div>
    }
  `,
})
export class ErrorPanel {
  readonly error = input<UiError | null>(null);
  readonly retry = output<void>();
  readonly title = computed(() => {
    switch (this.error()?.kind) {
      case 'waking':
        return 'Backend waking up';
      case 'denied':
        return 'Access denied';
      case 'notFound':
        return 'Not found';
      case 'expired':
        return 'Proposal expired';
      case 'conflict':
        return 'Changed since you loaded it';
      case 'incomplete':
        return 'Not ready';
      case 'invalid':
        return 'Invalid request';
      case 'unauthenticated':
        return 'Signed out';
      default:
        return 'Something went wrong';
    }
  });
}

@Component({
  selector: 'ab-waking',
  template: `
    @if (attempt() > 0) {
      <div class="panel warn" role="status">
        <img src="icons/clock-16.svg" width="16" height="16" alt="" />
        <p>Waking the backend (attempt {{ attempt() }}). Free hosting sleeps when idle; this can take up to a minute.</p>
      </div>
    }
  `,
})
export class WakingNotice {
  readonly attempt = input(0);
}

/** Loading placeholder rows with a shimmer, used instead of spinners for content. */
@Component({
  selector: 'ab-skeleton',
  template: `
    @for (r of rowsArray(); track $index) {
      <div class="tr"><div class="skeleton" [style.width.%]="60 + (($index * 13) % 35)"></div></div>
    }
  `,
})
export class Skeleton {
  readonly rows = input(5);
  protected readonly rowsArray = computed(() => Array.from({ length: this.rows() }));
}
