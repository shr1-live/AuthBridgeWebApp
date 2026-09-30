import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { HistoryEntry } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { CallerService, ErrorAlert, PageService, Skeleton, StatusPill, WakingCard, relativeTime, retryWhileWaking } from '../../shared/ui';

interface ActivityItem extends HistoryEntry {
  authorizationId: string;
}

/** Recent status changes across the tenant, built from each recently updated request's history. */
@Component({
  selector: 'ab-activity-page',
  imports: [RouterLink, DatePipe, Icon, StatusPill, ErrorAlert, WakingCard, Skeleton],
  template: `
    <div class="page">
      <ab-waking [attempt]="waking()" />
      <ab-error [error]="error()" (retry)="load()" />
      @if (!loaded() && !error()) {
        <ab-skeleton [rows]="8" />
      } @else if (loaded()) {
        <section class="card">
          <div class="card-h">
            <div>
              <h2 class="card-t">Recent activity</h2>
              <p class="card-s">Every status change in your tenant, newest first</p>
            </div>
            <span class="cap">{{ items().length }} events</span>
          </div>
          <div class="tl">
            @for (h of items(); track h.id) {
              <div class="tl-i" [class.past]="!$first">
                <div class="tl-card">
                  <div class="tl-trans">
                    <a class="mono" style="font-size: 13px; font-weight: 600; margin-right: 4px" [routerLink]="['/authorizations', h.authorizationId]">{{ h.authorizationId }}</a>
                    @if (h.previousStatus) {
                      <ab-status [status]="h.previousStatus" /><ab-icon name="arrow-right" [size]="14" />
                    }
                    <ab-status [status]="h.newStatus" />
                  </div>
                  <div class="tl-meta"><span>{{ actor(h.actorId) }}</span><span class="mono">{{ h.occurredAtUtc | date: 'yyyy-MM-dd HH:mm' }} · {{ ago(h.occurredAtUtc) }}</span></div>
                  <p class="body" style="margin-top: 8px; color: var(--text)">{{ h.reason }}</p>
                </div>
              </div>
            } @empty {
              <p class="cap">No activity yet.</p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ActivityPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly callers = inject(CallerService);
  protected readonly items = signal<ActivityItem[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<UiError | null>(null);
  protected readonly waking = signal(0);
  protected readonly ago = (iso: string) => relativeTime(iso);

  constructor() {
    inject(PageService).set('Activity', [{ label: 'Workspace' }, { label: 'Activity' }]);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.api
      .list({ page: 1, pageSize: 100 })
      .pipe(
        retryWhileWaking((n) => this.waking.set(n)),
        switchMap((list) => {
          const recent = [...list.items].sort((a, b) => Date.parse(b.updatedAtUtc) - Date.parse(a.updatedAtUtc)).slice(0, 10);
          if (recent.length === 0) return of([] as ActivityItem[]);
          return forkJoin(
            recent.map((r) => this.api.history(r.authorizationId, 1, 20).pipe(map((h) => h.items.map((e) => ({ ...e, authorizationId: r.authorizationId }))))),
          ).pipe(map((groups) => groups.flat()));
        }),
      )
      .subscribe({
        next: (all) => {
          this.items.set(all.sort((a, b) => Date.parse(b.occurredAtUtc) - Date.parse(a.occurredAtUtc)).slice(0, 40));
          this.loaded.set(true);
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.error.set(toUiError(e));
        },
      });
  }

  protected actor(actorId: string): string {
    const me = this.callers.caller();
    if (me && actorId === me.actorId) return `${me.displayLabel} · ${me.tenantId}`;
    if (actorId === 'system:payer-simulator') return 'Simulated payer';
    if (actorId === 'system:seed') return 'Seed data';
    return 'Coordinator';
  }
}
