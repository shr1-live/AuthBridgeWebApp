import { AssistantToolStep } from '../../core/api/models';
import { segments, stepLink } from './assistant.page';

const id = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('assistant reply rendering', () => {
  it('links request IDs and review URLs inside the app, without HTML', () => {
    const parts = segments(`AUTH-104 is ready. Approve it at http://localhost:4200/proposals/${id}.`);
    expect(parts[0]).toEqual({ text: 'AUTH-104', route: '/authorizations/AUTH-104' });
    expect(parts.find((p) => p.route?.startsWith('/proposals/'))).toEqual({ text: 'Open the review page', route: `/proposals/${id}` });
    expect(parts.map((p) => p.text).join('')).toContain('is ready. Approve it at ');
  });

  it('keeps other https links external and leaves plain text alone', () => {
    expect(segments('See https://example.org/docs')).toEqual([{ text: 'See ' }, { text: 'https://example.org/docs', href: 'https://example.org/docs' }]);
    expect(segments('Nothing to link.')).toEqual([{ text: 'Nothing to link.' }]);
  });

  it('offers the review page after a successful prepare, and nothing after a failure', () => {
    const step: AssistantToolStep = { tool: 'prepare_authorization_submission', input: {}, ok: true, errorCode: null, result: { ok: true, data: { proposalId: id } } };
    expect(stepLink(step)).toEqual({ label: 'Open the review page to approve', route: `/proposals/${id}` });
    expect(stepLink({ ...step, ok: false, errorCode: 'FORBIDDEN' })).toBeNull();
  });
});
