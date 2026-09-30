import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG, AppConfig } from '../config';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const config: AppConfig = { apiBaseUrl: 'https://api.test', authMode: 'localDev' };

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: { accessToken: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      accessToken: vi.fn().mockResolvedValue('token-1'),
      refresh: vi.fn().mockResolvedValue(false),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: config },
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adds the bearer token to API calls', async () => {
    const result = firstValueFrom(http.get('https://api.test/api/v1/me'));
    await flushMicrotasks();
    const req = backend.expectOne('https://api.test/api/v1/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(req.request.urlWithParams).not.toContain('token');
    req.flush({});
    await result;
  });

  it('never sends the token to another origin', async () => {
    const result = firstValueFrom(http.get('https://elsewhere.test/api/v1/me'));
    const req = backend.expectOne('https://elsewhere.test/api/v1/me');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    await result;
    expect(auth.accessToken).not.toHaveBeenCalled();
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    auth.refresh.mockResolvedValue(true);
    auth.accessToken.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    const result = firstValueFrom(http.get('https://api.test/api/v1/me'));
    await flushMicrotasks();
    backend.expectOne('https://api.test/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await flushMicrotasks();
    const retry = backend.expectOne('https://api.test/api/v1/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('signs out as expired when the session cannot be renewed', async () => {
    const result = firstValueFrom(http.get('https://api.test/api/v1/me')).catch((e: unknown) => e);
    await flushMicrotasks();
    backend.expectOne('https://api.test/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await flushMicrotasks();
    await result;
    expect(auth.signOut).toHaveBeenCalledWith('expired');
  });
});
