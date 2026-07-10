import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // Sprint 1 Mock: 注入一个默认用户
    // 后续 Sprint 替换为真实的 JWT 验证
    if (!request.user) {
      request.user = {
        id: '00000000-0000-0000-0000-000000000001',
        tenantId: '00000000-0000-0000-0000-000000000001',
        departmentId: null,
        name: 'Mock User',
        email: 'mock@prismreview.dev',
        platformRole: 'enterprise_admin',
      };
    }
    return true;
  }
}
