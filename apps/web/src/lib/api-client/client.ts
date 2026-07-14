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

export interface RadarDimension {
  name: string;
  score: number;
}

export interface DiagnosisResponse {
  reviewId?: string;
  summary: string;
  tags: string[];
  radarDimensions: RadarDimension[];
  confidenceScore: number;
  recommendedRoles: RecommendedRole[];
}

export interface RoleSelectionInput {
  roleId: string;
  weight: number;
}

export interface SelectedRole {
  roleId: string;
  roleCode: string;
  roleName: string;
  weight: number;
  removable: boolean;
}

export interface RoleSelectionResponse {
  roles: SelectedRole[];
}

export interface StartReviewResponse {
  sessionId: string;
  status: 'running';
}

export interface ReportActionItem {
  title: string;
  sourceAgent: string;
  priority: string;
  status: string;
}

export interface ReportOpinion {
  dimension: string;
  agentCode: string;
  agentName: string;
  riskLevel: string;
  issue: string;
  recommendation: string;
  confidenceScore: number;
}

export interface ReportRisk {
  title: string;
  riskLevel: string;
  sourceAgent: string;
  dimension: string;
  description: string;
}

export interface ReportMetrics {
  p0RiskCount: number;
  totalRiskCount: number;
  adoptionRate: number;
  durationMinutes: number;
  totalRoles: number;
}

export interface ReportLowConfidenceItem {
  agentCode: string;
  agentName: string;
  issue: string;
  confidenceScore: number;
}

export interface ReportResponse {
  reviewId?: string;
  title?: string;
  objective?: string;
  status?: string;
  mode?: string;
  verdict: string;
  source: 'db_opinions' | 'mock_fallback';
  opinionCount: number;
  generatedFromTurns: boolean;
  executiveSummary: string;
  metrics: ReportMetrics;
  risks: ReportRisk[];
  opinions: ReportOpinion[];
  actionItems: ReportActionItem[];
  lowConfidenceItems: ReportLowConfidenceItem[];
  providerSummary?: {
    totalTurns: number;
    bySource: {
      mock?: number;
      lmstudio?: number;
      openai_compatible?: number;
      fallback_mock?: number;
      failed?: number;
    };
    fallbackCount: number;
    failedCount: number;
    models: string[];
    hasRealProvider: boolean;
  };
}

export interface CreateReviewInput {
  title: string;
  objective: string;
  content?: string;
  mode?: string;
}

export interface ReviewResponse {
  id: string;
  title: string;
  status: string;
}

export interface ReviewListItem {
  id: string;
  title: string;
  objective: string;
  status: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewListResponse {
  items: ReviewListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Backward-compatible offset (derived from page on the server). */
  offset?: number;
}

export interface GetReviewsParams {
  status?: string;
  mode?: string;
  search?: string;
  page?: number;
  limit?: number;
  offset?: number;
}

// Real API client connecting to backend
export const apiClient = {
  getReviews: async (params?: GetReviewsParams): Promise<ReviewListResponse> => {
    try {
      const response = await axios.get<ReviewListResponse>(`${API_BASE_URL}/reviews`, {
        params,
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`获取评审列表失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `获取评审列表失败: ${error.message}` : "获取评审列表失败。");
    }
  },
  createReview: async (payload: CreateReviewInput): Promise<ReviewResponse> => {
    try {
      const response = await axios.post<ReviewResponse>(`${API_BASE_URL}/reviews`, payload, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`创建评审失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `创建评审失败: ${error.message}` : "创建评审失败。");
    }
  },

  createDiagnosis: async (reviewId: string): Promise<void> => {
    try {
      await axios.post(`${API_BASE_URL}/reviews/${reviewId}/diagnose`, {}, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`请求诊断失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `请求诊断失败: ${error.message}` : "请求诊断失败。");
    }
  },

  getDiagnosis: async (reviewId: string): Promise<DiagnosisResponse | null> => {
    try {
      const response = await axios.get<DiagnosisResponse | null>(`${API_BASE_URL}/reviews/${reviewId}/diagnosis`, {
        headers: {
          'Authorization': `Bearer ${API_AUTH_TOKEN}`
        }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error(`未找到该评审信息 (404): ${error.response?.data?.message || '评审 ID 无效或不存在。'}`);
        }
        throw new Error(`获取诊断结果失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `获取诊断结果失败: ${error.message}` : "获取诊断结果失败。");
    }
  },

  saveRoleSelection: async (reviewId: string, roles: RoleSelectionInput[]): Promise<RoleSelectionResponse> => {
    try {
      const response = await axios.post<RoleSelectionResponse>(`${API_BASE_URL}/reviews/${reviewId}/roles`, { roles }, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`保存评审团失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `保存评审团失败: ${error.message}` : "保存评审团失败。");
    }
  },

  startReview: async (reviewId: string): Promise<StartReviewResponse> => {
    try {
      const response = await axios.post<StartReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/start`, {}, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`启动评审失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `启动评审失败: ${error.message}` : "启动评审失败。");
    }
  },

  getReport: async (reviewId: string): Promise<ReportResponse> => {
    try {
      const response = await axios.get<ReportResponse>(`${API_BASE_URL}/reviews/${reviewId}/report`, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error(`未找到报告 (404): ${error.response?.data?.message || '评审可能尚未完成，或评审 ID 无效'}`);
        }
        throw new Error(`获取报告失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `获取报告失败: ${error.message}` : "获取报告失败。");
    }
  },

  getReview: async (reviewId: string): Promise<ReviewResponse> => {
    try {
      const response = await axios.get<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}`, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error("未找到该评审信息 (404)。请检查评审 ID 是否正确。");
        }
        if (error.response?.status === 400) {
          throw new Error("无效的请求 (400)。请检查请求参数。");
        }
        throw new Error(`获取评审详情失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `获取评审详情失败: ${error.message}` : "获取评审详情失败。");
    }
  },

  exportReportMarkdown: async (reviewId: string): Promise<void> => {
    try {
      const response = await axios.get(`${API_BASE_URL}/reviews/${reviewId}/report/export.md`, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` },
        responseType: 'blob'
      });

      let filename = `prismreview-${reviewId}.md`;
      const disposition = response.headers['content-disposition'];
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`导出 Markdown 失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `导出 Markdown 失败: ${error.message}` : "导出 Markdown 失败。");
    }
  },

  archiveReview: async (reviewId: string): Promise<ReviewResponse> => {
    try {
      const response = await axios.patch<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/archive`, {}, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`归档评审失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `归档评审失败: ${error.message}` : "归档评审失败。");
    }
  },

  unarchiveReview: async (reviewId: string): Promise<ReviewResponse> => {
    try {
      const response = await axios.patch<ReviewResponse>(`${API_BASE_URL}/reviews/${reviewId}/unarchive`, {}, {
        headers: { 'Authorization': `Bearer ${API_AUTH_TOKEN}` }
      });
      return response.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        throw new Error(`取消归档失败: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(error instanceof Error ? `取消归档失败: ${error.message}` : "取消归档失败。");
    }
  }
};
