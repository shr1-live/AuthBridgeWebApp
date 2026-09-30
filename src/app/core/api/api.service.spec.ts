import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: 'https://api.test', authMode: 'localDev' } },
      ],
    });
    api = TestBed.inject(ApiService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('omits blank filters and always sends paging', () => {
    api.list({ status: '', payerCode: ' DEMO-PAYER-A ', search: '', page: 2, pageSize: 10 }).subscribe();
    const req = backend.expectOne((r) => r.url === 'https://api.test/api/v1/authorizations');
    expect(req.request.params.keys().sort()).toEqual(['page', 'pageSize', 'payerCode']);
    expect(req.request.params.get('payerCode')).toBe('DEMO-PAYER-A');
    req.flush({ items: [], page: 2, pageSize: 10, total: 0 });
  });

  it('encodes identifiers in paths', () => {
    api.status('AUTH-104/../x').subscribe();
    backend.expectOne('https://api.test/api/v1/authorizations/AUTH-104%2F..%2Fx').flush({});
  });

  it('posts the expected version with writes', () => {
    api.validate('AUTH-104', 'v-1').subscribe();
    const req = backend.expectOne('https://api.test/api/v1/authorizations/AUTH-104/validate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expectedVersion: 'v-1' });
    req.flush({});
  });

  it('approves with an explicit POST, never a GET', () => {
    api.approve('p-1').subscribe();
    const req = backend.expectOne('https://api.test/api/v1/submission-proposals/p-1/approve');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('submits with the idempotency key in the body', () => {
    api.submit('p-1', 'ui-key').subscribe();
    const req = backend.expectOne('https://api.test/api/v1/submissions');
    expect(req.request.body).toEqual({ proposalId: 'p-1', idempotencyKey: 'ui-key' });
    req.flush({});
  });
});
