import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AUTHORIZATION_STATUSES, AuthorizationSummary, ListFilter } from '../../core/api/models';
import { GuideService } from '../../guide/guide.service';
import { ErrorPanel, Skeleton, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const CODE = Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
const PAGE_SIZE = 10;

type Filters = Omit<ListFilter, 'page' | 'pageSize'>;

@Component({
  selector: 'ab-authorization-list-page',
  imports: [ReactiveFormsModule, DatePipe, StatusBadge, ErrorPanel, WakingNotice, Skeleton],
  template: `
    <header class="page-head">
      <h1>Prior Auth Requests</h1>
      <span class="subtle">{{ total() }} in your tenant{{ hasFilters() ? ' matching filters' : '' }}</span>
    </header>

    <form class="toolbar" [formGroup]="filters" (ngSubmit)="$event.preventDefault()" novalidate>
      <label class="search">
        <img src="icons/search.svg" width="16" height="16" alt="" />
        <input formControlName="search" placeholder="Search request ID, e.g. AUTH-104" maxlength="40" aria-label="Search by request ID" />
      </label>
      <div class="chips">
        <select formControlName="status" aria-label="Status">
          <option value="">Status: Any</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ label(s) }}</option>
          }
        </select>
        <select formControlName="payerCode" aria-label="Payer">
          <option value="">Payer: Any</option>
          <option value="DEMO-PAYER-A">DEMO-PAYER-A</option>
          <option value="DEMO-PAYER-B">DEMO-PAYER-B</option>
        </select>
        <select formControlName="serviceCode" aria-label="Service">
          <option value="">Service: Any</option>
          @for (s of services; track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
        @if (hasFilters()) {
          <button type="button" class="ghost" (click)="clear()">Clear filters</button>
        }
      </div>
    </form>
    @if (filters.invalid) {
      <p class="field-error">Search may contain only letters, digits and hyphens.</p>
    }

    <ab-waking [attempt]="waking()" />
    <ab-error [error]="error()" (retry)="load()" />

    @if (!error()) {
      <section class="card">
        <div class="table wide" role="table">
          <div class="tr head dense" role="row">
            <span class="c-id">ID</span>
            <span class="c-grow">Member (synthetic)</span>
            <span class="c-sm">Payer</span>
            <span class="c-md">Service</span>
            <span class="c-status">Status</span>
            <span class="c-md">Updated</span>
          </div>
          @if (loading() && items().length === 0) {
            <ab-skeleton [rows]="8" />
          }
          @for (item of items(); track item.authorizationId) {
            <div class="tr row dense" role="row" tabindex="0" (click)="open(item)" (keydown.enter)="open(item)">
              <span class="c-id">{{ item.authorizationId }}</span>
              <span class="c-grow strong">{{ item.memberLabel }}</span>
              <span class="c-sm soft">{{ item.payerCode }}</span>
              <span class="c-md soft">{{ item.serviceCode }}</span>
              <span class="c-status"><ab-status [status]="item.status" /></span>
              <span class="c-md soft">{{ item.updatedAtUtc | date: 'MMM d, h:mm a' }}</span>
            </div>
          } @empty {
            @if (!loading()) {
              <div class="tr"><span class="muted">No requests match these filters.</span></div>
            }
          }
        </div>
        <div class="table-foot">
          <span>{{ rangeText() }}</span>
          <div class="chips">
            <button type="button" class="secondary small" (click)="go(page() - 1)" [disabled]="page() <= 1 || loading()">Previous</button>
            <button type="button" class="secondary small" (click)="go(page() + 1)" [disabled]="page() >= pages() || loading()">Next</button>
          </div>
        </div>
      </section>
    }
  `,
})
export class AuthorizationListPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly guide = inject(GuideService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statuses = AUTHORIZATION_STATUSES;
  protected readonly services = ['DEMO-MRI', 'DEMO-CT', 'DEMO-PHYSIO', 'DEMO-SURGERY', 'DEMO-SPECIALIST'];

  protected readonly filters = inject(FormBuilder).nonNullable.group({
    status: [''],
    payerCode: [''],
    serviceCode: [''],
    search: ['', [CODE, Validators.maxLength(40)]],
  });

  protected readonly items = signal<AuthorizationSummary[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly waking = signal(0);
  protected readonly error = signal<UiError | null>(null);
  /** The filter the current results were loaded with. Paging always reuses exactly this. */
  private readonly applied = signal<Filters>({});

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly hasFilters = computed(() => Object.values(this.applied()).some((v) => !!v));
  protected readonly rangeText = computed(() => {
    if (this.total() === 0) return 'No results';
    const from = (this.page() - 1) * PAGE_SIZE + 1;
    return `Showing ${from}–${from + this.items().length - 1} of ${this.total()} results`;
  });

  ngOnInit(): void {
    const status = this.route.snapshot.queryParamMap.get('status');
    if (status && AUTHORIZATION_STATUSES.includes(status as never)) this.filters.patchValue({ status }, { emitEvent: false });

    // Filters apply as soon as they change, so the screen never shows a filter the results don't use.
    this.filters.valueChanges
      .pipe(
        debounceTime(300),
        map(() => this.filters.getRawValue()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.apply());
    this.apply();
  }

  protected label(status: string): string {
    return status.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  protected clear(): void {
    this.filters.reset();
  }

  protected go(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.pages()));
    this.load();
  }

  protected open(item: AuthorizationSummary): void {
    void this.router.navigate(['/authorizations', item.authorizationId]);
  }

  private apply(): void {
    if (this.filters.invalid) return;
    this.applied.set(this.filters.getRawValue());
    this.page.set(1);
    this.load();
  }

  load(): void {
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
        },
        error: (e: unknown) => {
          this.error.set(toUiError(e));
          this.waking.set(0);
          this.loading.set(false);
        },
      });
  }
}
