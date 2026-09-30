import { HttpErrorResponse } from '@angular/common/http';

export type UiErrorKind =
  | 'waking' // backend unreachable or cold-starting (Render free instances spin down)
  | 'unauthenticated'
  | 'denied'
  | 'notFound'
  | 'conflict'
  | 'expired'
  | 'incomplete'
  | 'invalid'
  | 'server';

export interface UiError {
  kind: UiErrorKind;
  code: string;
  message: string;
  correlationId?: string;
  retryable: boolean;
}

const EXPIRED_CODES = new Set(['PROPOSAL_EXPIRED']);

/** Turns any HTTP failure into something the UI can explain and, where sensible, retry. */
export function toUiError(error: unknown): UiError {
  if (!(error instanceof HttpErrorResponse)) {
    return { kind: 'server', code: 'CLIENT_ERROR', message: 'Something went wrong in the browser.', retryable: true };
  }

  const body = (error.error ?? {}) as { code?: string; detail?: string; correlationId?: string };
  const code = body.code ?? `HTTP_${error.status}`;
  const correlationId = body.correlationId ?? error.headers?.get('X-Correlation-Id') ?? undefined;
  const detail = body.detail;

  if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) {
    return {
      kind: 'waking',
      code: 'BACKEND_UNAVAILABLE',
      message:
        'The backend is not responding. On free hosting it sleeps when idle and can take up to a minute to wake.',
      retryable: true,
    };
  }
  if (error.status === 401) {
    return { kind: 'unauthenticated', code, message: 'Your session has ended. Sign in again.', correlationId, retryable: false };
  }
  if (error.status === 403) {
    return {
      kind: 'denied',
      code,
      message:
        code === 'ACCESS_NOT_PROVISIONED'
          ? 'Your account is signed in but has no AuthBridge access. Ask an administrator to grant it.'
          : detail ?? 'Your role does not allow this action.',
      correlationId,
      retryable: false,
    };
  }
  if (error.status === 404) {
    return { kind: 'notFound', code, message: detail ?? 'Not found, or not in your tenant.', correlationId, retryable: false };
  }
  if (error.status === 409) {
    return {
      kind: EXPIRED_CODES.has(code) ? 'expired' : 'conflict',
      code,
      message: detail ?? 'The record changed. Reload and try again.',
      correlationId,
      retryable: false,
    };
  }
  if (error.status === 422) {
    return { kind: 'incomplete', code, message: detail ?? 'Required information is missing.', correlationId, retryable: false };
  }
  if (error.status === 400) {
    return { kind: 'invalid', code, message: detail ?? 'The request was invalid.', correlationId, retryable: false };
  }
  return {
    kind: 'server',
    code,
    message: 'The server hit an unexpected error.',
    correlationId,
    retryable: true,
  };
}
