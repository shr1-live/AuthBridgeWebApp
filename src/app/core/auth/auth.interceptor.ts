import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config';
import { AuthService } from './auth.service';

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

/**
 * Attaches the bearer token to AuthBridge API calls only, never to other origins, and
 * never in a query string. On a 401 it refreshes once and retries; if that fails the user
 * is signed out and sent to the login page with an explanation.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(APP_CONFIG);
  const auth = inject(AuthService);
  if (!req.url.startsWith(`${config.apiBaseUrl}/api/`)) return next(req);

  return from(auth.accessToken()).pipe(
    switchMap((token) => next(withToken(req, token))),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
      return from(auth.refresh()).pipe(
        switchMap((renewed) => {
          if (!renewed) {
            void auth.signOut('expired');
            return throwError(() => error);
          }
          return from(auth.accessToken()).pipe(switchMap((token) => next(withToken(req, token))));
        }),
      );
    }),
  );
};
