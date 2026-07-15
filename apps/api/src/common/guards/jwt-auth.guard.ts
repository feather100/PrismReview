import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // DEBUG temporaire
    if (process.env.AUTH_DEBUG) console.log(`[JwtGuard] ${request.method} ${request.url} user=${request.user ? 'Y' : 'N'} url=${request.originalUrl || request.url}`);
    // Sprint 1 Mock: 注入一个默认用户；后续 Sprint 替换为真实 JWT 验证
    if (!request.user) {
      request.user = {
        id: '00000000-0000-0000-0000-000000000001',
        tenantId: '00000000-0000-0000-0000-000000000001',
        departmentId: null,
        name: 'Mock User',
        email: 'mock@prismreview.dev',
        platformRole: 'enterprise_admin', // 默认 mock，不影响既有 smoke（红线 #6）
        permissions: this.authService.getPermissions('enterprise_admin'), // ← 关键：补 permissions
      };
    } else if (!request.user.permissions) {
      request.user.permissions = this.authService.getPermissions(
        request.user.platformRole ?? 'user',
      );
    }
    return true;
  }
}
