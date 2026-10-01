import { caseStory, nextStepShort, payerLabel, relativeTime, serviceLabel, statusLabel, versionCode } from './ui';

describe('display helpers', () => {
  it('uses sentence case for statuses, as in the design', () => {
    expect(statusLabel('AwaitingDocuments')).toBe('Awaiting documents');
    expect(statusLabel('ReadyToSubmit')).toBe('Ready to submit');
    expect(statusLabel('Draft')).toBe('Draft');
  });

  it('formats relative times compactly', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(relativeTime('2026-09-30T11:15:00Z', now)).toBe('45m ago');
    expect(relativeTime('2026-09-30T10:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-09-29T11:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-09-27T12:00:00Z', now)).toBe('3d ago');
  });

  it('derives a short, quotable version code', () => {
    expect(versionCode('AUTH-104', '1', '7f3c1a2b-0000-4000-8000-000000000000')).toBe('A104-RV1-7F3C');
  });
});

describe('plain-English case text', () => {
  it('names the synthetic codes and falls back to the code', () => {
    expect(serviceLabel('DEMO-MRI')).toBe('MRI scan');
    expect(payerLabel('DEMO-PAYER-B')).toBe('Demo Health Plan B');
    expect(serviceLabel('DEMO-NEW')).toBe('DEMO-NEW');
  });

  it('says what is left to do in a list row', () => {
    expect(nextStepShort('AwaitingDocuments', 1, 2)).toBe('1 document needed');
    expect(nextStepShort('Draft', 0, 2)).toBe('2 documents needed');
    expect(nextStepShort('ReadyToSubmit', 2, 2)).toBe('Ready to send');
    expect(nextStepShort('Approved', 2, 2)).toBe('Done');
  });

  it('explains missing and invalid paperwork', () => {
    const story = caseStory('AwaitingDocuments', { missing: ['ImagingReport'], invalid: ['ReferralLetter'] });
    expect(story.text).toContain('imaging report is not attached yet');
    expect(story.text).toContain('referral letter needs replacing');
    expect(caseStory('ReadyToSubmit', null).next).toContain('approves');
  });
});
