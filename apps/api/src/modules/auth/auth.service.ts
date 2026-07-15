import { Injectable } from '@nestjs/common';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    'review.create', 'review.read.all', 'review.delete',
    'role.read', 'role.write', 'role.delete',
    'kb.upload', 'kb.read', 'kb.delete',
    'admin.access', 'audit.read', 'tenant.manage',
  ],
  enterprise_admin: [
    'review.create', 'review.read', 'review.read.all',
    'role.read', 'role.write',
    'kb.upload', 'kb.read',
    'admin.access', 'audit.read',
  ],
  department_admin: [
    'review.create', 'review.read.department',
    'role.read', 'role.write',
    'kb.upload', 'kb.read',
  ],
  user: [
    'review.create', 'review.read.owned',
    'role.read',
    'kb.read',
  ],
};

@Injectable()
export class AuthService {
  getPermissions(platformRole: string): string[] {
    return ROLE_PERMISSIONS[platformRole] ?? ROLE_PERMISSIONS.user;
  }
}
