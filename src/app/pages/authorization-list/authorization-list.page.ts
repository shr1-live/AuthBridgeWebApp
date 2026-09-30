import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AUTHORIZATION_STATUSES, AuthorizationSummary } from '../../core/api/models';
import { ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const CODE = Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/);

@Component({
  selector: 'ab-authorization-list-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <h1>Authorization requests</h1>

    <form class="filters" [formGroup]="filters" (ngSubmit)="apply()" novalidate>
      <label>
        Status
        <select formControlName="status">
          <option value="">Any</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
      </label>
      <label>
        Payer
        <input formControlName="payerCode" placeholder="DEMO-PAYER-A" maxlength="40" />
      </label>
      <label>
        Service
        <input formControlName="serviceCode" placeholder="DEMO-MRI" maxlength="40" />
      </label>
      <label>
        ID contains
        <input formControlName="search" placeholder="AUTH-10" maxlength="40" />
      </label>
      <button type="submit" [disabled]="filters.invalid">Apply</button>
      <button type="button" class="secondary" (click)="clear()">Clear</button>
    </form>
    @if (filters.invalid) {
      <p class="field-error">Codes may contain only letters, digits and hyphens.</p>
    }

    <ab-waking [attempt]="waking()" />
    <ab-error [error]="error()" (retry)="load()" />

    @if (loading() && items().length === 0) {
      <p class="muted">Loading…</p>
    }

    @if (!error()) {
      <table class="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Payer</th>
            <th>Service</th>
            <th>Member (synthetic)</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          @for (item of items(); track item.authorizationId) {
            <tr>
              <td><a [routerLink]="['/authorizations', item.authorizationId]">{{ item.authorizationId }}</a></td>
              <td><ab-status [status]="item.status" /></td>
              <td>{{ item.payerCode }}</td>
              <td>{{ item.serviceCode }}</td>
              <td>{{ item.memberLabel }}</td>
              <td>{{ item.updatedAtUtc | date: 'medium' }}</td>
            </tr>
          } @empty {
            @if (!loading()) {
              <tr>
                <td colspan="6" class="muted">No requests match.</td>
              </tr>
            }
          }
        </tbody>
      </table>

      <nav class="pager" aria-label="Pagination">
        <button type="button" class="secondary" (click)="go(page() - 1)" [disabled]="page() <= 1 || loading()">Previous</button>
        <span>Page {{ page() }} of {{ pages() }} · {{ total() }} requests</span>
        <button type="button" class="secondary" (click)="go(page() + 1)" [disabled]="page() >= pages() || loading()">Next</button>
      </nav>
    }
  `,
})
export class AuthorizationListPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly statuses = AUTHORIZATION_STATUSES;
  protected readonly pageSize = 10;

  protected readonly filters = inject(FormBuilder).nonNullable.group({
    status: [''],
    payerCode: ['', [CODE, Validators.maxLength(40)]],
    serviceCode: ['', [CODE, Validators.maxLength(40)]],
    search: ['', [CODE, Validators.maxLength(40)]],
  });

  protected readonly items = signal<AuthorizationSummary[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(false);
  protected readonly waking = signal(0);
  protected readonly error = signal<UiError | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected apply(): void {
    this.page.set(1);
    this.load();
  }

  protected clear(): void {
    this.filters.reset();
    this.apply();
  }

  protected go(page: number): void {
    this.page.set(page);
    this.load();
  }

  load(): void {
    if (this.filters.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list({ ...this.filters.getRawValue(), page: this.page(), pageSize: this.pageSize })
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.total.set(result.total);
          this.pages.set(Math.max(1, Math.ceil(result.total / result.pageSize)));
          this.loading.set(false);
        },
        error: (e: unknown) => {
          this.error.set(toUiError(e));
          this.waking.set(0);
          this.loading.set(false);
        },
      });
  }
}
