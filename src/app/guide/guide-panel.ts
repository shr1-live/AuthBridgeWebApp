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
        'The ring counts down the 5-minute expiry: amber under a minute, red under thirty seconds.',
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
  if (url.startsWith('/submissions'))
    return {
      title: 'Submissions',
      what: 'Requests that have been sent to the simulated payer, newest first.',
      points: ['Open one to follow its progress or see the decision.', 'Decisions come from fixture scenarios, never from an AI.'],
    };
  if (url.startsWith('/assistant'))
    return {
      title: 'Assistant',
      what: 'Chat with Claude about your requests. It is a real MCP client of this server.',
      points: [
        'The server connects to its own /mcp endpoint with your token, exactly like an external AI.',
        'Open any tool call to see the input the model chose and the result /mcp returned.',
        'Tenant and role still apply: try AUTH-204 from tenant A, or ask a viewer to prepare.',
        'It can prepare a submission, but only you can approve it on the review page.',
      ],
    };
  if (url.startsWith('/activity'))
    return {
      title: 'Activity',
      what: 'Every recent status change across your tenant.',
      points: ['Each entry shows who changed what, when, and why.', 'Changes made by the simulated payer are labelled as such.'],
    };
  return {
    title: 'Requests',
    what: 'All prior-authorization requests for your tenant.',
    points: [
      'The four KPI cards filter the list when clicked.',
      'Filters apply the moment you change them; paging always uses the filters you see.',
      'Switch between Table and Cards; your choice is remembered.',
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
          <strong class="h3">Guide</strong>
          <span class="guide-progress cap">{{ guide.completedCount() }}/{{ guide.steps.length }}</span>
          <button type="button" class="btn btn-ghost btn-sm" style="width: 32px; padding: 0" (click)="guide.toggle()" aria-label="Hide guide">✕</button>
        </header>
        <div class="bar"><i [style.width.%]="percent()"></i></div>

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
              <span class="guide-label up">Do this next</span>
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
                <a class="btn btn-pri btn-sm" style="margin-top: 6px" [routerLink]="step.link">Take me there →</a>
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
          <button type="button" class="btn btn-sec btn-sm" (click)="guide.restart()">Restart walkthrough</button>
        </section>
      </aside>
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
