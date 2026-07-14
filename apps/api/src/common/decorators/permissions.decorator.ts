import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 标记某个路由所需的最小权限集合。
 * 语义为 OR：调用方只要持有其中之一即通过。
 * 不标注 @RequirePermissions 的路由不被 PermissionsGuard 拦截。
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
