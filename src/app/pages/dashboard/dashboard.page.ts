import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AuthorizationSummary } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { ErrorPanel, Skeleton, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

const ACTIVITY_TITLE: Record<string, string> = {
  Draft: 'Draft created',
  AwaitingDocuments: 'Documents requested',
  ReadyToSubmit: 'Ready to submit',
  Submitted: 'Submitted to simulated payer',
  UnderReview: 'Payer review started',
  Approved: 'Prior auth approved',
  Denied: 'Prior auth denied',
};

/** Tenant overview built from the same request list the queue uses. Synthetic data only. */
@Component({
  selector: 'ab-dashboard-page',
  imports: [RouterLink, StatusBadge, ErrorPanel, WakingNotice, Skeleton],
  template: `
    <header class="page-head">
      <h1>Dashboard</h1>
      <span class="subtle">Synthetic data · your tenant only</span>
    </header>

    <ab-waking [attempt]="waking()" />
    <ab-error [error]="error()" (retry)="load()" />

    @if (!error()) {
      <section class="kpis stagger" aria-label="Summary">
        <a class="card kpi clickable" routerLink="/authorizations">
          <span class="label">Pending Requests</span>
          <span class="value">{{ loaded() ? pending() : '–' }}</span>
          <span class="note">Draft, awaiting documents or ready</span>
        </a>
        <a class="card kpi clickable" routerLink="/authorizations" [queryParams]="{ status: 'UnderReview' }">
          <span class="label">With Payer</span>
          <span class="value">{{ loaded() ? withPayer() : '–' }}</span>
          <span class="note">Submitted or under simulated review</span>
        </a>
        <div class="card kpi">
          <span class="label">Approval Rate</span>
          <span class="value">{{ approvalRate() }}</span>
          <span class="note good">{{ count('Approved') }} approved · {{ count('Denied') }} denied</span>
        </div>
        <a class="card kpi alert clickable" routerLink="/authorizations" [queryParams]="{ status: 'AwaitingDocuments' }">
          <span class="label">Needs Documents</span>
          <span class="value">{{ loaded() ? count('AwaitingDocuments') + ' Action Required' : '–' }}</span>
          <span class="note">Attach the missing fixtures</span>
        </a>
      </section>

      <div class="grid-2">
        <section class="card">
          <div class="card-head">
            <h2>Recent Requests</h2>
            <a routerLink="/authorizations" class="btn-link">View All</a>
          </div>
          <div class="table">
            <div class="tr head"><span class="c-id">Request ID</span><span class="c-grow">Member</span><span class="c-grow">Service</span><span class="c-status">Status</span></div>
            @if (!loaded()) {
              <ab-skeleton [rows]="6" />
            }
            @for (r of recent(); track r.authorizationId) {
              <div class="tr row" role="link" tabindex="0" (click)="open(r)" (keydown.enter)="open(r)">
                <span class="c-id">{{ r.authorizationId }}</span>
                <span class="c-grow strong">{{ r.memberLabel }}</span>
                <span class="c-grow soft">{{ r.serviceCode }}</span>
                <span class="c-status"><ab-status [status]="r.status" /></span>
              </div>
            }
          </div>
        </section>

        <div class="stack">
          <section class="card">
            <h2>Activity Feed</h2>
            <div class="feed">
              @for (r of recent().slice(0, 4); track r.authorizationId) {
                <div class="feed-item">
                  <div class="top">{{ activityTitle(r) }}<span>{{ ago(r.updatedAtUtc) }}</span></div>
                  <p>{{ r.authorizationId }} · {{ r.serviceCode }} · {{ r.payerCode }} (simulated)</p>
                </div>
              } @empty {
                @if (loaded()) { <p class="muted">No activity yet.</p> }
              }
            </div>
          </section>

          <section class="card">
            <h2>Needs Attention</h2>
            <div class="stack" style="gap: 16px">
              @for (r of attention(); track r.authorizationId) {
                <a class="alert-row" [class.warn]="r.status === 'AwaitingDocuments'" [class.ok]="r.status === 'ReadyToSubmit'"
                   [routerLink]="['/authorizations', r.authorizationId]">
                  <img [src]="r.status === 'AwaitingDocuments' ? 'icons/alert-triangle-amber.svg' : 'icons/check-circle-16.svg'" width="16" height="16" alt="" />
                  <div>
                    <div class="t">{{ r.authorizationId }} ({{ r.serviceCode }})</div>
                    <div class="s">{{ r.status === 'AwaitingDocuments' ? 'Missing required documents' : 'Ready — prepare it for human approval' }}</div>
                  </div>
                </a>
              } @empty {
                @if (loaded()) { <p class="muted">Nothing needs attention.</p> }
              }
            </div>
          </section>
        </div>
      </div>
    }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly guide = inject(GuideService);

  protected readonly items = signal<AuthorizationSummary[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<UiError | null>(null);
  protected readonly waking = signal(0);

  protected readonly recent = computed(() =>
    [...this.items()].sort((a, b) => Date.parse(b.updatedAtUtc) - Date.parse(a.updatedAtUtc)).slice(0, 6),
  );
  protected readonly pending = computed(() => this.count('Draft') + this.count('AwaitingDocuments') + this.count('ReadyToSubmit'));
  protected readonly withPayer = computed(() => this.count('Submitted') + this.count('UnderReview'));
  protected readonly approvalRate = computed(() => {
    const decided = this.count('Approved') + this.count('Denied');
    return decided === 0 ? '–' : `${((this.count('Approved') / decided) * 100).toFixed(1)}%`;
  });
  protected readonly attention = computed(() =>
    this.items()
      .filter((r) => r.status === 'AwaitingDocuments' || r.status === 'ReadyToSubmit')
      .sort((a, b) => (a.status === b.status ? a.authorizationId.localeCompare(b.authorizationId) : a.status === 'AwaitingDocuments' ? -1 : 1))
      .slice(0, 4),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.api
      .list({ page: 1, pageSize: 100 })
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.loaded.set(true);
          this.guide.complete('browse');
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.error.set(toUiError(e));
        },
      });
  }

  protected count(status: string): number {
    return this.items().filter((r) => r.status === status).length;
  }

  protected activityTitle(r: AuthorizationSummary): string {
    return ACTIVITY_TITLE[r.status] ?? r.status;
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }

  protected open(r: AuthorizationSummary): void {
    void this.router.navigate(['/authorizations', r.authorizationId]);
  }
}
