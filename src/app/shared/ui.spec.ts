import { relativeTime, statusLabel, versionCode } from './ui';

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
