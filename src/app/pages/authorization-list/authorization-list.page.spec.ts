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
    memberLabel: 'SYN-2904',
    requiredDocumentCount: 2,
    validDocumentCount: 1,
    version: 'v',
    updatedAtUtc: new Date().toISOString(),
  }));
}

describe('AuthorizationListPage', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    list = vi.fn((f: { page: number; pageSize: number; status?: string }) =>
      of(f.pageSize === 100 ? { items: rows(12), page: 1, pageSize: 100, total: 12 }
        : f.status === 'Draft' ? { items: f.page === 1 ? rows(1) : [], page: f.page, pageSize: 10, total: 1 }
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

    const last = list.mock.calls.filter((c) => c[0].pageSize === 10).at(-1)![0];
    expect(last).toMatchObject({ status: 'Draft', page: 1 });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Page 1 of 1');
    expect(root.textContent).not.toContain('Page 2 of 1');
    expect(root.querySelector('.chip')?.textContent).toContain('Draft');
    const next = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Next'))!;
    expect(next.disabled).toBe(true);
  });

  it('shows document progress and KPI counts from real data', () => {
    const fixture = TestBed.createComponent(AuthorizationListPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('1 of 2');
    expect(root.querySelectorAll('.kpis button').length).toBe(4);
  });

  it('pages with the filter that produced the results, never an unapplied one', () => {
    const fixture = TestBed.createComponent(AuthorizationListPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { go(p: number): void };
    page.go(2);
    expect(list.mock.calls.filter((c) => c[0].pageSize === 10).at(-1)![0]).toMatchObject({ page: 2, status: '' });
  });
});
