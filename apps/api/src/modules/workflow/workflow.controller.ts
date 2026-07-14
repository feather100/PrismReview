/**
 * workflow.controller.ts — P5 新增端点（Contract §6.4 / §8.2）
 *
 * GET /api/workflows → 列出 preset 摘要（**不含** weights / availableTools / thresholds 等细节）。
 * 仅暴露 { id, name, description }，供前端新建评审下拉使用。
 */
import { Controller, Get, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { WorkflowRegistry } from './workflow.registry';

@Controller('workflows')
@UseInterceptors(ClassSerializerInterceptor)
export class WorkflowController {
  constructor(private readonly registry: WorkflowRegistry) {}

  /** GET /api/workflows — 返回 preset 摘要（id / name / description）。 */
  @Get()
  @RequirePermissions('role.read')
  listWorkflows(): Array<{ id: string; name: string; description: string }> {
    return this.registry.listPresets().map((c) => ({
      id: c.id,
      name: c.nameZh,
      description: c.description,
    }));
  }
}
