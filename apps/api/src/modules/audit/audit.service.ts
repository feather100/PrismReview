import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 审计服务（Sprint 5.0）。
 *
 * 所有写操作经 AuditInterceptor 调用本服务留痕。
 * 写入以 .catch 兜底，绝不抛错阻塞主业务流程（红线 #8）。
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    tenantId: string;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    detail?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          detail: input.detail ?? {},
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      })
      .catch(() => {
        /* 审计不阻塞主流程 */
      });
  }

  /** 供 AuditController 读取审计日志（租户隔离在 controller 层施加）。 */
  async list(where: any, skip: number, take: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
