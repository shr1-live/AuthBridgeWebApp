import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { AuthorizationSummary } from '../../core/api/models';
import { AuthorizationListPage } from './authorization-list.page';

function rows(n: number): AuthorizationSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    authorizationId: `AUTH-${100 + i}`,
    status: 'Draft',
    payerCode: 'DEMO-PAYER-A',
    serviceCode: 'DEMO-MRI',
    memberLabel: 'Synthetic Member',
    version: 'v',
    updatedAtUtc: new Date().toISOString(),
  }));
}

describe('AuthorizationListPage', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    list = vi.fn((f: { page: number; status?: string }) =>
      of(f.status === 'Draft' ? { items: f.page === 1 ? rows(1) : [], page: f.page, pageSize: 10, total: 1 }
                              : { items: rows(10), page: f.page, pageSize: 10, total: 12 }),
    );
    TestBed.configureTestingModule({
      imports: [AuthorizationListPage],
      providers: [provideRouter([]), { provide: ApiService, useValue: { list } }],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('applies a filter as soon as it changes and resets to page 1 (recorded bug)', () => {
    const fixture = TestBed.createComponent(AuthorizationListPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { filters: { patchValue(v: object): void }; go(p: number): void };

    page.filters.patchValue({ status: 'Draft' });
    vi.advanceTimersByTime(350);
    fixture.detectChanges();

    const last = list.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ status: 'Draft', page: 1 });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Showing 1–1 of 1 results');
    expect(root.textContent).not.toContain('Page 2 of 1');
    const next = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Next'))!;
    expect(next.disabled).toBe(true);
  });

  it('pages with the filter that produced the results, never an unapplied one', () => {
    const fixture = TestBed.createComponent(AuthorizationListPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { go(p: number): void };
    page.go(2);
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ page: 2, status: '' });
  });
});
