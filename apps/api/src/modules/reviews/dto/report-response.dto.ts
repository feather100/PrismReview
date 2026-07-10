import { Expose } from 'class-transformer';

export class ReportRiskItem {
  @Expose() title: string;
  @Expose() riskLevel: string;
  @Expose() sourceAgent: string;
  @Expose() dimension: string;
  @Expose() description: string;
}

export class ReportOpinionItem {
  @Expose() dimension: string;
  @Expose() agentCode: string;
  @Expose() agentName: string;
  @Expose() riskLevel: string;
  @Expose() issue: string;
  @Expose() recommendation: string;
  @Expose() confidenceScore: number;
}

export class ReportActionItem {
  @Expose() title: string;
  @Expose() sourceAgent: string;
  @Expose() priority: string;
  @Expose() status: string;
}

export class ReportLowConfidenceItem {
  @Expose() agentCode: string;
  @Expose() agentName: string;
  @Expose() issue: string;
  @Expose() confidenceScore: number;
}

export class ReportResponseDto {
  @Expose() reviewId: string;
  @Expose() title: string;
  @Expose() objective: string;
  @Expose() status: string;
  @Expose() mode: string;

  @Expose() source: string;     // 'db_opinions' | 'mock_fallback'
  @Expose() opinionCount: number;
  @Expose() generatedFromTurns: boolean;

  @Expose() providerSummary?: {
    totalTurns: number;
    bySource: {
      mock?: number; lmstudio?: number; openai_compatible?: number; fallback_mock?: number; failed?: number;
    };
    fallbackCount: number;
    failedCount: number;
    models: string[];
    hasRealProvider: boolean;
  };

  @Expose() verdict: string; // approved | conditionally_approved | rejected

  @Expose() executiveSummary: string;

  @Expose() metrics: {
    p0RiskCount: number;
    totalRiskCount: number;
    adoptionRate: number;
    durationMinutes: number;
    totalRoles: number;
  };

  @Expose() risks: ReportRiskItem[];
  @Expose() opinions: ReportOpinionItem[];
  @Expose() actionItems: ReportActionItem[];
  @Expose() lowConfidenceItems: ReportLowConfidenceItem[];
}
