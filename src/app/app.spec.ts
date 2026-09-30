import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { CallerService } from './shared/ui';

function render(signedIn: boolean, accessError: unknown = null) {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { signedIn: signal(signedIn), label: signal('Demo User'), signOut: vi.fn() } },
      {
        provide: CallerService,
        useValue: { caller: signal(null), accessError: signal(accessError), load: () => of(null), clear: vi.fn() },
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
    expect(root.querySelector('.sidebar')).toBeNull();
  });

  it('shows the sidebar navigation when signed in', () => {
    const root = render(true);
    expect(root.querySelector('.sidebar')?.textContent).toContain('Request Queue');
    expect(root.querySelector('router-outlet')).not.toBeNull();
  });

  it('shows only a no-access state for a signed-in user without access', () => {
    const root = render(true, { kind: 'denied', code: 'ACCESS_NOT_PROVISIONED', message: 'No access mapping.' });
    expect(root.textContent).toContain('No AuthBridge access');
    expect(root.querySelector('router-outlet')).toBeNull();
    expect(root.querySelector('.nav')).toBeNull();
  });
});
