import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { CallerService } from './shared/ui';

function render(signedIn: boolean, options: { accessError?: unknown; canWrite?: boolean } = {}) {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { signedIn: signal(signedIn), label: signal('Demo User'), mode: 'localDev', signOut: vi.fn() } },
      {
        provide: CallerService,
        useValue: {
          caller: signal(signedIn ? { displayLabel: 'Demo Viewer', tenantId: 'TENANT-A', role: 'Viewer', canWrite: false, actorId: 'x' } : null),
          canWrite: signal(options.canWrite ?? false),
          accessError: signal(options.accessError ?? null),
          load: () => of(null),
          clear: vi.fn(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('App shell', () => {
  beforeEach(() => localStorage.clear());

  it('always shows the synthetic-data banner, signed in or not', () => {
    const root = render(false);
    expect(root.querySelector('.banner')?.textContent).toContain('Synthetic healthcare demo — simulated payer responses.');
    expect(root.querySelector('.sb')).toBeNull();
  });

  it('shows Requests, Submissions and Activity with the tenant chip when signed in', () => {
    const root = render(true);
    const nav = root.querySelector('nav')?.textContent ?? '';
    expect(nav).toContain('Requests');
    expect(nav).toContain('Submissions');
    expect(nav).toContain('Activity');
    expect(root.querySelector('.tenant')?.textContent).toContain('TENANT-A');
  });

  it('marks viewers as read-only in the top bar', () => {
    const root = render(true, { canWrite: false });
    expect(root.querySelector('.topbar')?.textContent).toContain('Read-only access');
  });

  it('shows only the access-not-provisioned state for a signed-in user without access', () => {
    const root = render(true, { accessError: { kind: 'denied', code: 'ACCESS_NOT_PROVISIONED', message: 'No access mapping.' } });
    expect(root.textContent).toContain('Access not provisioned');
    expect(root.querySelector('router-outlet')).toBeNull();
    expect(root.querySelector('nav')).toBeNull();
  });
});
