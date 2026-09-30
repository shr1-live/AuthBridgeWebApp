import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { GuidePanel } from './guide/guide-panel';
import { GuideService } from './guide/guide.service';
import { Icon } from './shared/icon';
import { CallerService, PageService, StateCard, ThemeService, Toasts, initials } from './shared/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, GuidePanel, Icon, StateCard, Toasts],
  template: `
    <div class="app">
      <div class="banner" role="note"><ab-icon name="alert-triangle" [size]="14" /><span>Synthetic healthcare demo — simulated payer responses.</span></div>

      @if (!auth.signedIn()) {
        <div class="shell"><router-outlet /></div>
      } @else {
        <div class="shell">
          <div class="scrim" [class.open]="drawer()" (click)="drawer.set(false)"></div>
          <aside class="sb" [class.mini]="mini()" [class.open]="drawer()" aria-label="Main navigation">
            <div class="sb-head">
              <a routerLink="/authorizations" class="sb-brand" aria-label="AuthBridge home">
                <span class="sb-logo"><ab-icon name="logo" [size]="18" /></span>
                <span class="sb-name">AuthBridge</span>
              </a>
              <button type="button" class="btn btn-ghost btn-icon collapse-btn" style="width: 36px; height: 36px"
                      [attr.aria-label]="mini() ? 'Expand sidebar' : 'Collapse sidebar'" (click)="toggleMini()">
                <ab-icon name="sidebar" [size]="18" />
              </button>
            </div>
            @if (!callers.accessError()) {
              <nav aria-label="Main">
                <a class="nav-i" routerLink="/authorizations" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: false }" title="Requests">
                  <ab-icon name="list" [size]="18" /><span>Requests</span>
                </a>
                <a class="nav-i" routerLink="/submissions" routerLinkActive="on" title="Submissions">
                  <ab-icon name="send" [size]="18" /><span>Submissions</span>
                </a>
                <a class="nav-i" routerLink="/activity" routerLinkActive="on" title="Activity">
                  <ab-icon name="activity" [size]="18" /><span>Activity</span>
                </a>
              </nav>
            } @else {
              <div style="flex: 1"></div>
            }
            <div class="sb-foot">
              <div class="card tight" style="box-shadow: none; background: var(--surface-2)">
                <div style="display: flex; align-items: center; gap: 10px">
                  <div class="av">{{ initials(callers.caller()?.displayLabel ?? auth.label()) }}</div>
                  <div class="sb-user-detail" style="min-width: 0; flex: 1">
                    <div style="font-size: 13px; line-height: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                      {{ callers.caller()?.displayLabel || auth.label() }}
                    </div>
                    <div class="cap" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                      {{ auth.mode === 'demo' ? 'Synthetic demo' : 'Development sign-in' }}
                    </div>
                  </div>
                </div>
                @if (callers.caller(); as c) {
                  <div class="sb-badges" style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap">
                    <span class="tenant">{{ c.tenantId }}</span><span class="role">{{ c.role }}</span>
                  </div>
                }
                <button type="button" class="btn btn-ghost btn-sm signout" style="width: 100%; margin-top: 10px; justify-content: flex-start"
                        (click)="auth.signOut()" aria-label="Sign out"><ab-icon name="log-out" [size]="15" /><span>Sign out</span></button>
              </div>
            </div>
          </aside>

          <div class="main-col">
            <header class="topbar">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
                <button type="button" class="btn btn-ghost btn-icon menu-btn" aria-label="Open navigation" (click)="drawer.set(true)">
                  <ab-icon name="menu" [size]="20" />
                </button>
                <div style="min-width: 0">
                  <div class="crumb">
                    @for (c of page.crumbs(); track $index) {
                      @if ($index > 0) { <ab-icon name="chevron-right" [size]="12" /> }
                      @if (c.link) {
                        <a [routerLink]="c.link" style="color: inherit">{{ c.label }}</a>
                      } @else {
                        <span [style.color]="$last ? 'var(--text-2)' : null" [style.font-weight]="$last ? 500 : null">{{ c.label }}</span>
                      }
                    }
                  </div>
                  <h1 class="h1" [class.mono]="page.monoTitle()" style="margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ page.title() }}</h1>
                </div>
              </div>
              <div class="topbar-actions">
                @if (callers.caller() && !callers.canWrite()) {
                  <span class="pill p-neutral lg"><ab-icon name="lock" [size]="14" /><span>Read-only access</span></span>
                }
                <form class="search-box" (submit)="search($event)" role="search">
                  <label class="inp-ico" style="width: 280px">
                    <span class="sr-only">Search by request ID</span>
                    <ab-icon name="search" />
                    <input class="inp" type="search" name="q" [(ngModel)]="query" placeholder="Search request ID, e.g. AUTH-104" maxlength="40" />
                  </label>
                </form>
                <button type="button" class="btn btn-sec btn-icon" [attr.aria-label]="theme.dark() ? 'Switch to light theme' : 'Switch to dark theme'"
                        (click)="theme.toggle()"><ab-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="18" /></button>
                <button type="button" class="btn btn-sec btn-icon" [class.is-selected]="guide.open()" aria-label="Toggle guide"
                        title="Guide" (click)="guide.toggle()"><ab-icon name="help" [size]="18" /></button>
              </div>
            </header>

            <main class="content">
              @if (callers.accessError(); as e) {
                <div class="page narrow">
                  <ab-state icon="key" tone="warning" title="Access not provisioned" [text]="e.message" [correlationId]="e.correlationId">
                    <button type="button" class="btn btn-pri" (click)="auth.signOut()">Sign in as someone else</button>
                  </ab-state>
                </div>
              } @else {
                <router-outlet />
              }
            </main>
          </div>

          @if (guide.open()) {
            <ab-guide-panel />
          }
        </div>
      }
      <ab-toasts />
    </div>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly callers = inject(CallerService);
  protected readonly guide = inject(GuideService);
  protected readonly page = inject(PageService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  protected readonly initials = initials;

  protected readonly mini = signal(this.readMini());
  protected readonly drawer = signal(false);
  protected query = '';

  constructor() {
    effect(() => {
      if (this.auth.signedIn()) {
        this.callers.load().subscribe();
        this.guide.complete('signIn');
      } else {
        this.callers.clear();
      }
    });
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.drawer.set(false));
  }

  protected toggleMini(): void {
    this.mini.update((v) => !v);
    try {
      localStorage.setItem('authbridge.sidebar', this.mini() ? 'mini' : 'full');
    } catch {
      // Preference only.
    }
  }

  /** Global search: a full request ID opens it, anything else filters the request list. */
  protected search(event: Event): void {
    event.preventDefault();
    const q = this.query.trim().toUpperCase();
    if (!q) return;
    if (/^AUTH-\d+$/.test(q)) void this.router.navigate(['/authorizations', q]);
    else void this.router.navigate(['/authorizations'], { queryParams: { search: q } });
    this.query = '';
  }

  private readMini(): boolean {
    try {
      return localStorage.getItem('authbridge.sidebar') === 'mini';
    } catch {
      return false;
    }
  }
}
