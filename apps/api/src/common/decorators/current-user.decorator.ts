import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  tenantId: string;
  departmentId: string | null;
  name: string;
  email: string;
  platformRole: string;
  permissions: string[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | string | string[] | null => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    if (!data) return user;
    return user?.[data] ?? null;
  },
);
