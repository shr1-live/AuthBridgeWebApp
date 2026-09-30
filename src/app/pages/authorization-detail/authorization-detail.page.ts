import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of, catchError, map } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AuthorizationStatusDetail, DocumentFixture, HistoryEntry, MissingDocuments } from '../../core/api/models';
import { CallerService, ErrorPanel, StatusBadge, WakingNotice, retryWhileWaking } from '../../shared/ui';

const PRE_SUBMISSION = ['Draft', 'AwaitingDocuments', 'ReadyToSubmit'];

@Component({
  selector: 'ab-authorization-detail-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StatusBadge, ErrorPanel, WakingNotice],
  template: `
    <p><a routerLink="/authorizations">← All requests</a></p>
    <ab-waking [attempt]="waking()" />
    <ab-error [error]="loadError()" (retry)="load()" />

    @if (detail(); as d) {
      <header class="title-row">
        <h1>{{ d.authorizationId }}</h1>
        <ab-status [status]="d.status" />
      </header>

      <section class="card">
        <dl class="facts">
          <dt>Member</dt><dd>{{ d.memberLabel }} (synthetic)</dd>
          <dt>Payer</dt><dd>{{ d.payerCode }} (simulated)</dd>
          <dt>Service</dt><dd>{{ d.serviceCode }}</dd>
          <dt>Rule</dt>
          <dd>
            version {{ d.rule.ruleVersion }}
            @if (!d.rule.isActive) { <span class="warn">· inactive</span> }
          </dd>
          <dt>Version</dt><dd><code>{{ d.version }}</code></dd>
          <dt>Updated</dt><dd>{{ d.updatedAtUtc | date: 'medium' }}</dd>
        </dl>
        @if (d.submissionAttemptId) {
          <p><a [routerLink]="['/submissions', d.submissionAttemptId]">View submission progress →</a></p>
        }
      </section>

      <section class="card">
        <h2>Documents</h2>
        @if (missingError(); as e) {
          <ab-error [error]="e" />
        }
        @if (missing(); as m) {
          <ul class="checklist">
            @for (type of m.required; track type) {
              <li [attr.data-state]="m.present.includes(type) ? 'present' : m.invalid.includes(type) ? 'invalid' : 'missing'">
                {{ type }} —
                {{ m.present.includes(type) ? 'present' : m.invalid.includes(type) ? 'attached but invalid' : 'missing' }}
              </li>
            }
          </ul>
        }
        <table class="grid compact">
          <thead><tr><th>Type</th><th>Fixture</th><th>Valid</th><th>Attached</th></tr></thead>
          <tbody>
            @for (doc of d.documents; track doc.documentType) {
              <tr>
                <td>{{ doc.documentType }}</td>
                <td><code>{{ doc.fixtureKey }}</code></td>
                <td>{{ doc.isValid ? 'yes' : 'no' }}</td>
                <td>{{ doc.createdAtUtc | date: 'short' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="muted">No documents attached.</td></tr>
            }
          </tbody>
        </table>
        <p class="muted">Fixtures are allowlisted synthetic metadata records, not uploaded files.</p>

        @if (canEdit()) {
          <form class="inline-form" [formGroup]="attachForm" (ngSubmit)="attach()" novalidate>
            <label>
              Document type
              <select formControlName="documentType">
                <option value="" disabled>Choose…</option>
                @for (type of documentTypes(); track type) {
                  <option [value]="type">{{ type }}</option>
                }
              </select>
            </label>
            <label>
              Fixture
              <select formControlName="fixtureKey">
                <option value="" disabled>Choose…</option>
                @for (f of fixturesForType(); track f.key) {
                  <option [value]="f.key">{{ f.key }} — {{ f.isValid ? 'valid' : 'invalid' }}</option>
                }
              </select>
            </label>
            <button type="submit" [disabled]="attachForm.invalid || busy()">Attach fixture</button>
          </form>
        }
      </section>

      @if (canWrite()) {
        <section class="card">
          <h2>Actions</h2>
          <ab-error [error]="actionError()" />
          @if (notice(); as n) {
            <div class="panel info" role="status">{{ n }}</div>
          }
          <div class="actions">
            <button type="button" (click)="validate()" [disabled]="busy() || !isPreSubmission()">Validate</button>
            <button type="button" (click)="prepare()" [disabled]="busy() || d.status !== 'ReadyToSubmit'">
              Prepare submission for review
            </button>
          </div>
          @if (!isPreSubmission()) {
            <p class="muted">This request has been submitted; documents and validation are locked.</p>
          }
        </section>
      } @else {
        <p class="muted">You have read-only access. Coordinators in your tenant can change this request.</p>
      }

      <section class="card">
        <h2>Timeline</h2>
        <ol class="timeline">
          @for (h of history(); track h.id) {
            <li>
              <time>{{ h.occurredAtUtc | date: 'medium' }}</time>
              <span>
                @if (h.previousStatus) { {{ h.previousStatus }} → }
                <strong>{{ h.newStatus }}</strong>
              </span>
              <span class="muted">{{ h.reason }} · {{ h.actorId }}</span>
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class AuthorizationDetailPage implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly callers = inject(CallerService);

  protected readonly detail = signal<AuthorizationStatusDetail | null>(null);
  protected readonly missing = signal<MissingDocuments | null>(null);
  protected readonly missingError = signal<UiError | null>(null);
  protected readonly history = signal<HistoryEntry[]>([]);
  protected readonly fixtures = signal<DocumentFixture[]>([]);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly actionError = signal<UiError | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly waking = signal(0);

  protected readonly canWrite = this.callers.canWrite;
  protected readonly isPreSubmission = computed(() => PRE_SUBMISSION.includes(this.detail()?.status ?? ''));
  protected readonly canEdit = computed(() => this.canWrite() && this.isPreSubmission());

  protected readonly attachForm = inject(FormBuilder).nonNullable.group({
    documentType: ['', Validators.required],
    fixtureKey: ['', Validators.required],
  });
  private readonly selectedType = toSignal(this.attachForm.controls.documentType.valueChanges, { initialValue: '' });
  protected readonly documentTypes = computed(() => [...new Set(this.fixtures().map((f) => f.documentType))]);
  protected readonly fixturesForType = computed(() => this.fixtures().filter((f) => f.documentType === this.selectedType()));

  constructor() {
    this.attachForm.controls.documentType.valueChanges.subscribe(() =>
      this.attachForm.controls.fixtureKey.setValue('', { emitEvent: false }),
    );
  }

  ngOnInit(): void {
    this.load();
    this.api.fixtures().subscribe({ next: (f) => this.fixtures.set(f), error: () => this.fixtures.set([]) });
  }

  load(): void {
    this.loadError.set(null);
    const id = this.id();
    forkJoin({
      detail: this.api.status(id),
      history: this.api.history(id).pipe(map((h) => h.items)),
      missing: this.api.missingDocuments(id).pipe(
        map((m) => ({ ok: m, error: null as UiError | null })),
        catchError((e: unknown) => of({ ok: null, error: toUiError(e) })),
      ),
    })
      .pipe(retryWhileWaking((n) => this.waking.set(n)))
      .subscribe({
        next: ({ detail, history, missing }) => {
          this.detail.set(detail);
          this.history.set(history);
          this.missing.set(missing.ok);
          this.missingError.set(missing.error);
        },
        error: (e: unknown) => {
          this.waking.set(0);
          this.loadError.set(toUiError(e));
        },
      });
  }

  protected attach(): void {
    const d = this.detail();
    if (!d || this.attachForm.invalid) return;
    const { documentType, fixtureKey } = this.attachForm.getRawValue();
    this.act(this.api.attachFixture(d.authorizationId, documentType, fixtureKey, d.version), (r) => {
      this.attachForm.reset();
      return `${r.replaced ? 'Replaced' : 'Attached'} ${r.documentType} (${r.isValid ? 'valid' : 'invalid'}). Status: ${r.status}.`;
    });
  }

  protected validate(): void {
    const d = this.detail();
    if (!d) return;
    this.act(this.api.validate(d.authorizationId, d.version), (r) =>
      r.statusChanged
        ? `Validated: ${r.previousStatus} → ${r.status}.`
        : `Validated: still ${r.status}${r.completeness.isComplete ? '' : ` (missing ${[...r.completeness.missing, ...r.completeness.invalid].join(', ')})`}.`,
    );
  }

  protected prepare(): void {
    const d = this.detail();
    if (!d) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.prepare(d.authorizationId, d.version).subscribe({
      next: (proposal) => void this.router.navigate(['/proposals', proposal.proposalId]),
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
      },
    });
  }

  private act<T>(request: import('rxjs').Observable<T>, describe: (result: T) => string): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (result) => {
        this.busy.set(false);
        this.notice.set(describe(result));
        this.load();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(toUiError(e));
        // A version conflict means someone else changed it: show the current state.
        this.load();
      },
    });
  }
}
