import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config';
import {
  AuthorizationStatusDetail,
  AuthorizationSummary,
  Caller,
  DocumentAttachment,
  DocumentFixture,
  HistoryEntry,
  ListFilter,
  MissingDocuments,
  PagedResult,
  Proposal,
  Submission,
  ValidationResult,
} from './models';

/** Typed client for the AuthBridge API. All domain data goes through the backend. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_CONFIG).apiBaseUrl}/api/v1`;

  me(): Observable<Caller> {
    return this.http.get<Caller>(`${this.base}/me`);
  }

  list(filter: ListFilter): Observable<PagedResult<AuthorizationSummary>> {
    let params = new HttpParams().set('page', filter.page).set('pageSize', filter.pageSize);
    for (const key of ['status', 'payerCode', 'serviceCode', 'search'] as const) {
      const value = filter[key]?.trim();
      if (value) params = params.set(key, value);
    }
    return this.http.get<PagedResult<AuthorizationSummary>>(`${this.base}/authorizations`, { params });
  }

  status(id: string): Observable<AuthorizationStatusDetail> {
    return this.http.get<AuthorizationStatusDetail>(`${this.base}/authorizations/${encodeURIComponent(id)}`);
  }

  missingDocuments(id: string): Observable<MissingDocuments> {
    return this.http.get<MissingDocuments>(`${this.base}/authorizations/${encodeURIComponent(id)}/missing-documents`);
  }

  history(id: string, page = 1, pageSize = 50): Observable<PagedResult<HistoryEntry>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<PagedResult<HistoryEntry>>(`${this.base}/authorizations/${encodeURIComponent(id)}/history`, { params });
  }

  fixtures(): Observable<DocumentFixture[]> {
    return this.http.get<DocumentFixture[]>(`${this.base}/document-fixtures`);
  }

  attachFixture(id: string, documentType: string, fixtureKey: string, expectedVersion: string): Observable<DocumentAttachment> {
    return this.http.post<DocumentAttachment>(`${this.base}/authorizations/${encodeURIComponent(id)}/documents`, {
      documentType,
      fixtureKey,
      expectedVersion,
    });
  }

  validate(id: string, expectedVersion: string): Observable<ValidationResult> {
    return this.http.post<ValidationResult>(`${this.base}/authorizations/${encodeURIComponent(id)}/validate`, { expectedVersion });
  }

  prepare(id: string, expectedVersion: string): Observable<Proposal> {
    return this.http.post<Proposal>(`${this.base}/authorizations/${encodeURIComponent(id)}/submission-proposals`, {
      expectedVersion,
    });
  }

  proposal(proposalId: string): Observable<Proposal> {
    return this.http.get<Proposal>(`${this.base}/submission-proposals/${encodeURIComponent(proposalId)}`);
  }

  /** The human approval boundary. Called only from an explicit click on the review page. */
  approve(proposalId: string): Observable<Proposal> {
    return this.http.post<Proposal>(`${this.base}/submission-proposals/${encodeURIComponent(proposalId)}/approve`, null);
  }

  submit(proposalId: string, idempotencyKey: string): Observable<Submission> {
    return this.http.post<Submission>(`${this.base}/submissions`, { proposalId, idempotencyKey });
  }

  submission(attemptId: string): Observable<Submission> {
    return this.http.get<Submission>(`${this.base}/submissions/${encodeURIComponent(attemptId)}`);
  }
}
