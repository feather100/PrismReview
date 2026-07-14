import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * 平台 RBAC 守卫（Sprint 5.0）。
 *
 * 执行语义为 OR：只要调用方持有 required 中的任意一个权限即通过。
 * 未标注 @RequirePermissions 的路由视为不要求额外权限（仍由前置的 JwtAuthGuard 保证登录）。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 未标注 → 不拦截
    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user;
    if (!user) {
      throw new ForbiddenException('AUTH_REQUIRED');
    }

    const hold: string[] = Array.isArray(user.permissions) ? user.permissions : [];
    if (!required.some((p) => hold.includes(p))) {
      throw new ForbiddenException(
        `PERMISSION_DENIED: requires one of [${required.join(', ')}]`,
      );
    }
    return true;
  }
}
