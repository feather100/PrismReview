import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleBriefDto, RoleDetailDto } from './dto/role-response.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(
    tenantId: string,
    filters?: { excludeIds?: string[]; reviewId?: string },
  ): Promise<RoleBriefDto[]> {
    const where: any = {
      tenantId,
      status: { not: 'deleted' },
    };

    // G05: exclude already-selected roles for a review
    if (filters?.reviewId) {
      const review = await this.prisma.review.findUnique({
        where: { id: filters.reviewId },
        select: { roleSelection: true, tenantId: true },
      });
      // Only apply filter if review belongs to this tenant
      if (review && review.tenantId === tenantId && review.roleSelection) {
        const selected = (review.roleSelection as any)?.roles?.map((r: any) => r.roleId) ?? [];
        if (selected.length > 0) {
          where.id = { notIn: selected };
        }
      }
    } else if (filters?.excludeIds?.length) {
      where.id = { notIn: filters.excludeIds };
    }

    const roles = await this.prisma.agentRole.findMany({
      where,
      include: {
        activeVersion: {
          select: { id: true, version: true, dimensions: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return roles.map(this.toBriefDto);
  }

  async getRole(tenantId: string, roleId: string): Promise<RoleDetailDto> {
    const role = await this.prisma.agentRole.findFirst({
      where: { id: roleId, tenantId },
      include: {
        activeVersion: {
          select: { id: true, version: true, dimensions: true },
        },
        versions: {
          select: { id: true, version: true, dimensions: true, createdAt: true },
          orderBy: { version: 'desc' },
          take: 20,
        },
      },
    });

    if (!role) throw new NotFoundException('Role not found');
    return this.toDetailDto(role);
  }

  async createRole(tenantId: string, userId: string, dto: CreateRoleDto): Promise<RoleDetailDto> {
    // Check code uniqueness within tenant
    const existing = await this.prisma.agentRole.findFirst({
      where: { tenantId, code: dto.code, status: { not: 'deleted' } },
    });
    if (existing) throw new BadRequestException(`Role code "${dto.code}" already exists`);

    const role = await this.prisma.agentRole.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        type: 'custom',
        status: 'enabled',
      },
    });

    // Create initial version
    const version = await this.prisma.agentRoleVersion.create({
      data: {
        roleId: role.id,
        version: 1,
        systemPrompt: dto.systemPrompt ?? `你是${dto.name}，负责从专业角度审查方案。`,
        dimensions: dto.dimensions ?? ['综合评估'],
        outputSchema: dto.outputSchema ?? this.defaultOutputSchema(),
        knowledgeCollectionIds: [],
        createdBy: userId,
      },
    });

    // Set active version
    await this.prisma.agentRole.update({
      where: { id: role.id },
      data: { activeVersionId: version.id },
    });

    return this.getRole(tenantId, role.id);
  }

  async createVersion(tenantId: string, roleId: string, userId: string, dto: any): Promise<RoleDetailDto> {
    const role = await this.prisma.agentRole.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const latestVersion = await this.prisma.agentRoleVersion.findFirst({
      where: { roleId },
      orderBy: { version: 'desc' },
    });

    await this.prisma.agentRoleVersion.create({
      data: {
        roleId,
        version: (latestVersion?.version ?? 0) + 1,
        systemPrompt: dto.systemPrompt ?? '',
        dimensions: dto.dimensions ?? [],
        outputSchema: dto.outputSchema ?? this.defaultOutputSchema(),
        knowledgeCollectionIds: dto.knowledgeCollectionIds ?? [],
        createdBy: userId,
      },
    });

    return this.getRole(tenantId, roleId);
  }

  async activateVersion(tenantId: string, roleId: string, versionId: string): Promise<RoleDetailDto> {
    const version = await this.prisma.agentRoleVersion.findFirst({
      where: { id: versionId, roleId },
    });
    if (!version) throw new NotFoundException('Version not found');

    await this.prisma.agentRole.update({
      where: { id: roleId },
      data: { activeVersionId: versionId },
    });

    return this.getRole(tenantId, roleId);
  }

  // 产品化：编辑角色元数据（name / code / dimensions / systemPrompt）。
  // 不改 type / status（由 disable/enable 单独控制）；编辑不改版本内容，
  // 版本内容由 createVersion 管理。
  async updateRole(tenantId: string, roleId: string, dto: UpdateRoleDto, userId: string): Promise<RoleDetailDto> {
    const role = await this.prisma.agentRole.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new NotFoundException('Role not found');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.dimensions !== undefined) data.dimensions = dto.dimensions;
    if (dto.systemPrompt !== undefined) {
      // 写入 AgentRole.systemPrompt 作为兜底；版本化以 activeVersion 为准
      data.systemPrompt = dto.systemPrompt;
    }

    const updated = await this.prisma.agentRole.update({
      where: { id: roleId },
      data,
      include: { versions: { orderBy: { createdAt: 'desc' } } },
    });
    return this.toDetailDto(updated);
  }

  async disableRole(tenantId: string, roleId: string): Promise<void> {
    const role = await this.prisma.agentRole.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.agentRole.update({
      where: { id: roleId },
      data: { status: 'disabled' },
    });
  }

  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    const role = await this.prisma.agentRole.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found');

    // P1: Preset roles cannot be deleted, only disabled
    if (role.type === 'preset') {
      throw new BadRequestException('Preset roles cannot be deleted. Use disable instead.');
    }

    await this.prisma.agentRole.update({
      where: { id: roleId },
      data: { status: 'deleted' },
    });
  }

  // ── Helpers ──

  private toBriefDto(role: any): RoleBriefDto {
    const dto = new RoleBriefDto();
    dto.id = role.id;
    dto.code = role.code;
    dto.name = role.name;
    dto.type = role.type;
    dto.status = role.status;
    dto.createdAt = role.createdAt?.toISOString?.() ?? role.createdAt;
    if (role.activeVersion) {
      dto.activeVersion = {
        id: role.activeVersion.id,
        version: role.activeVersion.version,
        dimensions: role.activeVersion.dimensions as string[],
      };
    }
    return dto;
  }

  private toDetailDto(role: any): RoleDetailDto {
    const dto = new RoleDetailDto();
    Object.assign(dto, this.toBriefDto(role));
    dto.departmentId = role.departmentId ?? undefined;
    if (role.versions) {
      dto.versions = role.versions.map((v: any) => ({
        id: v.id,
        version: v.version,
        dimensions: v.dimensions as string[],
        createdAt: v.createdAt?.toISOString?.() ?? v.createdAt,
      }));
    }
    return dto;
  }

  private defaultOutputSchema() {
    return {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    };
  }
}
