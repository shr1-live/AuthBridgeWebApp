import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, LocalDevUser } from '../../core/auth/auth.service';
import { Icon } from '../../shared/icon';
import { initials } from '../../shared/ui';

@Component({
  selector: 'ab-login-page',
  imports: [ReactiveFormsModule, Icon],
  template: `
    <div class="login">
      <section class="brand-panel" aria-label="About AuthBridge">
        <div style="display: flex; align-items: center; gap: 10px">
          <span class="brand-mark"><ab-icon name="logo" [size]="18" /></span>
          <span style="font-size: 17px; font-weight: 600">AuthBridge</span>
        </div>
        <div>
          <p class="up" style="color: rgba(255,255,255,.72)">Prior-authorization workspace</p>
          <h1 style="font-size: 36px; line-height: 44px; font-weight: 600; letter-spacing: -.02em; margin: 12px 0 16px">Prior authorizations,<br />reviewed by humans.</h1>
          <p style="font-size: 15px; line-height: 24px; color: rgba(255,255,255,.85); max-width: 420px; margin: 0">
            Assemble a request, validate its documents, and send it to the payer. An assistant can prepare the submission — only a coordinator can approve it.
          </p>
          <div class="brand-feature"><span class="ic"><ab-icon name="shield-check" [size]="16" /></span>
            <div><b>Human approval is required</b><div style="font-size: 13px; opacity: .8">Every submission waits for an explicit click.</div></div></div>
          <div class="brand-feature"><span class="ic"><ab-icon name="clipboard" [size]="16" /></span>
            <div><b>Document rules, versioned</b><div style="font-size: 13px; opacity: .8">Checklists are pinned to the rule version in force.</div></div></div>
          <div class="brand-feature"><span class="ic"><ab-icon name="activity" [size]="16" /></span>
            <div><b>A full trail</b><div style="font-size: 13px; opacity: .8">Who changed what, when, and why.</div></div></div>
        </div>
        <p style="font-size: 12px; opacity: .75; margin: 0">Synthetic demo environment. No real patient, payer or clinical data is stored or transmitted.</p>
      </section>

      <div class="login-side">
        <div class="login-col">
          @if (reason() === 'expired') {
            <div class="alert a-info" role="status">
              <ab-icon name="clock" [size]="18" />
              <div><p class="at">Your session expired</p><p class="ad">Sign in again to pick up where you left off. Nothing you had prepared was lost.</p></div>
            </div>
          }

          @if (auth.mode === 'supabase') {
            <section class="card">
              <h2 class="h2">Sign in</h2>
              <p class="cap" style="margin-top: 2px">Use your coordinator account.</p>
              <form [formGroup]="form" (ngSubmit)="signIn()" novalidate style="display: flex; flex-direction: column; gap: 18px; margin-top: 20px">
                <div class="field"><label class="lbl" for="email">Work email</label>
                  <input class="inp" id="email" type="email" formControlName="email" autocomplete="username" /></div>
                <div class="field"><label class="lbl" for="password">Password</label>
                  <input class="inp" id="password" type="password" formControlName="password" autocomplete="current-password" [class.is-err]="!!error()" />
                  @if (error(); as message) { <p class="err-txt"><ab-icon name="alert-circle" [size]="14" />{{ message }}</p> }
                </div>
                <button type="submit" class="btn btn-pri btn-block" [disabled]="form.invalid || busy()">
                  @if (busy()) { <span class="spin"></span><span>Signing in…</span> } @else { <span>Sign in</span> }
                </button>
              </form>
            </section>
          } @else {
            <section class="card">
              <h2 class="h3">Development sign-in</h2>
              <p class="cap" style="margin-top: 2px">Pick a seeded user. Passwords are not checked.</p>
              @if (users().length === 0 && !error()) {
                <div class="dev-grid" style="margin-top: 16px">
                  @for (i of [1, 2, 3, 4]; track i) { <div class="card tight"><div class="sk" style="height: 36px; width: 60%"></div><div class="sk" style="height: 12px; width: 80%; margin-top: 12px"></div></div> }
                </div>
              }
              <div class="dev-grid" style="margin-top: 16px">
                @for (user of users(); track user.subjectId) {
                  <button type="button" class="card clickable dev-user" (click)="signInAs(user)" [disabled]="busy() || !user.isActive"
                          [attr.aria-label]="'Sign in as ' + user.displayLabel">
                    <span class="who">
                      <span class="av">{{ initials(user.displayLabel) }}</span>
                      <span><span class="body" style="font-weight: 600; display: block">{{ shortName(user.displayLabel) }}</span>
                        <span class="cap">{{ user.isActive ? 'Sign in as this user' : 'Cannot sign in' }}</span></span>
                    </span>
                    <span class="badges">
                      <span class="tenant">{{ user.tenantId }}</span><span class="role">{{ user.role }}</span>
                      @if (!user.isActive) { <span class="pill p-danger"><ab-icon name="slash" [size]="12" /><span>inactive</span></span> }
                    </span>
                  </button>
                }
              </div>
              @if (error(); as message) {
                <div class="alert a-danger" role="alert" style="margin-top: 16px"><ab-icon name="alert-circle" [size]="18" /><div><p class="at">Can't sign in</p><p class="ad">{{ message }}</p></div></div>
              }
              <p class="cap" style="margin-top: 16px">Development sign-in is disabled in any environment that is not a demo. Deployed builds sign in through Supabase Auth.</p>
            </section>
          }
        </div>
      </div>
    </div>
  `,
})
export class LoginPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly initials = initials;
  /** The tenant chip already shows the tenant, so drop a trailing "(Tenant A)". */
  protected readonly shortName = (label: string) => label.replace(/\s*\(.*\)\s*$/, '');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly users = signal<LocalDevUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reason = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    document.title = 'Sign in · AuthBridge';
    this.reason.set(this.route.snapshot.queryParamMap.get('reason'));
    if (this.auth.mode === 'localDev') {
      try {
        const rank = (u: LocalDevUser) => (u.isActive ? 0 : 2) + (u.role === 'Coordinator' ? 0 : 1);
        const users = await this.auth.localDevUsers();
        this.users.set(users.sort((a, b) => rank(a) - rank(b) || a.tenantId.localeCompare(b.tenantId) || a.displayLabel.localeCompare(b.displayLabel)));
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
