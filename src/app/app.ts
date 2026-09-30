import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { GuidePanel } from './guide/guide-panel';
import { GuideService } from './guide/guide.service';
import { CallerService, initials } from './shared/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, GuidePanel],
  template: `
    <div class="banner" role="note">Synthetic healthcare demo — simulated payer responses.</div>
    <div class="shell">
      @if (auth.signedIn()) {
        <aside class="sidebar" aria-label="Main navigation">
          <div class="sidebar-top">
            <a routerLink="/dashboard" class="brand">
              <span class="brand-mark"><img src="icons/logo-shield.svg" width="16" height="16" alt="" /></span>
              <span>AuthBridge</span>
            </a>
            @if (!callers.accessError()) {
              <nav class="nav">
                <a routerLink="/dashboard" routerLinkActive="active">
                  <img class="icon-idle" src="icons/home.svg" width="18" height="18" alt="" />
                  <img class="icon-active" src="icons/home-active.svg" width="18" height="18" alt="" />
                  <span>Dashboard</span>
                </a>
                <a routerLink="/authorizations" routerLinkActive="active">
                  <img class="icon-idle" src="icons/list.svg" width="18" height="18" alt="" />
                  <img class="icon-active" src="icons/list-active.svg" width="18" height="18" alt="" />
                  <span>Request Queue</span>
                </a>
              </nav>
            }
          </div>
          <div class="user-card">
            <span class="avatar">{{ initials(callers.caller()?.displayLabel ?? auth.label()) }}</span>
            <div class="who">
              <div class="name">{{ callers.caller()?.displayLabel || auth.label() }}</div>
              @if (callers.caller(); as c) {
                <div class="role">{{ c.role }} · {{ c.tenantId }}</div>
              }
            </div>
            <button type="button" (click)="auth.signOut()">Sign out</button>
          </div>
        </aside>
      }

      <main class="main">
        @if (auth.signedIn() && callers.accessError(); as e) {
          <!-- Signed in, but the server refused access: show only this, not a page behind it. -->
          <section class="card state-card" role="alert">
            <span class="dialog-icon"><img src="icons/alert-circle.svg" width="24" height="24" alt="" /></span>
            <h1>No AuthBridge access</h1>
            <p class="muted">{{ e.message }}</p>
            <p class="subtle">Code {{ e.code }}@if (e.correlationId) { · correlation {{ e.correlationId }} }</p>
            <button type="button" (click)="auth.signOut()">Sign in as someone else</button>
          </section>
        } @else {
          <router-outlet />
        }
      </main>

      @if (auth.signedIn() || guide.open()) {
        <ab-guide-panel />
      }
    </div>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly callers = inject(CallerService);
  protected readonly guide = inject(GuideService);
  protected readonly initials = initials;

  constructor() {
    effect(() => {
      if (this.auth.signedIn()) {
        this.callers.load().subscribe();
        this.guide.complete('signIn');
      } else {
        this.callers.clear();
      }
    });
  }
}
