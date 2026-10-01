import { JsonPipe } from '@angular/common';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { UiError, toUiError } from '../../core/api/api-error';
import { AssistantInfo, AssistantMessage, AssistantToolStep } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { CallerService, ErrorAlert, PageService } from '../../shared/ui';

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  steps?: AssistantToolStep[];
}

/** A piece of reply text: plain, an in-app link, or an external https link. */
export interface Segment {
  text: string;
  route?: string;
  href?: string;
}

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINKS = new RegExp(`(https?://[^\\s)]+|/proposals/${GUID}|/submissions/${GUID}|AUTH-\\d{3})`, 'gi');

/** Splits reply text so request IDs and review links become clickable without using innerHTML. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINKS)) {
    const value = match[0].replace(/[.,]$/, '');
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const inApp = value.match(new RegExp(`/(proposals|submissions)/${GUID}`, 'i'));
    if (/^AUTH-/i.test(value)) out.push({ text: value, route: `/authorizations/${value.toUpperCase()}` });
    else if (inApp) out.push({ text: value.startsWith('http') ? 'Open the review page' : value, route: inApp[0] });
    else out.push({ text: value, href: value });
    last = at + value.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** In-app pages a tool result points to: the review page after prepare, progress after submit. */
export function stepLink(step: AssistantToolStep): { label: string; route: string } | null {
  const data = step.result?.data ?? {};
  if (step.ok && step.tool === 'prepare_authorization_submission' && typeof data['proposalId'] === 'string')
    return { label: 'Open the review page to approve', route: `/proposals/${data['proposalId']}` };
  if (step.ok && step.tool === 'submit_authorization_request' && typeof data['attemptId'] === 'string')
    return { label: 'Follow the submission', route: `/submissions/${data['attemptId']}` };
  return null;
}

const SUGGESTIONS = [
  "What's missing on AUTH-104?",
  'Is AUTH-105 ready? If it is, prepare it for submission.',
  'Show the history of AUTH-109.',
  'What does Demo Health Plan A need for an MRI scan?',
  'Show me AUTH-204.',
];

@Component({
  selector: 'ab-assistant-page',
  imports: [RouterLink, JsonPipe, Icon, ErrorAlert],
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: minmax(0, 1fr); } }
    .chat { display: flex; flex-direction: column; gap: 16px; min-height: 420px; }
    .log { display: flex; flex-direction: column; gap: 14px; }
    .msg { max-width: 78ch; border-radius: 14px; padding: 12px 16px; line-height: 1.55; overflow-wrap: anywhere; }
    .msg-text { white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: var(--primary); color: var(--on-primary); border-bottom-right-radius: 4px; }
    .msg.assistant { align-self: flex-start; background: var(--surface-2); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
    .msg a { color: inherit; font-weight: 600; }
    .steps { display: grid; gap: 6px; margin-top: 10px; white-space: normal; }
    details.step { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    details.step > summary { cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; list-style: none; flex-wrap: wrap; }
    details.step > summary::-webkit-details-marker { display: none; }
    .step-body { padding: 0 12px 12px; display: grid; gap: 8px; }
    .step-body pre { margin: 0; max-height: 260px; overflow: auto; font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; white-space: pre; }
    .composer { display: flex; gap: 10px; align-items: flex-end; }
    .composer textarea { flex: 1; min-width: 0; resize: vertical; min-height: 48px; max-height: 200px; font: inherit; }
    .sugg { display: flex; flex-wrap: wrap; gap: 8px; }
    .sugg button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
    .sugg button:hover { border-color: var(--primary); color: var(--primary); }
    .flow { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; counter-reset: f; }
    .flow li { counter-increment: f; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; font-size: 13px; line-height: 1.45; color: var(--text-2); }
    .flow li::before { content: counter(f); width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 600; background: var(--primary-soft); color: var(--primary); }
    .tool-row { display: grid; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .tool-row:last-child { border-bottom: 0; }
    .typing { display: inline-flex; gap: 4px; align-items: center; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); animation: blink 1.2s infinite ease-in-out; }
    .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 50% { opacity: .25; } }
    @media (prefers-reduced-motion: reduce) { .typing i { animation: none; } }
  `,
  template: `
    <div class="page">
      @if (info(); as i) {
        @if (!i.enabled) {
          <div class="alert a-warn" role="status">
            <ab-icon name="key" [size]="18" />
            <div><p class="at">The assistant is not switched on for this server</p>
              <p class="ad">It needs an Anthropic API key on the backend (Render → Environment → <span class="mono">Assistant__ApiKey</span>). The MCP connection already works: the tools on the right came live from <span class="mono">/mcp</span>.</p></div>
          </div>
        }
      }
      <ab-error [error]="loadError()" (retry)="load()" />

      <div class="layout">
        <section class="card chat" aria-label="Chat with the assistant">
          <div class="card-h" style="margin-bottom: 0">
            <div><h2 class="card-t">Ask the assistant</h2>
              <p class="card-s">It can only use the AuthBridge MCP tools, with your permissions{{ roleNote() }}. It cannot approve anything.</p></div>
            @if (entries().length > 0) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="clear()"><ab-icon name="rotate-ccw" [size]="14" /><span>New chat</span></button>
            }
          </div>

          <div class="log" aria-live="polite">
            @if (entries().length === 0) {
              <p class="body muted">Try one of these. Each answer shows the MCP tool calls it made, with the exact input and result.</p>
              <div class="sugg">
                @for (s of suggestions; track s) { <button type="button" (click)="send(s)" [disabled]="busy() || !enabled()">{{ s }}</button> }
              </div>
            }
            @for (e of entries(); track $index) {
              <div class="msg" [class.user]="e.role === 'user'" [class.assistant]="e.role === 'assistant'">
                @if (e.role === 'user') { <div class="msg-text">{{ e.text }}</div> } @else {
                  <div class="msg-text">@for (seg of segs(e.text); track $index) {@if (seg.route) {<a [routerLink]="seg.route">{{ seg.text }}</a>} @else if (seg.href) {<a [href]="seg.href" target="_blank" rel="noopener">{{ seg.text }}</a>} @else {<span>{{ seg.text }}</span>}}</div>
                  @if (e.steps?.length) {
                    <div class="steps">
                      @for (s of e.steps; track $index) {
                        <details class="step">
                          <summary>
                            <ab-icon [name]="s.ok ? 'check-circle' : 'x-circle'" [size]="14" [style.color]="s.ok ? 'var(--success)' : 'var(--danger)'" />
                            <span class="mono" style="font-weight: 600">{{ s.tool }}</span>
                            <span class="pill" [class.p-success]="s.ok" [class.p-danger]="!s.ok">{{ s.ok ? 'ok' : s.errorCode }}</span>
                            <span class="cap">MCP tools/call · click for details</span>
                          </summary>
                          <div class="step-body">
                            <p class="cap" style="margin: 0">Input the model sent</p><pre>{{ s.input | json }}</pre>
                            <p class="cap" style="margin: 0">Result from /mcp</p><pre>{{ s.result | json }}</pre>
                          </div>
                        </details>
                        @if (link(s); as l) {
                          <a class="btn btn-pri btn-sm" style="justify-self: start" [routerLink]="l.route"><ab-icon name="arrow-right" [size]="14" /><span>{{ l.label }}</span></a>
                        }
                      }
                    </div>
                  }
                }
              </div>
            }
            @if (busy()) {
              <div class="msg assistant" aria-label="The assistant is working"><span class="typing"><i></i><i></i><i></i></span> <span class="cap">Calling tools…</span></div>
            }
          </div>

          <ab-error [error]="sendError()" (retry)="retry()" />

          <form class="composer" (submit)="submit($event)">
            <label class="sr-only" for="ask">Message</label>
            <textarea #box id="ask" class="inp" rows="2" maxlength="4000" placeholder="Ask about a request, e.g. What's missing on AUTH-104?"
                      [disabled]="!enabled()" (keydown.enter)="enter($event)"></textarea>
            <button type="submit" class="btn btn-pri" [disabled]="busy() || !enabled()"><ab-icon name="send" [size]="16" /><span>Send</span></button>
          </form>
        </section>

        <aside style="display: grid; gap: 16px">
          <section class="card tight">
            <h2 class="card-t">How this works</h2>
            <ol class="flow" style="margin-top: 12px">
              <li><span>Your message goes to the AuthBridge server, never straight to the AI.</span></li>
              <li><span>The server connects to its own <span class="mono">/mcp</span> endpoint with your sign-in token, like any MCP client.</span></li>
              <li><span>Claude picks tools from the list below. Each call goes through <span class="mono">/mcp</span>, which checks your tenant and role.</span></li>
              <li><span>You see every tool call. Approving is still a click on the review page.</span></li>
            </ol>
          </section>
          <section class="card tight">
            <h2 class="card-t">Tools from MCP</h2>
            <p class="card-s">Live from <span class="mono">tools/list</span>@if (info(); as i) { · model {{ i.model }} }</p>
            <div style="margin-top: 8px">
              @for (t of info()?.tools ?? []; track t.name) {
                <div class="tool-row">
                  <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
                    <span class="mono" style="font-size: 12px; font-weight: 600">{{ t.name }}</span>
                    <span class="pill" [class.p-info]="t.readOnly" [class.p-warn]="!t.readOnly">{{ t.readOnly ? 'read' : 'act' }}</span>
                  </div>
                </div>
              } @empty {
                @if (!loadError()) { <div class="sk" style="height: 160px; margin-top: 8px"></div> }
              }
            </div>
            <p class="cap" style="margin-top: 10px">No approve tool exists. A person approves on the review page.</p>
          </section>
        </aside>
      </div>
    </div>
  `,
})
export class AssistantPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly callers = inject(CallerService);
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly info = signal<AssistantInfo | null>(null);
  protected readonly entries = signal<ChatEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly loadError = signal<UiError | null>(null);
  protected readonly sendError = signal<UiError | null>(null);
  protected readonly enabled = computed(() => this.info()?.enabled === true);
  protected readonly roleNote = computed(() => {
    const c = this.callers.caller();
    return c ? ` (${c.role}, ${c.tenantId})` : '';
  });
  protected readonly segs = segments;
  protected readonly link = stepLink;
  private lastQuestion = '';

  constructor() {
    inject(PageService).set('Assistant', [{ label: 'Workspace' }, { label: 'Assistant' }]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loadError.set(null);
    this.api.assistant().subscribe({
      next: (i) => this.info.set(i),
      error: (e: unknown) => this.loadError.set(toUiError(e)),
    });
  }

  protected enter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey) return;
    key.preventDefault();
    this.submit(key);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const box = this.box()?.nativeElement;
    const text = box?.value.trim() ?? '';
    if (!text) return;
    if (box) box.value = '';
    this.send(text);
  }

  protected send(text: string): void {
    if (this.busy() || !this.enabled()) return;
    this.lastQuestion = text;
    this.sendError.set(null);
    const history: AssistantMessage[] = [...this.entries().map(({ role, text }) => ({ role, text })), { role: 'user', text }];
    this.entries.update((e) => [...e, { role: 'user', text }]);
    this.busy.set(true);
    this.api.ask(history).subscribe({
      next: (reply) => {
        this.entries.update((e) => [...e, { role: 'assistant', text: reply.text || '(No text reply.)', steps: reply.steps }]);
        this.busy.set(false);
      },
      error: (e: unknown) => {
        // Take the unanswered question back out so the conversation still alternates.
        this.entries.update((list) => list.slice(0, -1));
        const box = this.box()?.nativeElement;
        if (box && !box.value) box.value = text;
        this.sendError.set(toUiError(e));
        this.busy.set(false);
      },
    });
  }

  protected retry(): void {
    const box = this.box()?.nativeElement;
    const text = box?.value.trim() || this.lastQuestion;
    if (box) box.value = '';
    if (text) this.send(text);
  }

  protected clear(): void {
    this.entries.set([]);
    this.sendError.set(null);
  }
}
