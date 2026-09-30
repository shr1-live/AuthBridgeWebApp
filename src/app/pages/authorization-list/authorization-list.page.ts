import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AUTHORIZATION_STATUSES, AuthorizationSummary, ListFilter } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { Icon } from '../../shared/icon';
import {
  ErrorAlert, PageService, Skeleton, StatusPill, ToastService, WakingCard, relativeTime, retryWhileWaking, statusLabel,
} from '../../shared/ui';

const CODE = Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
const PAGE_SIZE = 10;
const DAY = 86_400_000;
const SUBMITTED = ['Submitted', 'UnderReview', 'Approved', 'Denied'];

type Filters = Omit<ListFilter, 'page' | 'pageSize'>;

interface Kpi {
  key: string;
  status: string | null;
  label: string;
  value: number;
  note: string;
  icon: string;
  tone: 'warning' | 'primary' | 'info' | 'success';
  spark: string;
}

/**
 * Requests (/authorizations) and Submissions (/submissions, mode 'submissions') share this
 * page: the latter shows only requests that have been sent to the simulated payer.
 */
@Component({
  selector: 'ab-authorization-list-page',
  imports: [ReactiveFormsModule, RouterLink, Icon, StatusPill, ErrorAlert, WakingCard, Skeleton],
  template: `
    <div class="page">
      @if (mode() === 'requests') {
        <div class="kpis">
          @for (k of kpis(); track k.key) {
            <button type="button" class="card clickable" [class.is-selected]="k.status && filters.controls.status.value === k.status"
                    [attr.aria-pressed]="!!k.status && filters.controls.status.value === k.status" (click)="toggleStatus(k.status)">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
                <span class="iconsq" [style.background]="'var(--' + k.tone + '-soft)'" [style.color]="'var(--' + k.tone + ')'">
                  <ab-icon [name]="k.icon" [size]="20" />
                </span>
                <svg class="spark" viewBox="0 0 92 28" width="92" height="28" fill="none" aria-hidden="true">
                  <polyline [attr.points]="k.spark" [attr.stroke]="'var(--' + k.tone + ')'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <p class="display" style="margin-top: 16px">{{ statsLoaded() ? k.value : '–' }}</p>
              <p class="body" style="margin-top: 2px; font-weight: 500; color: var(--text-2)">{{ k.label }}</p>
              <p class="cap" style="margin-top: 8px">{{ k.note }}</p>
            </button>
          }
        </div>
      }

      <section class="card">
        <form class="filters" [formGroup]="filters" (ngSubmit)="$event.preventDefault()" novalidate>
          <div class="field">
            <label class="lbl" for="f-status">Status</label>
            <span class="sel">
              <select class="inp" id="f-status" formControlName="status">
                <option value="">All statuses</option>
                @for (s of statuses(); track s) { <option [value]="s">{{ label(s) }}</option> }
              </select>
              <ab-icon name="chevron-down" />
            </span>
          </div>
          <div class="field">
            <label class="lbl" for="f-payer">Payer</label>
            <span class="sel">
              <select class="inp" id="f-payer" formControlName="payerCode">
                <option value="">All payers</option>
                <option value="DEMO-PAYER-A">DEMO-PAYER-A</option>
                <option value="DEMO-PAYER-B">DEMO-PAYER-B</option>
              </select>
              <ab-icon name="chevron-down" />
            </span>
          </div>
          <div class="field">
            <label class="lbl" for="f-service">Service</label>
            <span class="sel">
              <select class="inp" id="f-service" formControlName="serviceCode">
                <option value="">All services</option>
                @for (s of services; track s) { <option [value]="s">{{ s }}</option> }
              </select>
              <ab-icon name="chevron-down" />
            </span>
          </div>
          <div class="field">
            <label class="lbl" for="f-id">Request ID</label>
            <span class="inp-ico">
              <ab-icon name="search" />
              <input class="inp" id="f-id" type="search" formControlName="search" placeholder="AUTH-104" maxlength="40" [class.is-err]="filters.controls.search.invalid" />
            </span>
          </div>
          <button type="button" class="btn btn-ghost" (click)="clear()" [disabled]="!hasFilters()"><ab-icon name="rotate-ccw" /><span>Clear</span></button>
        </form>
        @if (filters.controls.search.invalid) {
          <p class="err-txt" style="margin-top: 8px"><ab-icon name="alert-circle" [size]="14" />Letters, digits and hyphens only.</p>
        }
        @if (activeChips().length) {
          <div class="chips">
            <span class="cap" style="margin-right: 2px">Active filters</span>
            @for (c of activeChips(); track c.key) {
              <span class="chip"><span>{{ c.name }} <b>{{ c.value }}</b></span>
                <button type="button" [attr.aria-label]="'Remove ' + c.name.toLowerCase() + ' filter'" (click)="removeFilter(c.key)"><ab-icon name="x" [size]="12" /></button>
              </span>
            }
          </div>
        }
      </section>

      <div class="between">
        <p class="body muted">Showing <strong style="color: var(--text)">{{ total() }}</strong> of {{ scopeTotal() }} {{ noun() }}</p>
        <div class="seg" role="group" aria-label="View">
          <button type="button" [class.on]="view() === 'table'" [attr.aria-pressed]="view() === 'table'" (click)="setView('table')"><ab-icon name="table" [size]="14" /><span>Table</span></button>
          <button type="button" [class.on]="view() === 'cards'" [attr.aria-pressed]="view() === 'cards'" (click)="setView('cards')"><ab-icon name="grid" [size]="14" /><span>Cards</span></button>
        </div>
      </div>

      <ab-waking [attempt]="waking()" />
      <ab-error [error]="error()" (retry)="load()" />

      @if (!error() && waking() === 0) {
        @if (loading() && items().length === 0) {
          <ab-skeleton [rows]="6" />
        } @else if (items().length === 0) {
          <section class="card center-empty">
            <svg viewBox="0 0 72 56" width="86" height="66" fill="none" aria-hidden="true">
              <rect x="9" y="12" width="54" height="36" rx="5" stroke="var(--border-strong)" stroke-width="2" />
              <path d="M9 30h14l4 6h18l4-6h14" stroke="var(--border-strong)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="36" cy="22" r="6.5" stroke="var(--primary)" stroke-width="2" />
              <line x1="41" y1="27" x2="45" y2="31" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" />
            </svg>
            <p class="h3" style="margin-top: 6px">No {{ noun() }} match</p>
            <p class="cap" style="max-width: 260px">Try clearing a filter or searching a different request ID.</p>
            @if (hasFilters()) {
              <button type="button" class="btn btn-sec btn-sm" style="margin-top: 10px" (click)="clear()">Clear filters</button>
            }
          </section>
        } @else if (view() === 'table') {
          <section class="card flush">
            <div style="overflow-x: auto; border-radius: 12px">
              <table class="tbl">
                <caption class="sr-only">Prior-authorization requests</caption>
                <thead>
                  <tr>
                    <th scope="col">Request</th><th scope="col">Status</th><th scope="col" class="hide-sm">Payer</th>
                    <th scope="col" class="hide-sm">Service</th><th scope="col" class="hide-sm">Member</th><th scope="col">Documents</th>
                    <th scope="col" class="hide-sm">Updated</th><th scope="col"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of items(); track r.authorizationId) {
                    <tr style="cursor: pointer" (click)="open(r)">
                      <td><a [routerLink]="['/authorizations', r.authorizationId]" class="mono" style="font-size: 13px" (click)="$event.stopPropagation()">{{ r.authorizationId }}</a></td>
                      <td><ab-status [status]="r.status" /></td>
                      <td class="hide-sm"><span class="mono" style="font-size: 12px">{{ r.payerCode }}</span></td>
                      <td class="hide-sm"><span class="mono" style="font-size: 12px">{{ r.serviceCode }}</span></td>
                      <td class="hide-sm"><span style="font-size: 13px">Member <span class="mono">{{ r.memberLabel }}</span></span></td>
                      <td>
                        <div style="min-width: 104px">
                          <div class="bar" [class.ok]="complete(r)" [class.warn]="!complete(r) && r.validDocumentCount > 0"><i [style.width.%]="pct(r)"></i></div>
                          <p class="cap" style="margin-top: 6px">{{ r.validDocumentCount }} of {{ r.requiredDocumentCount }}</p>
                        </div>
                      </td>
                      <td class="hide-sm"><span style="font-size: 13px">{{ ago(r.updatedAtUtc) }}</span></td>
                      <td style="text-align: right">
                        <a class="btn btn-ghost btn-sm" style="width: 36px; padding: 0" [routerLink]="['/authorizations', r.authorizationId]"
                           [attr.aria-label]="'Open ' + r.authorizationId" (click)="$event.stopPropagation()"><ab-icon name="chevron-right" /></a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        } @else {
          <div class="cards-grid">
            @for (r of items(); track r.authorizationId) {
              <a class="card clickable request-card" [routerLink]="['/authorizations', r.authorizationId]">
                <div class="between" style="flex-wrap: nowrap">
                  <span class="mono h3" style="font-size: 15px">{{ r.authorizationId }}</span>
                  <ab-status [status]="r.status" />
                </div>
                <span class="mono cap" style="letter-spacing: .02em">{{ r.payerCode }} · {{ r.serviceCode }}</span>
                <span class="body muted">Member <span class="mono">{{ r.memberLabel }}</span></span>
                <div class="bar" style="margin-top: 8px" [class.ok]="complete(r)" [class.warn]="!complete(r) && r.validDocumentCount > 0"><i [style.width.%]="pct(r)"></i></div>
                <div class="between cap"><span>{{ r.validDocumentCount }} of {{ r.requiredDocumentCount }} documents</span><span>{{ ago(r.updatedAtUtc) }}</span></div>
              </a>
            }
          </div>
        }

        @if (items().length > 0) {
          <div class="between">
            <p class="cap">Page {{ page() }} of {{ pages() }} · {{ total() }} {{ noun() }}</p>
            <div style="display: flex; gap: 8px">
              <button type="button" class="btn btn-sec btn-sm" (click)="go(page() - 1)" [disabled]="page() <= 1 || loading()"><ab-icon name="chevron-left" [size]="14" /><span>Previous</span></button>
              <button type="button" class="btn btn-sec btn-sm" (click)="go(page() + 1)" [disabled]="page() >= pages() || loading()"><span>Next</span><ab-icon name="chevron-right" [size]="14" /></button>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class AuthorizationListPage implements OnInit {
  readonly mode = input<'requests' | 'submissions'>('requests');

  private readonly api = inject(ApiService);
  private readonly guide = inject(GuideService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  private readonly pageHeader = inject(PageService);

  protected readonly services = ['DEMO-MRI', 'DEMO-CT', 'DEMO-PHYSIO', 'DEMO-SURGERY', 'DEMO-SPECIALIST'];
  protected readonly statuses = computed(() => (this.mode() === 'submissions' ? SUBMITTED : AUTHORIZATION_STATUSES));
  protected readonly noun = computed(() => (this.mode() === 'submissions' ? 'submissions' : 'requests'));
  protected readonly label = statusLabel;
  protected readonly ago = (iso: string) => relativeTime(iso);

  protected readonly filters = inject(FormBuilder).nonNullable.group({
    status: [''],
    payerCode: [''],
    serviceCode: [''],
    search: ['', [CODE, Validators.maxLength(40)]],
  });

  /** Every request in the tenant (demo scale): drives the KPI cards and the Submissions view. */
  private readonly all = signal<AuthorizationSummary[]>([]);
  protected readonly statsLoaded = signal(false);
  protected readonly items = signal<AuthorizationSummary[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly waking = signal(0);
  protected readonly error = signal<UiError | null>(null);
  protected readonly view = signal<'table' | 'cards'>(this.readView());
  /** The filter the current results were loaded with. Paging always reuses exactly this. */
  private readonly applied = signal<Filters>({});
  private firstLoad = true;

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly hasFilters = computed(() => Object.values(this.applied()).some((v) => !!v));
  protected readonly scopeTotal = computed(() =>
    this.mode() === 'submissions' ? this.all().filter((r) => SUBMITTED.includes(r.status)).length : this.all().length,
  );
  protected readonly activeChips = computed(() => {
    const a = this.applied();
    const chips: { key: keyof Filters; name: string; value: string }[] = [];
    if (a.status) chips.push({ key: 'status', name: 'Status', value: statusLabel(a.status) });
    if (a.payerCode) chips.push({ key: 'payerCode', name: 'Payer', value: a.payerCode });
    if (a.serviceCode) chips.push({ key: 'serviceCode', name: 'Service', value: a.serviceCode });
    if (a.search) chips.push({ key: 'search', name: 'ID', value: a.search });
    return chips;
  });

  protected readonly kpis = computed<Kpi[]>(() => {
    const all = this.all();
    const now = Date.now();
    const recent = (r: AuthorizationSummary) => now - Date.parse(r.updatedAtUtc) < 7 * DAY;
    const make = (key: string, status: string | null, statuses: string[], label: string, icon: string, tone: Kpi['tone']): Kpi => {
      const rows = all.filter((r) => statuses.includes(r.status));
      const week = rows.filter(recent).length;
      return {
        key, status, label, icon, tone,
        value: rows.length,
        note: week > 0 ? `+${week} this week` : 'No change this week',
        spark: this.spark(rows, now),
      };
    };
    const approved = all.filter((r) => r.status === 'Approved' && recent(r)).length;
    const denied = all.filter((r) => r.status === 'Denied' && recent(r)).length;
    const decided = make('decided', null, ['Approved', 'Denied'], 'Decided this week', 'shield-check', 'success');
    return [
      make('awaiting', 'AwaitingDocuments', ['AwaitingDocuments'], 'Awaiting documents', 'clock', 'warning'),
      make('ready', 'ReadyToSubmit', ['ReadyToSubmit'], 'Ready to submit', 'check-circle', 'primary'),
      make('review', 'UnderReview', ['Submitted', 'UnderReview'], 'Under review', 'hourglass', 'info'),
      { ...decided, value: approved + denied, note: `${approved} approved · ${denied} denied` },
    ];
  });

  ngOnInit(): void {
    const submissions = this.mode() === 'submissions';
    this.pageHeader.set(submissions ? 'Submissions' : 'Requests', [{ label: 'Workspace' }, { label: submissions ? 'Submissions' : 'Requests' }]);

    const q = this.route.snapshot.queryParamMap;
    const status = q.get('status');
    if (status && AUTHORIZATION_STATUSES.includes(status as never)) this.filters.patchValue({ status }, { emitEvent: false });
    const search = q.get('search');
    if (search) this.filters.patchValue({ search }, { emitEvent: false });

    // Filters apply as soon as they change, so the screen never shows a filter the results don't use.
    this.filters.valueChanges
      .pipe(
        debounceTime(300),
        map(() => this.filters.getRawValue()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.apply());

    this.api
      .list({ page: 1, pageSize: 100 })
      .pipe(retryWhileWaking(() => undefined))
      .subscribe({
        next: (r) => {
          this.all.set(r.items);
          this.statsLoaded.set(true);
          if (submissions) this.load();
        },
        error: () => this.statsLoaded.set(true),
      });
    this.apply();
  }

  protected toggleStatus(status: string | null): void {
    if (!status) return;
    this.filters.controls.status.setValue(this.filters.controls.status.value === status ? '' : status);
  }

  protected removeFilter(key: keyof Filters): void {
    this.filters.controls[key].setValue('');
  }

  protected clear(): void {
    this.filters.reset();
  }

  protected go(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.pages()));
    this.load();
  }

  protected open(r: AuthorizationSummary): void {
    void this.router.navigate(['/authorizations', r.authorizationId]);
  }

  protected setView(view: 'table' | 'cards'): void {
    this.view.set(view);
    try {
      localStorage.setItem('authbridge.view', view);
    } catch {
      // Preference only.
    }
  }

  protected complete(r: AuthorizationSummary): boolean {
    return r.requiredDocumentCount > 0 && r.validDocumentCount >= r.requiredDocumentCount;
  }

  protected pct(r: AuthorizationSummary): number {
    return r.requiredDocumentCount === 0 ? 0 : (r.validDocumentCount / r.requiredDocumentCount) * 100;
  }

  private apply(): void {
    if (this.filters.invalid) return;
    this.applied.set(this.filters.getRawValue());
    this.page.set(1);
    this.load();
  }

  load(): void {
    if (this.mode() === 'submissions') {
      this.loadSubmissions();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list({ ...this.applied(), page: this.page(), pageSize: PAGE_SIZE })
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (result) => {
          this.total.set(result.total);
          // A page past the end (e.g. the data shrank) snaps back to the last real page.
          if (result.items.length === 0 && result.total > 0 && this.page() > this.pages()) {
            this.page.set(this.pages());
            this.load();
            return;
          }
          this.items.set(result.items);
          this.loading.set(false);
          this.guide.complete('browse');
          this.announce();
        },
        error: (e: unknown) => {
          this.error.set(toUiError(e));
          this.waking.set(0);
          this.loading.set(false);
        },
      });
  }

  /** Submissions: requests that have been sent, filtered and paged in the browser (demo scale). */
  private loadSubmissions(): void {
    const a = this.applied();
    const rows = this.all()
      .filter((r) => SUBMITTED.includes(r.status))
      .filter((r) => (!a.status || r.status === a.status) && (!a.payerCode || r.payerCode === a.payerCode)
        && (!a.serviceCode || r.serviceCode === a.serviceCode) && (!a.search || r.authorizationId.includes(a.search.toUpperCase())))
      .sort((x, y) => Date.parse(y.updatedAtUtc) - Date.parse(x.updatedAtUtc));
    this.total.set(rows.length);
    if (this.page() > this.pages()) this.page.set(this.pages());
    this.items.set(rows.slice((this.page() - 1) * PAGE_SIZE, this.page() * PAGE_SIZE));
    this.loading.set(!this.statsLoaded());
    if (this.statsLoaded()) this.announce();
  }

  private announce(): void {
    if (this.firstLoad) {
      this.firstLoad = false;
      return;
    }
    if (this.page() !== 1) return;
    const scope = this.applied().payerCode ? ` for ${this.applied().payerCode}` : '';
    this.toasts.show(this.hasFilters() ? 'Filters applied' : 'Filters cleared', `Showing ${this.total()} of ${this.scopeTotal()} ${this.noun()}${scope}.`);
  }

  /** Sparkline: how many of these requests had reached this state on each of the last six days. */
  private spark(rows: AuthorizationSummary[], now: number): string {
    const counts = [5, 4, 3, 2, 1, 0].map((d) => rows.filter((r) => Date.parse(r.updatedAtUtc) <= now - d * DAY).length);
    const max = Math.max(1, ...counts);
    return counts.map((c, i) => `${(i * 18).toFixed(1)},${(24 - (c / max) * 18).toFixed(1)}`).join(' ');
  }

  private readView(): 'table' | 'cards' {
    try {
      return localStorage.getItem('authbridge.view') === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  }
}
