import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UserResponseDto } from './dto/user-response.dto';

/**
 * 用户管理服务（Sprint 5.0）。
 *
 * 租户内 CRUD；写操作受 RBAC 保护（controller 层）。
 * 约束：
 *  - 同租户 email 防重（service 层 findFirst；schema 的 email unique 为全局约束）。
 *  - departmentId 仅字段接收 + 存在性校验（不建独立 Department CRUD，见 §1.3 Out）。
 *  - 删除为软删除（status='disabled'），物理行保留。
 *  - passwordHash 写占位 'mock_password_hash'，不引入 bcrypt（红线 #3）。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(u: any): UserResponseDto {
    return {
      id: u.id,
      tenantId: u.tenantId,
      departmentId: u.departmentId ?? null,
      email: u.email,
      name: u.name,
      platformRole: u.platformRole,
      status: u.status,
      createdAt: u.createdAt,
    };
  }

  async listUsers(tenantId: string, query: ListUsersQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (query.platformRole) where.platformRole = query.platformRole;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => this.toResponse(u)),
      total,
      page,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getUser(tenantId: string, userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!u) throw new NotFoundException('USER_NOT_FOUND');
    return this.toResponse(u);
  }

  async createUser(tenantId: string, dto: CreateUserDto) {
    // 同租户 email 防重
    const existing = await this.prisma.user.findFirst({ where: { tenantId, email: dto.email } });
    if (existing) throw new BadRequestException('EMAIL_ALREADY_EXISTS');

    // departmentId 存在性校验
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, tenantId },
      });
      if (!dept) throw new BadRequestException('DEPARTMENT_NOT_FOUND');
    }

    const u = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        platformRole: dto.platformRole,
        departmentId: dto.departmentId ?? null,
        passwordHash: 'mock_password_hash', // 占位，不引入 bcrypt（红线 #3）
        status: 'active',
      },
    });
    return this.toResponse(u);
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!existing) throw new NotFoundException('USER_NOT_FOUND');

    // 自救问题（如管理员误改自己角色/状态）留真 auth 处理，这里不做阻止
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.platformRole !== undefined) data.platformRole = dto.platformRole;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId ?? null;
    if (dto.status !== undefined) data.status = dto.status;

    const u = await this.prisma.user.update({ where: { id: userId }, data });
    return this.toResponse(u);
  }

  async deleteUser(tenantId: string, userId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!existing) throw new NotFoundException('USER_NOT_FOUND');
    // 软删除：物理行保留，状态置 disabled
    const u = await this.prisma.user.update({ where: { id: userId }, data: { status: 'disabled' } });
    return this.toResponse(u);
  }
}
