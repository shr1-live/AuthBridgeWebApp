import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, LocalDevUser } from '../../core/auth/auth.service';

@Component({
  selector: 'ab-login-page',
  imports: [ReactiveFormsModule],
  template: `
    <section class="card narrow">
      <h1>Sign in</h1>
      @if (reason() === 'expired') {
        <div class="panel info" role="status">Your session expired. Sign in again to continue.</div>
      }

      @if (auth.mode === 'supabase') {
        <form [formGroup]="form" (ngSubmit)="signIn()" novalidate>
          <label>
            Email
            <input type="email" formControlName="email" autocomplete="username" />
          </label>
          <label>
            Password
            <input type="password" formControlName="password" autocomplete="current-password" />
          </label>
          <button type="submit" [disabled]="form.invalid || busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        </form>
      } @else {
        <p class="muted">
          Local development sign-in. The backend issues these tokens only in its Development environment; deployed
          builds sign in through Supabase Auth.
        </p>
        @if (users().length === 0 && !error()) {
          <p class="muted">Loading demo users…</p>
        }
        <ul class="user-list">
          @for (user of users(); track user.subjectId) {
            <li>
              <button type="button" (click)="signInAs(user)" [disabled]="busy()">
                {{ user.displayLabel }}
              </button>
              <span class="meta">{{ user.tenantId }} · {{ user.role }}{{ user.isActive ? '' : ' · inactive' }}</span>
            </li>
          }
        </ul>
      }

      @if (error(); as message) {
        <div class="panel error" role="alert">{{ message }}</div>
      }
    </section>
  `,
})
export class LoginPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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
    await this.router.navigateByUrl(returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/authorizations');
  }
}
