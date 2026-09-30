import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toUiError } from './api-error';

function problem(status: number, code: string, detail = 'detail') {
  return new HttpErrorResponse({
    status,
    error: { code, detail, correlationId: 'corr-12345678' },
    headers: new HttpHeaders(),
  });
}

describe('toUiError', () => {
  it.each([0, 502, 503, 504])('treats status %i as a waking backend that can be retried', (status) => {
    const e = toUiError(new HttpErrorResponse({ status }));
    expect(e.kind).toBe('waking');
    expect(e.retryable).toBe(true);
  });

  it('keeps the server code and correlation id', () => {
    const e = toUiError(problem(409, 'VERSION_CONFLICT', 'changed'));
    expect(e).toMatchObject({ kind: 'conflict', code: 'VERSION_CONFLICT', message: 'changed', correlationId: 'corr-12345678' });
  });

  it('distinguishes an expired proposal from other conflicts', () => {
    expect(toUiError(problem(409, 'PROPOSAL_EXPIRED')).kind).toBe('expired');
  });

  it('explains a signed-in user without an access mapping', () => {
    const e = toUiError(problem(403, 'ACCESS_NOT_PROVISIONED'));
    expect(e.kind).toBe('denied');
    expect(e.message).toContain('no AuthBridge access');
  });

  it.each([
    [400, 'invalid'],
    [401, 'unauthenticated'],
    [404, 'notFound'],
    [422, 'incomplete'],
    [500, 'server'],
  ] as const)('maps %i to %s', (status, kind) => {
    expect(toUiError(problem(status, 'X')).kind).toBe(kind);
  });

  it('never surfaces raw server text for a 500', () => {
    const e = toUiError(problem(500, 'INTERNAL_ERROR', 'SqlException: secret stack'));
    expect(e.message).not.toContain('SqlException');
  });
});
