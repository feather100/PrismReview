import { Expose } from 'class-transformer';

export class AuthUserResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() email: string;
  @Expose() tenantId: string;
  @Expose() departmentId?: string;
  @Expose() platformRole: string;
  @Expose() permissions: string[];
}
