import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { GuideService } from './guide.service';

interface PageHelp {
  title: string;
  what: string;
  points: string[];
}

function helpFor(url: string): PageHelp {
  if (url.startsWith('/login'))
    return {
      title: 'Sign-in',
      what: 'Proves who you are. Everything else is decided by the server from your identity.',
      points: [
        'Coordinators can change requests; viewers can only read.',
        'Tenant A and Tenant B cannot see each other\'s data.',
        'The deactivated user shows what happens when access is revoked.',
      ],
    };
  if (url.startsWith('/proposals/'))
    return {
      title: 'Review and approve',
      what: 'The one place where a submission gets approved, and only a person can do it.',
      points: [
        'The countdown shows the 5-minute expiry. After that, prepare a new proposal.',
        'If the request changes after preparation, the proposal becomes Stale.',
        'After approval, submit here or let the AI assistant submit it.',
      ],
    };
  if (url.startsWith('/submissions/'))
    return {
      title: 'Submission progress',
      what: 'Follows one submission through the simulated payer.',
      points: [
        'Queued, then Under review, then Approved or Denied.',
        'The outcome comes from the request\'s fixture scenario, never from an AI.',
        'On free hosting the server sleeps when idle, so progress may pause.',
      ],
    };
  if (url.startsWith('/authorizations/'))
    return {
      title: 'Request details',
      what: 'One prior-authorization request: its documents, the payer rule it must meet, and its history.',
      points: [
        'Documents: the checklist compares attached fixtures with the pinned rule.',
        'Actions: Validate re-checks the rule; Prepare starts the approval step.',
        'Timeline: every status change, who made it and why.',
        'Every change carries the version you loaded. If someone changed it first, you are asked to reload.',
      ],
    };
  return {
    title: 'Request list',
    what: 'All prior-authorization requests for your tenant.',
    points: [
      'Filter by status, payer or service, or search by ID.',
      'Statuses run Draft, Awaiting Documents, Ready to Submit, Submitted, Under Review, then Approved or Denied.',
      'All data is synthetic demo data.',
    ],
  };
}

@Component({
  selector: 'ab-guide-panel',
  imports: [RouterLink],
  template: `
    @if (guide.open()) {
      <aside class="guide" aria-label="Guide">
        <header class="guide-head">
          <strong>Guide</strong>
          <span class="guide-progress">{{ guide.completedCount() }}/{{ guide.steps.length }}</span>
          <button type="button" class="ghost" (click)="guide.toggle()" aria-label="Hide guide">✕</button>
        </header>
        <div class="guide-bar"><span [style.width.%]="percent()"></span></div>

        <details class="guide-card">
          <summary>What is AuthBridge?</summary>
          <p>
            A demo of how an AI assistant can help with <b>healthcare prior authorization</b>: asking an insurer
            to approve a treatment before it happens. All data and the "payer" are simulated.
          </p>
          <p>
            It is a <b>custom MCP server</b>: eight tools that let an AI read requests, validate them and prepare
            submissions against the same database this screen uses.
          </p>
          <ul>
            <li><b>Local MCP</b>: stdio, on this laptop, for development.</li>
            <li><b>Remote MCP</b>: <code>/mcp</code> over HTTPS on the server, which checks your sign-in token.</li>
          </ul>
          <p>
            The AI can do almost everything, except approve. That is a human decision and happens only in this UI.
          </p>
        </details>

        <section class="guide-card">
          <h3>On this page: {{ help().title }}</h3>
          <p>{{ help().what }}</p>
          <ul>
            @for (p of help().points; track p) {
              <li>{{ p }}</li>
            }
          </ul>
        </section>

        <section class="guide-card">
          <h3>Walkthrough</h3>
          @if (guide.current(); as step) {
            <div class="guide-now">
              <span class="guide-label">Do this next</span>
              <strong>{{ step.title }}</strong>
              <p>{{ step.doing }}</p>
              <p class="muted"><b>Behind the scenes:</b> {{ step.behind }}</p>
              @if (step.api) {
                <p class="guide-tech"><span>API</span><code>{{ step.api }}</code></p>
              }
              @if (step.mcp) {
                <p class="guide-tech"><span>MCP</span><code>{{ step.mcp }}</code></p>
              }
              @if (step.mcpNote) {
                <p class="guide-tech"><span>MCP</span><em>{{ step.mcpNote }}</em></p>
              }
              @if (step.link && !onPage(step.link)) {
                <a class="button-link" [routerLink]="step.link">Take me there →</a>
              }
            </div>
          } @else {
            <div class="guide-now done">
              <strong>Walkthrough complete ✓</strong>
              <p>
                You took a request from missing documents to a simulated decision. Next, try AUTH-106 (it gets denied),
                AUTH-110 (it fails once, then approves), or sign in as the Viewer to see read-only access.
              </p>
            </div>
          }

          <ol class="guide-steps">
            @for (s of guide.steps; track s.id) {
              <li [class.done]="guide.isDone(s.id)" [class.current]="guide.current()?.id === s.id">{{ s.title }}</li>
            }
          </ol>
          <button type="button" class="secondary small" (click)="guide.restart()">Restart walkthrough</button>
        </section>
      </aside>
    } @else {
      <button type="button" class="guide-fab" (click)="guide.toggle()" aria-label="Show guide">? Guide</button>
    }
  `,
})
export class GuidePanel {
  protected readonly guide = inject(GuideService);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly help = computed(() => helpFor(this.url() ?? '/'));
  protected readonly percent = computed(() => (this.guide.completedCount() / this.guide.steps.length) * 100);

  protected onPage(link: string): boolean {
    return (this.url() ?? '').split('?')[0] === link;
  }
}
