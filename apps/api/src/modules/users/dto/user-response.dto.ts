export class UserResponseDto {
  id: string;
  tenantId: string;
  departmentId?: string | null;
  email: string;
  name: string;
  platformRole: string;
  status: string;
  createdAt: Date;
}
