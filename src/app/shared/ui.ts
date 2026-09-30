import { Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, catchError, of, retry, tap, throwError, timer } from 'rxjs';
import { ApiService } from '../core/api/api.service';
import { UiError } from '../core/api/api-error';
import { AuthorizationStatus, Caller } from '../core/api/models';

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
  readonly caller = this.state.asReadonly();
  readonly canWrite = computed(() => this.state()?.canWrite ?? false);

  load(): Observable<Caller | null> {
    return this.api.me().pipe(
      tap((caller) => this.state.set(caller)),
      catchError(() => {
        this.state.set(null);
        return of(null);
      }),
    );
  }

  clear(): void {
    this.state.set(null);
  }
}

@Component({
  selector: 'ab-status',
  template: `<span class="status" [attr.data-status]="status()">{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<AuthorizationStatus | string>();
  readonly label = computed(() => this.status().replace(/([a-z])([A-Z])/g, '$1 $2'));
}

@Component({
  selector: 'ab-error',
  template: `
    @if (error(); as e) {
      <div class="panel error" role="alert" [attr.data-kind]="e.kind">
        <strong>{{ title() }}</strong>
        <p>{{ e.message }}</p>
        <p class="meta">
          Code {{ e.code }}
          @if (e.correlationId) {
            · correlation {{ e.correlationId }}
          }
        </p>
        @if (e.retryable) {
          <button type="button" (click)="retry.emit()">Try again</button>
        }
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
      <div class="panel info" role="status">
        Waking the backend (attempt {{ attempt() }}). Free hosting sleeps when idle; this can take up to a minute.
      </div>
    }
  `,
})
export class WakingNotice {
  readonly attempt = input(0);
}
