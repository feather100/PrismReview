import { Expose } from 'class-transformer';

export class ReviewResponseDto {
  @Expose() id: string;
  @Expose() title: string;
  @Expose() objective: string;
  @Expose() status: string;
  @Expose() mode: string;
  @Expose() inputType: string;
  @Expose() createdBy: string;
  @Expose() createdAt: string;
  @Expose() updatedAt: string;
}

export class DiagnosisResponseDto {
  @Expose() summary: string;
  @Expose() tags: string[];
  @Expose() radarDimensions: { name: string; score: number }[];
  @Expose() confidenceScore: number;
  @Expose() recommendedRoles: {
    roleId: string;
    roleCode: string;
    roleName: string;
    weight: number;
    reason: string;
    removable: boolean;
  }[];
}
