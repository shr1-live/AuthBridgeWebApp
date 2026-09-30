import { Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, catchError, of, retry, tap, throwError, timer } from 'rxjs';
import { ApiService } from '../core/api/api.service';
import { UiError, toUiError } from '../core/api/api-error';
import { Caller } from '../core/api/models';
import { Icon } from './icon';

/* ------------------------------------------------------------------ helpers */

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

export function initials(label: string | null | undefined): string {
  const words = (label ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? 'A') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** "AwaitingDocuments" -> "Awaiting documents" (sentence case, as in the design). */
export function statusLabel(status: string): string {
  const words = status.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(' ');
}

export const docLabel = statusLabel;

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

/** Short, quotable form of a request version, e.g. A104-RV1-7F3C. */
export function versionCode(publicId: string, ruleVersion: string, version: string): string {
  return `${publicId.replace(/^AUTH-/, 'A')}-RV${ruleVersion}-${version.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/* ------------------------------------------------------------------ services */

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

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-essential preference.
  }
}

/** Light/dark theme on the body's `.ab` root, remembered per browser. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(
    stored('authbridge.theme') ? stored('authbridge.theme') === 'dark' : globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  constructor() {
    this.apply();
  }

  toggle(): void {
    this.dark.update((v) => !v);
    store('authbridge.theme', this.dark() ? 'dark' : 'light');
    this.apply();
  }

  private apply(): void {
    document.body.classList.toggle('dark', this.dark());
  }
}

export interface Crumb {
  label: string;
  link?: string;
}

/** Title and breadcrumb for the shell's top bar, set by each page. */
@Injectable({ providedIn: 'root' })
export class PageService {
  readonly title = signal('');
  readonly crumbs = signal<Crumb[]>([]);
  readonly monoTitle = signal(false);

  set(title: string, crumbs: Crumb[], mono = false): void {
    this.title.set(title);
    this.crumbs.set(crumbs);
    this.monoTitle.set(mono);
    document.title = `${title} · AuthBridge`;
  }
}

export interface Toast {
  id: number;
  title: string;
  text: string;
  tone: 'success' | 'info' | 'danger';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private next = 1;
  readonly toasts = signal<Toast[]>([]);

  show(title: string, text: string, tone: Toast['tone'] = 'success'): void {
    const toast = { id: this.next++, title, text, tone };
    this.toasts.update((t) => [...t.slice(-1), toast]);
    setTimeout(() => this.dismiss(toast.id), 4_000);
  }

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}

/* ------------------------------------------------------------------ components */

type Tone = 'neutral' | 'warn' | 'info' | 'success' | 'danger' | 'primary';

const STATUS: Record<string, { tone: Tone; icon: string; label?: string }> = {
  Draft: { tone: 'neutral', icon: 'file' },
  AwaitingDocuments: { tone: 'warn', icon: 'clock' },
  ReadyToSubmit: { tone: 'primary', icon: 'check-circle' },
  Submitted: { tone: 'info', icon: 'send' },
  UnderReview: { tone: 'info', icon: 'hourglass' },
  Approved: { tone: 'success', icon: 'check-circle' },
  Denied: { tone: 'danger', icon: 'x-circle' },
  PendingApproval: { tone: 'warn', icon: 'shield' },
  Expired: { tone: 'danger', icon: 'alert-circle' },
  Stale: { tone: 'danger', icon: 'refresh' },
  Consumed: { tone: 'info', icon: 'send', label: 'Submitted' },
  Queued: { tone: 'neutral', icon: 'clock' },
  Processing: { tone: 'info', icon: 'hourglass', label: 'Under review' },
  Completed: { tone: 'success', icon: 'check-circle' },
  Failed: { tone: 'warn', icon: 'alert-triangle', label: 'Retrying' },
};

/** Status pill: always icon + label, so status is never carried by colour alone. */
@Component({
  selector: 'ab-status',
  imports: [Icon],
  template: `<span [class]="'pill p-pulse p-' + style().tone" [class.lg]="large()" [attr.data-status]="status()">
    <ab-icon [name]="style().icon" [size]="large() ? 14 : 12" /><span>{{ style().label ?? label(status()) }}</span></span>`,
})
export class StatusPill {
  readonly status = input.required<string>();
  readonly large = input(false);
  protected readonly label = statusLabel;
  protected readonly style = computed(() => STATUS[this.status()] ?? { tone: 'neutral' as Tone, icon: 'info' });
}

/** Monospace value with a copy button (IDs, version codes, payer references). */
@Component({
  selector: 'ab-code',
  imports: [Icon],
  template: `<span class="codechip">{{ value() }}<button type="button" [attr.aria-label]="'Copy ' + value()" (click)="copy()">
    <ab-icon [name]="copied() ? 'check' : 'copy'" [size]="13" /></button></span>`,
})
export class CodeChip {
  readonly value = input.required<string>();
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); the value is still visible.
    }
  }
}

const ERROR_LOOK: Record<string, { cls: string; icon: string; title: string }> = {
  waking: { cls: 'a-warn', icon: 'alert-triangle', title: 'Backend waking up' },
  denied: { cls: 'a-danger', icon: 'slash', title: 'Access denied' },
  notFound: { cls: 'a-neutral', icon: 'frown', title: 'Not found' },
  expired: { cls: 'a-danger', icon: 'alert-circle', title: 'Review expired' },
  conflict: { cls: 'a-info', icon: 'refresh', title: 'Changed since you loaded it' },
  incomplete: { cls: 'a-warn', icon: 'alert-triangle', title: 'Not ready yet' },
  invalid: { cls: 'a-danger', icon: 'alert-circle', title: 'Invalid request' },
  unauthenticated: { cls: 'a-info', icon: 'clock', title: 'Session expired' },
  server: { cls: 'a-danger', icon: 'alert-octagon', title: 'Something went wrong' },
};

/** Inline alert for a failed call: icon + title + text, with the server code and correlation ID. */
@Component({
  selector: 'ab-error',
  imports: [Icon],
  template: `
    @if (error(); as e) {
      <div class="alert" [class]="'alert ' + look().cls" role="alert" [attr.data-kind]="e.kind">
        <ab-icon [name]="look().icon" [size]="18" />
        <div style="flex: 1; min-width: 0">
          <p class="at">{{ look().title }}</p>
          <p class="ad">{{ e.message }}</p>
          <p class="ad mono" style="font-size: 11px">{{ e.code }}@if (e.correlationId) { · {{ e.correlationId }} }</p>
        </div>
        @if (e.kind === 'conflict') {
          <button type="button" class="btn btn-sec btn-sm" (click)="retry.emit()"><ab-icon name="refresh" /><span>Reload</span></button>
        } @else if (e.retryable) {
          <button type="button" class="btn btn-sec btn-sm" (click)="retry.emit()"><ab-icon name="rotate-ccw" /><span>Try again</span></button>
        }
      </div>
    }
  `,
})
export class ErrorAlert {
  readonly error = input<UiError | null>(null);
  readonly retry = output<void>();
  protected readonly look = computed(() => ERROR_LOOK[this.error()?.kind ?? 'server'] ?? ERROR_LOOK['server']);
}

/** "Backend waking up" card with the floating cloud, shown while reads retry. */
@Component({
  selector: 'ab-waking',
  template: `
    @if (attempt() > 0) {
      <div class="card center-empty" role="status" style="border-color: var(--warning-border); background: var(--warning-soft)">
        <svg viewBox="0 0 80 48" width="92" height="55" fill="none" aria-hidden="true" class="float">
          <path d="M26 34h30a9 9 0 0 0 .6-17.97A14 14 0 0 0 29 14.5A10 10 0 0 0 26 34z" stroke="var(--warning-ink)" stroke-width="2" stroke-linejoin="round" />
          <line x1="34" y1="41" x2="34" y2="44" stroke="var(--warning-ink)" stroke-width="2" stroke-linecap="round" />
          <line x1="44" y1="41" x2="44" y2="46" stroke="var(--warning-ink)" stroke-width="2" stroke-linecap="round" />
          <line x1="54" y1="41" x2="54" y2="44" stroke="var(--warning-ink)" stroke-width="2" stroke-linecap="round" />
        </svg>
        <p class="h3" style="margin-top: 6px; color: var(--warning-ink)">Backend waking up</p>
        <p class="cap" style="max-width: 260px; color: var(--warning-ink)">Retrying automatically — attempt {{ attempt() }} · may take up to a minute.</p>
        <div class="bar warn" style="width: 180px; margin-top: 12px"><i [style.width.%]="(attempt() / 8) * 100"></i></div>
      </div>
    }
  `,
})
export class WakingCard {
  readonly attempt = input(0);
}

/** Full state card (not found, access denied, not provisioned, session expired, unexpected error). */
@Component({
  selector: 'ab-state',
  imports: [Icon, CodeChip],
  template: `
    <section class="card state-card" role="alert">
      <span class="iconsq" [style.background]="'var(--' + tone() + '-soft)'" [style.color]="'var(--' + tone() + ')'">
        <ab-icon [name]="icon()" [size]="24" />
      </span>
      <h2 class="h2">{{ title() }}</h2>
      <p class="body muted" style="max-width: 360px">{{ text() }}</p>
      <div class="actions">
        <ng-content />
        @if (correlationId(); as id) {
          <ab-code [value]="id" />
        }
      </div>
    </section>
  `,
})
export class StateCard {
  readonly icon = input('frown');
  readonly tone = input<'neutral' | 'danger' | 'warning' | 'info' | 'primary'>('neutral');
  readonly title = input.required<string>();
  readonly text = input('');
  readonly correlationId = input<string | undefined>(undefined);
}

/** The page-level state for a load failure: a state card for terminal errors, an alert otherwise. */
@Component({
  selector: 'ab-load-error',
  imports: [StateCard, ErrorAlert, Icon],
  template: `
    @if (error(); as e) {
      @switch (e.kind) {
        @case ('notFound') {
          <ab-state icon="frown" tone="neutral" title="Request not found"
                    [text]="subject() + ' does not exist in your tenant, or it belongs to another one. Check the ID and try again.'">
            <a class="btn btn-sec" href="/authorizations">Back to requests</a>
          </ab-state>
        }
        @case ('denied') {
          <ab-state icon="slash" tone="danger" title="Access denied" [text]="e.message">
            <a class="btn btn-sec" href="/authorizations">Back to requests</a>
          </ab-state>
        }
        @case ('server') {
          <ab-state icon="alert-octagon" tone="danger" title="Something went wrong"
                    text="We could not load this page. Quote the correlation ID below if you report it." [correlationId]="e.correlationId">
            <button type="button" class="btn btn-pri" (click)="retry.emit()"><ab-icon name="rotate-ccw" /><span>Try again</span></button>
          </ab-state>
        }
        @default {
          <ab-error [error]="e" (retry)="retry.emit()" />
        }
      }
    }
  `,
})
export class LoadError {
  readonly error = input<UiError | null>(null);
  readonly subject = input('This record');
  readonly retry = output<void>();
}

@Component({
  selector: 'ab-toasts',
  imports: [Icon],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast">
          <span [style.color]="'var(--' + t.tone + ')'"><ab-icon [name]="t.tone === 'danger' ? 'alert-circle' : 'check-circle'" [size]="18" /></span>
          <div style="flex: 1">
            <p class="body" style="font-weight: 600">{{ t.title }}</p>
            <p class="cap" style="margin-top: 2px">{{ t.text }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" style="width: 28px; height: 28px; padding: 0; margin: -4px -6px 0 0"
                  aria-label="Dismiss" (click)="toasts.dismiss(t.id)"><ab-icon name="x" [size]="14" /></button>
          <span class="tprog"></span>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}

/** Skeleton rows with the shimmer sweep, used instead of spinners for content. */
@Component({
  selector: 'ab-skeleton',
  template: `
    <div class="card" aria-hidden="true">
      @for (r of rowsArray(); track $index) {
        <div class="sk" [style.width.%]="$index === 0 ? 30 : 60 + (($index * 13) % 40)" style="height: 12px; margin-top: 14px"></div>
      }
    </div>
  `,
})
export class Skeleton {
  readonly rows = input(5);
  protected readonly rowsArray = computed(() => Array.from({ length: this.rows() }));
}
