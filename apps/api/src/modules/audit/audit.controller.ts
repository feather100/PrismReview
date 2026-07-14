import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

/**
 * 审计读 API（Sprint 5.0）。
 *
 * 全部端点要求 audit.read；强制租户隔离（super_admin 例外可读所有，红线 #9）。
 */
@Controller('audit')
@RequirePermissions('audit.read')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  async listLogs(@CurrentUser() user: AuthUser, @Query() q: ListAuditQueryDto) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const limit = q.limit && q.limit > 0 ? q.limit : 20;
    const skip = (page - 1) * limit;

    // 租户隔离：非 super_admin 仅可见本租户日志
    const where: any = {};
    if (user.platformRole !== 'super_admin') {
      where.tenantId = user.tenantId;
    }
    if (q.action) where.action = q.action;
    if (q.resource) where.resource = q.resource;
    if (q.userId) where.userId = q.userId;

    const { items, total } = await this.auditService.list(where, skip, limit);
    return {
      items,
      total,
      page,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}
