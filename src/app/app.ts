import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { CallerService } from './shared/ui';
import { GuidePanel } from './guide/guide-panel';
import { GuideService } from './guide/guide.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, GuidePanel],
  template: `
    <div class="banner" role="note">Synthetic healthcare demo — simulated payer responses.</div>
    <header class="topbar">
      <a routerLink="/authorizations" class="brand">AuthBridge</a>
      @if (auth.signedIn()) {
        <span class="who">
          @if (callers.caller(); as c) {
            {{ c.displayLabel || auth.label() }} · {{ c.tenantId }} · {{ c.role }}
          } @else {
            {{ auth.label() }}
          }
        </span>
        <button type="button" class="secondary" (click)="auth.signOut()">Sign out</button>
      }
    </header>
    <div class="layout" [class.with-guide]="guide.open()">
      <main>
        <router-outlet />
      </main>
      <ab-guide-panel />
    </div>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly callers = inject(CallerService);
  protected readonly guide = inject(GuideService);

  constructor() {
    effect(() => {
      if (this.auth.signedIn()) {
        this.callers.load().subscribe();
        this.guide.complete('signIn');
      }
      else this.callers.clear();
    });
  }
}
