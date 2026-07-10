import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.params.tenantId || request.body?.tenantId || request.query?.tenantId;

    // If no specific tenant param, allow (controller will inject user.tenantId)
    if (!tenantId) return true;

    if (user.tenantId !== tenantId) {
      throw new ForbiddenException('TENANT_ISOLATION_VIOLATION');
    }
    return true;
  }
}
