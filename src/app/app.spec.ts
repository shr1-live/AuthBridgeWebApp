import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { CallerService } from './shared/ui';

describe('App shell', () => {
  it('always shows the synthetic-data banner, signed in or not', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { signedIn: signal(false), label: signal(null), signOut: vi.fn() } },
        { provide: CallerService, useValue: { caller: signal(null), load: () => of(null), clear: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.banner');
    expect(banner?.textContent).toContain('Synthetic healthcare demo — simulated payer responses.');
  });
});
