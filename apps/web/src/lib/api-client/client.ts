import axios, { isAxiosError } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
const API_AUTH_TOKEN = process.env.NEXT_PUBLIC_API_AUTH_TOKEN || 'test-token';

export interface RecommendedRole {
  roleId: string;
  roleCode: string;
  roleName: string;
  weight: number;
  reason: string;
  removable: boolean;
}

export interface RadarDimension { name: string; score: number }

export interface DiagnosisResponse {
  reviewId?: string;
  summary: string;
  tags: string[];
  radarDimensions: RadarDimension[];
  confidenceScore: number;
  recommendedRoles: RecommendedRole[];
}

export interface RoleSelectionInput { roleId: string; weight: number; }
export interface SelectedRole { roleId: string; roleCode: string; roleName: string; weight: number; removable: boolean; }
export interface RoleSelectionResponse { roles: SelectedRole[]; }
export interface StartReviewResponse { sessionId: string; status: 'running'; }

export interface ReportActionItem { title: string; sourceAgent: string; priority: string; status: string; }
export interface ReportOpinion { dimension: string; agentCode: string; agentName: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number; }
export interface ReportRisk { title: string; riskLevel: string; sourceAgent: string; dimension: string; description: string; }
export interface ReportMetrics { p0RiskCount: number; totalRiskCount: number; adoptionRate: number; durationMinutes: number; totalRoles: number; }
export interface ReportLowConfidenceItem { agentCode: string; agentName: string; issue: string; confidenceScore: number; }
export interface ReportResponse {
  reviewId?: string; title?: string; objective?: string; status?: string; mode?: string;
  verdict: string; source: 'db_opinions' | 'mock_fallback'; opinionCount: number; generatedFromTurns: boolean;
  executiveSummary: string; metrics: ReportMetrics; risks: ReportRisk[]; opinions: ReportOpinion[];
  actionItems: ReportActionItem[]; lowConfidenceItems: ReportLowConfidenceItem[];
  providerSummary?: { totalTurns: number; bySource: Record<string, number>; fallbackCount: number; failedCount: number; models: string[]; hasRealProvider: boolean; };
}

export interface CreateReviewInput {
  title: string; objective: string; content?: string; mode?: string;
  provider?: { provider: 'mock' | 'lmstudio' | 'openai_compatible'; model?: string; baseUrl?: string; apiKey?: string; };
  lang?: 'zh' | 'en'; // 强制专家回复语言（默认 auto-detect）
}
export interface ReviewResponse { id: string; title: string; status: string; }
export interface ReviewListItem { id: string; title: string; objective: string; status: string; mode: string; createdAt: string; updatedAt: string; }
export interface ReviewListResponse { items: ReviewListItem[]; total: number; page: number; limit: number; totalPages: number; offset?: number; }
export interface GetReviewsParams { status?: string; mode?: string; search?: string; page?: number; limit?: number; offset?: number; }

export interface RoleBrief { id: string; name: string; code: string; activeVersionId: string | null; isPreset: boolean; updatedAt: string; }
export interface RoleDetail { id: string; name: string; code: string; type?: string; status?: string; departmentId?: string; systemPrompt?: string; dimensions?: string[]; activeVersionId?: string; versions?: { id: string; version: string; dimensions: string[]; createdAt: string }[]; }
export interface AuditLogItem { id: string; action: string; resource: string; resourceId: string | null; userId: string | null; createdAt: string; detail?: unknown; }
export interface AuditLogList { items: AuditLogItem[]; total: number; page: number; totalPages: number; }
export interface KnowledgeDocument { id: string; title: string; status: string; chunkCount: number; createdAt: string; }
export interface WorkflowPreset { id: string; name: string; description: string; }
export interface PromptTemplate { id: string; roleCode: string; version: string; layer: 'base' | 'task' | 'context' | 'format'; content: string; metadata?: { description?: string; createdBy?: string; schemaVersion?: string }; createdAt: string; }

const auth = { Authorization: `Bearer ${API_AUTH_TOKEN}` };
function err(msg: string, e: unknown): Error {
  if (isAxiosError(e)) return new Error(`${msg}: ${e.response?.data?.message || e.message}`);
  return new Error(e instanceof Error ? `${msg}: ${e.message}` : `${msg}.`);
}

export const apiClient = {
  getReviews: async (p?: GetReviewsParams): Promise<ReviewListResponse> => {
    try { return (await axios.get<ReviewListResponse>(`${API_BASE_URL}/reviews`, { params: p, headers: auth })).data; }
    catch (e: unknown) { throw err('获取评审列表失败', e); }
  },
  createReview: async (payload: CreateReviewInput): Promise<ReviewResponse> => {
    try { return (await axios.post<ReviewResponse>(`${API_BASE_URL}/reviews`, payload, { headers: auth })).data; }
    catch (e: unknown) { throw err('创建评审失败', e); }
  },
  createDiagnosis: async (reviewId: string): Promise<void> => {
    try { await axios.post(`${API_BASE_URL}/reviews/${reviewId}/diagnose`, {}, { headers: auth }); }
    catch (e: unknown) { throw err('请求诊断失败', e); }
  },
  getDiagnosis: async (reviewId: string): Promise<DiagnosisResponse | null> => {
    try { return (await axios.get<DiagnosisResponse | null>(`${API_BASE_URL}/reviews/${reviewId}/diagnosis`, { headers: auth })).data; }
    catch (e: unknown) {
      if (isAxiosError(e) && e.response?.status === 404) throw new Error(`未找到该评审信息 (404): ${e.response?.data?.message || '评审 ID 无效或不存在。'}`);
      throw err('获取诊断结果失败', e);
    }
  },
  saveRoleSelection: async (reviewId: string, roles: RoleSelectionInput[]): Promise<RoleSelectionResponse> => {
    try { return (await axios.post<RoleSelectionResponse>(`${API_BASE_URL}/reviews/${reviewId}/roles`, { roles }, { headers: auth })).data; }
    catch (e: unknown) { throw err('保存评审团失败', e); }
  },
  startReview: async (reviewId: string): Promise<StartReviewResponse> => {
    try { return (await axios.post<StartReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/start`, {}, { headers: auth })).data; }
    catch (e: unknown) { throw err('启动评审失败', e); }
  },
  getReport: async (reviewId: string): Promise<ReportResponse> => {
    try { return (await axios.get<ReportResponse>(`${API_BASE_URL}/reviews/${reviewId}/report`, { headers: auth })).data; }
    catch (e: unknown) {
      if (isAxiosError(e) && e.response?.status === 404) throw new Error(`未找到报告 (404): ${e.response?.data?.message || '评审可能尚未完成，或评审 ID 无效'}`);
      throw err('获取报告失败', e);
    }
  },
  getReview: async (reviewId: string): Promise<ReviewResponse> => {
    try { return (await axios.get<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}`, { headers: auth })).data; }
    catch (e: unknown) {
      if (isAxiosError(e)) {
        if (e.response?.status === 404) throw new Error("未找到该评审信息 (404)。请检查评审 ID 是否正确。");
        if (e.response?.status === 400) throw new Error("无效的请求 (400)。请检查请求参数。");
      }
      throw err('获取评审详情失败', e);
    }
  },
  exportReportMarkdown: async (reviewId: string): Promise<void> => {
    try {
      const response = await axios.get(`${API_BASE_URL}/reviews/${reviewId}/report/export.md`, { headers: auth, responseType: 'blob' });
      let filename = `prismreview-${reviewId}.md`;
      const disposition = response.headers['content-disposition'];
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches != null && matches[1]) filename = matches[1].replace(/['"]/g, '');
      }
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url; link.setAttribute('download', filename);
      document.body.appendChild(link); link.click();
      document.body.removeChild(link); window.URL.revokeObjectURL(url);
    } catch (e: unknown) { throw err('导出 Markdown 失败', e); }
  },
  archiveReview: async (reviewId: string): Promise<ReviewResponse> => {
    try { return (await axios.patch<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/archive`, {}, { headers: auth })).data; }
    catch (e: unknown) { throw err('归档评审失败', e); }
  },
  unarchiveReview: async (reviewId: string): Promise<ReviewResponse> => {
    try { return (await axios.patch<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/unarchive`, {}, { headers: auth })).data; }
    catch (e: unknown) { throw err('取消归档失败', e); }
  },
  interruptReview: async (reviewId: string): Promise<ReviewResponse> => {
    try { return (await axios.post<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/interrupt`, {}, { headers: auth })).data; }
    catch (e: unknown) { throw err('中断评审失败', e); }
  },
  resumeReview: async (reviewId: string): Promise<ReviewResponse> => {
    try { return (await axios.post<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/resume`, {}, { headers: auth })).data; }
    catch (e: unknown) { throw err('恢复评审失败', e); }
  },
  submitHumanTurn: async (reviewId: string, payload: { roleCode: string; dimension: string; issue: string; recommendation: string; riskLevel?: string }): Promise<void> => {
    try { await axios.post(`${API_BASE_URL}/reviews/${reviewId}/meetings`, payload, { headers: auth }); }
    catch (e: unknown) { throw err('提交人工意见失败', e); }
  },

  // ── Roles ─────────────────────────────────────────────────────────────
  listRoles: async (): Promise<RoleBrief[]> => { try { return (await axios.get<RoleBrief[]>(`${API_BASE_URL}/roles`, { headers: auth })).data; } catch (e: unknown) { throw err('获取角色列表失败', e); } },
  getRole: async (id: string): Promise<RoleDetail> => { try { return (await axios.get<RoleDetail>(`${API_BASE_URL}/roles/${id}`, { headers: auth })).data; } catch (e: unknown) { throw err('获取角色详情失败', e); } },
  createRole: async (p: { name: string; code: string; systemPrompt?: string; dimensions?: string[] }): Promise<RoleDetail> => { try { return (await axios.post<RoleDetail>(`${API_BASE_URL}/roles`, p, { headers: auth })).data; } catch (e: unknown) { throw err('创建角色失败', e); } },
  updateRole: async (id: string, p: Partial<{ name: string; code: string; systemPrompt: string; dimensions: string[] }>): Promise<RoleDetail> => { try { return (await axios.patch<RoleDetail>(`${API_BASE_URL}/roles/${id}`, p, { headers: auth })).data; } catch (e: unknown) { throw err('更新角色失败', e); } },
  disableRole: async (id: string): Promise<void> => { try { await axios.post(`${API_BASE_URL}/roles/${id}/disable`, {}, { headers: auth }); } catch (e: unknown) { throw err('停用角色失败', e); } },
  deleteRole: async (id: string): Promise<void> => { try { await axios.delete(`${API_BASE_URL}/roles/${id}`, { headers: auth }); } catch (e: unknown) { throw err('删除角色失败', e); } },

  // ── Audit / Knowledge / Workflows / Prompts ─────────────────────────
  listAuditLogs: async (p?: { action?: string; resource?: string; page?: number; limit?: number }): Promise<AuditLogList> => { try { return (await axios.get<AuditLogList>(`${API_BASE_URL}/audit/logs`, { params: p, headers: auth })).data; } catch (e: unknown) { throw err('获取审计日志失败', e); } },
  listKnowledge: async (): Promise<KnowledgeDocument[]> => { try { return (await axios.get<KnowledgeDocument[]>(`${API_BASE_URL}/knowledge/documents`, { headers: auth })).data; } catch (e: unknown) { throw err('获取知识库失败', e); } },
  uploadKnowledge: async (p: { title: string; content: string; mimeType?: string }): Promise<KnowledgeDocument> => { try { return (await axios.post<KnowledgeDocument>(`${API_BASE_URL}/knowledge/documents`, p, { headers: auth })).data; } catch (e: unknown) { throw err('上传文档失败', e); } },
  listWorkflows: async (): Promise<WorkflowPreset[]> => { try { return (await axios.get<WorkflowPreset[]>(`${API_BASE_URL}/workflows`, { headers: auth })).data; } catch (e: unknown) { throw err('获取 Workflow 失败', e); } },
  listPrompts: async (p?: { roleCode?: string; layer?: string }): Promise<PromptTemplate[]> => { try { return (await axios.get<PromptTemplate[]>(`${API_BASE_URL}/prompts`, { params: p, headers: auth })).data; } catch (e: unknown) { throw err('获取 Prompt 模板失败', e); } },
  registerPrompt: async (p: { roleCode: string; layer: string; content: string; version?: string; description?: string }): Promise<PromptTemplate> => { try { return (await axios.post<PromptTemplate>(`${API_BASE_URL}/prompts`, p, { headers: auth })).data; } catch (e: unknown) { throw err('注册 Prompt 失败', e); } },
  promptHistory: async (roleCode: string, layer?: string): Promise<PromptTemplate[]> => { try { return (await axios.get<PromptTemplate[]>(`${API_BASE_URL}/prompts/${encodeURIComponent(roleCode)}/history`, { params: layer ? { layer } : undefined, headers: auth })).data; } catch (e: unknown) { throw err('获取 Prompt 历史失败', e); } },
  rollbackPrompt: async (roleCode: string, layer: string, version: string): Promise<PromptTemplate> => { try { return (await axios.post<PromptTemplate>(`${API_BASE_URL}/prompts/${encodeURIComponent(roleCode)}/rollback`, { layer, version }, { headers: auth })).data; } catch (e: unknown) { throw err('回滚 Prompt 失败', e); } },

  // ── LLM Provider Admin ─────────────────────────────────────────────
  llmStatus: async (): Promise<{ hasActive: boolean; active: any; envConfigured: boolean }> => { try { return (await axios.get(`${API_BASE_URL}/llm-providers/status`, { headers: auth })).data; } catch (e: unknown) { throw err('获取 Provider 状态失败', e); } },
  llmListProviders: async (): Promise<any[]> => { try { return (await axios.get(`${API_BASE_URL}/llm-providers`, { headers: auth })).data; } catch (e: unknown) { throw err('获取 Provider 列表失败', e); } },
  llmCreate: async (input: any): Promise<any> => { try { return (await axios.post(`${API_BASE_URL}/llm-providers`, input, { headers: auth })).data; } catch (e: unknown) { throw err('创建 Provider 失败', e); } },
  llmUpdate: async (id: string, input: any): Promise<any> => { try { return (await axios.patch(`${API_BASE_URL}/llm-providers/${id}`, input, { headers: auth })).data; } catch (e: unknown) { throw err('更新 Provider 失败', e); } },
  llmDelete: async (id: string): Promise<void> => { try { await axios.delete(`${API_BASE_URL}/llm-providers/${id}`, { headers: auth }); } catch (e: unknown) { throw err('删除 Provider 失败', e); } },
  llmActivate: async (id: string): Promise<any> => { try { return (await axios.post(`${API_BASE_URL}/llm-providers/${id}/activate`, {}, { headers: auth })).data; } catch (e: unknown) { throw err('激活 Provider 失败', e); } },
  llmTest: async (id: string): Promise<any> => { try { return (await axios.post(`${API_BASE_URL}/llm-providers/${id}/test`, {}, { headers: auth })).data; } catch (e: unknown) { throw err('测试 Provider 失败', e); } },
};
