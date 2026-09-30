import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { Proposal } from '../../core/api/models';
import { CallerService } from '../../shared/ui';
import { ProposalReviewPage } from './proposal-review.page';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  const now = Date.now();
  return {
    proposalId: 'p-1',
    authorizationId: 'AUTH-105',
    requestStatus: 'ReadyToSubmit',
    payerCode: 'DEMO-PAYER-A',
    serviceCode: 'DEMO-CT',
    ruleVersion: '1',
    memberLabel: 'SYN-6612',
    simulatedAction: 'Send a simulated prior-authorization submission. No real payer is contacted.',
    summary: 'Submit AUTH-105',
    expectedRequestVersion: 'v',
    state: 'PendingApproval',
    actorId: 'me',
    isOwnedByCaller: true,
    createdAtUtc: new Date(now).toISOString(),
    expiresAtUtc: new Date(now + 5 * 60_000).toISOString(),
    approvedAtUtc: null,
    consumedAtUtc: null,
    reviewUrl: '',
    ...overrides,
  };
}

describe('ProposalReviewPage', () => {
  let api: { proposal: ReturnType<typeof vi.fn>; approve: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> };

  async function render(p: Proposal, canWrite = true) {
    api.proposal.mockReturnValue(of(p));
    TestBed.configureTestingModule({
      imports: [ProposalReviewPage],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ApiService, useValue: api },
        { provide: CallerService, useValue: { canWrite: signal(canWrite), caller: signal({ displayLabel: 'Demo Coordinator', role: 'Coordinator', tenantId: 'TENANT-A' }) } },
      ],
    });
    const fixture = TestBed.createComponent(ProposalReviewPage);
    fixture.componentRef.setInput('id', p.proposalId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    sessionStorage.clear();
    api = { proposal: vi.fn(), approve: vi.fn(), submit: vi.fn() };
  });

  it('shows the synthetic review details and does not approve on load', async () => {
    const fixture = await render(proposal());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('AUTH-105');
    expect(text).toContain('No real payer is contacted');
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('keeps Approve disabled until the confirmation is ticked, then approves on click', async () => {
    api.approve.mockReturnValue(of(proposal({ state: 'Approved', approvedAtUtc: new Date().toISOString() })));
    const fixture = await render(proposal());
    const root = fixture.nativeElement as HTMLElement;
    const approve = root.querySelector<HTMLButtonElement>('form button[type=submit]')!;
    const boxes = root.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes.length).toBe(1);
    expect(boxes[0].checked).toBe(false);
    expect(approve.disabled).toBe(true);

    boxes[0].click();
    fixture.detectChanges();
    expect(approve.disabled).toBe(false);
    approve.click();
    fixture.detectChanges();
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('Nothing has been sent yet');
    expect(root.textContent).toContain('Submit to simulated payer');
  });

  it('offers no approval to someone who did not prepare it', async () => {
    const fixture = await render(proposal({ isOwnedByCaller: false }));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('input[type=checkbox]')).toBeNull();
    expect(root.textContent).toContain('Not yours to approve');
  });

  it('shows an expired proposal as expired even if the server said pending', async () => {
    const fixture = await render(proposal({ expiresAtUtc: new Date(Date.now() - 1000).toISOString() }));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('5-minute window');
    expect(root.querySelector('input[type=checkbox]')).toBeNull();
  });

  it('reuses one idempotency key for repeated submit clicks', async () => {
    api.submit.mockReturnValue(of({ attemptId: 'a-1' }));
    const fixture = await render(proposal({ state: 'Approved', approvedAtUtc: new Date().toISOString() }));
    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Submit to simulated payer'))!;
    expect(button).toBeTruthy();
    button.click();
    const firstKey = api.submit.mock.calls[0][1];
    fixture.componentInstance['busy'].set(false);
    button.click();
    expect(api.submit.mock.calls[1][1]).toBe(firstKey);
    expect(firstKey).toMatch(/^ui-/);
  });
});
