import { TestBed } from '@angular/core/testing';
import { GuideService } from './guide.service';

describe('GuideService', () => {
  let guide: GuideService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    guide = TestBed.inject(GuideService);
  });

  it('starts open at the sign-in step', () => {
    expect(guide.open()).toBe(true);
    expect(guide.current()?.id).toBe('signIn');
    expect(guide.isCurrent('signIn')).toBe(true);
  });

  it('completing a later step also completes the earlier ones', () => {
    guide.complete('attach');
    expect(guide.isDone('signIn')).toBe(true);
    expect(guide.isDone('open')).toBe(true);
    expect(guide.current()?.id).toBe('validate');
    expect(guide.completedCount()).toBe(4);
  });

  it('only highlights while the panel is open', () => {
    guide.toggle();
    expect(guide.isCurrent('signIn')).toBe(false);
  });

  it('finishes after the decision and can restart', () => {
    guide.complete('decision');
    expect(guide.finished()).toBe(true);
    guide.restart();
    expect(guide.current()?.id).toBe('signIn');
  });

  it('remembers progress across reloads', () => {
    guide.complete('browse');
    const reloaded = TestBed.runInInjectionContext(() => new GuideService());
    expect(reloaded.isDone('browse')).toBe(true);
  });

  it('explains what the AI can and cannot do at the approval step', () => {
    const approve = guide.steps.find((s) => s.id === 'approve')!;
    expect(approve.mcp).toBeUndefined();
    expect(approve.mcpNote).toContain('never approve');
  });
});
