// Mirrors the backend DTOs (AuthBridge.Application.Dtos). Values are synthetic demo data.

export type AuthorizationStatus =
  | 'Draft'
  | 'AwaitingDocuments'
  | 'ReadyToSubmit'
  | 'Submitted'
  | 'UnderReview'
  | 'Approved'
  | 'Denied';

export type AttemptState = 'Queued' | 'Processing' | 'Completed' | 'Failed';

export type ProposalState = 'PendingApproval' | 'Approved' | 'Expired' | 'Consumed' | 'Stale';

export const AUTHORIZATION_STATUSES: AuthorizationStatus[] = [
  'Draft',
  'AwaitingDocuments',
  'ReadyToSubmit',
  'Submitted',
  'UnderReview',
  'Approved',
  'Denied',
];

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Caller {
  actorId: string;
  tenantId: string;
  role: 'Viewer' | 'Coordinator';
  canWrite: boolean;
  displayLabel: string;
}

export interface AuthorizationSummary {
  authorizationId: string;
  status: AuthorizationStatus;
  payerCode: string;
  serviceCode: string;
  memberLabel: string;
  version: string;
  updatedAtUtc: string;
  requiredDocumentCount: number;
  validDocumentCount: number;
}

export interface RuleReference {
  requirementSetId: string;
  payerCode: string;
  serviceCode: string;
  ruleVersion: string;
  isActive: boolean;
  isDemo: boolean;
}

export interface AttachedDocument {
  documentType: string;
  fixtureKey: string;
  isValid: boolean;
  createdAtUtc: string;
}

export interface AuthorizationStatusDetail {
  authorizationId: string;
  tenantId: string;
  status: AuthorizationStatus;
  version: string;
  payerCode: string;
  serviceCode: string;
  memberLabel: string;
  demoScenario: string;
  rule: RuleReference;
  documents: AttachedDocument[];
  submissionAttemptId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface MissingDocuments {
  authorizationId: string;
  ruleVersion: string;
  required: string[];
  present: string[];
  missing: string[];
  invalid: string[];
  isComplete: boolean;
}

export interface HistoryEntry {
  id: string;
  previousStatus: AuthorizationStatus | null;
  newStatus: AuthorizationStatus;
  actorId: string;
  reason: string;
  occurredAtUtc: string;
  correlationId: string;
}

export interface DocumentFixture {
  key: string;
  documentType: string;
  isValid: boolean;
  description: string;
}

export interface DocumentAttachment {
  authorizationId: string;
  documentType: string;
  fixtureKey: string;
  isValid: boolean;
  replaced: boolean;
  status: AuthorizationStatus;
  version: string;
}

export interface ValidationResult {
  authorizationId: string;
  previousStatus: AuthorizationStatus;
  status: AuthorizationStatus;
  statusChanged: boolean;
  version: string;
  completeness: MissingDocuments;
}

export interface Proposal {
  proposalId: string;
  authorizationId: string;
  requestStatus: AuthorizationStatus;
  payerCode: string;
  serviceCode: string;
  ruleVersion: string;
  memberLabel: string;
  simulatedAction: string;
  summary: string;
  expectedRequestVersion: string;
  state: ProposalState;
  actorId: string;
  isOwnedByCaller: boolean;
  createdAtUtc: string;
  expiresAtUtc: string;
  approvedAtUtc: string | null;
  consumedAtUtc: string | null;
  reviewUrl: string;
}

export interface Submission {
  attemptId: string;
  authorizationId: string;
  proposalId: string;
  state: AttemptState;
  requestStatus: AuthorizationStatus;
  payerReference: string | null;
  failureCount: number;
  lastError: string | null;
  createdAtUtc: string;
  completedAtUtc: string | null;
  isReplay: boolean;
}

export interface ListFilter {
  status?: string;
  payerCode?: string;
  serviceCode?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/** The in-app assistant: an MCP client of this server's own /mcp endpoint. */
export interface AssistantToolInfo {
  name: string;
  title: string | null;
  description: string | null;
  readOnly: boolean;
}

export interface AssistantInfo {
  enabled: boolean;
  model: string;
  tools: AssistantToolInfo[];
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** One MCP tool call made while answering, exactly as /mcp returned it. */
export interface AssistantToolStep {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  errorCode: string | null;
  result: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } | null;
}

export interface AssistantReply {
  text: string;
  steps: AssistantToolStep[];
  model: string;
}
