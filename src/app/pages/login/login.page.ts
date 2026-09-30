import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, LocalDevUser } from '../../core/auth/auth.service';
import { initials } from '../../shared/ui';

@Component({
  selector: 'ab-login-page',
  imports: [ReactiveFormsModule],
  template: `
    <div class="center-page">
      <section class="card dialog login">
        <div class="dialog-head">
          <span class="brand-mark"><img src="icons/logo-shield.svg" width="16" height="16" alt="" /></span>
          <div>
            <h1>Sign in to AuthBridge</h1>
            <p class="muted">Prior authorizations, approved by humans</p>
          </div>
        </div>

        @if (reason() === 'expired') {
          <div class="panel info" role="status"><img src="icons/info-16.svg" width="16" height="16" alt="" /><p>Your session expired. Sign in again to continue.</p></div>
        }

        @if (auth.mode === 'supabase') {
          <form class="stack" style="gap: 16px" [formGroup]="form" (ngSubmit)="signIn()" novalidate>
            <label class="field">Email<input type="email" formControlName="email" autocomplete="username" /></label>
            <label class="field">Password<input type="password" formControlName="password" autocomplete="current-password" /></label>
            <button type="submit" [disabled]="form.invalid || busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
          </form>
        } @else {
          <p class="muted">
            Development sign-in: choose a demo user. The backend issues these tokens only in Development; deployed builds sign in through Supabase Auth.
          </p>
          @if (users().length === 0 && !error()) {
            <p class="muted">Loading demo users…</p>
          }
          <div class="user-grid">
            @for (user of users(); track user.subjectId) {
              <button type="button" class="user-option" [class.inactive]="!user.isActive" (click)="signInAs(user)" [disabled]="busy()">
                <span class="avatar">{{ initials(user.displayLabel) }}</span>
                <span>
                  <span>{{ user.displayLabel }}</span>
                  <span class="meta">
                    <span class="pill tone-neutral">{{ user.tenantId }}</span>
                    <span class="pill" [class.tone-teal]="user.role === 'Coordinator'" [class.tone-info]="user.role !== 'Coordinator'">{{ user.role }}</span>
                    @if (!user.isActive) { <span class="pill tone-danger">inactive</span> }
                  </span>
                </span>
              </button>
            }
          </div>
        }

        @if (error(); as message) {
          <div class="panel error" role="alert"><img src="icons/alert-circle.svg" width="16" height="16" alt="" /><p>{{ message }}</p></div>
        }
      </section>
    </div>
  `,
})
export class LoginPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly initials = initials;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly users = signal<LocalDevUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reason = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.reason.set(this.route.snapshot.queryParamMap.get('reason'));
    if (this.auth.mode === 'localDev') {
      try {
        this.users.set(await this.auth.localDevUsers());
      } catch {
        this.error.set('The backend is not reachable. Start it with: dotnet run --project src/AuthBridge.Api');
      }
    }
  }

  protected async signIn(): Promise<void> {
    if (this.form.invalid) return;
    await this.run(() => this.auth.signInWithPassword(this.form.controls.email.value, this.form.controls.password.value));
  }

  protected signInAs(user: LocalDevUser): Promise<void> {
    return this.run(() => this.auth.signInLocalDev(user));
  }

  private async run(action: () => Promise<string | null>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const failure = await action();
    this.busy.set(false);
    if (failure) {
      this.error.set(failure);
      return;
    }
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    await this.router.navigateByUrl(returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/dashboard');
  }
}
