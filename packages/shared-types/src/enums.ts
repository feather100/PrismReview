// Shared enums
export const ReviewStatus = {
  DRAFT: 'draft',
  DIAGNOSING: 'diagnosing',
  READY: 'ready',
  RUNNING: 'running',
  INTERRUPTED: 'interrupted',
  SUMMARIZING: 'summarizing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ARCHIVED: 'archived',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const ReviewMode = {
  ROUND_ROBIN: 'round_robin',
  FREE_DEBATE: 'free_debate',
  BLIND_CONSENSUS: 'blind_consensus',
  RED_BLUE: 'red_blue',
} as const;
export type ReviewMode = (typeof ReviewMode)[keyof typeof ReviewMode];

export const AgentTurnStatus = {
  QUEUED: 'queued',
  RETRIEVING: 'retrieving',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  COMPLETED: 'completed',
  TIMEOUT: 'timeout',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  INTERRUPTED_PENDING: 'interrupted_pending',
} as const;
export type AgentTurnStatus = (typeof AgentTurnStatus)[keyof typeof AgentTurnStatus];

export const RiskLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const DocumentStatus = {
  UPLOADING: 'uploading',
  PARSING: 'parsing',
  CHUNKING: 'chunking',
  INDEXING: 'indexing',
  READY: 'ready',
  PARSE_FAILED: 'parse_failed',
  INDEX_FAILED: 'index_failed',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const ChunkReviewStatus = {
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DEPRECATED: 'deprecated',
} as const;
export type ChunkReviewStatus = (typeof ChunkReviewStatus)[keyof typeof ChunkReviewStatus];

export const ActionItemStatus = {
  OPEN: 'open',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELED: 'canceled',
} as const;
export type ActionItemStatus = (typeof ActionItemStatus)[keyof typeof ActionItemStatus];

export const ReportStatus = {
  GENERATING: 'generating',
  READY: 'ready',
  FAILED: 'failed',
  HUMAN_REVIEW_REQUIRED: 'human_review_required',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const TenantStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const UserPlatformRole = {
  SUPER_ADMIN: 'super_admin',
  ENTERPRISE_ADMIN: 'enterprise_admin',
  DEPARTMENT_ADMIN: 'department_admin',
  USER: 'user',
} as const;
export type UserPlatformRole = (typeof UserPlatformRole)[keyof typeof UserPlatformRole];

export const AgentRoleType = {
  PRESET: 'preset',
  CUSTOM: 'custom',
  MARKETPLACE: 'marketplace',
} as const;
export type AgentRoleType = (typeof AgentRoleType)[keyof typeof AgentRoleType];
